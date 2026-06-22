use crate::commands::AppState;
use crate::local_binding::verify_binding_token;
pub use crate::local_binding::LocalUserSession;
use crate::local_queue::{
    configured_legacy_origin, CacheClearOptions, CacheClearReport, DraftInput, LocalQueue,
    LocalQueueError, PendingResult, QueueStatus,
};
use tauri::{AppHandle, WebviewWindow};

fn queue(state: &AppState) -> LocalQueue<'_> {
    match configured_legacy_origin() {
        Some(origin) => LocalQueue::with_legacy_origin(
            &state.local_storage_path,
            state.secrets.as_ref(),
            origin,
        ),
        None => LocalQueue::new(&state.local_storage_path, state.secrets.as_ref()),
    }
}

pub(crate) fn with_queue<T>(
    state: &AppState,
    operation: impl FnOnce(&LocalQueue<'_>) -> Result<T, LocalQueueError>,
) -> Result<T, String> {
    let _guard = state
        .local_storage_lock
        .lock()
        .map_err(|_| "LOCAL_STORAGE_UNAVAILABLE".to_string())?;
    operation(&queue(state)).map_err(|error| error.to_string())
}

pub(crate) fn clear_drafts_for_origin(
    state: &AppState,
    user_id: &str,
    origin: &crate::server_config::ServerOrigin,
) -> Result<(), String> {
    with_queue(state, |queue| queue.logout(user_id, origin).map(|_| ()))
}

#[tauri::command]
pub async fn local_session_bind(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    token: String,
) -> Result<(), String> {
    let lease = windows.workspace_lease_for_window(&window)?;
    let user_id = verify_binding_token(lease.origin().as_url(), &token).await?;
    windows.with_current_workspace_lease(&window, &lease, |origin| {
        state.local_user.bind_verified(&user_id, |previous| {
            with_queue(&state, |queue| queue.logout(previous, origin).map(|_| ()))
        })
    })
}

#[tauri::command]
pub fn local_draft_save(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
    task_id: String,
    content: String,
) -> Result<(), String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| {
        queue.save_draft(&user_id, &origin, DraftInput::new(&task_id, &content))
    })
}

#[tauri::command]
pub fn local_draft_load(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
    task_id: String,
) -> Result<Option<DraftInput>, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| {
        queue.load_draft(&user_id, &origin, &task_id)
    })
}

#[tauri::command]
pub fn local_draft_delete(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
    task_id: String,
) -> Result<(), String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| {
        queue.delete_draft(&user_id, &origin, &task_id)
    })
}

#[tauri::command]
pub fn local_queue_push(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
    result_id: String,
    payload: String,
) -> Result<(), String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| {
        queue.push(
            &user_id,
            &origin,
            PendingResult::new(&result_id, &payload, QueueStatus::Pending),
        )
    })
}

#[tauri::command]
pub fn local_queue_list(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
) -> Result<Vec<PendingResult>, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| queue.list(&user_id, &origin))
}

#[tauri::command]
pub fn local_queue_remove(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
    result_id: String,
) -> Result<(), String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| queue.remove(&user_id, &origin, &result_id))
}

#[tauri::command]
pub fn local_cache_clear(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
    delete_unsynced: bool,
) -> Result<CacheClearReport, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.local_user.authorize(&user_id)?;
    let options = if delete_unsynced {
        CacheClearOptions::delete_all()
    } else {
        CacheClearOptions::preserve_unsynced()
    };
    with_queue(&state, |queue| {
        queue.clear_cache(&user_id, &origin, options)
    })
}

#[tauri::command]
pub fn local_logout(
    app: AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
) -> Result<CacheClearReport, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    state.cancel_all_model_requests()?;
    let report = state.local_user.logout(&user_id, |verified_user_id| {
        with_queue(&state, |queue| queue.logout(verified_user_id, &origin))
    })?;
    crate::window_manager::workspace_closed(&windows);
    let mut cleanup_result = Ok(());
    crate::window_manager::merge_cleanup_result(
        &mut cleanup_result,
        crate::window_manager::clear_window_cookies(&window),
    );
    crate::window_manager::merge_cleanup_result(
        &mut cleanup_result,
        window.close().map_err(|error| error.to_string()),
    );
    crate::window_manager::merge_cleanup_result(
        &mut cleanup_result,
        crate::window_manager::show_launcher(&app),
    );
    crate::window_manager::emit_workspace_recovery(&app, None);
    cleanup_result?;
    Ok(report)
}
