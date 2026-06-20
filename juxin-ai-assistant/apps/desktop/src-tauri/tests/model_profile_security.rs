use std::collections::BTreeMap;
use std::sync::Mutex;

use juxin_ai_assistant_lib::keychain::SecretStore;
use juxin_ai_assistant_lib::model_profile_store::{
    commit_model_profile_upsert, migrate_legacy_model_secrets,
};
use juxin_ai_assistant_lib::model_profiles::{
    model_secret_account, ModelProfileInput, ModelProfilePublic,
};

#[derive(Default)]
struct FailingSecretStore {
    values: Mutex<BTreeMap<String, String>>,
    fail_set: bool,
    fail_delete: bool,
}

impl SecretStore for FailingSecretStore {
    fn set(&self, account: &str, secret: &str) -> Result<(), String> {
        if self.fail_set {
            return Err("TEST_SET_FAILED".to_string());
        }
        self.values
            .lock()
            .unwrap()
            .insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> Result<Option<String>, String> {
        Ok(self.values.lock().unwrap().get(account).cloned())
    }

    fn delete(&self, account: &str) -> Result<(), String> {
        if self.fail_delete {
            return Err("TEST_DELETE_FAILED".to_string());
        }
        self.values.lock().unwrap().remove(account);
        Ok(())
    }
}

fn profile(id: &str, base_url: &str) -> ModelProfilePublic {
    ModelProfilePublic {
        id: id.to_string(),
        display_name: "模型".to_string(),
        base_url: base_url.to_string(),
        model_id: "model".to_string(),
        temperature: 0.3,
        timeout_seconds: 60,
        is_default: true,
        has_api_key: true,
    }
}

fn input(id: &str, base_url: &str, api_key: Option<&str>) -> ModelProfileInput {
    serde_json::from_value(serde_json::json!({
        "id": id,
        "displayName": "模型",
        "baseUrl": base_url,
        "modelId": "model",
        "temperature": 0.3,
        "timeoutSeconds": 60,
        "isDefault": true,
        "apiKey": api_key,
    }))
    .unwrap()
}

#[test]
fn origin_change_requires_nonempty_replacement_secret() {
    // Given: a profile whose current origin owns a stored secret.
    let directory = tempfile::tempdir().unwrap();
    let id = "11111111-1111-4111-8111-111111111111";
    let mut profiles = vec![profile(id, "https://old.example.com/v1")];
    let store = FailingSecretStore::default();
    store.set(&model_secret_account(id), "old-secret").unwrap();

    // When: renderer changes origin with an empty replacement.
    let result = commit_model_profile_upsert(
        &directory.path().join("profiles.json"),
        &mut profiles,
        &store,
        input(id, "https://new.example.com/v1", Some("")),
    );

    // Then: both profile and existing key remain unchanged.
    assert_eq!(result.unwrap_err(), "MODEL_API_KEY_REENTRY_REQUIRED");
    assert_eq!(profiles[0].base_url, "https://old.example.com/v1");
    assert_eq!(
        store.get(&model_secret_account(id)).unwrap().unwrap(),
        "old-secret"
    );
}

#[test]
fn keychain_failure_does_not_mutate_in_memory_profile() {
    // Given: an existing profile and a keychain that rejects writes.
    let directory = tempfile::tempdir().unwrap();
    let id = "11111111-1111-4111-8111-111111111111";
    let mut profiles = vec![profile(id, "https://old.example.com/v1")];
    let store = FailingSecretStore {
        values: Mutex::new(BTreeMap::from([(
            model_secret_account(id),
            "old-secret".to_string(),
        )])),
        fail_set: true,
        fail_delete: false,
    };

    // When: a valid replacement is submitted with the new origin.
    let result = commit_model_profile_upsert(
        &directory.path().join("profiles.json"),
        &mut profiles,
        &store,
        input(id, "https://new.example.com/v1", Some("new-secret")),
    );

    // Then: the failed keychain write cannot partially update profile memory.
    assert_eq!(result.unwrap_err(), "TEST_SET_FAILED");
    assert_eq!(profiles[0].base_url, "https://old.example.com/v1");
}

#[test]
fn keychain_delete_failure_does_not_mutate_in_memory_profile() {
    // Given: a profile whose existing secret cannot be deleted from keychain.
    let directory = tempfile::tempdir().unwrap();
    let id = "11111111-1111-4111-8111-111111111111";
    let mut profiles = vec![profile(id, "https://old.example.com/v1")];
    let store = FailingSecretStore {
        values: Mutex::new(BTreeMap::from([(
            model_secret_account(id),
            "old-secret".to_string(),
        )])),
        fail_set: false,
        fail_delete: true,
    };

    // When: renderer clears the optional secret while updating profile metadata.
    let result = commit_model_profile_upsert(
        &directory.path().join("profiles.json"),
        &mut profiles,
        &store,
        input(id, "https://old.example.com/v1", Some("")),
    );

    // Then: failed deletion leaves the shared profile untouched.
    assert_eq!(result.unwrap_err(), "TEST_DELETE_FAILED");
    assert!(profiles[0].has_api_key);
    assert_eq!(profiles[0].base_url, "https://old.example.com/v1");
}

#[test]
fn legacy_key_migrates_only_for_existing_uuid_profile() {
    // Given: one valid UUID profile plus a device key and UUID-like unrelated key.
    let id = "11111111-1111-4111-8111-111111111111";
    let profiles = vec![
        profile(id, "https://old.example.com/v1"),
        profile("device-storage-key", "https://old.example.com/v1"),
    ];
    let store = FailingSecretStore::default();
    store.set(id, "legacy-model-secret").unwrap();
    store.set("device-storage-key", "device-secret").unwrap();
    store
        .set("22222222-2222-4222-8222-222222222222", "unrelated")
        .unwrap();

    // When: startup migration examines only loaded profiles.
    let migrated = migrate_legacy_model_secrets(&profiles, &store).unwrap();

    // Then: only the valid profile key moves into the model namespace.
    assert_eq!(migrated, 1);
    assert_eq!(store.get(id).unwrap(), None);
    assert_eq!(
        store.get(&model_secret_account(id)).unwrap().unwrap(),
        "legacy-model-secret"
    );
    assert_eq!(
        store.get("device-storage-key").unwrap().unwrap(),
        "device-secret"
    );
    assert_eq!(
        store
            .get("22222222-2222-4222-8222-222222222222")
            .unwrap()
            .unwrap(),
        "unrelated"
    );
    assert_eq!(store.get("model-profile:device-storage-key").unwrap(), None);
}

#[test]
fn failed_legacy_key_migration_keeps_original_secret() {
    // Given: one valid profile whose namespaced keychain write will fail.
    let id = "11111111-1111-4111-8111-111111111111";
    let profiles = vec![profile(id, "https://old.example.com/v1")];
    let store = FailingSecretStore {
        values: Mutex::new(BTreeMap::from([(
            id.to_string(),
            "legacy-model-secret".to_string(),
        )])),
        fail_set: true,
        fail_delete: false,
    };

    // When: startup attempts the safe migration.
    let result = migrate_legacy_model_secrets(&profiles, &store);

    // Then: failure cannot delete the only copy of the secret.
    assert_eq!(result.unwrap_err(), "TEST_SET_FAILED");
    assert_eq!(store.get(id).unwrap().unwrap(), "legacy-model-secret");
    assert_eq!(store.get(&model_secret_account(id)).unwrap(), None);
}
