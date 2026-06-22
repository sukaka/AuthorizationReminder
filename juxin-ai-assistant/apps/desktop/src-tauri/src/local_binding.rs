use std::sync::Mutex;
use std::time::Duration;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use url::Url;

use crate::build_mode::BuildMode;
use crate::server_config::ServerOrigin;
const VERIFY_PATH: &str = "/api/ai/local-binding/verify";
const VERIFY_ERROR: &str = "LOCAL_BINDING_VERIFICATION_FAILED";

#[derive(Default)]
pub struct LocalUserSession {
    user_id: Mutex<Option<String>>,
}

impl LocalUserSession {
    pub fn bind_verified<F>(&self, user_id: &str, cleanup: F) -> Result<(), String>
    where
        F: FnOnce(&str) -> Result<(), String>,
    {
        let verified_user_id = validate_user_id(user_id)?;
        let mut current = self
            .user_id
            .lock()
            .map_err(|_| "LOCAL_USER_SESSION_UNAVAILABLE".to_string())?;
        match current.as_deref() {
            Some(bound) if bound != verified_user_id => {
                cleanup(bound)?;
                *current = Some(verified_user_id.to_string());
            }
            Some(_) => {}
            None => *current = Some(verified_user_id.to_string()),
        }
        Ok(())
    }

    pub fn authorize(&self, user_id: &str) -> Result<(), String> {
        let current = self
            .user_id
            .lock()
            .map_err(|_| "LOCAL_USER_SESSION_UNAVAILABLE".to_string())?;
        match current.as_deref() {
            Some(bound) if bound == user_id => Ok(()),
            Some(_) => Err("LOCAL_USER_SESSION_MISMATCH".to_string()),
            None => Err("LOCAL_USER_SESSION_REQUIRED".to_string()),
        }
    }

    pub fn require_bound(&self) -> Result<(), String> {
        let current = self
            .user_id
            .lock()
            .map_err(|_| "LOCAL_USER_SESSION_UNAVAILABLE".to_string())?;
        if current.is_some() {
            Ok(())
        } else {
            Err("LOCAL_USER_SESSION_REQUIRED".to_string())
        }
    }

    pub fn current_user_id(&self) -> Result<Option<String>, String> {
        self.user_id
            .lock()
            .map(|current| current.clone())
            .map_err(|_| "LOCAL_USER_SESSION_UNAVAILABLE".to_string())
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut current = self
            .user_id
            .lock()
            .map_err(|_| "LOCAL_USER_SESSION_UNAVAILABLE".to_string())?;
        *current = None;
        Ok(())
    }

    pub fn logout<T, F>(&self, user_id: &str, cleanup: F) -> Result<T, String>
    where
        F: FnOnce(&str) -> Result<T, String>,
    {
        let mut current = self
            .user_id
            .lock()
            .map_err(|_| "LOCAL_USER_SESSION_UNAVAILABLE".to_string())?;
        match current.as_deref() {
            Some(bound) if bound == user_id => {
                let result = cleanup(bound)?;
                *current = None;
                Ok(result)
            }
            Some(_) => Err("LOCAL_USER_SESSION_MISMATCH".to_string()),
            None => Err("LOCAL_USER_SESSION_REQUIRED".to_string()),
        }
    }
}

#[derive(Serialize)]
struct VerifyRequest<'a> {
    token: &'a str,
}

#[derive(Deserialize)]
struct VerifyResponse {
    user_id: String,
}

fn validate_user_id(user_id: &str) -> Result<&str, String> {
    let normalized = user_id.trim();
    if normalized.is_empty() || normalized.len() > 160 || normalized.chars().any(char::is_control) {
        return Err(VERIFY_ERROR.to_string());
    }
    Ok(normalized)
}

pub fn validate_binding_base_url(raw: &str, mode: impl Into<BuildMode>) -> Result<Url, String> {
    ServerOrigin::parse_for_mode(raw, mode.into())
        .map(|origin| origin.as_url().clone())
        .map_err(|_| "SERVER_ORIGIN_INVALID".to_string())
}

pub async fn verify_binding_token(base_url: &Url, token: &str) -> Result<String, String> {
    if token.is_empty() || token.len() > 4096 {
        return Err(VERIFY_ERROR.to_string());
    }
    let endpoint = base_url
        .join(VERIFY_PATH)
        .map_err(|_| VERIFY_ERROR.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .redirect(Policy::none())
        .build()
        .map_err(|_| VERIFY_ERROR.to_string())?;
    let response = client
        .post(endpoint)
        .json(&VerifyRequest { token })
        .send()
        .await
        .map_err(|_| VERIFY_ERROR.to_string())?;
    if !response.status().is_success() {
        return Err(VERIFY_ERROR.to_string());
    }
    let body = response
        .json::<VerifyResponse>()
        .await
        .map_err(|_| VERIFY_ERROR.to_string())?;
    validate_user_id(&body.user_id).map(str::to_string)
}
