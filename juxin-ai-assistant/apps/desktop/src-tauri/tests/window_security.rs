use std::fs;
use std::path::Path;

use juxin_ai_assistant_lib::command_origin::{
    authorize, CallerContext, CommandOriginError, CommandScope,
};
use juxin_ai_assistant_lib::local_binding::LocalUserSession;
use juxin_ai_assistant_lib::server_config::{ServerConfig, ServerOrigin};
use juxin_ai_assistant_lib::window_manager::ServerTrustState;

fn production_origin(raw: &str) -> ServerOrigin {
    ServerOrigin::parse_production(raw).unwrap()
}

#[test]
fn workspace_authorization_accepts_equivalent_https_origin() {
    // Given: the saved business server uses the default HTTPS port.
    let saved = production_origin("https://ai.example.com");
    let caller = CallerContext::new("workspace", "https://AI.EXAMPLE.COM:443/tasks/42").unwrap();

    // When: a business command validates its native caller context.
    let result = authorize(&caller, CommandScope::Business, Some(&saved));

    // Then: scheme, normalized host and effective port are accepted as the same origin.
    assert_eq!(result, Ok(()));
}

#[test]
fn workspace_authorization_rejects_prefix_port_and_userinfo_confusion() {
    // Given: one exact saved business origin.
    let saved = production_origin("https://ai.example.com");
    let hostile_urls = [
        "https://ai.example.com.evil.test/tasks",
        "https://ai.example.com:444/tasks",
        "https://user@ai.example.com/tasks",
    ];

    // When / Then: origin-confusion variants never authorize a business command.
    for raw in hostile_urls {
        let result = CallerContext::new("workspace", raw)
            .and_then(|caller| authorize(&caller, CommandScope::Business, Some(&saved)));
        assert_eq!(result, Err(CommandOriginError::Unauthorized));
    }
}

#[test]
fn window_roles_cannot_cross_command_scopes() {
    // Given: local launcher, business workspace and an SSO portal page.
    let saved = production_origin("https://ai.example.com");
    let launcher = CallerContext::new("launcher", "tauri://localhost/index.html").unwrap();
    let workspace = CallerContext::new("workspace", "https://ai.example.com/tasks").unwrap();
    let portal = CallerContext::new("workspace", "https://auth.example.com/portal").unwrap();

    // When / Then: each role is restricted to its own command surface.
    assert_eq!(
        authorize(&launcher, CommandScope::Business, Some(&saved)),
        Err(CommandOriginError::Unauthorized)
    );
    assert_eq!(
        authorize(&workspace, CommandScope::Launcher, Some(&saved)),
        Err(CommandOriginError::Unauthorized)
    );
    assert_eq!(
        authorize(&portal, CommandScope::Business, Some(&saved)),
        Err(CommandOriginError::Unauthorized)
    );
}

#[test]
fn development_launcher_accepts_only_the_configured_loopback_origin() {
    // Given: the checked-in Vite development origin and nearby hostile variants.
    let launcher = CallerContext::new("launcher", "http://localhost:18093/index.html").unwrap();
    let wrong_port = CallerContext::new("launcher", "http://localhost:18094/index.html").unwrap();
    let non_loopback =
        CallerContext::new("launcher", "http://192.168.1.8:18093/index.html").unwrap();

    // When / Then: debug builds can use the exact local dev origin only.
    assert_eq!(authorize(&launcher, CommandScope::Launcher, None), Ok(()));
    assert_eq!(
        authorize(&wrong_port, CommandScope::Launcher, None),
        Err(CommandOriginError::Unauthorized)
    );
    assert_eq!(
        authorize(&non_loopback, CommandScope::Launcher, None),
        Err(CommandOriginError::Unauthorized)
    );
}

