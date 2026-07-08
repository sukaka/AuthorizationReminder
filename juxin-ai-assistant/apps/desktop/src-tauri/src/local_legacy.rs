use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;

use crate::keychain::SecretStore;
use crate::local_crypto::{decrypt, device_key};
use crate::local_queue::{DraftInput, LegacyUnassignedData, LocalQueueError, PendingResult};
use crate::local_record_store::{validate_legacy_identifier, LocalRecordStore, RecordKind};
use crate::server_config::ServerOrigin;

const DRAFTS_PURPOSE: &str = "drafts";
const QUEUE_PURPOSE: &str = "sync-queue";

pub fn migrate_legacy_records(
    root: &Path,
    secrets: &dyn SecretStore,
    records: &LocalRecordStore<'_>,
    user_id: &str,
    legacy_origin: Option<&ServerOrigin>,
) -> Result<(), LocalQueueError> {
    if validate_legacy_identifier(user_id).is_err() {
        return Ok(());
    }
    migrate_kind::<DraftInput, _>(
        root,
        secrets,
        records,
        user_id,
        legacy_origin,
        LegacyKind::Drafts,
        |draft| &draft.task_id,
    )?;
    migrate_kind::<PendingResult, _>(
        root,
        secrets,
        records,
        user_id,
        legacy_origin,
        LegacyKind::Queue,
        |result| &result.id,
    )
}

pub fn export_unassigned(
    root: &Path,
    secrets: &dyn SecretStore,
    user_id: &str,
) -> Result<LegacyUnassignedData, LocalQueueError> {
    validate_legacy_identifier(user_id)?;
    Ok(LegacyUnassignedData {
        drafts: read_optional_legacy(root, secrets, user_id, LegacyKind::Drafts, true)?,
        pending_results: read_optional_legacy(root, secrets, user_id, LegacyKind::Queue, true)?,
    })
}

pub fn delete_unassigned(root: &Path, user_id: &str) -> Result<(), LocalQueueError> {
    validate_legacy_identifier(user_id)?;
    for kind in [LegacyKind::Drafts, LegacyKind::Queue] {
        let path = unassigned_path(root, user_id, kind);
        if path.exists() {
            fs::remove_file(path).map_err(|_| LocalQueueError::Io)?;
        }
    }
    Ok(())
}

#[derive(Clone, Copy)]
enum LegacyKind {
    Drafts,
    Queue,
}

impl LegacyKind {
    const fn purpose(self) -> &'static str {
        match self {
            Self::Drafts => DRAFTS_PURPOSE,
            Self::Queue => QUEUE_PURPOSE,
        }
    }

    const fn record_kind(self) -> RecordKind {
        match self {
            Self::Drafts => RecordKind::Draft,
            Self::Queue => RecordKind::PendingResult,
        }
    }
}

fn migrate_kind<T, F>(
    root: &Path,
    secrets: &dyn SecretStore,
    records: &LocalRecordStore<'_>,
    user_id: &str,
    legacy_origin: Option<&ServerOrigin>,
    kind: LegacyKind,
    record_id: F,
) -> Result<(), LocalQueueError>
where
    T: DeserializeOwned + serde::Serialize,
    F: Fn(&T) -> &str,
{
    let legacy_path = legacy_path(root, user_id, kind);
    if !legacy_path.exists() {
        return Ok(());
    }
    let Some(origin) = legacy_origin else {
        let destination = unassigned_path(root, user_id, kind);
        if destination.exists() {
            return Err(LocalQueueError::Io);
        }
        fs::rename(legacy_path, destination).map_err(|_| LocalQueueError::Io)?;
        return Ok(());
    };
    let values: Vec<T> = read_legacy_file(&legacy_path, secrets, user_id, kind.purpose())?;
    for value in &values {
        records.write(user_id, origin, kind.record_kind(), record_id(value), value)?;
    }
    fs::remove_file(legacy_path).map_err(|_| LocalQueueError::Io)
}

fn read_optional_legacy<T: DeserializeOwned>(
    root: &Path,
    secrets: &dyn SecretStore,
    user_id: &str,
    kind: LegacyKind,
    unassigned: bool,
) -> Result<Vec<T>, LocalQueueError> {
    let path = if unassigned {
        unassigned_path(root, user_id, kind)
    } else {
        legacy_path(root, user_id, kind)
    };
    if !path.exists() {
        return Ok(Vec::new());
    }
    read_legacy_file(&path, secrets, user_id, kind.purpose())
}

