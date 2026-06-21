use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::watch;
use url::{Host, Url};
use zeroize::Zeroizing;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelGenerateResult {
    pub output: String,
    pub latency_ms: u64,
    pub usage: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ModelClientError {
    #[error("MODEL_AUTH_FAILED")]
    Auth,
    #[error("MODEL_RATE_LIMITED")]
    RateLimited,
    #[error("MODEL_TIMEOUT")]
    Timeout,
    #[error("MODEL_PROTOCOL_ERROR")]
    Protocol,
    #[error("MODEL_CONNECTION_FAILED")]
    Connection,
    #[error("MODEL_CANCELLED")]
    Cancelled,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeltaEvent<'a> {
    request_id: &'a str,
    delta: &'a str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DoneEvent<'a> {
    request_id: &'a str,
}

#[derive(Deserialize)]
struct StreamEnvelope {
    choices: Vec<StreamChoice>,
    #[serde(default)]
    usage: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct StreamChoice {
    #[serde(default)]
    delta: StreamDelta,
}

#[derive(Default, Deserialize)]
struct StreamDelta {
    #[serde(default)]
    content: Option<String>,
}

pub fn validate_base_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|_| "模型地址格式无效".to_string())?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err("模型地址不能包含账号密码".to_string());
    }

    let loopback = matches!(url.host(), Some(Host::Domain("localhost")))
        || matches!(url.host(), Some(Host::Ipv4(ip)) if ip.is_loopback())
        || matches!(url.host(), Some(Host::Ipv6(ip)) if ip.is_loopback());

    if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
        return Err("公网模型地址必须使用 HTTPS".to_string());
    }

    Ok(url)
}

pub fn parse_sse_line(line: &str) -> Result<Option<String>, ModelClientError> {
    let Some(data) = line.strip_prefix("data:") else {
        return Ok(None);
    };
    let payload = data.trim();
    if payload == "[DONE]" {
        return Ok(None);
    }
    let envelope: StreamEnvelope =
        serde_json::from_str(payload).map_err(|_| ModelClientError::Protocol)?;
    Ok(envelope
        .choices
        .first()
        .and_then(|choice| choice.delta.content.clone()))
}

fn endpoint_url(base_url: &Url, path: &str) -> Result<Url, ModelClientError> {
    let mut normalized = base_url.clone();
    if !normalized.path().ends_with('/') {
        normalized.set_path(&format!("{}/", normalized.path()));
    }
    normalized
        .join(path)
        .map_err(|_| ModelClientError::Protocol)
}

pub struct ModelGenerateRequest<'a> {
    pub base_url: &'a Url,
    pub model_id: &'a str,
    pub api_key: Option<String>,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub timeout_seconds: u64,
    pub request_id: &'a str,
    pub cancel: watch::Receiver<bool>,
}