#[test]
fn auth_portal_navigation_is_allowed_without_business_ipc_authority() {
    // Given: a probed business origin with a separate safe SSO portal.
    let business = production_origin("https://ai.example.com");
    let portal = url::Url::parse("https://auth.example.com/portal").unwrap();
    let workspace = url::Url::parse("https://workspace.example.com").unwrap();
    let saved = ServerConfig::new(business.clone(), None);
    let mut trust = ServerTrustState::new(Some(saved));
    trust.record_probe_success_with_portal(business.clone(), portal, workspace.clone());
    let policy = trust.navigation_policy(&business).unwrap();
    let portal_page = url::Url::parse("https://auth.example.com/portal/callback").unwrap();
    let workspace_page = url::Url::parse("https://workspace.example.com/tasks").unwrap();
    let hostile_portal = url::Url::parse("https://auth.example.com.evil.test/portal").unwrap();
    let portal_caller = CallerContext::new("workspace", portal_page.as_str()).unwrap();

    // When / Then: navigation can complete SSO and land on the web workspace,
    // but the SSO portal itself never receives business IPC authority.
    assert!(policy.allows(&portal_page));
    assert!(policy.allows(&workspace_page));
    assert!(policy.is_business(&workspace_page));
    assert!(!policy.allows(&hostile_portal));
    assert_eq!(
        authorize(&portal_caller, CommandScope::Business, Some(&business)),
        Err(CommandOriginError::Unauthorized)
    );
}

#[test]
fn business_ipc_uses_workspace_web_origin_not_api_origin() {
    // Given: a trusted API origin with a separate browser workspace origin.
    let api = production_origin("https://api.example.com");
    let workspace = production_origin("https://workspace.example.com");
    let workspace_caller =
        CallerContext::new("workspace", "https://workspace.example.com/tasks").unwrap();
    let api_caller = CallerContext::new("workspace", "https://api.example.com/tasks").unwrap();

    // When / Then: native IPC belongs to the loaded workspace web app, not the API origin.
    assert_eq!(
        authorize(&workspace_caller, CommandScope::Business, Some(&workspace)),
        Ok(())
    );
    assert_eq!(
        authorize(&api_caller, CommandScope::Business, Some(&workspace)),
        Err(CommandOriginError::Unauthorized)
    );
    assert_eq!(
        authorize(&workspace_caller, CommandScope::Business, Some(&api)),
        Err(CommandOriginError::Unauthorized)
    );
}

#[test]
fn workspace_open_requires_same_saved_and_probed_origin() {
    // Given: one saved server and a successful probe for a different server.
    let saved_origin = production_origin("https://saved.example.com");
    let probed_origin = production_origin("https://probed.example.com");
    let saved = ServerConfig::new(saved_origin.clone(), None);
    let mut trust = ServerTrustState::new(Some(saved));
    trust.record_probe_success(probed_origin.clone());

    // When / Then: neither origin opens until saved and probed refer to the same origin.
    assert!(trust.authorize_workspace_open(&saved_origin).is_err());
    assert!(trust.authorize_workspace_open(&probed_origin).is_err());
    trust.record_probe_success(saved_origin.clone());
    assert!(trust.authorize_workspace_open(&saved_origin).is_ok());
    assert!(trust
        .authorize_workspace_open(&production_origin("https://unknown.example.com"))
        .is_err());
    assert!(trust
        .authorize_workspace_open(&production_origin("https://probed.example.com.evil.test"))
        .is_err());
}

#[test]
fn save_requires_probe_for_the_exact_origin() {
    // Given: no successful probe, followed by a probe for server A.
    let origin_a = production_origin("https://a.example.com");
    let origin_b = production_origin("https://b.example.com");
    let mut trust = ServerTrustState::new(None);

    // When / Then: save is denied before probing and for a different server.
    assert!(trust.config_after_successful_probe(&origin_a).is_err());
    trust.record_probe_success(origin_a.clone());
    assert!(trust.config_after_successful_probe(&origin_b).is_err());

    // When: the exact probed origin is converted to a persisted configuration.
    let config = trust.config_after_successful_probe(&origin_a).unwrap();
    assert!(!trust.record_saved(config));

    // Then: the saved and probed origin is eligible to open.
    assert!(trust.authorize_workspace_open(&origin_a).is_ok());

    // When: a different successfully probed server replaces it.
    trust.record_probe_success(origin_b.clone());
    let replacement = trust.config_after_successful_probe(&origin_b).unwrap();

    // Then: the caller is told this is a trust-boundary switch.
    assert!(trust.record_saved(replacement));
}

