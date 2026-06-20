use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::de::DeserializeOwned;

use crate::keychain::SecretStore;
use crate::local_crypto::{decrypt, device_key, encrypt};
pub use crate::local_types::{
    CacheClearOptions, CacheClearReport, DraftInput, LocalQueueError, PendingResult, QueueStatus,
};

const MAX_PENDING_RESULTS: usize = 100;
const MAX_QUEUE_BYTES: usize = 20 * 1024 * 1024;
const DRAFT_RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60;

pub struct LocalQueue<'a> {
    root: PathBuf,
    secrets: &'a dyn SecretStore,
}

impl<'a> LocalQueue<'a> {
    pub fn new(root: &Path, secrets: &'a dyn SecretStore) -> Self {
        Self {
            root: root.to_path_buf(),
            secrets,
        }
    }

    pub fn push(&self, user_id: &str, result: PendingResult) -> Result<(), LocalQueueError> {
        validate_identifier(user_id)?;
        validate_identifier(&result.id)?;
        let mut results: Vec<PendingResult> = self.read(user_id, "sync-queue")?;
        results.retain(|item| item.id != result.id);
        let pending_count = results
            .iter()
            .filter(|item| item.status == QueueStatus::Pending)
            .count();
        if result.status == QueueStatus::Pending && pending_count >= MAX_PENDING_RESULTS {
            return Err(LocalQueueError::QueueLimit);
        }
        results.push(result);
        let serialized = serde_json::to_vec(&results).map_err(|_| LocalQueueError::Corrupt)?;
        if serialized.len() > MAX_QUEUE_BYTES {
            return Err(LocalQueueError::QueueLimit);
        }
        self.write(user_id, "sync-queue", &serialized)
    }

    pub fn list(&self, user_id: &str) -> Result<Vec<PendingResult>, LocalQueueError> {
        self.read(user_id, "sync-queue")
    }

    pub fn remove(&self, user_id: &str, result_id: &str) -> Result<(), LocalQueueError> {
        validate_identifier(user_id)?;
        validate_identifier(result_id)?;
        let mut results: Vec<PendingResult> = self.read(user_id, "sync-queue")?;
        let original_len = results.len();
        results.retain(|item| item.id != result_id);
        if results.len() == original_len {
            return Ok(());
        }
        if results.is_empty() {
            return self.remove_file(user_id, "sync-queue");
        }
        let serialized = serde_json::to_vec(&results).map_err(|_| LocalQueueError::Corrupt)?;
        self.write(user_id, "sync-queue", &serialized)
    }

    pub fn save_draft(&self, user_id: &str, draft: DraftInput) -> Result<(), LocalQueueError> {
        validate_identifier(user_id)?;
        validate_identifier(&draft.task_id)?;
        let mut drafts: Vec<DraftInput> = self.read(user_id, "drafts")?;
        drafts.retain(|item| item.task_id != draft.task_id);
        drafts.push(draft);
        let serialized = serde_json::to_vec(&drafts).map_err(|_| LocalQueueError::Corrupt)?;
        self.write(user_id, "drafts", &serialized)
    }

    pub fn load_draft(
        &self,
        user_id: &str,
        task_id: &str,
    ) -> Result<Option<DraftInput>, LocalQueueError> {
        validate_identifier(task_id)?;
        let drafts: Vec<DraftInput> = self.read(user_id, "drafts")?;
        let oldest_allowed = unix_seconds().saturating_sub(DRAFT_RETENTION_SECONDS);
        Ok(drafts
            .into_iter()
            .find(|draft| draft.task_id == task_id && draft.saved_at >= oldest_allowed))
    }

    pub fn delete_draft(&self, user_id: &str, task_id: &str) -> Result<(), LocalQueueError> {
        validate_identifier(user_id)?;
        validate_identifier(task_id)?;
        let mut drafts: Vec<DraftInput> = self.read(user_id, "drafts")?;
        let original_len = drafts.len();
        drafts.retain(|draft| draft.task_id != task_id);
        if drafts.len() == original_len {
            return Ok(());
        }
        if drafts.is_empty() {
            return self.remove_file(user_id, "drafts");
        }
        let serialized = serde_json::to_vec(&drafts).map_err(|_| LocalQueueError::Corrupt)?;
        self.write(user_id, "drafts", &serialized)
    }

