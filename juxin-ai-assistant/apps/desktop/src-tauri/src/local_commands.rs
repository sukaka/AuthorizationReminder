use crate::commands::AppState;
use crate::local_binding::verify_binding_token;
pub use crate::local_binding::LocalUserSession;
use crate::local_queue::{
    CacheClearOptions, CacheClearReport, DraftInput, LocalQueue, PendingResult, QueueStatus,
};
use tauri::{AppHandle, WebviewWindow};

fn queue(state: &AppState) -> LocalQueue<'_> {
    LocalQueue::new(&state.local_storage_path, state.secrets.as_ref())
}

#[tauri::command]
pub async fn local_session_bind(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    token: String,
) -> Result<(), String> {
    crate::window_manager::guard_business(&window, &windows)?;
    let origin = windows.active_origin()?;
    let user_id = verify_binding_token(origin.as_url(), &token).await?;
    state.local_user.bind_verified(&user_id, |previous| {
        queue(&state)
            .logout(previous)
            .map(|_| ())
            .map_err(|error| error.to_string())
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
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .save_draft(&user_id, DraftInput::new(&task_id, &content))
        .map_err(|error| error.to_string())
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
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .load_draft(&user_id, &task_id)
        .map_err(|error| error.to_string())
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
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .delete_draft(&user_id, &task_id)
        .map_err(|error| error.to_string())
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
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .push(
            &user_id,
            PendingResult::new(&result_id, &payload, QueueStatus::Pending),
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_queue_list(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
) -> Result<Vec<PendingResult>, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .list(&user_id)
        .map_err(|error| error.to_string())
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
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .remove(&user_id, &result_id)
        .map_err(|error| error.to_string())
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
    state.local_user.authorize(&user_id)?;
    let options = if delete_unsynced {
        CacheClearOptions::delete_all()
    } else {
        CacheClearOptions::preserve_unsynced()
    };
    queue(&state)
        .clear_cache(&user_id, options)
        .map_err(|error| error.to_string())
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
    state.cancel_all_model_requests()?;
    let report = state.local_user.logout(&user_id, |verified_user_id| {
        queue(&state)
            .logout(verified_user_id)
            .map_err(|error| error.to_string())
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
