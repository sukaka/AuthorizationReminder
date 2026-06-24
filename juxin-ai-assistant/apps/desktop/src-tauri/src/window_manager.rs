use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use url::Url;

use crate::command_origin::{guard_window, same_origin, CommandScope};
use crate::commands::AppState;
use crate::server_config::{
    default_server_config, load_server_config, save_server_config, DesktopProbe, ServerConfig,
    ServerConfigError, ServerOrigin,
};

const SERVER_CONFIG_FILE: &str = "server-config.json";
const WORKSPACE_READY_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug)]
pub struct ServerTrustState {
    saved: Option<ServerConfig>,
    recent_probe: Option<SuccessfulProbe>,
    probe_generation: u64,
    active_workspace: Option<ServerOrigin>,
    workspace_generation: u64,
    workspace_ready: bool,
}

#[derive(Debug)]
struct SuccessfulProbe {
    origin: ServerOrigin,
    auth_portal_url: Url,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WorkspaceLease {
    origin: ServerOrigin,
    generation: u64,
}

impl WorkspaceLease {
    pub const fn origin(&self) -> &ServerOrigin {
        &self.origin
    }
}

#[derive(Clone, Debug)]
pub struct WorkspaceNavigationPolicy {
    business_origin: ServerOrigin,
    auth_portal_url: Url,
}

impl WorkspaceNavigationPolicy {
    pub fn allows(&self, candidate: &Url) -> bool {
        same_origin(candidate, self.business_origin.as_url())
            || same_origin(candidate, &self.auth_portal_url)
    }

    pub fn is_business(&self, candidate: &Url) -> bool {
        same_origin(candidate, self.business_origin.as_url())
    }

    pub fn is_auth_portal(&self, candidate: &Url) -> bool {
        same_origin(candidate, &self.auth_portal_url)
    }

    pub fn auth_portal_url(&self) -> &Url {
        &self.auth_portal_url
    }
}

impl ServerTrustState {
    pub const fn new(saved: Option<ServerConfig>) -> Self {
        Self {
            saved,
            recent_probe: None,
            probe_generation: 0,
            active_workspace: None,
            workspace_generation: 0,
            workspace_ready: false,
        }
    }

    pub fn record_probe_success(&mut self, origin: ServerOrigin) {
        let portal = Url::parse(origin.as_str()).unwrap_or_else(|_| origin.as_url().clone());
        self.record_probe_success_with_portal(origin, portal);
    }

    pub fn begin_probe(&mut self) -> u64 {
        self.probe_generation = self.probe_generation.wrapping_add(1);
        self.recent_probe = None;
        self.probe_generation
    }

    pub fn record_probe_success_with_portal(&mut self, origin: ServerOrigin, auth_portal_url: Url) {
        self.recent_probe = Some(SuccessfulProbe {
            origin,
            auth_portal_url,
        });
    }

    pub fn record_probe_success_if_current(
        &mut self,
        generation: u64,
        origin: ServerOrigin,
        auth_portal_url: Url,
    ) -> bool {
        if generation != self.probe_generation {
            return false;
        }
        self.record_probe_success_with_portal(origin, auth_portal_url);
        true
    }

    pub fn authorize_workspace_open(&self, origin: &ServerOrigin) -> Result<(), String> {
        if self.is_saved(origin) && self.has_successful_probe(origin) {
            Ok(())
        } else {
            Err("WORKSPACE_ORIGIN_NOT_TRUSTED".to_string())
        }
    }

    pub fn is_saved(&self, origin: &ServerOrigin) -> bool {
        self.saved
            .as_ref()
            .is_some_and(|config| config.server_origin() == origin)
    }

    pub fn will_switch_to(&self, origin: &ServerOrigin) -> bool {
        self.saved
            .as_ref()
            .is_some_and(|config| config.server_origin() != origin)
    }

    pub fn has_successful_probe(&self, origin: &ServerOrigin) -> bool {
        self.recent_probe
            .as_ref()
            .is_some_and(|probe| probe.origin == *origin)
    }

    pub fn config_after_successful_probe(
        &self,
        origin: &ServerOrigin,
    ) -> Result<ServerConfig, String> {
        if !self
            .recent_probe
            .as_ref()
            .is_some_and(|probe| probe.origin == *origin)
        {
            return Err("SERVER_ORIGIN_NOT_PROBED".to_string());
        }
        Ok(ServerConfig::new(origin.clone(), Some(Utc::now())))
    }

