use std::path::{Path, PathBuf};

/// Fixed folder name of the daemon deployment under the run directory.
pub const DAEMON_FOLDER: &str = "daemon";

/// Fixed folder name of the panel deployment under the run directory.
/// Keeps the upstream MCSManager bundle folder name.
pub const PANEL_FOLDER: &str = "web";

/// Maps a service id to its fixed folder name under the run directory.
/// Unknown service ids resolve to `None`.
pub fn service_folder_name(service_id: &str) -> Option<&'static str> {
    match service_id {
        "daemon" => Some(DAEMON_FOLDER),
        "panel" => Some(PANEL_FOLDER),
        _ => None,
    }
}

/// Resolves the run directory the service folders live next to.
///
/// Release builds resolve it from the executable location, so the portable
/// layout is "exe next to `daemon/` and `web/`". Development builds fall
/// back to the workspace root (the parent of `src-tauri`), where those
/// folders sit during `tauri dev`.
pub fn run_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        if let Some(root) = Path::new(env!("CARGO_MANIFEST_DIR")).parent() {
            return root.to_path_buf();
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|dir| dir.to_path_buf()))
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

/// Resolves the fixed service directory for a known service id.
pub fn service_dir(service_id: &str) -> Option<PathBuf> {
    service_folder_name(service_id).map(|folder| run_dir().join(folder))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn service_folder_names_are_fixed() {
        assert_eq!(service_folder_name("daemon"), Some(DAEMON_FOLDER));
        assert_eq!(service_folder_name("panel"), Some(PANEL_FOLDER));
        assert_eq!(service_folder_name("daemon"), Some("daemon"));
        assert_eq!(service_folder_name("panel"), Some("web"));
        assert_eq!(service_folder_name("unknown"), None);
        assert_eq!(service_folder_name(""), None);
    }

    #[test]
    fn run_dir_is_the_workspace_root_in_debug_builds() {
        let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
        assert_eq!(run_dir(), manifest.parent().expect("manifest parent"));
    }

    #[test]
    fn service_dir_resolves_under_run_dir() {
        let run = run_dir();
        assert_eq!(service_dir("daemon"), Some(run.join("daemon")));
        assert_eq!(service_dir("panel"), Some(run.join("web")));
        assert_eq!(service_dir("unknown"), None);
    }

    #[test]
    fn service_dir_never_escapes_the_run_dir() {
        let run = run_dir();
        for id in ["daemon", "panel"] {
            let dir = service_dir(id).expect("known service");
            assert!(dir.starts_with(&run));
            assert_eq!(dir.components().count(), run.components().count() + 1);
        }
    }
}
