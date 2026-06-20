use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::local_queue::unix_seconds;

#[derive(Debug, Error)]
pub enum LocalQueueError {
    #[error("本地安全存储参数无效")]
    InvalidInput,
    #[error("本地设备密钥不可用")]
    DeviceKey,
    #[error("本地安全数据已损坏")]
    Corrupt,
    #[error("本地安全数据读写失败")]
    Io,
    #[error("待同步队列已达到上限")]
    QueueLimit,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum QueueStatus {
    Pending,
    Completed,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct PendingResult {
    pub(crate) id: String,
    pub(crate) payload: String,
    pub(crate) status: QueueStatus,
    created_at: u64,
}

impl PendingResult {
    pub fn new(id: &str, payload: &str, status: QueueStatus) -> Self {
        Self {
            id: id.to_string(),
            payload: payload.to_string(),
            status,
            created_at: unix_seconds(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct DraftInput {
    pub(crate) task_id: String,
    content: String,
    pub(crate) saved_at: u64,
}

impl DraftInput {
    pub fn new(task_id: &str, content: &str) -> Self {
        Self::new_at(task_id, content, unix_seconds())
    }

    pub fn new_at(task_id: &str, content: &str, saved_at: u64) -> Self {
        Self {
            task_id: task_id.to_string(),
            content: content.to_string(),
            saved_at,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CacheClearOptions {
    pub(crate) delete_unsynced: bool,
}

impl CacheClearOptions {
    pub const fn preserve_unsynced() -> Self {
        Self {
            delete_unsynced: false,
        }
    }

    pub const fn delete_all() -> Self {
        Self {
            delete_unsynced: true,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize)]
pub struct CacheClearReport {
    pub drafts_deleted: usize,
    pub completed_deleted: usize,
    pub pending_deleted: usize,
}
