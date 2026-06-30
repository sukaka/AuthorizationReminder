use std::path::Path;

use uuid::Uuid;

use crate::keychain::SecretStore;
use crate::model_profiles::{
    ensure_secret_origin_safe, model_secret_account, save_profiles, upsert_profile,
    ModelProfileInput, ModelProfilePublic,
};

pub fn commit_model_profile_upsert(
    profiles_path: &Path,
    profiles: &mut Vec<ModelProfilePublic>,
    secrets: &dyn SecretStore,
    mut input: ModelProfileInput,
) -> Result<ModelProfilePublic, String> {
    let replacement = input.take_api_key();
    let is_update = input.id.is_some();
    let profile_id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    input.id = Some(profile_id.clone());
    let account = model_secret_account(&profile_id);
    let previous_secret = load_model_profile_secret(&profile_id, secrets)?;
    let existing = profiles.iter().find(|profile| profile.id == profile_id);
    if is_update && existing.is_none() {
        return Err("MODEL_PROFILE_NOT_FOUND".to_string());
    }
    ensure_secret_origin_safe(
        existing,
        &input.base_url,
        previous_secret.is_some(),
        replacement.as_deref(),
    )?;

    let replacement_secret = replacement
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let has_api_key = match replacement.as_ref() {
        Some(_) => replacement_secret.is_some(),
        None => previous_secret.is_some(),
    };
    let mut candidate = profiles.clone();
    let profile = upsert_profile(&mut candidate, input, has_api_key)?;

    match replacement.as_ref() {
        Some(_) if replacement_secret.is_none() => {
            eprintln!("[model_save] deleting encrypted local secret: {}", account);
            secrets.delete(&account)?;
        }
        Some(_) => {
            let secret_value =
                replacement_secret.ok_or_else(|| "MODEL_SECRET_INVALID".to_string())?;
            eprintln!(
                "[model_save] saving encrypted local secret: {} (len: {})",
                account,
                secret_value.len()
            );
            secrets.set(&account, &secret_value)?;
            eprintln!("[model_save] encrypted local secret save OK");
        }
        None => {}
    }
    if let Err(save_error) = save_profiles(profiles_path, &candidate) {
        restore_secret(secrets, &account, previous_secret.as_deref())?;
        return Err(save_error);
    }
    *profiles = candidate;
    Ok(profile)
}

pub fn migrate_legacy_model_secrets(
    profiles: &[ModelProfilePublic],
    secrets: &dyn SecretStore,
) -> Result<usize, String> {
    let mut migrated = 0;
    for profile in profiles {
        if Uuid::parse_str(&profile.id).is_err() {
            continue;
        }
        let Some(legacy_secret) = secrets.get(&profile.id)? else {
            continue;
        };
        let namespaced = model_secret_account(&profile.id);
        if secrets.get(&namespaced)?.is_none() {
            secrets.set(&namespaced, &legacy_secret)?;
        }
        secrets.delete(&profile.id)?;
        migrated += 1;
    }
    Ok(migrated)
}

pub fn load_model_profile_secret(
    profile_id: &str,
    secrets: &dyn SecretStore,
) -> Result<Option<String>, String> {
    let account = model_secret_account(profile_id);
    if let Some(secret) = secrets.get(&account)? {
        return Ok(Some(secret));
    }
    if Uuid::parse_str(profile_id).is_err() {
        return Ok(None);
    }
    let Some(legacy_secret) = secrets.get(profile_id)? else {
        return Ok(None);
    };
    secrets.set(&account, &legacy_secret)?;
    secrets.delete(profile_id)?;
    Ok(Some(legacy_secret))
}

fn restore_secret(
    secrets: &dyn SecretStore,
    account: &str,
    previous_secret: Option<&str>,
) -> Result<(), String> {
    match previous_secret {
        Some(secret) => secrets.set(account, secret),
        None => secrets.delete(account),
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use crate::keychain::SecretStore;

    use super::load_model_profile_secret;

    #[derive(Default)]
    struct TestSecretStore {
        values: Mutex<HashMap<String, String>>,
    }

    impl TestSecretStore {
        fn with_secret(self, account: &str, secret: &str) -> Self {
            self.values
                .lock()
                .unwrap()
                .insert(account.to_string(), secret.to_string());
            self
        }

        fn contains(&self, account: &str) -> bool {
            self.values.lock().unwrap().contains_key(account)
        }
    }

    impl SecretStore for TestSecretStore {
        fn set(&self, profile_id: &str, secret: &str) -> Result<(), String> {
            self.values
                .lock()
                .unwrap()
                .insert(profile_id.to_string(), secret.to_string());
            Ok(())
        }

        fn get(&self, profile_id: &str) -> Result<Option<String>, String> {
            Ok(self.values.lock().unwrap().get(profile_id).cloned())
        }

        fn delete(&self, profile_id: &str) -> Result<(), String> {
            self.values.lock().unwrap().remove(profile_id);
            Ok(())
        }
    }

    #[test]
    fn model_secret_is_migrated_lazily_when_accessed() {
        let profile_id = "c72cdadc-b5de-4a1d-9b3c-f94d35f72cab";
        let store = TestSecretStore::default().with_secret(profile_id, "legacy-secret");

        let secret = load_model_profile_secret(profile_id, &store).unwrap();

        assert_eq!(secret.as_deref(), Some("legacy-secret"));
        assert!(store.contains("model-profile:c72cdadc-b5de-4a1d-9b3c-f94d35f72cab"));
        assert!(!store.contains(profile_id));
    }
}
