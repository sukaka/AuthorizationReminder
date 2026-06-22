use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::keychain::SecretStore;
use crate::local_legacy::{delete_unassigned, export_unassigned, migrate_legacy_records};
use crate::local_record_store::{LocalRecordStore, RecordKind};
pub use crate::local_types::{
    CacheClearOptions, CacheClearReport, DraftInput, LegacyUnassignedData, LocalQueueError,
    PendingResult, QueueStatus,
};
use crate::server_config::ServerOrigin;

const MAX_PENDING_RESULTS: usize = 100;
const MAX_QUEUE_BYTES: usize = 20 * 1024 * 1024;
const DRAFT_RETENTION_SECONDS: u64 = 7 * 24 * 60 * 60;

pub fn configured_legacy_origin() -> Option<ServerOrigin> {
    option_env!("AI_ASSISTANT_LEGACY_SERVER_ORIGIN")
        .filter(|value| !value.is_empty())
        .and_then(|value| ServerOrigin::parse(value).ok())
}

pub struct LocalQueue<'a> {
    root: PathBuf,
    secrets: &'a dyn SecretStore,
    records: LocalRecordStore<'a>,
    legacy_origin: Option<ServerOrigin>,
}

impl<'a> LocalQueue<'a> {
    pub fn new(root: &Path, secrets: &'a dyn SecretStore) -> Self {
        Self {
            root: root.to_path_buf(),
            secrets,
            records: LocalRecordStore::new(root, secrets),
            legacy_origin: None,
        }
    }

    pub fn with_legacy_origin(
        root: &Path,
        secrets: &'a dyn SecretStore,
        legacy_origin: ServerOrigin,
    ) -> Self {
        Self {
            root: root.to_path_buf(),
            secrets,
            records: LocalRecordStore::new(root, secrets),
            legacy_origin: Some(legacy_origin),
        }
    }

    pub fn push(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        result: PendingResult,
    ) -> Result<(), LocalQueueError> {
        self.migrate_legacy(user_id)?;
        let results = self.list_current(user_id, origin)?;
        let pending_count = results
            .iter()
            .filter(|item| item.status == QueueStatus::Pending && item.id != result.id)
            .count();
        if result.status == QueueStatus::Pending && pending_count >= MAX_PENDING_RESULTS {
            return Err(LocalQueueError::QueueLimit);
        }
        let existing_bytes = results
            .iter()
            .filter(|item| item.id != result.id)
            .map(|item| serde_json::to_vec(item).map(|bytes| bytes.len()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| LocalQueueError::Corrupt)?
            .into_iter()
            .sum::<usize>();
        let result_bytes = serde_json::to_vec(&result).map_err(|_| LocalQueueError::Corrupt)?;
        if existing_bytes.saturating_add(result_bytes.len()) > MAX_QUEUE_BYTES {
            return Err(LocalQueueError::QueueLimit);
        }
        self.records.write(
            user_id,
            origin,
            RecordKind::PendingResult,
            &result.id,
            &result,
        )
    }

    pub fn list(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
    ) -> Result<Vec<PendingResult>, LocalQueueError> {
        self.migrate_legacy(user_id)?;
        self.list_current(user_id, origin)
    }

    pub fn remove(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        result_id: &str,
    ) -> Result<(), LocalQueueError> {
        self.migrate_legacy(user_id)?;
        self.records
            .remove(user_id, origin, RecordKind::PendingResult, result_id)
    }

    pub fn save_draft(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        draft: DraftInput,
    ) -> Result<(), LocalQueueError> {
        self.migrate_legacy(user_id)?;
        self.records
            .write(user_id, origin, RecordKind::Draft, &draft.task_id, &draft)
    }

    pub fn load_draft(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        task_id: &str,
    ) -> Result<Option<DraftInput>, LocalQueueError> {
        self.migrate_legacy(user_id)?;
        let draft: Option<DraftInput> =
            self.records
                .read(user_id, origin, RecordKind::Draft, task_id)?;
        let oldest_allowed = unix_seconds().saturating_sub(DRAFT_RETENTION_SECONDS);
        Ok(draft.filter(|item| item.saved_at >= oldest_allowed))
    }

    pub fn delete_draft(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        task_id: &str,
    ) -> Result<(), LocalQueueError> {
        self.migrate_legacy(user_id)?;
        self.records
            .remove(user_id, origin, RecordKind::Draft, task_id)
    }

    pub fn logout(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
    ) -> Result<CacheClearReport, LocalQueueError> {
        self.migrate_legacy(user_id)?;
        let drafts: Vec<DraftInput> = self.records.list(user_id, origin, RecordKind::Draft)?;
        for draft in &drafts {
            self.records
                .remove(user_id, origin, RecordKind::Draft, &draft.task_id)?;
        }
        Ok(CacheClearReport {
            drafts_deleted: drafts.len(),
            ..CacheClearReport::default()
        })
    }

    pub fn clear_cache(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
        options: CacheClearOptions,
    ) -> Result<CacheClearReport, LocalQueueError> {
        self.migrate_legacy(user_id)?;
        let drafts: Vec<DraftInput> = self.records.list(user_id, origin, RecordKind::Draft)?;
        let results = self.list_current(user_id, origin)?;
        for draft in &drafts {
            self.records
                .remove(user_id, origin, RecordKind::Draft, &draft.task_id)?;
        }
        let completed_deleted = results
            .iter()
            .filter(|item| item.status == QueueStatus::Completed)
            .count();
        let pending_deleted = results
            .iter()
            .filter(|item| options.delete_unsynced && item.status == QueueStatus::Pending)
            .count();
        for result in results.iter().filter(|item| {
            item.status == QueueStatus::Completed
                || (options.delete_unsynced && item.status == QueueStatus::Pending)
        }) {
            self.records
                .remove(user_id, origin, RecordKind::PendingResult, &result.id)?;
        }
        Ok(CacheClearReport {
            drafts_deleted: drafts.len(),
            completed_deleted,
            pending_deleted,
        })
    }

    pub fn export_legacy_unassigned(
        &self,
        user_id: &str,
    ) -> Result<LegacyUnassignedData, LocalQueueError> {
        self.migrate_legacy(user_id)?;
        export_unassigned(&self.root, self.secrets, user_id)
    }

    pub fn delete_legacy_unassigned(&self, user_id: &str) -> Result<(), LocalQueueError> {
        self.migrate_legacy(user_id)?;
        delete_unassigned(&self.root, user_id)
    }

    fn list_current(
        &self,
        user_id: &str,
        origin: &ServerOrigin,
    ) -> Result<Vec<PendingResult>, LocalQueueError> {
        self.records
            .list(user_id, origin, RecordKind::PendingResult)
    }

    fn migrate_legacy(&self, user_id: &str) -> Result<(), LocalQueueError> {
        migrate_legacy_records(
            &self.root,
            self.secrets,
            &self.records,
            user_id,
            self.legacy_origin.as_ref(),
        )
    }
}

pub(crate) fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
