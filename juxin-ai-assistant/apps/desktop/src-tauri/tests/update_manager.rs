use juxin_ai_assistant_lib::update_state::{
    CheckMode, UpdateDeferral, UpdateFailureStage, UpdateInfo, UpdateMachine, UpdatePhase,
};

fn update(version: &str) -> UpdateInfo {
    UpdateInfo::new(version, "优化启动速度", Some(18_600_000))
}

#[test]
fn deferral_suppresses_only_automatic_prompt_for_twenty_four_hours() {
    // Given: version 5.89.1 was deferred now.
    let now = 1_782_086_400;
    let deferred = UpdateDeferral::new("5.89.1", now);
    let mut machine = UpdateMachine::new(true, Some(deferred));

    // When: an automatic check finds the same release within 24 hours.
    let automatic = machine.begin_check().unwrap();
    machine.finish_check(
        automatic,
        Some(update("5.89.1")),
        CheckMode::Automatic,
        now + 60,
    );

    // Then: no dialog is presented, while a manual check ignores the deferral.
    assert_eq!(machine.phase(), &UpdatePhase::Idle { enabled: true });
    let manual = machine.begin_check().unwrap();
    machine.finish_check(manual, Some(update("5.89.1")), CheckMode::Manual, now + 120);
    assert!(matches!(machine.phase(), UpdatePhase::Available { .. }));
}

#[test]
fn download_can_be_cancelled_but_install_cannot() {
    // Given: a checked release is ready to download.
    let mut machine = UpdateMachine::new(true, None);
    let check = machine.begin_check().unwrap();
    machine.finish_check(check, Some(update("5.89.1")), CheckMode::Manual, 0);

    // When: download starts and receives one chunk.
    let download = machine.begin_download().unwrap();
    machine.record_download(download, 4_000, Some(10_000));

    // Then: explicit cancellation restores the available release.
    assert!(machine.cancel_download());
    assert!(matches!(machine.phase(), UpdatePhase::Available { .. }));

    // When / Then: installation is a non-cancellable phase.
    let retry = machine.begin_download().unwrap();
    machine.begin_install(retry);
    assert!(!machine.cancel_download());
    assert!(matches!(machine.phase(), UpdatePhase::Installing { .. }));
}

#[test]
fn stale_download_progress_cannot_replace_a_newer_operation() {
    // Given: an old download was cancelled and a retry started.
    let mut machine = UpdateMachine::new(true, None);
    let check = machine.begin_check().unwrap();
    machine.finish_check(check, Some(update("5.89.1")), CheckMode::Manual, 0);
    let old = machine.begin_download().unwrap();
    assert!(machine.cancel_download());
    let current = machine.begin_download().unwrap();

    // When: a late chunk from the cancelled request arrives.
    machine.record_download(old, 9_000, Some(10_000));
    machine.record_download(current, 1_000, Some(10_000));

    // Then: only the current operation contributes progress.
    assert_eq!(
        machine.phase(),
        &UpdatePhase::Downloading {
            update: update("5.89.1"),
            received: 1_000,
            total: Some(10_000),
        }
    );
}

#[test]
fn stale_download_failure_cannot_replace_a_retry() {
    // Given: a cancelled download has already been retried.
    let mut machine = UpdateMachine::new(true, None);
    let check = machine.begin_check().unwrap();
    machine.finish_check(check, Some(update("5.89.1")), CheckMode::Manual, 0);
    let old = machine.begin_download().unwrap();
    assert!(machine.cancel_download());
    let current = machine.begin_download().unwrap();

    // When: the old operation reports failure after the retry starts.
    machine.fail(old, UpdateFailureStage::Download, "late failure");
    machine.record_download(current, 1_000, Some(10_000));

    // Then: the retry remains active and cancellable.
    assert!(matches!(
        machine.phase(),
        UpdatePhase::Downloading {
            received: 1_000,
            ..
        }
    ));
    assert!(machine.cancel_download());
}

#[test]
fn failed_check_keeps_the_launcher_usable() {
    // Given: an enabled updater is checking in the background.
    let mut machine = UpdateMachine::new(true, None);
    let check = machine.begin_check().unwrap();

    // When: the update service is unavailable.
    machine.fail(check, UpdateFailureStage::Check, "暂时无法检查更新");

    // Then: the failure is explicit and contains no fake release metadata.
    assert_eq!(
        machine.phase(),
        &UpdatePhase::Failed {
            stage: UpdateFailureStage::Check,
            update: None,
            message: "暂时无法检查更新".to_string(),
        }
    );
}

#[test]
fn duplicate_check_is_rejected_while_one_is_in_flight() {
    // Given: one update check already owns the current operation.
    let mut machine = UpdateMachine::new(true, None);
    let _operation = machine.begin_check().unwrap();

    // When / Then: a second check cannot replace its generation.
    assert_eq!(machine.begin_check(), Err("UPDATE_BUSY".to_string()));
    assert_eq!(machine.phase(), &UpdatePhase::Checking);
}

#[test]
fn deferral_is_scoped_to_the_current_process() {
    // Given: one running process defers version 5.89.1.
    let now = 1_782_086_400;
    let mut first_process = UpdateMachine::new(true, None);
    let check = first_process.begin_check().unwrap();
    first_process.finish_check(check, Some(update("5.89.1")), CheckMode::Manual, now);
    first_process.defer(now).unwrap();

    // When: a fresh process starts without runtime state and checks automatically.
    let mut restarted_process = UpdateMachine::new(true, None);
    let restarted_check = restarted_process.begin_check().unwrap();
    restarted_process.finish_check(
        restarted_check,
        Some(update("5.89.1")),
        CheckMode::Automatic,
        now + 60,
    );

    // Then: the previous process deferral does not suppress the new process prompt.
    assert!(matches!(
        restarted_process.phase(),
        UpdatePhase::Available { .. }
    ));
}

#[test]
fn download_cancellation_is_registered_before_the_status_is_broadcast() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let manager = std::fs::read_to_string(root.join("src/update_manager.rs")).unwrap();
    let commands = std::fs::read_to_string(root.join("src/update_commands.rs")).unwrap();

    assert!(manager.contains("begin_download_with_cancel"));
    assert!(manager.contains("runtime.cancel = Some((operation, cancel));"));
    assert!(!commands.contains("attach_cancel"));
}

#[test]
fn trusted_windows_expose_only_guarded_custom_update_commands() {
    // Given: generated command registration and both trusted window capabilities.
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let library = std::fs::read_to_string(root.join("src/lib.rs")).unwrap();
    let commands = std::fs::read_to_string(root.join("src/update_commands.rs")).unwrap();
    let launcher = std::fs::read_to_string(root.join("capabilities/launcher.json")).unwrap();
    let workspace = std::fs::read_to_string(root.join("capabilities/workspace.json")).unwrap();

    // When / Then: five policy-enforcing commands are available without raw updater access.
    for command in [
        "update_status",
        "update_check",
        "update_download_and_install",
        "update_cancel",
        "update_defer",
    ] {
        assert!(library.contains(command), "{command}");
        let permission = format!("allow-{}", command.replace('_', "-"));
        assert!(launcher.contains(&permission), "{permission}");
        assert!(workspace.contains(&permission), "{permission}");
    }
    assert!(commands.contains("guard_business(window, state)"));
    assert!(commands.contains("emit_to(\"workspace\""));
    assert!(!launcher.contains("updater:"));
    assert!(!workspace.contains("updater:"));
}
