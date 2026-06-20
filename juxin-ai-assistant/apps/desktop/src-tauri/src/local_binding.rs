use std::net::IpAddr;
use std::sync::Mutex;
use std::time::Duration;

use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use url::{Host, Url};

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

pub fn validate_binding_base_url(raw: &str, allow_loopback: bool) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "AI_ASSISTANT_PUBLIC_URL_INVALID".to_string())?;
    let exact_origin = url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none();
    if !exact_origin {
        return Err("AI_ASSISTANT_PUBLIC_URL_INVALID".to_string());
    }
    match url.scheme() {
        "https" => Ok(url),
        "http" if allow_loopback && is_loopback(&url) => Ok(url),
        _ => Err("AI_ASSISTANT_PUBLIC_URL_INVALID".to_string()),
    }
}

pub fn configured_binding_base_url() -> Result<Url, String> {
    let configured = option_env!("AI_ASSISTANT_PUBLIC_URL").unwrap_or("");
    if configured.is_empty() && cfg!(debug_assertions) {
        return validate_binding_base_url("http://127.0.0.1:18093", true);
    }
    validate_binding_base_url(configured, cfg!(debug_assertions))
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

fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
        Some(Host::Ipv4(address)) => IpAddr::V4(address).is_loopback(),
        Some(Host::Ipv6(address)) => IpAddr::V6(address).is_loopback(),
        None => false,
    }
}
