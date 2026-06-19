use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::keychain::SecretStore;
use crate::model_profiles::{
    save_profiles, set_default_profile, upsert_profile, ModelProfileInput, ModelProfilePublic,
};

pub struct AppState {
    pub profiles_path: PathBuf,
    pub profiles: Mutex<Vec<ModelProfilePublic>>,
    pub secrets: Arc<dyn SecretStore>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionStatus {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub fn model_profile_list(state: tauri::State<'_, AppState>) -> Result<Vec<ModelProfilePublic>, String> {
    state
        .profiles
        .lock()
        .map(|profiles| profiles.clone())
        .map_err(|_| "本地模型配置暂不可用".to_string())
}

#[tauri::command]
pub fn model_profile_upsert(
    state: tauri::State<'_, AppState>,
    mut input: ModelProfileInput,
) -> Result<ModelProfilePublic, String> {
    let secret = input.take_api_key();
    let profile_id = input
        .id
        .clone()
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    input.id = Some(profile_id.clone());
    let existing_secret = state.secrets.get(&profile_id)?.is_some();
    let has_api_key = match secret.as_deref() {
        Some(value) if value.trim().is_empty() => false,
        Some(_) => true,
        None => existing_secret,
    };

    let mut profiles = state
        .profiles
        .lock()
        .map_err(|_| "本地模型配置暂不可用".to_string())?;
    let profile = upsert_profile(&mut profiles, input, has_api_key)?;

    if let Some(value) = secret {
        if value.trim().is_empty() {
            state.secrets.delete(&profile_id)?;
        } else {
            state.secrets.set(&profile_id, value.trim())?;
        }
    }
    save_profiles(&state.profiles_path, &profiles)?;
    Ok(profile)
}

#[tauri::command]
pub fn model_profile_delete(state: tauri::State<'_, AppState>, profile_id: String) -> Result<(), String> {
    let mut profiles = state
        .profiles
        .lock()
        .map_err(|_| "本地模型配置暂不可用".to_string())?;
    let original_len = profiles.len();
    profiles.retain(|profile| profile.id != profile_id);
    if profiles.len() == original_len {
        return Err("模型配置不存在".to_string());
    }
    if !profiles.is_empty() && !profiles.iter().any(|profile| profile.is_default) {
        profiles[0].is_default = true;
    }
    state.secrets.delete(&profile_id)?;
    save_profiles(&state.profiles_path, &profiles)
}

#[tauri::command]
pub fn model_profile_set_default(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
    let mut profiles = state
        .profiles
        .lock()
        .map_err(|_| "本地模型配置暂不可用".to_string())?;
    set_default_profile(&mut profiles, &profile_id)?;
    save_profiles(&state.profiles_path, &profiles)
}

#[tauri::command]
pub fn model_profile_test(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<ModelConnectionStatus, String> {
    let profiles = state
        .profiles
        .lock()
        .map_err(|_| "本地模型配置暂不可用".to_string())?;
    let profile = profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| "模型配置不存在".to_string())?;
    Ok(ModelConnectionStatus {
        ok: true,
        message: format!("{} 配置可用", profile.display_name),
    })
}

#[tauri::command]
pub fn model_generate() -> Result<(), String> {
    Err("模型生成桥将在连接测试后启用".to_string())
}

#[tauri::command]
pub fn model_cancel() -> Result<(), String> {
    Ok(())
}
