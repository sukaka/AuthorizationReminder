use std::collections::BTreeMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use juxin_ai_assistant_lib::keychain::SecretStore;
use juxin_ai_assistant_lib::local_queue::{
    CacheClearOptions, DraftInput, LocalQueue, PendingResult, QueueStatus,
};
use juxin_ai_assistant_lib::server_config::ServerOrigin;

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

fn origin(raw: &str) -> ServerOrigin {
    ServerOrigin::parse_production(raw).unwrap()
}

fn default_origin() -> ServerOrigin {
    origin("https://ai.example.com")
}

fn record_files(root: &std::path::Path) -> Vec<std::path::PathBuf> {
    let Ok(scopes) = std::fs::read_dir(root.join("v2")) else {
        return Vec::new();
    };
    scopes
        .flat_map(|scope| std::fs::read_dir(scope.unwrap().path()).unwrap())
        .map(|entry| entry.unwrap().path())
        .collect()
}

#[test]
fn pending_results_never_cross_server_origins() {
    // Given: one user queues a result for server A.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    let server_a = origin("https://a.example.com");
    let server_b = origin("https://b.example.com");
    queue
        .push(
            "user-1",
            &server_a,
            PendingResult::new("result-1", "private", QueueStatus::Pending),
        )
        .unwrap();

    // When / Then: server B sees nothing, while server A still owns the record.
    assert!(queue.list("user-1", &server_b).unwrap().is_empty());
    assert_eq!(queue.list("user-1", &server_a).unwrap().len(), 1);
}

#[test]
fn drafts_never_cross_server_origins() {
    // Given: one task draft belongs to server A.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    let server_a = origin("https://a.example.com");
    let server_b = origin("https://b.example.com");
    queue
        .save_draft("user-1", &server_a, DraftInput::new("task-1", "server-a"))
        .unwrap();

    // When / Then: the same user and task on server B cannot restore it.
    assert_eq!(
        queue.load_draft("user-1", &server_b, "task-1").unwrap(),
        None
    );
    assert!(queue
        .load_draft("user-1", &server_a, "task-1")
        .unwrap()
        .is_some());
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
            &default_origin(),
            PendingResult::new("result-1", "客户敏感输出", QueueStatus::Pending),
        )
        .unwrap();

    // Then: the versioned file contains no plaintext.
    let files = record_files(directory.path());
    assert_eq!(files.len(), 1);
    let bytes = std::fs::read(&files[0]).unwrap();
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
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-1", "内部内容"),
        )
        .unwrap();

    // When: user two requests the same task identifier.
    let draft = queue
        .load_draft("user-2", &default_origin(), "task-1")
        .unwrap();

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
            &default_origin(),
            PendingResult::new("result-1", "private", QueueStatus::Pending),
        )
        .unwrap();
    let user_one_file = record_files(directory.path()).remove(0);
    queue
        .push(
            "user-2",
            &default_origin(),
            PendingResult::new("result-1", "placeholder", QueueStatus::Pending),
        )
        .unwrap();
    let user_two_file = record_files(directory.path())
        .into_iter()
        .find(|path| path != &user_one_file)
        .unwrap();
    std::fs::copy(user_one_file, user_two_file).unwrap();

    // When / Then: replaying ciphertext under another user fails authentication.
    assert!(queue.list("user-2", &default_origin()).is_err());
}

#[test]
fn associated_origin_prevents_ciphertext_replay() {
    // Given: the same user and record identifier exist on two server origins.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    let server_a = origin("https://a.example.com");
    let server_b = origin("https://b.example.com");
    queue
        .push(
            "user-1",
            &server_a,
            PendingResult::new("result-1", "server-a", QueueStatus::Pending),
        )
        .unwrap();
    let server_a_file = record_files(directory.path()).remove(0);
    queue
        .push(
            "user-1",
            &server_b,
            PendingResult::new("result-1", "server-b", QueueStatus::Pending),
        )
        .unwrap();
    let server_b_file = record_files(directory.path())
        .into_iter()
        .find(|path| path != &server_a_file)
        .unwrap();
    std::fs::copy(server_a_file, server_b_file).unwrap();

    // When / Then: ciphertext authenticated for A cannot be opened under B.
    assert!(queue.list("user-1", &server_b).is_err());
}

#[test]
fn associated_record_id_prevents_ciphertext_replay() {
    // Given: two draft identifiers in the same user and Origin scope.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-1", "one"),
        )
        .unwrap();
    let task_one_file = record_files(directory.path()).remove(0);
    queue
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-2", "two"),
        )
        .unwrap();
    let task_two_file = record_files(directory.path())
        .into_iter()
        .find(|path| path != &task_one_file)
        .unwrap();
    std::fs::copy(task_one_file, task_two_file).unwrap();

    // When / Then: task-one ciphertext cannot be replayed as task two.
    assert!(queue
        .load_draft("user-1", &default_origin(), "task-2")
        .is_err());
}

#[test]
fn record_delete_rejects_path_like_identifiers() {
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);

    for record_id in ["../escape", r"..\escape", "..", "x/../../escape"] {
        assert!(queue
            .remove("user-1", &default_origin(), record_id)
            .is_err());
    }
}

#[test]
fn legacy_export_and_delete_reject_path_like_users() {
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);

    for user_id in ["../escape", r"..\escape", "..", "x/../../escape"] {
        assert!(queue.export_legacy_unassigned(user_id).is_err());
        assert!(queue.delete_legacy_unassigned(user_id).is_err());
    }
}

