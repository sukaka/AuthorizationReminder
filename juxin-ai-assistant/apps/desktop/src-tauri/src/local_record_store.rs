use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use ring::digest::{digest, SHA256};
use serde::de::DeserializeOwned;
use serde::Serialize;
use tempfile::NamedTempFile;

use crate::keychain::SecretStore;
use crate::local_crypto::{decrypt, device_key, encrypt};
use crate::local_queue::LocalQueueError;
use crate::server_config::ServerOrigin;

#[derive(Clone, Copy)]
pub enum RecordKind {
    Draft,
    PendingResult,
}

impl RecordKind {
    const fn file_prefix(self) -> &'static str {
        match self {
            Self::Draft => "draft-",
            Self::PendingResult => "pending-",
        }
    }

    const fn aad_purpose(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::PendingResult => "pending-result",
        }
    }
}

pub struct LocalRecordStore<'a> {
    root: PathBuf,
    secrets: &'a dyn SecretStore,
}

impl<'a> LocalRecordStore<'a> {
    pub fn new(root: &Path, secrets: &'a dyn SecretStore) -> Self {
        Self {
            root: root.join("v2"),
            secrets,
        }
    }

    pub fn write<T: Serialize>(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        kind: RecordKind,
        record_id: &str,
        value: &T,
    ) -> Result<(), LocalQueueError> {
        validate_user_identity(user_id)?;
        validate_record_identifier(record_id)?;
        let directory = self.scope_directory(user_id, origin);
        fs::create_dir_all(&directory).map_err(|_| LocalQueueError::Io)?;
        let plaintext = serde_json::to_vec(value).map_err(|_| LocalQueueError::Corrupt)?;
        let identity = record_identity(user_id, origin, record_id);
        let envelope = encrypt(
            &device_key(self.secrets)?,
            &identity,
            kind.aad_purpose(),
            &plaintext,
        )?;
        let mut temporary = NamedTempFile::new_in(&directory).map_err(|_| LocalQueueError::Io)?;
        temporary
            .write_all(&envelope)
            .and_then(|()| temporary.as_file().sync_all())
            .map_err(|_| LocalQueueError::Io)?;
        temporary
            .persist(self.record_path(user_id, origin, kind, record_id))
            .map_err(|_| LocalQueueError::Io)?;
        Ok(())
    }

    pub fn read<T: DeserializeOwned>(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        kind: RecordKind,
        record_id: &str,
    ) -> Result<Option<T>, LocalQueueError> {
        validate_user_identity(user_id)?;
        validate_record_identifier(record_id)?;
        let path = self.record_path(user_id, origin, kind, record_id);
        if !path.exists() {
            return Ok(None);
        }
        let envelope = fs::read(path).map_err(|_| LocalQueueError::Io)?;
        let identity = record_identity(user_id, origin, record_id);
        let plaintext = decrypt(
            &device_key(self.secrets)?,
            &identity,
            kind.aad_purpose(),
            &envelope,
        )?;
        serde_json::from_slice(&plaintext)
            .map(Some)
            .map_err(|_| LocalQueueError::Corrupt)
    }

    pub fn list<T: DeserializeOwned>(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        kind: RecordKind,
    ) -> Result<Vec<T>, LocalQueueError> {
        validate_user_identity(user_id)?;
        let directory = self.scope_directory(user_id, origin);
        if !directory.exists() {
            return Ok(Vec::new());
        }
        let mut record_ids = Vec::new();
        for entry in fs::read_dir(directory).map_err(|_| LocalQueueError::Io)? {
            let entry = entry.map_err(|_| LocalQueueError::Io)?;
            if let Some(record_id) = record_id_from_path(&entry.path(), kind) {
                record_ids.push(record_id);
            }
        }
        record_ids.sort();
        record_ids
            .into_iter()
            .map(|record_id| {
                self.read(user_id, origin, kind, &record_id)?
                    .ok_or(LocalQueueError::Corrupt)
            })
            .collect()
    }

    pub fn remove(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        kind: RecordKind,
        record_id: &str,
    ) -> Result<(), LocalQueueError> {
        validate_user_identity(user_id)?;
        validate_record_identifier(record_id)?;
        let path = self.record_path(user_id, origin, kind, record_id);
        if path.exists() {
            fs::remove_file(path).map_err(|_| LocalQueueError::Io)?;
        }
        Ok(())
    }

    fn record_path(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        kind: RecordKind,
        record_id: &str,
    ) -> PathBuf {
        self.scope_directory(user_id, origin)
            .join(format!("{}{record_id}.bin", kind.file_prefix()))
    }

    fn scope_directory(&self, user_id: &str, origin: &ServerOrigin) -> PathBuf {
        let scope = format!("{user_id}\0{}", origin.as_str());
        self.root.join(hex_digest(scope.as_bytes()))
    }
}

pub(crate) fn validate_user_identity(value: &str) -> Result<(), LocalQueueError> {
    if value.is_empty() || value.len() > 160 || value.chars().any(char::is_control) {
        return Err(LocalQueueError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_record_identifier(value: &str) -> Result<(), LocalQueueError> {
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(LocalQueueError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn validate_legacy_identifier(value: &str) -> Result<(), LocalQueueError> {
    validate_record_identifier(value)
}

fn record_identity(user_id: &str, origin: &ServerOrigin, record_id: &str) -> String {
    format!("{user_id}\0{}\0{record_id}", origin.as_str())
}

fn record_id_from_path(path: &Path, kind: RecordKind) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    file_name
        .strip_prefix(kind.file_prefix())?
        .strip_suffix(".bin")
        .map(str::to_string)
}

fn hex_digest(value: &[u8]) -> String {
    digest(&SHA256, value)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
