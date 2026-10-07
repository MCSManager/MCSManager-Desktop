//! Tray copy lookups backed by the shared i18n locale files.
//!
//! Chinese literals are forbidden in code (see `src/test/noChinese.test.ts`),
//! so every user-visible string is resolved from `src/i18n/locales/*.json`.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::config::Language;
use crate::process::events::ServiceState;

const EN_JSON: &str = include_str!("../../../src/i18n/locales/en.json");
const ZH_JSON: &str = include_str!("../../../src/i18n/locales/zh.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfirmAction {
    StartAll,
    StopAll,
    Exit,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuLabels {
    pub open_panel: String,
    pub show_window: String,
    pub start_all: String,
    pub stop_all: String,
    pub exit: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfirmTexts {
    pub title: String,
    pub message: String,
    pub confirm: String,
    pub cancel: String,
}

fn catalog(language: Language) -> &'static HashMap<String, String> {
    static EN: OnceLock<HashMap<String, String>> = OnceLock::new();
    static ZH: OnceLock<HashMap<String, String>> = OnceLock::new();
    let (slot, json) = match language {
        Language::En => (&EN, EN_JSON),
        Language::Zh => (&ZH, ZH_JSON),
    };
    slot.get_or_init(|| serde_json::from_str(json).expect("locale file must be a flat string map"))
}

fn state_key(state: ServiceState) -> &'static str {
    match state {
        ServiceState::Stopped => "state.stopped",
        ServiceState::Starting => "state.starting",
        ServiceState::Running => "state.running",
        ServiceState::Stopping => "state.stopping",
        ServiceState::Error => "state.error",
    }
}

fn confirm_message_key(action: ConfirmAction) -> &'static str {
    match action {
        ConfirmAction::StartAll => "tray.confirm.startAll",
        ConfirmAction::StopAll => "tray.confirm.stopAll",
        ConfirmAction::Exit => "tray.confirm.exit",
    }
}

/// Resolves one locale key for `language`, falling back to English and then to
/// the key itself so a missing copy entry degrades visibly instead of panicking.
pub fn text(language: Language, key: &str) -> String {
    catalog(language)
        .get(key)
        .or_else(|| catalog(Language::En).get(key))
        .cloned()
        .unwrap_or_else(|| key.to_string())
}

/// Builds the tray status row, e.g. "Daemon: Running" or "Daemon: Disabled"
/// when the service is not registered.
pub fn status_line(language: Language, service_id: &str, state: Option<ServiceState>) -> String {
    let service = text(language, &format!("service.{}.name", service_id));
    let state_label = match state {
        Some(state) => text(language, state_key(state)),
        None => text(language, "status.disabled"),
    };
    text(language, "tray.statusLine")
        .replace("{service}", &service)
        .replace("{state}", &state_label)
}

pub fn menu_labels(language: Language) -> MenuLabels {
    MenuLabels {
        open_panel: text(language, "tray.openPanel"),
        show_window: text(language, "tray.showWindow"),
        start_all: text(language, "action.startAll"),
        stop_all: text(language, "action.stopAll"),
        exit: text(language, "tray.exit"),
    }
}

pub fn confirm_texts(language: Language, action: ConfirmAction) -> ConfirmTexts {
    ConfirmTexts {
        title: text(language, "tray.confirm.title"),
        message: text(language, confirm_message_key(action)),
        confirm: text(language, "action.ok"),
        cancel: text(language, "tray.confirm.cancel"),
    }
}