fn read_legacy_file<T: DeserializeOwned>(
    path: &Path,
    secrets: &dyn SecretStore,
    user_id: &str,
    purpose: &str,
) -> Result<Vec<T>, LocalQueueError> {
    let envelope = fs::read(path).map_err(|_| LocalQueueError::Io)?;
    let plaintext = decrypt(&device_key(secrets)?, user_id, purpose, &envelope)?;
    serde_json::from_slice(&plaintext).map_err(|_| LocalQueueError::Corrupt)
}

fn legacy_path(root: &Path, user_id: &str, kind: LegacyKind) -> PathBuf {
    root.join(format!("{}-{user_id}.bin", kind.purpose()))
}

fn unassigned_path(root: &Path, user_id: &str, kind: LegacyKind) -> PathBuf {
    root.join(format!(
        "legacy-unassigned-{}-{user_id}.bin",
        kind.purpose()
    ))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::sync::Mutex;

    use crate::keychain::SecretStore;
    use crate::local_crypto::{device_key, encrypt};
    use crate::local_queue::{DraftInput, LocalQueue, PendingResult, QueueStatus};
    use crate::server_config::ServerOrigin;

    #[derive(Default)]
    struct TestSecretStore {
        values: Mutex<BTreeMap<String, String>>,
    }

    impl SecretStore for TestSecretStore {
        fn set(&self, account: &str, secret: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|_| "LOCK".to_string())?
                .insert(account.to_string(), secret.to_string());
            Ok(())
        }

        fn get(&self, account: &str) -> Result<Option<String>, String> {
            Ok(self
                .values
                .lock()
                .map_err(|_| "LOCK".to_string())?
                .get(account)
                .cloned())
        }

        fn delete(&self, account: &str) -> Result<(), String> {
            self.values
                .lock()
                .map_err(|_| "LOCK".to_string())?
                .remove(account);
            Ok(())
        }
    }

    #[test]
    fn known_origin_migrates_legacy_queue_without_crossing_current_origin() {
        let directory = tempfile::tempdir().unwrap();
        let secrets = TestSecretStore::default();
        write_legacy(
            directory.path(),
            &secrets,
            "user-1",
            "sync-queue",
            &[PendingResult::new(
                "result-1",
                "legacy",
                QueueStatus::Pending,
            )],
        );
        let legacy = ServerOrigin::parse_production("https://legacy.example.com").unwrap();
        let current = ServerOrigin::parse_production("https://current.example.com").unwrap();
        let queue = LocalQueue::with_legacy_origin(directory.path(), &secrets, legacy.clone());

        assert!(queue.list("user-1", &current).unwrap().is_empty());
        assert_eq!(queue.list("user-1", &legacy).unwrap().len(), 1);
    }

    #[test]
    fn unknown_origin_is_exportable_but_not_visible_to_current_server() {
        let directory = tempfile::tempdir().unwrap();
        let secrets = TestSecretStore::default();
        write_legacy(
            directory.path(),
            &secrets,
            "user-1",
            "drafts",
            &[DraftInput::new("task-1", "legacy")],
        );
        write_legacy(
            directory.path(),
            &secrets,
            "user-1",
            "sync-queue",
            &[PendingResult::new(
                "result-1",
                "legacy",
                QueueStatus::Pending,
            )],
        );
        let current = ServerOrigin::parse_production("https://current.example.com").unwrap();
        let queue = LocalQueue::new(directory.path(), &secrets);

        assert!(queue
            .load_draft("user-1", &current, "task-1")
            .unwrap()
            .is_none());
        assert!(queue.list("user-1", &current).unwrap().is_empty());
        let exported = queue.export_legacy_unassigned("user-1").unwrap();
        assert_eq!(exported.drafts.len(), 1);
        assert_eq!(exported.pending_results.len(), 1);
        queue.delete_legacy_unassigned("user-1").unwrap();
        assert!(queue
            .export_legacy_unassigned("user-1")
            .unwrap()
            .drafts
            .is_empty());
    }

    fn write_legacy<T: serde::Serialize>(
        root: &std::path::Path,
        secrets: &dyn SecretStore,
        user_id: &str,
        purpose: &str,
        values: &[T],
    ) {
        let plaintext = serde_json::to_vec(values).unwrap();
        let envelope =
            encrypt(&device_key(secrets).unwrap(), user_id, purpose, &plaintext).unwrap();
        std::fs::write(root.join(format!("{purpose}-{user_id}.bin")), envelope).unwrap();
    }
}