    pub fn logout(&self, user_id: &str) -> Result<CacheClearReport, LocalQueueError> {
        validate_identifier(user_id)?;
        let drafts: Vec<DraftInput> = self.read(user_id, "drafts")?;
        self.remove_file(user_id, "drafts")?;
        Ok(CacheClearReport {
            drafts_deleted: drafts.len(),
            ..CacheClearReport::default()
        })
    }

    pub fn clear_cache(
        &self,
        user_id: &str,
        options: CacheClearOptions,
    ) -> Result<CacheClearReport, LocalQueueError> {
        validate_identifier(user_id)?;
        let drafts: Vec<DraftInput> = self.read(user_id, "drafts")?;
        let results: Vec<PendingResult> = self.read(user_id, "sync-queue")?;
        let completed_deleted = results
            .iter()
            .filter(|item| item.status == QueueStatus::Completed)
            .count();
        let pending_deleted = if options.delete_unsynced {
            results
                .iter()
                .filter(|item| item.status == QueueStatus::Pending)
                .count()
        } else {
            0
        };
        let retained: Vec<PendingResult> = if options.delete_unsynced {
            Vec::new()
        } else {
            results
                .into_iter()
                .filter(|item| item.status == QueueStatus::Pending)
                .collect()
        };
        self.remove_file(user_id, "drafts")?;
        if retained.is_empty() {
            self.remove_file(user_id, "sync-queue")?;
        } else {
            let serialized = serde_json::to_vec(&retained).map_err(|_| LocalQueueError::Corrupt)?;
            self.write(user_id, "sync-queue", &serialized)?;
        }
        Ok(CacheClearReport {
            drafts_deleted: drafts.len(),
            completed_deleted,
            pending_deleted,
        })
    }

    fn read<T>(&self, user_id: &str, purpose: &str) -> Result<T, LocalQueueError>
    where
        T: DeserializeOwned + Default,
    {
        validate_identifier(user_id)?;
        let path = self.path(user_id, purpose);
        if !path.exists() {
            return Ok(T::default());
        }
        let envelope = fs::read(path).map_err(|_| LocalQueueError::Io)?;
        let plaintext = decrypt(&device_key(self.secrets)?, user_id, purpose, &envelope)?;
        serde_json::from_slice(&plaintext).map_err(|_| LocalQueueError::Corrupt)
    }

    fn write(&self, user_id: &str, purpose: &str, plaintext: &[u8]) -> Result<(), LocalQueueError> {
        fs::create_dir_all(&self.root).map_err(|_| LocalQueueError::Io)?;
        let envelope = encrypt(&device_key(self.secrets)?, user_id, purpose, plaintext)?;
        let destination = self.path(user_id, purpose);
        let temporary = destination.with_extension("bin.tmp");
        let mut file = File::create(&temporary).map_err(|_| LocalQueueError::Io)?;
        file.write_all(&envelope).map_err(|_| LocalQueueError::Io)?;
        file.sync_all().map_err(|_| LocalQueueError::Io)?;
        fs::rename(temporary, destination).map_err(|_| LocalQueueError::Io)
    }

    fn remove_file(&self, user_id: &str, purpose: &str) -> Result<(), LocalQueueError> {
        let path = self.path(user_id, purpose);
        if path.exists() {
            fs::remove_file(path).map_err(|_| LocalQueueError::Io)?;
        }
        Ok(())
    }

    fn path(&self, user_id: &str, purpose: &str) -> PathBuf {
        self.root.join(format!("{purpose}-{user_id}.bin"))
    }
}

fn validate_identifier(value: &str) -> Result<(), LocalQueueError> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(LocalQueueError::InvalidInput);
    }
    Ok(())
}

pub(crate) fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
