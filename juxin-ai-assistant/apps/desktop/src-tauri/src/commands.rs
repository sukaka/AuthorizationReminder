use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::AppHandle;

use crate::keychain::SecretStore;
use crate::model_client::{generate, ChatMessage, ModelGenerateRequest, ModelGenerateResult};
use crate::model_profile_store::commit_model_profile_upsert;
use crate::model_profiles::{
    model_secret_account, save_profiles, set_default_profile, ModelProfileInput, ModelProfilePublic,
};

pub struct AppState {
    pub profiles_path: PathBuf,
    pub local_storage_path: PathBuf,
    pub profiles: Mutex<Vec<ModelProfilePublic>>,
    pub secrets: Arc<dyn SecretStore>,
    pub cancellations: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
    pub local_user: crate::local_commands::LocalUserSession,
    pub binding_base_url: url::Url,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelConnectionStatus {
    pub ok: bool,
    pub message: String,
}

#[tauri::command]
pub fn model_profile_list(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ModelProfilePublic>, String> {
    state
        .profiles
        .lock()
        .map(|profiles| profiles.clone())
        .map_err(|_| "本地模型配置暂不可用".to_string())
}

#[tauri::command]
pub fn model_profile_upsert(
    state: tauri::State<'_, AppState>,
    input: ModelProfileInput,
) -> Result<ModelProfilePublic, String> {
    let mut profiles = state
        .profiles
        .lock()
        .map_err(|_| "本地模型配置暂不可用".to_string())?;
    commit_model_profile_upsert(
        &state.profiles_path,
        &mut profiles,
        state.secrets.as_ref(),
        input,
    )
}

#[tauri::command]
pub fn model_profile_delete(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<(), String> {
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
    state.secrets.delete(&model_secret_account(&profile_id))?;
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
pub async fn model_profile_test(
    state: tauri::State<'_, AppState>,
    profile_id: String,
) -> Result<ModelConnectionStatus, String> {
    let profile = {
        let profiles = state
            .profiles
            .lock()
            .map_err(|_| "本地模型配置暂不可用".to_string())?;
        profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
            .ok_or_else(|| "模型配置不存在".to_string())?
    };
    let base_url = crate::model_client::validate_base_url(&profile.base_url)
        .map_err(|_| "MODEL_URL_INVALID".to_string())?;
    crate::model_client::test_connection(
        &base_url,
        state.secrets.get(&model_secret_account(&profile.id))?,
        profile.timeout_seconds,
    )
    .await
    .map_err(|error| error.to_string())?;
    Ok(ModelConnectionStatus {
        ok: true,
        message: format!("{} 连接成功", profile.display_name),
    })
}

#[tauri::command]
pub async fn model_generate(
    app: AppHandle,
    state: tauri::State<'_, AppState>,
    profile_id: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    request_id: String,
) -> Result<ModelGenerateResult, String> {
    if request_id.is_empty()
        || request_id.len() > 128
        || messages.is_empty()
        || messages.len() > 128
    {
        return Err("MODEL_INVALID_REQUEST".to_string());
    }
    if messages.iter().any(|message| {
        !matches!(message.role.as_str(), "system" | "user" | "assistant")
            || message.content.is_empty()
            || message.content.len() > 2_000_000
    }) {
        return Err("MODEL_INVALID_REQUEST".to_string());
    }
    let profile = {
        let profiles = state
            .profiles
            .lock()
            .map_err(|_| "MODEL_PROFILE_UNAVAILABLE".to_string())?;
        profiles
            .iter()
            .find(|profile| profile.id == profile_id)
            .cloned()
            .ok_or_else(|| "MODEL_PROFILE_NOT_FOUND".to_string())?
    };
    let base_url = crate::model_client::validate_base_url(&profile.base_url)
        .map_err(|_| "MODEL_URL_INVALID".to_string())?;
    let api_key = state.secrets.get(&model_secret_account(&profile.id))?;
    let (cancel_sender, cancel_receiver) = tokio::sync::watch::channel(false);
    state
        .cancellations
        .lock()
        .map_err(|_| "MODEL_REQUEST_STATE_UNAVAILABLE".to_string())?
        .insert(request_id.clone(), cancel_sender);

    let result = generate(
        &app,
        ModelGenerateRequest {
            base_url: &base_url,
            model_id: &profile.model_id,
            api_key,
            messages,
            temperature: temperature.clamp(0.0, 2.0),
            timeout_seconds: profile.timeout_seconds,
            request_id: &request_id,
            cancel: cancel_receiver,
        },
    )
    .await;
    if let Ok(mut cancellations) = state.cancellations.lock() {
        cancellations.remove(&request_id);
    }
    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn model_cancel(state: tauri::State<'_, AppState>, request_id: String) -> Result<(), String> {
    let sender = state
        .cancellations
        .lock()
        .map_err(|_| "MODEL_REQUEST_STATE_UNAVAILABLE".to_string())?
        .remove(&request_id);
    if let Some(sender) = sender {
        let _ = sender.send(true);
    }
    Ok(())
}
