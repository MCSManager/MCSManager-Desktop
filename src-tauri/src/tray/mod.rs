//! System tray: icon, menu, and native confirmation dialogs.
//!
//! The tray lives entirely on the Rust side so every action keeps working
//! while the main window is hidden.

pub mod strings;

use std::sync::Arc;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::commands::{self, AppState};
use crate::config::Language;
use crate::process::events::ServiceStatus;
use strings::{confirm_texts, error_title, menu_labels, status_line, text, ConfirmAction};

pub const TRAY_ID: &str = "main-tray";

const MENU_TITLE: &str = "title";
const MENU_STATUS_DAEMON: &str = "status-daemon";
const MENU_STATUS_PANEL: &str = "status-panel";
const MENU_OPEN_PANEL: &str = "open-panel";
const MENU_SHOW_WINDOW: &str = "show-window";
const MENU_START_ALL: &str = "start-all";
const MENU_STOP_ALL: &str = "stop-all";
const MENU_EXIT: &str = "exit";

/// The tray menu items whose labels change with service state or language.
pub struct TrayMenu {
    title: MenuItem<Wry>,
    daemon_status: MenuItem<Wry>,
    panel_status: MenuItem<Wry>,
    open_panel: MenuItem<Wry>,
    show_window: MenuItem<Wry>,
    start_all: MenuItem<Wry>,
    stop_all: MenuItem<Wry>,
    exit: MenuItem<Wry>,
}

/// Builds the tray icon and its menu and stores the items for later refreshes.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let language = language_of(app);
    let labels = menu_labels(language);

    let title = MenuItem::with_id(app, MENU_TITLE, text(language, "app.title"), false, None::<&str>)?;
    let daemon_status = MenuItem::with_id(app, MENU_STATUS_DAEMON, "", false, None::<&str>)?;
    let panel_status = MenuItem::with_id(app, MENU_STATUS_PANEL, "", false, None::<&str>)?;
    let open_panel =
        MenuItem::with_id(app, MENU_OPEN_PANEL, &labels.open_panel, true, None::<&str>)?;
    let show_window =
        MenuItem::with_id(app, MENU_SHOW_WINDOW, &labels.show_window, true, None::<&str>)?;
    let start_all = MenuItem::with_id(app, MENU_START_ALL, &labels.start_all, true, None::<&str>)?;
    let stop_all = MenuItem::with_id(app, MENU_STOP_ALL, &labels.stop_all, true, None::<&str>)?;
    let exit = MenuItem::with_id(app, MENU_EXIT, &labels.exit, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[
            &title,
            &daemon_status,
            &panel_status,
            &separator,
            &open_panel,
            &show_window,
            &separator,
            &start_all,
            &stop_all,
            &separator,
            &exit,
        ],
    )?;

    // Left click restores the main window instead of popping the menu.
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip(text(language, "app.title"))
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event);
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;

    app.manage(TrayMenu {
        title,
        daemon_status,
        panel_status,
        open_panel,
        show_window,
        start_all,
        stop_all,
        exit,
    });
    refresh_status_rows(app);
    Ok(())
}

/// Rewrites every static label and status row, e.g. after a language change.
pub fn refresh_texts(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let language = language_of(app);
    let labels = menu_labels(language);
    let _ = menu.title.set_text(text(language, "app.title"));
    let _ = menu.open_panel.set_text(&labels.open_panel);
    let _ = menu.show_window.set_text(&labels.show_window);
    let _ = menu.start_all.set_text(&labels.start_all);
    let _ = menu.stop_all.set_text(&labels.stop_all);
    let _ = menu.exit.set_text(&labels.exit);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(text(language, "app.title")));
    }
    refresh_status_rows(app);
}

/// Rewrites one status row from a live service status event.
pub fn update_status(app: &AppHandle, status: &ServiceStatus) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let item = match status.id.as_str() {
        "daemon" => &menu.daemon_status,
        "panel" => &menu.panel_status,
        _ => return,
    };
    let _ = item.set_text(status_line(
        language_of(app),
        &status.id,
        Some(status.state),
    ));
}

fn refresh_status_rows(app: &AppHandle) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    let language = language_of(app);
    let statuses = commands::read_manager(&app.state::<AppState>().manager).statuses();
    for (id, item) in [("daemon", &menu.daemon_status), ("panel", &menu.panel_status)] {
        let state = statuses.iter().find(|status| status.id == id).map(|s| s.state);
        let _ = item.set_text(status_line(language, id, state));
    }
}

fn language_of(app: &AppHandle) -> Language {
    app.state::<AppState>()
        .config
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .language
}

fn handle_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id.0.as_str() {
        MENU_OPEN_PANEL => open_panel_in_browser(app),
        MENU_SHOW_WINDOW => show_main_window(app),
        MENU_START_ALL => confirm_then(app, ConfirmAction::StartAll, start_all_confirmed),
        MENU_STOP_ALL => confirm_then(app, ConfirmAction::StopAll, stop_all_confirmed),
        MENU_EXIT => confirm_then(app, ConfirmAction::Exit, exit_confirmed),
        _ => {}
    }
}

fn handle_tray_event(tray: &TrayIcon<Wry>, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        show_main_window(tray.app_handle());
    }
}

/// Runs `then` only after the user confirms the native dialog.
fn confirm_then(app: &AppHandle, action: ConfirmAction, then: fn(AppHandle)) {
    let texts = confirm_texts(language_of(app), action);
    let kind = if action == ConfirmAction::StartAll {
        MessageDialogKind::Info
    } else {
        MessageDialogKind::Warning
    };
    let handle = app.clone();
    app.dialog()
        .message(texts.message)
        .title(texts.title)
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancelCustom(
            texts.confirm,
            texts.cancel,
        ))
        .show(move |confirmed| {
            if confirmed {
                then(handle);
            }
        });
}

fn show_error(app: &AppHandle, message: &str) {
    let language = language_of(app);
    app.dialog()
        .message(message.to_string())
        .title(error_title(language))
        .kind(MessageDialogKind::Error)
        .buttons(MessageDialogButtons::OkCustom(text(
            language, "action.ok",
        )))
        .show(|_| {});
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(crate::WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_panel_in_browser(app: &AppHandle) {
    let url = {
        let state = app.state::<AppState>();
        let config = state
            .config
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        config.panel_url.clone()
    };
    if let Err(error) = app.opener().open_url(url, None::<String>) {
        show_error(app, &error.to_string());
    }
}

fn start_all_confirmed(app: AppHandle) {
    let manager = Arc::clone(&app.state::<AppState>().manager);
    let config = Arc::clone(&app.state::<AppState>().config);
    std::thread::spawn(move || {
        if let Err(error) = commands::start_all_sync(&manager, &config) {
            show_error(&app, &error);
        }
    });
}

fn stop_all_confirmed(app: AppHandle) {
    let manager = Arc::clone(&app.state::<AppState>().manager);
    std::thread::spawn(move || {
        if let Err(error) = commands::stop_all_sync(&manager) {
            show_error(&app, &error);
        }
    });
}

fn exit_confirmed(app: AppHandle) {
    let manager = Arc::clone(&app.state::<AppState>().manager);
    std::thread::spawn(move || {
        // Exit is final even if a service refuses to stop cleanly.
        let _ = commands::stop_all_sync(&manager);
        app.exit(0);
    });
}
