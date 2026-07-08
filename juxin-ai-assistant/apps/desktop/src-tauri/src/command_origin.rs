use thiserror::Error;
use url::Url;

use crate::server_config::ServerOrigin;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommandScope {
    Launcher,
    Business,
}

#[derive(Clone, Debug)]
pub struct CallerContext {
    window_label: String,
    current_url: Url,
}

impl CallerContext {
    pub fn new(window_label: &str, current_url: &str) -> Result<Self, CommandOriginError> {
        let current_url = Url::parse(current_url).map_err(|_| CommandOriginError::Unauthorized)?;
        if current_url.username().is_empty() && current_url.password().is_none() {
            Ok(Self {
                window_label: window_label.to_string(),
                current_url,
            })
        } else {
            Err(CommandOriginError::Unauthorized)
        }
    }
}

#[derive(Clone, Copy, Debug, Error, Eq, PartialEq)]
pub enum CommandOriginError {
    #[error("IPC_CALLER_UNAUTHORIZED")]
    Unauthorized,
}

pub fn authorize(
    caller: &CallerContext,
    scope: CommandScope,
    saved_business_origin: Option<&ServerOrigin>,
) -> Result<(), CommandOriginError> {
    match scope {
        CommandScope::Launcher
            if caller.window_label == "launcher" && is_local_app_origin(&caller.current_url) =>
        {
            Ok(())
        }
        CommandScope::Business
            if caller.window_label == "workspace"
                && saved_business_origin
                    .is_some_and(|saved| same_origin(&caller.current_url, saved.as_url())) =>
        {
            Ok(())
        }
        CommandScope::Launcher | CommandScope::Business => Err(CommandOriginError::Unauthorized),
    }
}

pub fn guard_window(
    window: &tauri::WebviewWindow,
    scope: CommandScope,
    saved_business_origin: Option<&ServerOrigin>,
) -> Result<(), String> {
    let url = window
        .url()
        .map_err(|_| CommandOriginError::Unauthorized.to_string())?;
    let caller =
        CallerContext::new(window.label(), url.as_str()).map_err(|error| error.to_string())?;
    authorize(&caller, scope, saved_business_origin).map_err(|error| error.to_string())
}

pub fn same_origin(candidate: &Url, trusted: &Url) -> bool {
    candidate.username().is_empty()
        && candidate.password().is_none()
        && candidate.scheme().eq_ignore_ascii_case(trusted.scheme())
        && candidate.host_str().zip(trusted.host_str()).is_some_and(
            |(candidate_host, trusted_host)| candidate_host.eq_ignore_ascii_case(trusted_host),
        )
        && candidate.port_or_known_default() == trusted.port_or_known_default()
}

fn is_local_app_origin(url: &Url) -> bool {
    if cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
        && url.port() == Some(18093)
    {
        return true;
    }
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}
