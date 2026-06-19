use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use uuid::Uuid;

use crate::model_client::validate_base_url;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileInput {
    pub id: Option<String>,
    pub display_name: String,
    pub base_url: String,
    pub model_id: String,
    pub temperature: f32,
    pub timeout_seconds: u64,
    pub is_default: bool,
    api_key: Option<String>,
}

impl ModelProfileInput {
    pub fn take_api_key(&mut self) -> Option<String> {
        self.api_key.take()
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfilePublic {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
    pub model_id: String,
    pub temperature: f32,
    pub timeout_seconds: u64,
    pub is_default: bool,
    pub has_api_key: bool,
}

pub fn upsert_profile(
    profiles: &mut Vec<ModelProfilePublic>,
    input: ModelProfileInput,
    has_api_key: bool,
) -> Result<ModelProfilePublic, String> {
    let ModelProfileInput {
        id,
        display_name,
        base_url,
        model_id,
        temperature,
        timeout_seconds,
        is_default,
        api_key: _,
    } = input;

    let display_name = display_name.trim();
    let model_id = model_id.trim();
    if display_name.is_empty() || display_name.len() > 80 {
        return Err("模型名称长度必须为 1 到 80 个字符".to_string());
    }
    if model_id.is_empty() || model_id.len() > 160 {
        return Err("模型 ID 长度必须为 1 到 160 个字符".to_string());
    }
    if !(0.0..=2.0).contains(&temperature) {
        return Err("temperature 必须在 0 到 2 之间".to_string());
    }
    if !(5..=600).contains(&timeout_seconds) {
        return Err("超时时间必须在 5 到 600 秒之间".to_string());
    }
    let base_url = validate_base_url(base_url.trim())?.to_string();
    let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let make_default = is_default || profiles.is_empty();

    if make_default {
        for profile in profiles.iter_mut() {
            profile.is_default = false;
        }
    }

    let profile = ModelProfilePublic {
        id: id.clone(),
        display_name: display_name.to_string(),
        base_url,
        model_id: model_id.to_string(),
        temperature,
        timeout_seconds,
        is_default: make_default,
        has_api_key,
    };

    if let Some(existing) = profiles.iter_mut().find(|item| item.id == id) {
        *existing = profile.clone();
    } else {
        profiles.push(profile.clone());
    }

    Ok(profile)
}

pub fn load_profiles(path: &Path) -> Result<Vec<ModelProfilePublic>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|_| "无法读取本地模型配置".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "本地模型配置格式损坏".to_string())
}

pub fn save_profiles(path: &Path, profiles: &[ModelProfilePublic]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|_| "无法创建本地配置目录".to_string())?;
    }
    let temporary = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec_pretty(profiles).map_err(|_| "无法编码本地模型配置".to_string())?;
    fs::write(&temporary, bytes).map_err(|_| "无法保存本地模型配置".to_string())?;
    fs::rename(temporary, path).map_err(|_| "无法提交本地模型配置".to_string())
}

pub fn set_default_profile(profiles: &mut [ModelProfilePublic], id: &str) -> Result<(), String> {
    if !profiles.iter().any(|profile| profile.id == id) {
        return Err("模型配置不存在".to_string());
    }
    for profile in profiles {
        profile.is_default = profile.id == id;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        load_profiles, save_profiles, set_default_profile, upsert_profile, ModelProfileInput,
        ModelProfilePublic,
    };

    fn input(id: &str, is_default: bool) -> ModelProfileInput {
        ModelProfileInput {
            id: Some(id.to_string()),
            display_name: format!("模型 {id}"),
            base_url: "https://api.example.com/v1".to_string(),
            model_id: "example-model".to_string(),
            temperature: 0.3,
            timeout_seconds: 60,
            is_default,
            api_key: Some("should-never-be-serialized".to_string()),
        }
    }

    #[test]
    fn public_profile_never_serializes_an_api_key() {
        let mut profiles = Vec::<ModelProfilePublic>::new();
        let profile = upsert_profile(&mut profiles, input("one", true), true).unwrap();
        let json = serde_json::to_value(profile).unwrap();

        assert_eq!(json["hasApiKey"], true);
        assert!(json.get("apiKey").is_none());
        assert!(!json.to_string().contains("should-never-be-serialized"));
    }

    #[test]
    fn only_one_profile_can_be_default() {
        let mut profiles = Vec::<ModelProfilePublic>::new();
        upsert_profile(&mut profiles, input("one", true), true).unwrap();
        upsert_profile(&mut profiles, input("two", true), true).unwrap();

        assert_eq!(profiles.iter().filter(|profile| profile.is_default).count(), 1);
        assert!(profiles.iter().find(|profile| profile.id == "two").unwrap().is_default);
    }

    #[test]
    fn profiles_round_trip_without_secrets() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("profiles.json");
        let mut profiles = Vec::<ModelProfilePublic>::new();
        upsert_profile(&mut profiles, input("one", true), true).unwrap();

        save_profiles(&path, &profiles).unwrap();
        let restored = load_profiles(&path).unwrap();
        let raw = std::fs::read_to_string(path).unwrap();

        assert_eq!(restored.len(), 1);
        assert!(!raw.contains("should-never-be-serialized"));
        assert!(!raw.contains("apiKey"));
    }

    #[test]
    fn selecting_a_default_requires_an_existing_profile() {
        let mut profiles = Vec::<ModelProfilePublic>::new();
        upsert_profile(&mut profiles, input("one", true), false).unwrap();

        assert!(set_default_profile(&mut profiles, "missing").is_err());
    }
}
