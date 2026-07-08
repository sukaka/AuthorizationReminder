use juxin_ai_assistant_lib::tray::{CloseAction, LifecycleState, TrayPreference};

#[test]
fn close_hides_when_tray_mode_is_enabled() {
    // Given: the user enabled minimize-to-tray and no explicit quit is active.
    let state = LifecycleState::new(TrayPreference {
        minimize_to_tray: true,
    });

    // When / Then: closing hides the window without exiting the process.
    assert_eq!(state.close_action(), CloseAction::Hide);
}

#[test]
fn close_exits_when_tray_mode_is_disabled() {
    // Given: minimize-to-tray is disabled.
    let state = LifecycleState::new(TrayPreference {
        minimize_to_tray: false,
    });

    // When / Then: the native close action exits.
    assert_eq!(state.close_action(), CloseAction::Exit);
}

#[test]
fn explicit_quit_always_exits() {
    // Given: minimize-to-tray is enabled.
    let state = LifecycleState::new(TrayPreference {
        minimize_to_tray: true,
    });

    // When: an explicit tray quit begins.
    state.begin_quit();

    // Then: subsequent close handling exits rather than hiding.
    assert_eq!(state.close_action(), CloseAction::Exit);
}

#[test]
fn restore_centers_only_on_first_launch() {
    // Given: a newly started lifecycle.
    let state = LifecycleState::new(TrayPreference {
        minimize_to_tray: true,
    });

    // When / Then: only the first restore requests centering.
    assert!(state.restore_action().center);
    assert!(!state.restore_action().center);
}