#[test]
fn starting_a_new_probe_revokes_the_previous_save_authorization() {
    let origin = production_origin("https://a.example.com");
    let mut trust = ServerTrustState::new(None);
    trust.record_probe_success(origin.clone());
    assert!(trust.config_after_successful_probe(&origin).is_ok());

    trust.begin_probe();

    assert!(trust.config_after_successful_probe(&origin).is_err());
}

#[test]
fn stale_probe_completion_cannot_replace_the_latest_result() {
    // Given: probe A starts before probe B.
    let origin_a = production_origin("https://a.example.com");
    let origin_b = production_origin("https://b.example.com");
    let portal_a = url::Url::parse("https://auth-a.example.com/portal").unwrap();
    let portal_b = url::Url::parse("https://auth-b.example.com/portal").unwrap();
    let workspace_a = url::Url::parse("https://workspace-a.example.com").unwrap();
    let workspace_b = url::Url::parse("https://workspace-b.example.com").unwrap();
    let mut trust = ServerTrustState::new(None);
    let probe_a = trust.begin_probe();
    let probe_b = trust.begin_probe();

    // When: B completes first and A completes late.
    assert!(trust.record_probe_success_if_current(
        probe_b,
        origin_b.clone(),
        portal_b,
        workspace_b
    ));
    assert!(!trust.record_probe_success_if_current(probe_a, origin_a, portal_a, workspace_a));

    // Then: only the latest origin can be saved.
    assert!(trust.config_after_successful_probe(&origin_b).is_ok());
}

#[test]
fn stale_workspace_timeout_cannot_match_a_rebuilt_window() {
    // Given: workspace A is closed and workspace B is opened at the same origin.
    let origin = production_origin("https://a.example.com");
    let mut trust = ServerTrustState::new(None);
    let generation_a = trust.activate_workspace(origin.clone(), origin.clone());
    trust.deactivate_workspace();
    let generation_b = trust.activate_workspace(origin.clone(), origin);

    // When / Then: only B's generation remains current.
    assert!(!trust.is_workspace_generation_current(generation_a));
    assert!(trust.is_workspace_generation_current(generation_b));
}

#[test]
fn stale_workspace_lease_cannot_authorize_a_late_binding_response() {
    // Given: token verification started in workspace A.
    let origin = production_origin("https://a.example.com");
    let mut trust = ServerTrustState::new(None);
    trust.activate_workspace(origin.clone(), origin.clone());
    let lease = trust.active_workspace_lease().unwrap();

    // When: the workspace is revoked and rebuilt at the same Origin.
    trust.deactivate_workspace();
    trust.activate_workspace(origin.clone(), origin);

    // Then: the old async verification lease is no longer current.
    assert!(!trust.is_workspace_lease_current(&lease));
}

#[test]
fn binding_captures_and_guards_its_workspace_lease_in_one_step() {
    // Given: the native binding command and window trust implementation.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let commands = fs::read_to_string(root.join("src/local_commands.rs")).unwrap();
    let manager = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();
    let bind_start = commands.find("pub async fn local_session_bind(").unwrap();
    let bind_end = commands[bind_start..]
        .find("pub fn local_draft_save(")
        .map(|offset| bind_start + offset)
        .unwrap();
    let bind = &commands[bind_start..bind_end];

    // When / Then: token verification receives a lease captured while its caller
    // window is checked under the same trust lock, never two independent reads.
    assert!(manager.contains("pub fn workspace_lease_for_window("));
    assert!(bind.contains("workspace_lease_for_window(&window)?"));
    assert!(!bind.contains("guard_business(&window"));
    assert!(!bind.contains("active_workspace_lease()?"));
}

#[test]
fn closing_workspace_revokes_the_active_business_origin() {
    let origin = production_origin("https://a.example.com");
    let mut trust = ServerTrustState::new(None);
    trust.activate_workspace(origin.clone(), origin.clone());
    assert_eq!(trust.active_workspace(), Some(&origin));

    trust.deactivate_workspace();

    assert_eq!(trust.active_workspace(), None);
}

