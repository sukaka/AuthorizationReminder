mod commands;
pub mod keychain;
pub mod local_binding;
mod local_commands;
mod local_crypto;
pub mod local_queue;
mod local_types;
mod model_client;
pub mod model_profile_store;
pub mod model_profiles;
pub mod tray;
pub mod updater_policy;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use commands::AppState;
use keychain::SystemKeychain;
use local_binding::{configured_binding_base_url, LocalUserSession};
use model_profile_store::migrate_legacy_model_secrets;
use model_profiles::load_profiles;
use tauri::Manager;
use tray::{CloseAction, LifecycleState, TrayPreference};
use updater_policy::UpdaterPolicy;

pub fn run() {
    let updater_policy = UpdaterPolicy::from_env(|key| std::env::var(key).ok())
        .unwrap_or_else(|error| panic!("自动更新配置无效: {error}"));
    let mut builder =
        tauri::Builder::default().plugin(tauri_plugin_single_instance::init(|app, _, _| {
            tray::restore_main(app);
        }));
    if let Some(public_key) = updater_policy.public_key() {
        builder = builder.plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(public_key)
                .build(),
        );
    }
    let setup_policy = updater_policy.clone();
    let app = builder
        .manage(updater_policy)
        .manage(LifecycleState::new(TrayPreference {
            minimize_to_tray: true,
        }))
        .setup(move |app| {
            let app_data_dir = app.path().app_data_dir()?;
            let profiles_path = app_data_dir.join("model-profiles.json");
            let profiles = load_profiles(&profiles_path).map_err(std::io::Error::other)?;
            let secrets: Arc<dyn keychain::SecretStore> = Arc::new(SystemKeychain);
            migrate_legacy_model_secrets(&profiles, secrets.as_ref())
                .map_err(std::io::Error::other)?;
            app.manage(AppState {
                profiles_path,
                local_storage_path: app_data_dir.join("secure-local"),
                profiles: Mutex::new(profiles),
                secrets,
                cancellations: Mutex::new(HashMap::new()),
                local_user: LocalUserSession::default(),
                binding_base_url: configured_binding_base_url().map_err(std::io::Error::other)?,
            });
            tray::install_tray(app)?;
            tray::restore_main(app.handle());
            updater_policy::schedule_check(app.handle(), &setup_policy);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<LifecycleState>().close_action() == CloseAction::Hide {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            local_commands::local_session_bind,
            local_commands::local_draft_save,
            local_commands::local_draft_load,
            local_commands::local_draft_delete,
            local_commands::local_queue_push,
            local_commands::local_queue_list,
            local_commands::local_queue_remove,
            local_commands::local_cache_clear,
            local_commands::local_logout,
            commands::model_profile_list,
            commands::model_profile_upsert,
            commands::model_profile_delete,
            commands::model_profile_set_default,
            commands::model_profile_test,
            commands::model_generate,
            commands::model_cancel,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build 聚信 AI 助手");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Reopen { .. } = event {
            tray::restore_main(app_handle);
        }
    });
}
