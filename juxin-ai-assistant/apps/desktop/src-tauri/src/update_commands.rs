use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, Runtime, WebviewWindow};
use tauri_plugin_updater::UpdaterExt;

use crate::command_origin::{guard_window, CommandScope};
use crate::update_manager::UpdateManagerState;
use crate::update_state::{CheckMode, UpdateFailureStage, UpdatePhase};
use crate::updater_policy::UpdaterPolicy;
use crate::window_manager::{guard_business, WindowManagerState};

const UPDATE_EVENT: &str = "update-status-changed";
const STARTUP_CHECK_DELAY: Duration = Duration::from_secs(15);
const PERIODIC_CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[tauri::command]
pub fn update_status(
    window: WebviewWindow,
    state: tauri::State<'_, UpdateManagerState>,
    window_state: tauri::State<'_, WindowManagerState>,
) -> Result<UpdatePhase, String> {
    guard_update_window(&window, &window_state)?;
    state.phase()
}

#[tauri::command]
pub async fn update_check(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, UpdateManagerState>,
    policy: tauri::State<'_, UpdaterPolicy>,
    window_state: tauri::State<'_, WindowManagerState>,
) -> Result<UpdatePhase, String> {
    guard_update_window(&window, &window_state)?;
    run_check(&app, &state, &policy, CheckMode::Manual).await
}

#[tauri::command]
pub fn update_download_and_install(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, UpdateManagerState>,
    window_state: tauri::State<'_, WindowManagerState>,
) -> Result<(), String> {
    guard_update_window(&window, &window_state)?;
    let state = state.inner().clone();
    let (operation, update, phase, cancel_receiver) = state.begin_download_with_cancel()?;
    emit_status(&app, &phase);
    let task_app = app.clone();
    let task_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let progress_app = task_app.clone();
        let progress_state = task_state.clone();
        let download = update.download(
            move |chunk_length, total| {
                if let Ok(Some(phase)) =
                    progress_state.record_download(operation, chunk_length, total)
                {
                    emit_status(&progress_app, &phase);
                }
            },
            || {},
        );
        let result = tokio::select! {
            biased;
            _ = cancel_receiver => return,
            result = download => result,
        };
        let bytes = match result {
            Ok(bytes) => bytes,
            Err(_) => {
                fail_update(
                    &task_app,
                    &task_state,
                    operation,
                    UpdateFailureStage::Download,
                    "更新下载或签名验证失败，当前版本仍可继续使用。",
                );
                return;
            }
        };
        let Ok(Some(phase)) = task_state.begin_install(operation) else {
            return;
        };
        emit_status(&task_app, &phase);
        let install = tauri::async_runtime::spawn_blocking(move || update.install(bytes)).await;
        if !matches!(install, Ok(Ok(()))) {
            fail_update(
                &task_app,
                &task_state,
                operation,
                UpdateFailureStage::Install,
                "更新安装失败，当前版本仍可继续使用。",
            );
            return;
        }
        task_app.request_restart();
    });
    Ok(())
}

#[tauri::command]
pub fn update_cancel(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, UpdateManagerState>,
    window_state: tauri::State<'_, WindowManagerState>,
) -> Result<(), String> {
    guard_update_window(&window, &window_state)?;
    let (cancel, phase) = state.cancel_download()?;
    let _ = cancel.send(());
    emit_status(&app, &phase);
    Ok(())
}

#[tauri::command]
pub fn update_defer(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, UpdateManagerState>,
    window_state: tauri::State<'_, WindowManagerState>,
) -> Result<(), String> {
    guard_update_window(&window, &window_state)?;
    let phase = state.defer(unix_seconds())?;
    emit_status(&app, &phase);
    Ok(())
}

pub fn schedule_checks<R: Runtime>(
    app: AppHandle<R>,
    state: UpdateManagerState,
    policy: UpdaterPolicy,
) {
    if !policy.enabled() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_CHECK_DELAY).await;
        loop {
            let _ = run_check(&app, &state, &policy, CheckMode::Automatic).await;
            tokio::time::sleep(PERIODIC_CHECK_INTERVAL).await;
        }
    });
}

async fn run_check<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdateManagerState,
    policy: &UpdaterPolicy,
    mode: CheckMode,
) -> Result<UpdatePhase, String> {
    let operation = state.begin_check()?;
    emit_status(app, &state.phase()?);
    let result = async {
        let endpoint = policy
            .endpoint()
            .cloned()
            .ok_or_else(|| "UPDATER_DISABLED".to_string())?;
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .map_err(|_| "UPDATE_CHECK_FAILED".to_string())?
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| "UPDATE_CHECK_FAILED".to_string())?;
        updater
            .check()
            .await
            .map_err(|_| "UPDATE_CHECK_FAILED".to_string())
    }
    .await;
    match result {
        Ok(update) => match state.finish_check(operation, update, mode, unix_seconds()) {
            Ok(phase) => {
                emit_status(app, &phase);
                Ok(phase)
            }
            Err(error) => {
                let phase = state.fail(
                    operation,
                    UpdateFailureStage::Check,
                    "更新信息不安全或不兼容，当前版本仍可继续使用。",
                )?;
                emit_status(app, &phase);
                Err(error)
            }
        },
        Err(error) => {
            let phase = state.fail(
                operation,
                UpdateFailureStage::Check,
                "暂时无法检查更新，请稍后重试。",
            )?;
            emit_status(app, &phase);
            Err(error)
        }
    }
}

fn fail_update<R: Runtime>(
    app: &AppHandle<R>,
    state: &UpdateManagerState,
    operation: crate::update_state::UpdateOperation,
    stage: UpdateFailureStage,
    message: &str,
) {
    if let Ok(phase) = state.fail(operation, stage, message) {
        emit_status(app, &phase);
    }
}

fn emit_status<R: Runtime>(app: &AppHandle<R>, phase: &UpdatePhase) {
    let _ = app.emit_to("launcher", UPDATE_EVENT, phase);
    let _ = app.emit_to("workspace", UPDATE_EVENT, phase);
}

fn guard_update_window(window: &WebviewWindow, state: &WindowManagerState) -> Result<(), String> {
    match window.label() {
        "launcher" => guard_window(window, CommandScope::Launcher, None),
        "workspace" => guard_business(window, state),
        _ => Err("IPC_CALLER_UNAUTHORIZED".to_string()),
    }
}

fn unix_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_secs())
}