#[test]
fn launcher_window_configuration_is_local_and_fixed() {
    // Given: the checked-in Tauri configuration.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let config: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join("tauri.conf.json")).unwrap()).unwrap();

    // When: the default window contract is inspected.
    let windows = config["app"]["windows"].as_array().unwrap();

    // Then: only the local launcher is created at startup.
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0]["label"], "launcher");
    assert_eq!(windows[0]["title"], "聚信 AI 助手");
    assert_eq!(windows[0]["url"], "index.html");
    assert_eq!(windows[0]["width"], 1120);
    assert_eq!(windows[0]["height"], 720);
    assert_eq!(windows[0]["minWidth"], 900);
    assert_eq!(windows[0]["minHeight"], 640);
}

#[test]
fn capabilities_separate_launcher_and_workspace_commands() {
    // Given: both checked-in capability documents.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let launcher_text = fs::read_to_string(root.join("capabilities/launcher.json")).unwrap();
    let workspace_text = fs::read_to_string(root.join("capabilities/workspace.json")).unwrap();
    let launcher: serde_json::Value = serde_json::from_str(&launcher_text).unwrap();
    let workspace: serde_json::Value = serde_json::from_str(&workspace_text).unwrap();
    let launcher_permissions = launcher["permissions"].as_array().unwrap();
    let workspace_permissions = workspace["permissions"].as_array().unwrap();

    // When / Then: launcher owns configuration/window commands only.
    for command in [
        "allow-server-config-get",
        "allow-server-probe",
        "allow-server-config-save",
        "allow-workspace-open",
        "allow-launcher-show",
    ] {
        assert!(
            launcher_permissions.iter().any(|value| value == command),
            "{command}"
        );
        assert!(
            !workspace_permissions.iter().any(|value| value == command),
            "{command}"
        );
    }
    assert!(workspace_permissions
        .iter()
        .any(|value| value == "allow-workspace-close"));
    assert!(workspace_permissions
        .iter()
        .any(|value| value == "allow-workspace-ready"));
    assert!(workspace_permissions
        .iter()
        .any(|value| value == "allow-workspace-status"));
    for command in ["allow-local-legacy-export", "allow-local-legacy-delete"] {
        assert!(
            workspace_permissions.iter().any(|value| value == command),
            "{command}"
        );
        assert!(
            !launcher_permissions.iter().any(|value| value == command),
            "{command}"
        );
    }
    assert!(!launcher_permissions
        .iter()
        .any(|value| value == "allow-model-generate"));
    assert!(workspace_permissions
        .iter()
        .any(|value| value == "allow-model-generate"));
    for command in [
        "allow-update-status",
        "allow-update-check",
        "allow-update-download-and-install",
        "allow-update-cancel",
        "allow-update-defer",
    ] {
        assert!(
            launcher_permissions.iter().any(|value| value == command),
            "{command}"
        );
        assert!(
            workspace_permissions.iter().any(|value| value == command),
            "{command}"
        );
    }
    for forbidden in ["shell:", "fs:", "http:", "updater:"] {
        assert!(
            launcher_permissions
                .iter()
                .all(|value| !value.as_str().unwrap().starts_with(forbidden)),
            "{forbidden}"
        );
        assert!(
            workspace_permissions
                .iter()
                .all(|value| !value.as_str().unwrap().starts_with(forbidden)),
            "{forbidden}"
        );
    }
    assert_eq!(
        workspace["remote"]["urls"],
        serde_json::json!([
            "https://*:*/*",
            "http://localhost:*/*",
            "http://127.0.0.1:*/*"
        ])
    );
    assert_eq!(
        launcher["permissions"],
        serde_json::json!([
            "core:app:allow-version",
            "core:event:allow-listen",
            "core:event:allow-unlisten",
            "allow-server-config-get",
            "allow-server-probe",
            "allow-server-config-save",
            "allow-workspace-open",
            "allow-launcher-show",
            "allow-update-status",
            "allow-update-check",
            "allow-update-download-and-install",
            "allow-update-cancel",
            "allow-update-defer"
        ])
    );
    assert!(workspace_permissions
        .iter()
        .any(|value| value == "core:event:allow-listen"));
    assert!(workspace_permissions
        .iter()
        .any(|value| value == "core:event:allow-unlisten"));
    assert!(workspace_permissions
        .iter()
        .all(|value| value != "core:default"));
}