#[test]
fn cache_clear_preserves_unsynced_results_by_default() {
    // Given: drafts plus pending and completed queue entries.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-1", "draft"),
        )
        .unwrap();
    queue
        .push(
            "user-1",
            &default_origin(),
            PendingResult::new("pending", "keep", QueueStatus::Pending),
        )
        .unwrap();
    queue
        .push(
            "user-1",
            &default_origin(),
            PendingResult::new("completed", "remove", QueueStatus::Completed),
        )
        .unwrap();

    // When: the normal cache-clear operation runs.
    let report = queue
        .clear_cache(
            "user-1",
            &default_origin(),
            CacheClearOptions::preserve_unsynced(),
        )
        .unwrap();

    // Then: drafts and completed items are removed, pending output remains.
    assert_eq!(report.drafts_deleted, 1);
    assert_eq!(report.completed_deleted, 1);
    assert_eq!(report.pending_deleted, 0);
    assert_eq!(queue.list("user-1", &default_origin()).unwrap().len(), 1);
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
                &default_origin(),
                PendingResult::new(&format!("result-{index}"), "payload", QueueStatus::Pending),
            )
            .unwrap();
    }

    // When / Then: the next pending result is refused.
    assert!(queue
        .push(
            "user-1",
            &default_origin(),
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
            &default_origin(),
            DraftInput::new_at("task-1", "expired", now - 8 * 24 * 60 * 60),
        )
        .unwrap();

    // When: the draft is restored after its retention period.
    let draft = queue
        .load_draft("user-1", &default_origin(), "task-1")
        .unwrap();

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
            &default_origin(),
            PendingResult::new("oversized", &oversized, QueueStatus::Pending),
        )
        .is_err());
    assert!(record_files(directory.path()).is_empty());
}

#[test]
fn logout_clears_drafts_but_preserves_pending_results() {
    // Given: a user has a draft and unsynced output.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-1", "draft"),
        )
        .unwrap();
    queue
        .push(
            "user-1",
            &default_origin(),
            PendingResult::new("pending", "keep", QueueStatus::Pending),
        )
        .unwrap();

    // When: local logout cleanup runs.
    let report = queue.logout("user-1", &default_origin()).unwrap();

    // Then: session drafts are removed without destroying unsynced work.
    assert_eq!(report.drafts_deleted, 1);
    assert_eq!(
        queue
            .load_draft("user-1", &default_origin(), "task-1")
            .unwrap(),
        None
    );
    assert_eq!(queue.list("user-1", &default_origin()).unwrap().len(), 1);
}

#[test]
fn origin_switch_cleanup_preserves_old_pending_results_and_hides_them_from_new_origin() {
    // Given: server A has a draft and an unsynced result.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    let server_a = origin("https://a.example.com");
    let server_b = origin("https://b.example.com");
    queue
        .save_draft("user-1", &server_a, DraftInput::new("task-1", "draft"))
        .unwrap();
    queue
        .push(
            "user-1",
            &server_a,
            PendingResult::new("result-1", "pending", QueueStatus::Pending),
        )
        .unwrap();

    // When: address switching performs the same scoped draft cleanup as logout.
    queue.logout("user-1", &server_a).unwrap();

    // Then: A keeps its pending result, B sees nothing, and A's draft is gone.
    assert!(queue
        .load_draft("user-1", &server_a, "task-1")
        .unwrap()
        .is_none());
    assert_eq!(queue.list("user-1", &server_a).unwrap().len(), 1);
    assert!(queue.list("user-1", &server_b).unwrap().is_empty());
}

#[test]
fn draft_delete_removes_only_the_current_users_task() {
    // Given: two users have drafts with the same task identifier.
    let directory = tempfile::tempdir().unwrap();
    let secrets = TestSecretStore::default();
    let queue = LocalQueue::new(directory.path(), &secrets);
    queue
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-1", "one"),
        )
        .unwrap();
    queue
        .save_draft(
            "user-1",
            &default_origin(),
            DraftInput::new("task-2", "keep"),
        )
        .unwrap();
    queue
        .save_draft(
            "user-2",
            &default_origin(),
            DraftInput::new("task-1", "two"),
        )
        .unwrap();

    // When: user one deletes task one.
    queue
        .delete_draft("user-1", &default_origin(), "task-1")
        .unwrap();

    // Then: only that user's matching draft is removed.
    assert_eq!(
        queue
            .load_draft("user-1", &default_origin(), "task-1")
            .unwrap(),
        None
    );
    assert!(queue
        .load_draft("user-1", &default_origin(), "task-2")
        .unwrap()
        .is_some());
    assert!(queue
        .load_draft("user-2", &default_origin(), "task-1")
        .unwrap()
        .is_some());
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
                &default_origin(),
                PendingResult::new("result-1", "pending", QueueStatus::Pending),
            )
            .unwrap();
    }

    // When: user one removes the successfully synced result.
    queue
        .remove("user-1", &default_origin(), "result-1")
        .unwrap();

    // Then: user two's encrypted queue remains untouched.
    assert!(queue.list("user-1", &default_origin()).unwrap().is_empty());
    assert_eq!(queue.list("user-2", &default_origin()).unwrap().len(), 1);
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
            &default_origin(),
            PendingResult::new("result-1", "old", QueueStatus::Pending),
        )
        .unwrap();

    // When: the same result is queued again with updated content.
    queue
        .push(
            "user-1",
            &default_origin(),
            PendingResult::new("result-1", "new", QueueStatus::Pending),
        )
        .unwrap();

    // Then: only the replacement remains.
    let results = queue.list("user-1", &default_origin()).unwrap();
    assert_eq!(results.len(), 1);
    assert_eq!(serde_json::to_value(&results[0]).unwrap()["payload"], "new");
}
