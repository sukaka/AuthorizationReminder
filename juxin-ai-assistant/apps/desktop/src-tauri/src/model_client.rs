use std::time::{Duration, Instant};

use futures_util::StreamExt;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use thiserror::Error;
use tokio::sync::watch;
use url::{Host, Url};
use zeroize::Zeroizing;

const END_OF_OUTPUT_MARKER: &str = "<END_OF_OUTPUT>";
const END_OF_OUTPUT_INSTRUCTION: &str =
    "完整回答结束时必须在最后输出 <END_OF_OUTPUT>，不要解释这个标记。";
const CONTINUE_AFTER_TRUNCATION_PROMPT: &str =
    "上一次输出因为长度限制被截断，请从被截断处继续，不要重复前文。";

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
    pub finish_reason: Option<String>,
    pub truncated: bool,
    pub auto_continue_count: u8,
}

#[derive(Clone, Debug, PartialEq, Eq, Error)]
pub enum ModelClientError {
    #[error("MODEL_AUTH_FAILED — 请检查 API Key 是否正确、账户是否有余额")]
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
    #[error("MODEL_OUTPUT_TRUNCATED — 模型连续达到输出长度上限，请提高 max_output_tokens 或缩短输入后重试")]
    OutputTruncated,
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
    #[serde(default)]
    finish_reason: Option<String>,
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

fn parse_sse_finish_reason(line: &str) -> Result<Option<String>, ModelClientError> {
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
        .and_then(|choice| choice.finish_reason.clone()))
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
    pub max_output_tokens: u32,
    pub max_auto_continues: u8,
    pub timeout_seconds: u64,
    pub request_id: &'a str,
    pub cancel: watch::Receiver<bool>,
}

struct StreamAttemptResult {
    output: String,
    usage: serde_json::Value,
    finish_reason: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum ContinuationDecision {
    Continue,
    Stop { truncated: bool },
}

fn is_truncation_finish_reason(reason: Option<&str>) -> bool {
    matches!(
        reason,
        Some("length" | "max_tokens" | "token_limit" | "output_limit")
    )
}

fn continuation_decision(
    finish_reason: Option<&str>,
    saw_end_marker: bool,
    auto_continue_count: u8,
    max_auto_continues: u8,
) -> Result<ContinuationDecision, ModelClientError> {
    if saw_end_marker {
        return Ok(ContinuationDecision::Stop { truncated: false });
    }
    if !is_truncation_finish_reason(finish_reason) {
        return Ok(ContinuationDecision::Stop { truncated: false });
    }
    if auto_continue_count >= max_auto_continues {
        return Err(ModelClientError::OutputTruncated);
    }
    Ok(ContinuationDecision::Continue)
}

fn with_end_marker_instruction(messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
    let mut prepared = Vec::with_capacity(messages.len() + 1);
    let mut inserted = false;
    for mut message in messages {
        if !inserted && message.role == "system" {
            if !message.content.contains(END_OF_OUTPUT_MARKER) {
                message.content = format!("{}\n\n{}", message.content, END_OF_OUTPUT_INSTRUCTION);
            }
            inserted = true;
        }
        prepared.push(message);
    }
    if !inserted {
        prepared.insert(
            0,
            ChatMessage {
                role: "system".to_string(),
                content: END_OF_OUTPUT_INSTRUCTION.to_string(),
            },
        );
    }
    prepared
}

fn append_continuation_messages(messages: &mut Vec<ChatMessage>, previous_output: &str) {
    messages.push(ChatMessage {
        role: "assistant".to_string(),
        content: previous_output.to_string(),
    });
    messages.push(ChatMessage {
        role: "user".to_string(),
        content: CONTINUE_AFTER_TRUNCATION_PROMPT.to_string(),
    });
}

fn strip_end_marker(output: &str) -> (String, bool) {
    if let Some(index) = output.find(END_OF_OUTPUT_MARKER) {
        return (output[..index].trim_end().to_string(), true);
    }
    (output.to_string(), false)
}

fn merge_usage(total: &mut serde_json::Value, next: serde_json::Value) {
    let Some(next_object) = next.as_object() else {
        *total = next;
        return;
    };
    if !total.is_object() {
        *total = serde_json::json!({});
    }
    let Some(total_object) = total.as_object_mut() else {
        return;
    };
    for (key, value) in next_object {
        if let Some(next_number) = value.as_u64() {
            let current = total_object
                .get(key)
                .and_then(|item| item.as_u64())
                .unwrap_or(0);
            total_object.insert(key.clone(), serde_json::json!(current + next_number));
        } else {
            total_object.insert(key.clone(), value.clone());
        }
    }
}

fn chat_completion_body(
    model_id: &str,
    messages: &[ChatMessage],
    temperature: f32,
    max_output_tokens: u32,
) -> serde_json::Value {
    serde_json::json!({
        "model": model_id,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_output_tokens,
        "stream": true,
        "stream_options": { "include_usage": true },
    })
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
        max_output_tokens,
        max_auto_continues,
        timeout_seconds,
        request_id,
        cancel,
    } = request;
    let max_output_tokens = max_output_tokens.clamp(1, 200_000);
    let max_auto_continues = max_auto_continues.min(10);
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .map_err(|_| ModelClientError::Connection)?;