#[test]
fn lifecycle_commands_are_registered() {
    // Given: the native invoke handler source.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let source = fs::read_to_string(root.join("src/lib.rs")).unwrap();

    // When / Then: every launcher/workspace lifecycle command is registered.
    for command in [
        "server_config_get",
        "server_probe",
        "server_config_save",
        "workspace_open",
        "workspace_ready",
        "workspace_status",
        "workspace_close",
        "launcher_show",
    ] {
        assert!(source.contains(command), "{command}");
    }
}

#[test]
fn changing_server_clears_session_cookies_and_the_old_workspace() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manager = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();

    assert!(manager.contains("app_state.local_user.clear()"));
    assert!(manager.contains("clear_drafts_for_origin("));
    assert!(manager.contains("clear_window_cookies(&window)"));
    assert!(manager.contains("clear_window_cookies(&workspace)"));
    assert!(manager.contains("workspace.close()"));
}

#[test]
fn changing_server_revokes_business_ipc_before_fallible_cleanup() {
    // Given: the native address-switch implementation.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manager = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();
    let switch_start = manager.find("if switching {").unwrap();
    let switch_end = manager[switch_start..]
        .find("save_server_config")
        .map(|offset| switch_start + offset)
        .unwrap();
    let switch_block = &manager[switch_start..switch_end];

    // When / Then: command authority is revoked before cookie/window cleanup can fail.
    let revoke = switch_block.find("workspace_closed(&state)").unwrap();
    let clear_launcher = switch_block.find("clear_window_cookies(&window)").unwrap();
    assert!(revoke < clear_launcher);
    assert!(switch_block.contains("merge_cleanup_result("));
}

#[test]
fn rejected_workspace_navigation_closes_the_remote_window() {
    // Given: the workspace navigation callback.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manager = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();

    // When / Then: leaving the trusted origins revokes authority and destroys the window.
    assert!(manager.contains("recover_workspace("));
    assert!(manager.contains("Some(\"connection\")"));
}

#[test]
fn workspace_requires_a_business_ready_handshake_and_timeout_fallback() {
    // Given: the native workspace lifecycle implementation.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manager = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();

    // When / Then: business content is shown only after its command handshake,
    // while a stalled page schedules a launcher recovery.
    assert!(manager.contains("pub fn workspace_ready("));
    assert!(manager.contains("app_state.local_user.require_bound()?"));
    assert!(manager.contains("pub fn workspace_status("));
    assert!(manager.contains("WorkspaceStatus::Forbidden"));
    assert!(manager.contains("WorkspaceStatus::NetworkError"));
    assert!(manager.contains("schedule_workspace_ready_timeout("));
    assert!(manager.contains("WORKSPACE_READY_TIMEOUT"));
    assert!(manager.contains("emit_workspace_recovery("));
    assert!(manager.contains("navigation_for_load.allows(payload.url())"));
    assert!(manager.contains("navigation_policy.is_auth_portal(&current)"));
    assert!(manager.contains("reveal_workspace("));
}

#[test]
fn workspace_stays_hidden_until_an_allowed_page_finishes_loading() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let source = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();

    assert!(source.contains(".visible(false)"));
    assert!(source.contains(".on_page_load("));
    assert!(source.contains("PageLoadEvent::Finished"));
}

#[test]
fn workspace_initially_loads_the_auth_portal_not_the_business_root() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let source = fs::read_to_string(root.join("src/window_manager.rs")).unwrap();

    assert!(source.contains("WebviewUrl::External(navigation_policy.auth_portal_url().clone())"));
    assert!(!source.contains("WebviewUrl::External(workspace_url)"));
}

#[test]
fn model_command_session_gate_requires_a_verified_binding() {
    // Given: a local session before and after verified SSO binding.
    let session = LocalUserSession::default();

    // When / Then: model access is unavailable until a verified user is bound.
    assert_eq!(
        session.require_bound(),
        Err("LOCAL_USER_SESSION_REQUIRED".to_string())
    );
    session.bind_verified("user-1", |_| Ok(())).unwrap();
    assert_eq!(session.require_bound(), Ok(()));
    session.clear().unwrap();
    assert_eq!(
        session.require_bound(),
        Err("LOCAL_USER_SESSION_REQUIRED".to_string())
    );
}
