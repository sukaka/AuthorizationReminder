pub mod build_mode;
pub mod command_origin;
mod commands;
mod file_export_commands;
pub mod keychain;
pub mod local_binding;
mod local_commands;
mod local_crypto;
mod local_legacy;
mod local_legacy_commands;
pub mod local_queue;
mod local_record_store;
mod local_types;
pub mod model_cancellation;
mod model_client;
pub mod model_profile_store;
pub mod model_profiles;
pub mod server_config;
mod server_probe;
pub mod tray;
mod update_commands;
mod update_manager;
pub mod update_state;
pub mod updater_policy;
pub mod window_manager;

use std::sync::{Arc, Mutex};

use commands::AppState;
use keychain::LocalEncryptedSecretStore;
use local_binding::LocalUserSession;
use model_profiles::load_profiles;
use tauri::Manager;
use tray::{CloseAction, LifecycleState, TrayPreference};
use updater_policy::UpdaterPolicy;

pub fn run() {
    let updater_policy = UpdaterPolicy::from_build(
        option_env!("AI_UPDATER_ENABLED"),
        option_env!("AI_UPDATER_URL"),
        option_env!("AI_UPDATER_PUBLIC_KEY"),
    )
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
            let app_config_dir = app.path().app_config_dir()?;
            let update_manager = update_manager::UpdateManagerState::new(setup_policy.enabled());
            let profiles_path = app_data_dir.join("model-profiles.json");
            let profiles = load_profiles(&profiles_path).map_err(std::io::Error::other)?;
            let secrets: Arc<dyn keychain::SecretStore> = Arc::new(LocalEncryptedSecretStore::new(
                &app_data_dir.join("secrets"),
            )?);
            app.manage(AppState {
                profiles_path,
                local_storage_path: app_data_dir.join("secure-local"),
                profiles: Mutex::new(profiles),
                secrets,
                cancellations: Mutex::new(model_cancellation::ModelCancellationRegistry::default()),
                local_storage_lock: Mutex::new(()),
                local_user: LocalUserSession::default(),
            });
            app.manage(
                window_manager::WindowManagerState::load(&app_config_dir)
                    .map_err(std::io::Error::other)?,
            );
            app.manage(update_manager.clone());
            tray::install_tray(app)?;
            tray::restore_main(app.handle());
            update_commands::schedule_checks(
                app.handle().clone(),
                update_manager,
                setup_policy.clone(),
            );
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => match window.label() {
                "launcher"
                    if window.state::<LifecycleState>().close_action() == CloseAction::Hide =>
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
                "workspace" => {
                    let _ = window.state::<AppState>().cancel_all_model_requests();
                    let was_active = window_manager::workspace_closed(
                        &window.state::<window_manager::WindowManagerState>(),
                    );
                    if was_active {
                        window_manager::emit_workspace_recovery(window.app_handle(), None);
                    }
                    let _ = window_manager::show_launcher(window.app_handle());
                }
                _ => {}
            },
            tauri::WindowEvent::Destroyed if window.label() == "workspace" => {
                let _ = window.state::<AppState>().cancel_all_model_requests();
                window_manager::workspace_closed(
                    &window.state::<window_manager::WindowManagerState>(),
                );
                let _ = window_manager::show_launcher(window.app_handle());
            }
            _ => {}
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
            local_legacy_commands::local_legacy_export,
            local_legacy_commands::local_legacy_delete,
            local_commands::local_logout,
            commands::model_profile_list,
            commands::model_profile_upsert,
            commands::model_profile_delete,
            commands::model_profile_set_default,
            commands::model_profile_test,
            commands::model_generate,
            commands::model_cancel,
            file_export_commands::generation_word_save,
            window_manager::server_config_get,
            window_manager::server_probe,
            window_manager::server_config_save,
            window_manager::workspace_open,
            window_manager::workspace_ready,
            window_manager::workspace_status,
            window_manager::workspace_close,
            window_manager::launcher_show,
            update_commands::update_status,
            update_commands::update_check,
            update_commands::update_download_and_install,
            update_commands::update_cancel,
            update_commands::update_defer,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build 聚信 AI 助手");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Reopen { .. } = event {
            tray::restore_main(app_handle);
        }
    });
}