    let started = Instant::now();
    let mut messages = with_end_marker_instruction(messages);
    let mut output = String::new();
    let mut usage = serde_json::json!({});
    let mut auto_continue_count = 0_u8;

    loop {
        let attempt = generate_stream_attempt(
            app,
            &client,
            base_url,
            model_id,
            api_key.as_deref(),
            &messages,
            temperature,
            max_output_tokens,
            request_id,
            cancel.clone(),
        )
        .await?;
        let finish_reason = attempt.finish_reason.clone();
        merge_usage(&mut usage, attempt.usage);
        let previous_output = attempt.output.clone();
        output.push_str(&previous_output);
        let (cleaned_output, saw_end_marker) = strip_end_marker(&output);
        output = cleaned_output;
        match continuation_decision(
            finish_reason.as_deref(),
            saw_end_marker,
            auto_continue_count,
            max_auto_continues,
        )? {
            ContinuationDecision::Stop { truncated } => {
                if output.is_empty() {
                    return Err(ModelClientError::Protocol);
                }
                app.emit_to(
                    "workspace",
                    &format!("model://done/{request_id}"),
                    DoneEvent { request_id },
                )
                .map_err(|_| ModelClientError::Protocol)?;

                return Ok(ModelGenerateResult {
                    output,
                    latency_ms: started.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                    usage,
                    finish_reason,
                    truncated,
                    auto_continue_count,
                });
            }
            ContinuationDecision::Continue => {
                append_continuation_messages(&mut messages, &previous_output);
                auto_continue_count = auto_continue_count.saturating_add(1);
            }
        }
    }
}

