use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use juxin_ai_assistant_lib::keychain::SecretStore;
use juxin_ai_assistant_lib::local_queue::{
    CacheClearOptions, DraftInput, LocalQueue, PendingResult, QueueStatus,
};

#[derive(Default)]
struct TestSecretStore {
    values: Mutex<BTreeMap<String, String>>,
}

impl SecretStore for TestSecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        self.values
            .lock()
            .map_err(|_| "TEST_LOCK_FAILED".to_string())?
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self
            .values
            .lock()
            .map_err(|_| "TEST_LOCK_FAILED".to_string())?
            .get(account)
            .cloned())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        self.values
            .lock()
            .map_err(|_| "TEST_LOCK_FAILED".to_string())?
            .remove(account);
        Ok(())
    }
}

#[test]
fn encrypted_queue_file_does_not_contain_plain_output() {
    // Given: a local queue with a deterministic test key.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    secrets
        .set(
            "device-storage-key",
            "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc=",
        )
        .unwrap();
    let queue = LocalQueue::new(directory.path(), &secrets);

    // When: a sensitive pending result is persisted.
    queue
        .push(
            "user-1",
            PendingResult::new("result-1", "客户敏感输出", QueueStatus::Pending),
        )
        .unwrap();

    // Then: the versioned file contains no plaintext.
    let bytes = std::fs::read(directory.path().join("sync-queue-user-1.bin")).unwrap();
    assert_eq!(bytes[0], 1);
    assert!(!String::from_utf8_lossy(&bytes).contains("客户敏感输出"));
}

#[test]
fn user_cannot_read_another_users_drafts() {
    // Given: user one owns a saved draft.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft("user-1", DraftInput::new("task-1", "内部内容"))
        .unwrap();

    // When: user two requests the same task identifier.
    let draft = queue.load_draft("user-2", "task-1").unwrap();

    // Then: no cross-user data is disclosed.
    assert_eq!(draft, None);
}

#[test]
fn associated_user_identity_prevents_ciphertext_replay() {
    // Given: an encrypted queue file belonging to user one.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .push(
            "user-1",
            PendingResult::new("result-1", "private", QueueStatus::Pending),
        )
        .unwrap();
    std::fs::copy(
        directory.path().join("sync-queue-user-1.bin"),
        directory.path().join("sync-queue-user-2.bin"),
    )
    .unwrap();

    // When / Then: replaying ciphertext under another user fails authentication.
    assert!(queue.list("user-2").is_err());
}

#[test]
fn cache_clear_preserves_unsynced_results_by_default() {
    // Given: drafts plus pending and completed queue entries.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft("user-1", DraftInput::new("task-1", "draft"))
        .unwrap();
    queue
        .push(
            "user-1",
            PendingResult::new("pending", "keep", QueueStatus::Pending),
        )
        .unwrap();
    queue
        .push(
            "user-1",
            PendingResult::new("completed", "remove", QueueStatus::Completed),
        )
        .unwrap();

    // When: the normal cache-clear operation runs.
    let report = queue
        .clear_cache("user-1", CacheClearOptions::preserve_unsynced())
        .unwrap();

    // Then: drafts and completed items are removed, pending output remains.
    assert_eq!(report.drafts_deleted, 1);
    assert_eq!(report.completed_deleted, 1);
    assert_eq!(report.pending_deleted, 0);
    assert_eq!(queue.list("user-1").unwrap().len(), 1);
}

#[test]
fn queue_rejects_more_than_one_hundred_pending_results() {
    // Given: a queue already containing one hundred pending results.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    for index in 0..100 {
        queue
            .push(
                "user-1",
                PendingResult::new(&format!("result-{index}"), "payload", QueueStatus::Pending),
            )
            .unwrap();
    }

    // When / Then: the next pending result is refused.
    assert!(queue
        .push(
            "user-1",
            PendingResult::new("result-101", "payload", QueueStatus::Pending),
        )
        .is_err());
}

#[test]
fn drafts_older_than_seven_days_are_not_restored() {
    // Given: a draft saved more than seven days ago.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    queue
        .save_draft(
            "user-1",
            DraftInput::new_at("task-1", "expired", now - 8 * 24 * 60 * 60),
        )
        .unwrap();

    // When: the draft is restored after its retention period.
    let draft = queue.load_draft("user-1", "task-1").unwrap();

    // Then: expired content is unavailable.
    assert_eq!(draft, None);
}

#[test]
fn queue_rejects_payloads_beyond_twenty_mebibytes() {
    // Given: one pending result whose serialized payload exceeds the device limit.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    let oversized = "x".repeat(20 * 1024 * 1024 + 1);

    // When / Then: the queue rejects it without writing a release file.
    assert!(queue
        .push(
            "user-1",
            PendingResult::new("oversized", &oversized, QueueStatus::Pending),
        )
        .is_err());
    assert!(!directory.path().join("sync-queue-user-1.bin").exists());
}

#[test]
fn logout_clears_drafts_but_preserves_pending_results() {
    // Given: a user has a draft and unsynced output.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft("user-1", DraftInput::new("task-1", "draft"))
        .unwrap();
    queue
        .push(
            "user-1",
            PendingResult::new("pending", "keep", QueueStatus::Pending),
        )
        .unwrap();

    // When: local logout cleanup runs.
    let report = queue.logout("user-1").unwrap();

    // Then: session drafts are removed without destroying unsynced work.
    assert_eq!(report.drafts_deleted, 1);
    assert_eq!(queue.load_draft("user-1", "task-1").unwrap(), None);
    assert_eq!(queue.list("user-1").unwrap().len(), 1);
}

#[test]
fn draft_delete_removes_only_the_current_users_task() {
    // Given: two users have drafts with the same task identifier.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft("user-1", DraftInput::new("task-1", "one"))
        .unwrap();
    queue
        .save_draft("user-1", DraftInput::new("task-2", "keep"))
        .unwrap();
    queue
        .save_draft("user-2", DraftInput::new("task-1", "two"))
        .unwrap();

    // When: user one deletes task one.
    queue.delete_draft("user-1", "task-1").unwrap();

    // Then: only that user's matching draft is removed.
    assert_eq!(queue.load_draft("user-1", "task-1").unwrap(), None);
    assert!(queue.load_draft("user-1", "task-2").unwrap().is_some());
    assert!(queue.load_draft("user-2", "task-1").unwrap().is_some());
}

#[test]
fn queue_remove_deletes_only_the_current_users_result() {
    // Given: two users have pending results with the same identifier.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    for user_id in ["user-1", "user-2"] {
        queue
            .push(
                user_id,
                PendingResult::new("result-1", "pending", QueueStatus::Pending),
            )
            .unwrap();
    }

    // When: user one removes the successfully synced result.
    queue.remove("user-1", "result-1").unwrap();

    // Then: user two's encrypted queue remains untouched.
    assert!(queue.list("user-1").unwrap().is_empty());
    assert_eq!(queue.list("user-2").unwrap().len(), 1);
}

#[test]
fn queue_push_replaces_an_existing_result_identifier() {
    // Given: one result is already pending.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .push(
            "user-1",
            PendingResult::new("result-1", "old", QueueStatus::Pending),
        )
        .unwrap();

    // When: the same result is queued again with updated content.
    queue
        .push(
            "user-1",
            PendingResult::new("result-1", "new", QueueStatus::Pending),
        )
        .unwrap();

    // Then: only the replacement remains.
    let results = queue.list("user-1").unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(serde_json::to_value(&results[0]).unwrap()["payload"], "new");
}
