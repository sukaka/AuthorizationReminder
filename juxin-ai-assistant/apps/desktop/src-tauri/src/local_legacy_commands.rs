use tauri::WebviewWindow;

use crate::commands::AppState;
use crate::local_commands::with_queue;
use crate::local_queue::LegacyUnassignedData;

#[tauri::command]
pub fn local_legacy_export(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
) -> Result<LegacyUnassignedData, String> {
    crate::window_manager::guard_business(&window, &windows)?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| queue.export_legacy_unassigned(&user_id))
}

#[tauri::command]
pub fn local_legacy_delete(
    window: WebviewWindow,
    state: tauri::State<'_, AppState>,
    windows: tauri::State<'_, crate::window_manager::WindowManagerState>,
    user_id: String,
) -> Result<(), String> {
    crate::window_manager::guard_business(&window, &windows)?;
    state.local_user.authorize(&user_id)?;
    with_queue(&state, |queue| queue.delete_legacy_unassigned(&user_id))
}
