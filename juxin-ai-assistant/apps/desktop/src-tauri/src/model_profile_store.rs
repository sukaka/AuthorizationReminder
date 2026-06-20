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
    let previous_secret = secrets.get(&account)?;
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
        Some(_) if replacement_secret.is_none() => secrets.delete(&account)?,
        Some(_) => secrets.set(
            &account,
            replacement_secret.ok_or_else(|| "MODEL_SECRET_INVALID".to_string())?,
        )?,
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