async fn generate_stream_attempt(
    app: &AppHandle,
    client: &reqwest::Client,
    base_url: &Url,
    model_id: &str,
    api_key: Option<&str>,
    messages: &[ChatMessage],
    temperature: f32,
    max_output_tokens: u32,
    request_id: &str,
    mut cancel: watch::Receiver<bool>,
) -> Result<StreamAttemptResult, ModelClientError> {
    let body = chat_completion_body(model_id, messages, temperature, max_output_tokens);
    let mut request = client
        .post(endpoint_url(base_url, "chat/completions")?)
        .json(&body);
    if let Some(secret) = api_key {
        let protected = Zeroizing::new(secret.to_string());
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
        401 | 403 => return Err(ModelClientError::Auth),
        429 => return Err(ModelClientError::RateLimited),
        code if !(200..300).contains(&code) => return Err(ModelClientError::Connection),
        _ => {}
    }

    let mut stream = response.bytes_stream();
    let mut pending = String::new();
    let mut output = String::new();
    let mut usage = serde_json::json!({});
    let mut finish_reason: Option<String> = None;

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
                if let Some(reason) = parse_sse_finish_reason(&line)? {
                    finish_reason = Some(reason);
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
    Ok(StreamAttemptResult {
        output,
        usage,
        finish_reason,
    })
}

pub async fn test_connection(
    base_url: &Url,
    api_key: Option<String>,
    timeout_seconds: u64,
) -> Result<(), ModelClientError> {
    let timeout = Duration::from_secs(timeout_seconds.min(30));

    // Try /models endpoint
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| ModelClientError::Connection)?;
    let url = endpoint_url(base_url, "models")?;
    let mut request = client.get(url);
    if let Some(ref secret) = api_key {
        request = request.bearer_auth(secret.as_str());
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ModelClientError::Timeout
        } else {
            ModelClientError::Connection
        }
    })?;
    eprintln!("[model_test] GET /models -> {}", response.status().as_u16());
    if (200..300).contains(&response.status().as_u16()) {
        return Ok(());
    }
    if response.status().as_u16() == 429 {
        return Err(ModelClientError::RateLimited);
    }

    // /models failed, try /chat/completions with minimal body
    let client = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .build()
        .map_err(|_| ModelClientError::Connection)?;
    let url = endpoint_url(base_url, "chat/completions")?;
    let body = serde_json::json!({
        "model": "gpt-3.5-turbo",
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 1,
    });
    let mut request = client.post(url).json(&body);
    if let Some(ref secret) = api_key {
        request = request.bearer_auth(secret.as_str());
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ModelClientError::Timeout
        } else {
            ModelClientError::Connection
        }
    })?;
    let status_code = response.status().as_u16();
    eprintln!("[model_test] POST /chat/completions -> {}", status_code);
    match status_code {
        200..=299 => Ok(()),
        401 | 403 => Err(ModelClientError::Auth),
        429 => Err(ModelClientError::RateLimited),
        _ => Err(ModelClientError::Connection),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        append_continuation_messages, chat_completion_body, continuation_decision, endpoint_url,
        is_truncation_finish_reason, parse_sse_finish_reason, parse_sse_line, strip_end_marker,
        validate_base_url, with_end_marker_instruction, ChatMessage, ContinuationDecision,
        ModelClientError, CONTINUE_AFTER_TRUNCATION_PROMPT, END_OF_OUTPUT_INSTRUCTION,
        END_OF_OUTPUT_MARKER,
    };

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
    fn parses_openai_length_finish_reason() {
        assert_eq!(
            parse_sse_finish_reason(r#"data: {"choices":[{"delta":{},"finish_reason":"length"}]}"#)
                .unwrap(),
            Some("length".to_string()),
        );
        assert_eq!(parse_sse_finish_reason("data: [DONE]").unwrap(), None);
    }

    #[test]
    fn continues_when_finish_reason_is_length() {
        assert_eq!(
            continuation_decision(Some("length"), false, 0, 3).unwrap(),
            ContinuationDecision::Continue,
        );
    }

    #[test]
    fn recognizes_openai_compatible_truncation_finish_reasons() {
        for reason in ["length", "max_tokens", "token_limit", "output_limit"] {
            assert!(is_truncation_finish_reason(Some(reason)));
        }
        assert!(!is_truncation_finish_reason(Some("stop")));
        assert!(!is_truncation_finish_reason(None));
    }

    #[test]
    fn stops_when_finish_reason_is_stop() {
        assert_eq!(
            continuation_decision(Some("stop"), false, 0, 3).unwrap(),
            ContinuationDecision::Stop { truncated: false },
        );
    }

    #[test]
    fn errors_when_truncation_exceeds_max_auto_continues() {
        assert_eq!(
            continuation_decision(Some("length"), false, 3, 3).unwrap_err(),
            ModelClientError::OutputTruncated,
        );
    }

    #[test]
    fn continuation_messages_include_previous_output_and_resume_instruction() {
        let mut messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "生成方案".to_string(),
        }];

        append_continuation_messages(&mut messages, "上一段输出");

        assert_eq!(messages[1].role, "assistant");
        assert_eq!(messages[1].content, "上一段输出");
        assert_eq!(messages[2].role, "user");
        assert_eq!(messages[2].content, CONTINUE_AFTER_TRUNCATION_PROMPT);
    }

    #[test]
    fn request_body_uses_configured_max_output_tokens() {
        let messages = vec![ChatMessage {
            role: "user".to_string(),
            content: "生成方案".to_string(),
        }];

        let body = chat_completion_body("deepseek-chat", &messages, 0.3, 12_345);

        assert_eq!(body["max_tokens"], 12_345);
        assert_eq!(body["stream"], true);
    }

    #[test]
    fn adds_end_marker_instruction_to_system_prompt() {
        let messages = with_end_marker_instruction(vec![ChatMessage {
            role: "user".to_string(),
            content: "生成方案".to_string(),
        }]);

        assert_eq!(messages[0].role, "system");
        assert_eq!(messages[0].content, END_OF_OUTPUT_INSTRUCTION);
    }

    #[test]
    fn strips_end_of_output_marker_before_returning_output() {
        assert_eq!(
            strip_end_marker(&format!("完整内容\n{END_OF_OUTPUT_MARKER} 后续噪音")),
            ("完整内容".to_string(), true),
        );
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