pub async fn generate(
    app: &AppHandle,
    request: ModelGenerateRequest<'_>,
) -> Result<ModelGenerateResult, ModelClientError> {
    let ModelGenerateRequest {
        base_url,
        model_id,
        api_key,
        messages,
        temperature,
        timeout_seconds,
        request_id,
        mut cancel,
    } = request;
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|_| ModelClientError::Connection)?;
    let body = serde_json::json!({
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "stream": true,
        "stream_options": { "include_usage": true },
    });
    let mut request = client
        .post(endpoint_url(base_url, "chat/completions")?)
        .json(&body);
    if let Some(secret) = api_key {
        let protected = Zeroizing::new(secret);
        request = request.bearer_auth(protected.as_str());
        drop(protected);
    }

    let started = Instant::now();
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ModelClientError::Timeout
        } else {
            ModelClientError::Connection
        }
    })?;
    match response.status().as_u16() {
        401 | 403 => return Err(ModelClientError::Auth),
        429 => return Err(ModelClientError::RateLimited),
        code if !(200..300).contains(&code) => return Err(ModelClientError::Connection),
        _ => {}
    }

    let mut stream = response.bytes_stream();
    let mut pending = String::new();
    let mut output = String::new();
    let mut usage = serde_json::json!({});

    loop {
        let next = tokio::select! {
            changed = cancel.changed() => {
                if changed.is_ok() && *cancel.borrow() {
                    return Err(ModelClientError::Cancelled);
                }
                continue;
            }
            next = stream.next() => next,
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| {
            if error.is_timeout() {
                ModelClientError::Timeout
            } else {
                ModelClientError::Connection
            }
        })?;
        pending.push_str(std::str::from_utf8(&chunk).map_err(|_| ModelClientError::Protocol)?);

        while let Some(index) = pending.find('\n') {
            let line = pending[..index].trim_end_matches('\r').to_string();
            pending.drain(..=index);
            if let Some(data) = line.strip_prefix("data:") {
                let payload = data.trim();
                if payload == "[DONE]" {
                    continue;
                }
                let delta = parse_sse_line(&line)?;
                let envelope: StreamEnvelope =
                    serde_json::from_str(payload).map_err(|_| ModelClientError::Protocol)?;
                if let Some(frame_usage) = envelope.usage {
                    usage = frame_usage;
                }
                if let Some(delta) = delta {
                    output.push_str(&delta);
                    app.emit_to(
                        "workspace",
                        &format!("model://delta/{request_id}"),
                        DeltaEvent {
                            request_id,
                            delta: &delta,
                        },
                    )
                    .map_err(|_| ModelClientError::Protocol)?;
                }
            }
        }
    }

    if output.is_empty() {
        return Err(ModelClientError::Protocol);
    }
    app.emit_to(
        "workspace",
        &format!("model://done/{request_id}"),
        DoneEvent { request_id },
    )
    .map_err(|_| ModelClientError::Protocol)?;

    Ok(ModelGenerateResult {
        output,
        latency_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        usage,
    })
}

pub async fn test_connection(
    base_url: &Url,
    api_key: Option<String>,
    timeout_seconds: u64,
) -> Result<(), ModelClientError> {
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(timeout_seconds.min(30)))
        .build()
        .map_err(|_| ModelClientError::Connection)?;
    let url = endpoint_url(base_url, "models")?;
    let mut request = client.get(url);
    if let Some(secret) = api_key {
        let protected = Zeroizing::new(secret);
        request = request.bearer_auth(protected.as_str());
        drop(protected);
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ModelClientError::Timeout
        } else {
            ModelClientError::Connection
        }
    })?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        401 | 403 => Err(ModelClientError::Auth),
        429 => Err(ModelClientError::RateLimited),
        _ => Err(ModelClientError::Connection),
    }
}

#[cfg(test)]
mod tests {
    use super::{endpoint_url, parse_sse_line, validate_base_url, ModelClientError};

    #[test]
    fn allows_https_and_loopback_http() {
        assert!(validate_base_url("https://api.example.com/v1").is_ok());
        assert!(validate_base_url("http://127.0.0.1:11434/v1").is_ok());
        assert!(validate_base_url("http://localhost:11434/v1").is_ok());
    }

    #[test]
    fn rejects_public_http_and_credential_urls() {
        assert!(validate_base_url("http://api.example.com/v1").is_err());
        assert!(validate_base_url("https://user:pass@example.com/v1").is_err());
        assert!(validate_base_url("file:///tmp/key").is_err());
    }

    #[test]
    fn parses_openai_delta_and_done_frames() {
        assert_eq!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"content":"聚信"}}]}"#).unwrap(),
            Some("聚信".to_string()),
        );
        assert_eq!(parse_sse_line("data: [DONE]").unwrap(), None);
        assert_eq!(parse_sse_line(": keep-alive").unwrap(), None);
    }

    #[test]
    fn rejects_malformed_sse_payloads() {
        assert_eq!(
            parse_sse_line("data: not-json").unwrap_err(),
            ModelClientError::Protocol,
        );
    }

    #[test]
    fn cancellation_has_a_stable_error_code() {
        assert_eq!(ModelClientError::Cancelled.to_string(), "MODEL_CANCELLED");
    }

    #[test]
    fn preserves_the_base_path_for_model_endpoints() {
        let base = validate_base_url("https://api.example.com/v1").unwrap();
        assert_eq!(
            endpoint_url(&base, "models").unwrap().as_str(),
            "https://api.example.com/v1/models",
        );
        assert_eq!(
            endpoint_url(&base, "chat/completions").unwrap().as_str(),
            "https://api.example.com/v1/chat/completions",
        );
    }
}