    pub fn record_saved(&mut self, config: ServerConfig) -> bool {
        let switched = self
            .saved
            .as_ref()
            .is_some_and(|saved| saved.server_origin() != config.server_origin());
        self.saved = Some(config);
        if switched {
            self.active_workspace = None;
            self.workspace_generation = self.workspace_generation.wrapping_add(1);
            self.workspace_ready = false;
        }
        switched
    }

    pub fn navigation_policy(
        &self,
        origin: &ServerOrigin,
    ) -> Result<WorkspaceNavigationPolicy, String> {
        self.authorize_workspace_open(origin)?;
        let probe = self
            .recent_probe
            .as_ref()
            .ok_or_else(|| "SERVER_ORIGIN_NOT_PROBED".to_string())?;
        Ok(WorkspaceNavigationPolicy {
            business_origin: origin.clone(),
            auth_portal_url: probe.auth_portal_url.clone(),
        })
    }

    pub const fn saved(&self) -> Option<&ServerConfig> {
        self.saved.as_ref()
    }

    pub const fn active_workspace(&self) -> Option<&ServerOrigin> {
        self.active_workspace.as_ref()
    }

    pub fn active_workspace_lease(&self) -> Option<WorkspaceLease> {
        self.active_workspace.as_ref().map(|origin| WorkspaceLease {
            origin: origin.clone(),
            generation: self.workspace_generation,
        })
    }

    pub fn is_workspace_lease_current(&self, lease: &WorkspaceLease) -> bool {
        self.workspace_generation == lease.generation
            && self.active_workspace.as_ref() == Some(&lease.origin)
    }

    pub fn deactivate_workspace(&mut self) -> bool {
        let was_active = self.active_workspace.is_some();
        self.active_workspace = None;
        self.workspace_generation = self.workspace_generation.wrapping_add(1);
        self.workspace_ready = false;
        was_active
    }

    pub fn activate_workspace(&mut self, origin: ServerOrigin) -> u64 {
        self.workspace_generation = self.workspace_generation.wrapping_add(1);
        self.active_workspace = Some(origin);
        self.workspace_ready = false;
        self.workspace_generation
    }

    pub const fn is_workspace_generation_current(&self, generation: u64) -> bool {
        self.active_workspace.is_some() && self.workspace_generation == generation
    }

    pub fn mark_workspace_ready(&mut self, origin: &ServerOrigin) -> Result<(), String> {
        if self.active_workspace.as_ref() != Some(origin) {
            return Err("WORKSPACE_NOT_ACTIVE".to_string());
        }
        self.workspace_ready = true;
        Ok(())
    }

    pub fn is_workspace_ready(&self, origin: &ServerOrigin) -> bool {
        self.workspace_ready && self.active_workspace.as_ref() == Some(origin)
    }
}

pub struct WindowManagerState {
    config_path: PathBuf,
    configuration_warning: Option<String>,
    trust: Mutex<ServerTrustState>,
    probe: DesktopProbe,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    auth_portal_url: String,
}

impl WindowManagerState {
    pub fn load(config_dir: &Path) -> Result<Self, String> {
        let config_path = config_dir.join(SERVER_CONFIG_FILE);
        let (saved, configuration_warning) = match load_server_config(&config_path) {
            Ok(saved) => (saved, None),
            Err(ServerConfigError::InvalidFormat | ServerConfigError::UnsupportedSchema) => {
                let suffix = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |duration| duration.as_nanos());
                let quarantine = config_dir.join(format!("{SERVER_CONFIG_FILE}.corrupt-{suffix}"));
                let warning = if fs::rename(&config_path, quarantine).is_ok() {
                    "本机服务器配置已损坏，已安全隔离。请重新填写并测试地址。"
                } else {
                    "本机服务器配置已损坏，已忽略旧配置。请重新填写并测试地址。"
                };
                (None, Some(warning.to_string()))
            }
            Err(_) => (
                None,
                Some("暂时无法读取本机服务器配置。请重新填写并测试地址。".to_string()),
            ),
        };
        Ok(Self {
            config_path,
            configuration_warning,
            trust: Mutex::new(ServerTrustState::new(saved)),
            probe: DesktopProbe::new().map_err(|error| error.to_string())?,
        })
    }

    pub fn configuration_warning(&self) -> Option<&str> {
        self.configuration_warning.as_deref()
    }

    pub fn active_origin(&self) -> Result<ServerOrigin, String> {
        self.trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
            .active_workspace()
            .cloned()
            .ok_or_else(|| "WORKSPACE_NOT_ACTIVE".to_string())
    }

    pub fn workspace_lease_for_window(
        &self,
        window: &WebviewWindow,
    ) -> Result<WorkspaceLease, String> {
        let trust = self
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?;
        let lease = trust
            .active_workspace_lease()
            .ok_or_else(|| "WORKSPACE_NOT_ACTIVE".to_string())?;
        guard_window(window, CommandScope::Business, Some(lease.origin()))?;
        Ok(lease)
    }

