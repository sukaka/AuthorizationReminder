mod commands;
mod keychain;
mod model_client;
mod model_profiles;

use std::sync::{Arc, Mutex};
use std::collections::HashMap;

use commands::AppState;
use keychain::SystemKeychain;
use model_profiles::load_profiles;
use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let profiles_path = app.path().app_data_dir()?.join("model-profiles.json");
            let profiles = load_profiles(&profiles_path)
                .map_err(|message| std::io::Error::other(message))?;
            app.manage(AppState {
                profiles_path,
                profiles: Mutex::new(profiles),
                secrets: Arc::new(SystemKeychain),
                cancellations: Mutex::new(HashMap::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::model_profile_list,
            commands::model_profile_upsert,
            commands::model_profile_delete,
            commands::model_profile_set_default,
            commands::model_profile_test,
            commands::model_generate,
            commands::model_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run 聚信 AI 助手");
}
