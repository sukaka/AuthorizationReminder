use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Runtime};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CloseAction {
    Hide,
    Exit,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct TrayPreference {
    pub minimize_to_tray: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RestoreAction {
    pub center: bool,
    pub focus: bool,
    pub show: bool,
    pub unminimize: bool,
}

pub struct LifecycleState {
    preference: TrayPreference,
    quitting: AtomicBool,
    first_restore: AtomicBool,
}

impl LifecycleState {
    pub const fn new(preference: TrayPreference) -> Self {
        Self {
            preference,
            quitting: AtomicBool::new(false),
            first_restore: AtomicBool::new(true),
        }
    }

    pub fn begin_quit(&self) {
        self.quitting.store(true, Ordering::Release);
    }

    pub fn close_action(&self) -> CloseAction {
        if self.quitting.load(Ordering::Acquire) || !self.preference.minimize_to_tray {
            return CloseAction::Exit;
        }
        CloseAction::Hide
    }

    pub fn restore_action(&self) -> RestoreAction {
        RestoreAction {
            center: self.first_restore.swap(false, Ordering::AcqRel),
            focus: true,
            show: true,
            unminimize: true,
        }
    }
}

pub fn restore_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let action = app.state::<LifecycleState>().restore_action();
    if action.unminimize {
        let _ = window.unminimize();
    }
    if action.center {
        let _ = window.center();
    }
    if action.show {
        let _ = window.show();
    }
    if action.focus {
        let _ = window.set_focus();
    }
}

pub fn install_tray<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "打开聚信 AI 助手", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, "tray-hide", "隐藏窗口", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "tray-quit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &hide, &separator, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| tauri::Error::AssetNotFound("default window icon".to_string()))?;
    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "tray-open" => restore_main(app),
            "tray-hide" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }
            "tray-quit" => {
                app.state::<LifecycleState>().begin_quit();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                }
            ) {
                restore_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}