    pub fn with_current_workspace_lease<T>(
        &self,
        window: &WebviewWindow,
        lease: &WorkspaceLease,
        operation: impl FnOnce(&ServerOrigin) -> Result<T, String>,
    ) -> Result<T, String> {
        let trust = self
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?;
        if !trust.is_workspace_lease_current(lease) {
            return Err("WORKSPACE_LEASE_STALE".to_string());
        }
        guard_window(window, CommandScope::Business, Some(lease.origin()))?;
        operation(lease.origin())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfigSnapshot {
    server_origin: Option<String>,
    last_successful_check_at: Option<chrono::DateTime<Utc>>,
    configuration_warning: Option<String>,
}

#[tauri::command]
pub fn server_config_get(
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
) -> Result<ServerConfigSnapshot, String> {
    guard_window(&window, CommandScope::Launcher, None)?;
    let saved = state
        .trust
        .lock()
        .map(|trust| trust.saved().cloned())
        .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?;
    let config = match saved {
        Some(config) => Some(config),
        None => default_server_config(option_env!("AI_ASSISTANT_DEFAULT_SERVER_ORIGIN"))
            .map_err(|error| error.to_string())?,
    };
    Ok(ServerConfigSnapshot {
        server_origin: config
            .as_ref()
            .map(|value| value.server_origin().as_str().to_string()),
        last_successful_check_at: config
            .as_ref()
            .and_then(ServerConfig::last_successful_check_at),
        configuration_warning: state.configuration_warning.clone(),
    })
}

#[tauri::command]
pub async fn server_probe(
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
    origin: String,
) -> Result<ProbeResult, String> {
    guard_window(&window, CommandScope::Launcher, None)?;
    let origin = ServerOrigin::parse(&origin).map_err(|error| error.to_string())?;
    let probe_generation = state
        .trust
        .lock()
        .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
        .begin_probe();
    let result = state
        .probe
        .probe(&origin)
        .await
        .map_err(|error| format!("{:?}", error.kind()))?;
    let auth_portal_url = result.auth_portal_url().clone();
    let recorded = state
        .trust
        .lock()
        .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
        .record_probe_success_if_current(probe_generation, origin, auth_portal_url.clone());
    if !recorded {
        return Err("SERVER_PROBE_STALE".to_string());
    }
    Ok(ProbeResult {
        auth_portal_url: auth_portal_url.to_string(),
    })
}

#[tauri::command]
pub fn server_config_save(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
    app_state: tauri::State<'_, AppState>,
    origin: String,
) -> Result<(), String> {
    guard_window(&window, CommandScope::Launcher, None)?;
    let origin = ServerOrigin::parse(&origin).map_err(|error| error.to_string())?;
    let (config, switching, previous_origin) = {
        let trust = state
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?;
        (
            trust.config_after_successful_probe(&origin)?,
            trust.will_switch_to(&origin),
            trust.saved().map(|saved| saved.server_origin().clone()),
        )
    };
    if switching {
        workspace_closed(&state);
        let mut cleanup_result = Ok(());
        merge_cleanup_result(&mut cleanup_result, app_state.cancel_all_model_requests());
        if let (Some(user_id), Some(previous_origin)) = (
            app_state.local_user.current_user_id()?,
            previous_origin.as_ref(),
        ) {
            merge_cleanup_result(
                &mut cleanup_result,
                crate::local_commands::clear_drafts_for_origin(
                    &app_state,
                    &user_id,
                    previous_origin,
                ),
            );
        }
        merge_cleanup_result(&mut cleanup_result, app_state.local_user.clear());
        merge_cleanup_result(&mut cleanup_result, clear_window_cookies(&window));
        if let Some(workspace) = app.get_webview_window("workspace") {
            merge_cleanup_result(&mut cleanup_result, clear_window_cookies(&workspace));
            merge_cleanup_result(
                &mut cleanup_result,
                workspace.close().map_err(|error| error.to_string()),
            );
        }
        cleanup_result?;
    }
    save_server_config(&state.config_path, &config).map_err(|error| error.to_string())?;
    state
        .trust
        .lock()
        .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
        .record_saved(config);
    Ok(())
}

#[tauri::command]
pub async fn workspace_open(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
    origin: String,
) -> Result<(), String> {
    guard_window(&window, CommandScope::Launcher, None)?;
    let origin = ServerOrigin::parse(&origin).map_err(|error| error.to_string())?;
    let requires_probe = {
        let trust = state
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?;
        if !trust.is_saved(&origin) {
            return Err("WORKSPACE_ORIGIN_NOT_SAVED".to_string());
        }
        !trust.has_successful_probe(&origin)
    };
    if requires_probe {
        let probe_generation = state
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
            .begin_probe();
        let result = state
            .probe
            .probe(&origin)
            .await
            .map_err(|error| format!("{:?}", error.kind()))?;
        let recorded = state
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
            .record_probe_success_if_current(
                probe_generation,
                origin.clone(),
                result.auth_portal_url().clone(),
            );
        if !recorded {
            return Err("SERVER_PROBE_STALE".to_string());
        }
    }
    let navigation_policy = {
        let trust = state
            .trust
            .lock()
            .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?;
        trust.authorize_workspace_open(&origin)?;
        trust.navigation_policy(&origin)?
    };
    if let Some(workspace) = app.get_webview_window("workspace") {
        let current = workspace
            .url()
            .map_err(|_| "WORKSPACE_URL_UNAVAILABLE".to_string())?;
        if navigation_policy.is_auth_portal(&current) {
            workspace.show().map_err(|error| error.to_string())?;
            workspace.set_focus().map_err(|error| error.to_string())?;
            return Ok(());
        }
        workspace_closed(&state);
        workspace.close().map_err(|error| error.to_string())?;
    }
    let launcher = window.clone();
    let auth_portal_json = serde_json::to_string(navigation_policy.auth_portal_url().as_str())
        .map_err(|_| "AUTH_PORTAL_SERIALIZATION_FAILED".to_string())?;
    let initialization_script =
        format!("window.__JUXIN_DESKTOP_AUTH_PORTAL__ = {auth_portal_json};");
    let navigation_for_load = navigation_policy.clone();
    let navigation_epoch = Arc::new(AtomicU64::new(0));
    let navigation_epoch_for_load = Arc::clone(&navigation_epoch);
    let app_for_load = app.clone();
    let origin_for_load = origin.clone();
    let workspace_generation = state
        .trust
        .lock()
        .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
        .activate_workspace(origin);
    let build_result = WebviewWindowBuilder::new(
        &app,
        "workspace",
        WebviewUrl::External(navigation_policy.auth_portal_url().clone()),
    )
    .title("聚信 AI 助手")
    .inner_size(1280.0, 820.0)
    .min_inner_size(900.0, 640.0)
    .visible(false)
    .initialization_script(initialization_script)
    .on_navigation(move |url| {
        let allowed = navigation_policy.allows(url);
        if !allowed {
            recover_workspace(
                launcher.app_handle(),
                &launcher.state::<WindowManagerState>(),
                Some("connection"),
            );
        }
        allowed
    })
    .on_page_load(move |workspace, payload| {
        if payload.event() == PageLoadEvent::Started {
            let epoch = navigation_epoch_for_load.fetch_add(1, Ordering::AcqRel) + 1;
            if navigation_for_load.allows(payload.url()) {
                schedule_workspace_ready_timeout(
                    app_for_load.clone(),
                    origin_for_load.clone(),
                    payload.url().clone(),
                    navigation_for_load.is_business(payload.url()),
                    workspace_generation,
                    Arc::clone(&navigation_epoch_for_load),
                    epoch,
                );
            }
        } else if payload.event() == PageLoadEvent::Finished
            && navigation_for_load.is_auth_portal(payload.url())
        {
            let shown = workspace
                .show()
                .and_then(|()| workspace.set_focus())
                .map_err(|error| error.to_string());
            if shown.is_ok() {
                navigation_epoch_for_load.fetch_add(1, Ordering::AcqRel);
            } else {
                recover_workspace(
                    workspace.app_handle(),
                    &workspace.state::<WindowManagerState>(),
                    Some("connection"),
                );
            }
        }
    })
    .build();
    match build_result {
        Ok(workspace) => {
            drop(workspace);
            Ok(())
        }
        Err(error) => {
            workspace_closed(&state);
            Err(error.to_string())
        }
    }
}

#[tauri::command]
pub fn workspace_ready(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    guard_business(&window, &state)?;
    app_state.local_user.require_bound()?;
    let origin = state.active_origin()?;
    reveal_workspace(&app, &window, &state, &origin)
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceStatus {
    Forbidden,
    NetworkError,
}

#[tauri::command]
pub fn workspace_status(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
    status: WorkspaceStatus,
) -> Result<(), String> {
    guard_business(&window, &state)?;
    match status {
        WorkspaceStatus::Forbidden => {
            let origin = state.active_origin()?;
            reveal_workspace(&app, &window, &state, &origin)
        }
        WorkspaceStatus::NetworkError => {
            recover_workspace(&app, &state, Some("connection"));
            Ok(())
        }
    }
}

#[tauri::command]
pub fn workspace_close(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, WindowManagerState>,
    app_state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    guard_business(&window, &state)?;
    app_state.cancel_all_model_requests()?;
    workspace_closed(&state);
    window.close().map_err(|error| error.to_string())?;
    emit_workspace_recovery(&app, None);
    show_launcher(&app)
}

#[tauri::command]
pub fn launcher_show(window: WebviewWindow) -> Result<(), String> {
    guard_window(&window, CommandScope::Launcher, None)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn show_launcher(app: &AppHandle) -> Result<(), String> {
    let launcher = app
        .get_webview_window("launcher")
        .ok_or_else(|| "LAUNCHER_WINDOW_UNAVAILABLE".to_string())?;
    launcher.show().map_err(|error| error.to_string())?;
    launcher.set_focus().map_err(|error| error.to_string())
}

pub fn hide_launcher(app: &AppHandle) -> Result<(), String> {
    app.get_webview_window("launcher")
        .ok_or_else(|| "LAUNCHER_WINDOW_UNAVAILABLE".to_string())?
        .hide()
        .map_err(|error| error.to_string())
}

pub fn clear_window_cookies(window: &WebviewWindow) -> Result<(), String> {
    for cookie in window.cookies().map_err(|error| error.to_string())? {
        window
            .delete_cookie(cookie)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn merge_cleanup_result(aggregate: &mut Result<(), String>, next: Result<(), String>) {
    if aggregate.is_ok() {
        *aggregate = next;
    }
}

pub fn guard_business(window: &WebviewWindow, state: &WindowManagerState) -> Result<(), String> {
    let active = state.active_origin()?;
    guard_window(window, CommandScope::Business, Some(&active))
}

pub fn workspace_closed(state: &WindowManagerState) -> bool {
    if let Ok(mut trust) = state.trust.lock() {
        trust.deactivate_workspace()
    } else {
        false
    }
}

pub fn emit_workspace_recovery(app: &AppHandle, reason: Option<&str>) {
    let _ = app.emit_to(
        "launcher",
        "workspace-recovered",
        WorkspaceRecovery {
            reason: reason.map(str::to_string),
        },
    );
}

fn recover_workspace(app: &AppHandle, state: &WindowManagerState, reason: Option<&str>) {
    if let Some(app_state) = app.try_state::<AppState>() {
        let _ = app_state.cancel_all_model_requests();
    }
    workspace_closed(state);
    if let Some(workspace) = app.get_webview_window("workspace") {
        let _ = workspace.close();
    }
    emit_workspace_recovery(app, reason);
    let _ = show_launcher(app);
}

fn schedule_workspace_ready_timeout(
    app: AppHandle,
    origin: ServerOrigin,
    target_origin: Url,
    requires_ready: bool,
    workspace_generation: u64,
    navigation_epoch: Arc<AtomicU64>,
    expected_epoch: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WORKSPACE_READY_TIMEOUT).await;
        if navigation_epoch.load(Ordering::Acquire) != expected_epoch {
            return;
        }
        let state = app.state::<WindowManagerState>();
        let (generation_current, ready) = state
            .trust
            .lock()
            .map(|trust| {
                (
                    trust.is_workspace_generation_current(workspace_generation),
                    trust.is_workspace_ready(&origin),
                )
            })
            .unwrap_or((false, false));
        if !generation_current {
            return;
        }
        let target_page_active = app
            .get_webview_window("workspace")
            .and_then(|workspace| workspace.url().ok())
            .is_some_and(|url| same_origin(&url, &target_origin));
        if (!requires_ready || !ready) && target_page_active {
            recover_workspace(&app, &state, Some("timeout"));
        }
    });
}

fn reveal_workspace(
    app: &AppHandle,
    window: &WebviewWindow,
    state: &WindowManagerState,
    origin: &ServerOrigin,
) -> Result<(), String> {
    let display_result = window
        .show()
        .and_then(|()| window.set_focus())
        .map_err(|error| error.to_string())
        .and_then(|()| hide_launcher(app));
    if let Err(error) = display_result {
        recover_workspace(app, state, Some("connection"));
        return Err(error);
    }
    let ready_result = state
        .trust
        .lock()
        .map_err(|_| "SERVER_TRUST_STATE_UNAVAILABLE".to_string())?
        .mark_workspace_ready(origin);
    if let Err(error) = ready_result {
        recover_workspace(app, state, Some("connection"));
        return Err(error);
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
struct WorkspaceRecovery {
    reason: Option<String>,
}