pub fn error_title(language: Language) -> String {
    text(language, "tray.error.title")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn contains_han(value: &str) -> bool {
        value.chars().any(|ch| ('\u{4E00}'..='\u{9FFF}').contains(&ch))
    }

    #[test]
    fn menu_labels_map_to_their_english_copy() {
        let labels = menu_labels(Language::En);
        assert_eq!(labels.open_panel, "Open panel in browser");
        assert_eq!(labels.show_window, "Show main window");
        assert_eq!(labels.start_all, "Start All");
        assert_eq!(labels.stop_all, "Stop All");
        assert_eq!(labels.exit, "Exit");
    }

    #[test]
    fn menu_labels_are_localized_in_chinese() {
        let english = menu_labels(Language::En);
        let chinese = menu_labels(Language::Zh);
        for (en, zh) in [
            (&english.open_panel, &chinese.open_panel),
            (&english.show_window, &chinese.show_window),
            (&english.start_all, &chinese.start_all),
            (&english.stop_all, &chinese.stop_all),
            (&english.exit, &chinese.exit),
        ] {
            assert_ne!(en, zh, "Chinese copy must differ from English");
            assert!(contains_han(zh), "Chinese copy must contain Han characters: {zh}");
            assert!(!contains_han(en), "English copy must not contain Han characters");
        }
    }

    #[test]
    fn status_line_composes_service_and_state() {
        assert_eq!(
            status_line(Language::En, "daemon", Some(ServiceState::Running)),
            "Daemon: Running"
        );
        assert_eq!(
            status_line(Language::En, "panel", Some(ServiceState::Stopped)),
            "Panel: Stopped"
        );
    }

    #[test]
    fn status_line_marks_missing_service_as_disabled() {
        assert_eq!(
            status_line(Language::En, "daemon", None),
            "Daemon: Disabled"
        );
    }

    #[test]
    fn status_line_states_are_distinct() {
        let lines = [
            ServiceState::Stopped,
            ServiceState::Starting,
            ServiceState::Running,
            ServiceState::Stopping,
            ServiceState::Error,
        ]
        .map(|state| status_line(Language::En, "daemon", Some(state)));
        for (index, line) in lines.iter().enumerate() {
            for other in &lines[index + 1..] {
                assert_ne!(line, other, "every state must produce a distinct status line");
            }
        }
    }

    #[test]
    fn status_line_is_localized_in_chinese() {
        let english = status_line(Language::En, "daemon", Some(ServiceState::Running));
        let chinese = status_line(Language::Zh, "daemon", Some(ServiceState::Running));
        assert_ne!(english, chinese);
        assert!(contains_han(&chinese));
        assert!(
            chinese.contains('\u{FF1A}'),
            "Chinese status line must use the full-width separator"
        );
    }

    #[test]
    fn unknown_key_falls_back_to_the_key() {
        assert_eq!(text(Language::En, "tray.missing"), "tray.missing");
        assert_eq!(text(Language::Zh, "tray.missing"), "tray.missing");
    }

    #[test]
    fn confirm_texts_use_per_action_english_messages() {
        let start = confirm_texts(Language::En, ConfirmAction::StartAll);
        assert_eq!(start.title, "Please confirm");
        assert_eq!(start.message, "Start all services?");
        assert_eq!(start.confirm, "OK");
        assert_eq!(start.cancel, "Cancel");

        let stop = confirm_texts(Language::En, ConfirmAction::StopAll);
        assert_eq!(stop.message, "Stop all services?");

        let exit = confirm_texts(Language::En, ConfirmAction::Exit);
        assert_eq!(
            exit.message,
            "Exit the application? All services will be stopped."
        );
    }

    #[test]
    fn confirm_texts_are_localized_in_chinese() {
        for action in [
            ConfirmAction::StartAll,
            ConfirmAction::StopAll,
            ConfirmAction::Exit,
        ] {
            let english = confirm_texts(Language::En, action);
            let chinese = confirm_texts(Language::Zh, action);
            assert_ne!(english.message, chinese.message);
            assert!(contains_han(&chinese.message));
            assert!(contains_han(&chinese.title));
            assert!(contains_han(&chinese.confirm));
            assert!(contains_han(&chinese.cancel));
        }
    }

    #[test]
    fn error_title_lookup_is_localized() {
        assert_eq!(error_title(Language::En), "Operation failed");
        let chinese = error_title(Language::Zh);
        assert!(contains_han(&chinese));
        assert_ne!(error_title(Language::En), chinese);
    }
}
