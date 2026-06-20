use crate::commands::AppState;
use crate::local_binding::verify_binding_token;
pub use crate::local_binding::LocalUserSession;
use crate::local_queue::{
    CacheClearOptions, CacheClearReport, DraftInput, LocalQueue, PendingResult, QueueStatus,
};

fn queue(state: &AppState) -> LocalQueue<'_> {
    LocalQueue::new(&state.local_storage_path, state.secrets.as_ref())
}

#[tauri::command]
pub async fn local_session_bind(
    state: tauri::State<'_, AppState>,
    token: String,
) -> Result<(), String> {
    let user_id = verify_binding_token(&state.binding_base_url, &token).await?;
    state.local_user.bind_verified(&user_id, |previous| {
        queue(&state)
            .logout(previous)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
}

#[tauri::command]
pub fn local_draft_save(
    state: tauri::State<'_, AppState>,
    user_id: String,
    task_id: String,
    content: String,
) -> Result<(), String> {
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .save_draft(&user_id, DraftInput::new(&task_id, &content))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_draft_load(
    state: tauri::State<'_, AppState>,
    user_id: String,
    task_id: String,
) -> Result<Option<DraftInput>, String> {
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .load_draft(&user_id, &task_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_draft_delete(
    state: tauri::State<'_, AppState>,
    user_id: String,
    task_id: String,
) -> Result<(), String> {
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .delete_draft(&user_id, &task_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_queue_push(
    state: tauri::State<'_, AppState>,
    user_id: String,
    result_id: String,
    payload: String,
) -> Result<(), String> {
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
    state: tauri::State<'_, AppState>,
    user_id: String,
) -> Result<Vec<PendingResult>, String> {
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .list(&user_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_queue_remove(
    state: tauri::State<'_, AppState>,
    user_id: String,
    result_id: String,
) -> Result<(), String> {
    state.local_user.authorize(&user_id)?;
    queue(&state)
        .remove(&user_id, &result_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn local_cache_clear(
    state: tauri::State<'_, AppState>,
    user_id: String,
    delete_unsynced: bool,
) -> Result<CacheClearReport, String> {
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
    state: tauri::State<'_, AppState>,
    user_id: String,
) -> Result<CacheClearReport, String> {
    state.local_user.logout(&user_id, |verified_user_id| {
        queue(&state)
            .logout(verified_user_id)
            .map_err(|error| error.to_string())
    })
}
