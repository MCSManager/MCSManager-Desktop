mod model;

pub use model::{AppConfig, ConfigError, Language, ServiceConfig};

use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadOutcome {
    pub config: AppConfig,
    pub recovered: bool,
    pub error: Option<String>,
}

pub fn load_from(path: &Path) -> Result<LoadOutcome, ConfigError> {
    let contents = match std::fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
            return Ok(LoadOutcome {
                config: AppConfig::default(),
                recovered: false,
                error: None,
            });
        }
        Err(err) => {
            return Err(ConfigError::Io(format!(
                "failed to read {}: {}",
                path.display(),
                err
            )));
        }
    };

    let checked = match serde_json::from_str::<AppConfig>(&contents) {
        Ok(config) => match config.validate() {
            Ok(()) => Ok(config),
            Err(err) => Err(format!("config validation failed: {}", err)),
        },
        Err(err) => Err(format!("failed to parse config file: {}", err)),
    };

    match checked {
        Ok(config) => Ok(LoadOutcome {
            config,
            recovered: false,
            error: None,
        }),
        Err(error) => {
            let error = match backup_file(path) {
                Ok(()) => error,
                Err(backup_error) => format!("{}; additionally the backup copy failed: {}", error, backup_error),
            };
            Ok(LoadOutcome {
                config: AppConfig::default(),
                recovered: true,
                error: Some(error),
            })
        }
    }
}

pub fn save_to(path: &Path, config: &AppConfig) -> Result<(), ConfigError> {
    config.validate()?;
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|err| {
                ConfigError::Io(format!(
                    "failed to create directory {}: {}",
                    parent.display(),
                    err
                ))
            })?;
        }
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|err| ConfigError::Io(format!("failed to serialize config: {}", err)))?;
    std::fs::write(path, json).map_err(|err| {
        ConfigError::Io(format!("failed to write {}: {}", path.display(), err))
    })?;
    Ok(())
}

fn backup_file(path: &Path) -> Result<(), ConfigError> {
    let file_name = path.file_name().ok_or_else(|| {
        ConfigError::Io(format!(
            "cannot determine file name of {}",
            path.display()
        ))
    })?;
    let mut backup_name = file_name.to_os_string();
    backup_name.push(".bak");
    let backup_path = path.with_file_name(backup_name);
    std::fs::copy(path, &backup_path).map_err(|err| {
        ConfigError::Io(format!(
            "failed to back up {} to {}: {}",
            path.display(),
            backup_path.display(),
            err
        ))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir() -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before unix epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "mcsmanager-desktop-config-test-{}-{}-{}",
            std::process::id(),
            n,
            nanos
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn default_matches_spec_values() {
        let config = AppConfig::default();
        assert_eq!(config.version, 1);
        assert_eq!(config.language, Language::En);
        assert_eq!(config.node_path, "node");
        assert_eq!(config.panel_url, "http://localhost:23333");
        assert_eq!(config.stop_timeout_ms, 35000);
        assert_eq!(config.max_log_lines, 2000);
        assert_eq!(config.services.len(), 2);

        let daemon = config.services.get("daemon").expect("daemon service");
        assert!(daemon.enabled);
        assert_eq!(daemon.working_dir, "");
        assert_eq!(daemon.script, "app.js");
        assert_eq!(daemon.extra_args, Vec::<String>::new());
        assert_eq!(daemon.start_delay_ms, 0);
        assert_eq!(daemon.ready_port, Some(24444));

        let panel = config.services.get("panel").expect("panel service");
        assert!(panel.enabled);
        assert_eq!(panel.working_dir, "");
        assert_eq!(panel.script, "app.js");
        assert_eq!(panel.extra_args, Vec::<String>::new());
        assert_eq!(panel.start_delay_ms, 1500);
        assert_eq!(panel.ready_port, Some(23333));
    }

    #[test]
    fn round_trip_preserves_all_fields() {
        let dir = unique_temp_dir();
        let path = dir.join("nested").join("config.json");

        let mut config = AppConfig::default();
        config.language = Language::Zh;
        config.node_path = "C:/tools/node/node.exe".to_string();
        config.panel_url = "https://panel.example.test:23333".to_string();
        config.stop_timeout_ms = 12345;
        config.max_log_lines = 4321;

        let daemon = config.services.get_mut("daemon").expect("daemon service");
        daemon.enabled = false;
        daemon.working_dir = "C:/mcsmanager/daemon".to_string();
        daemon.script = "production/app.js".to_string();
        daemon.extra_args = vec!["production/app.js".to_string()];
        daemon.start_delay_ms = 7;
        daemon.ready_port = None;

        let panel = config.services.get_mut("panel").expect("panel service");
        panel.working_dir = "C:/mcsmanager/panel".to_string();
        panel.script = "panel.js".to_string();
        panel.extra_args = vec!["--flag".to_string()];
        panel.start_delay_ms = 42;
        panel.ready_port = Some(9999);

        save_to(&path, &config).expect("save config");
        let outcome = load_from(&path).expect("load config");
        assert!(!outcome.recovered);
        assert!(outcome.error.is_none());
        assert_eq!(outcome.config, config);

        cleanup(&dir);
    }

    #[test]
    fn validate_rejects_bad_values() {
        let mut config = AppConfig::default();
        config.panel_url = "ftp://x".to_string();
        assert!(matches!(config.validate(), Err(ConfigError::Invalid(_))));

        let mut config = AppConfig::default();
        config.stop_timeout_ms = 0;
        assert!(matches!(config.validate(), Err(ConfigError::Invalid(_))));

        let mut config = AppConfig::default();
        config.max_log_lines = 50;
        assert!(matches!(config.validate(), Err(ConfigError::Invalid(_))));

        let mut config = AppConfig::default();
        config.services.remove("panel");
        assert!(matches!(config.validate(), Err(ConfigError::Invalid(_))));
    }

    #[test]
    fn load_recovers_from_corrupt_file() {
        let dir = unique_temp_dir();
        let path = dir.join("config.json");
        std::fs::write(&path, "{not json").expect("write corrupt file");

        let outcome = load_from(&path).expect("load config");
        assert!(outcome.recovered);
        assert!(outcome.error.is_some());
        assert_eq!(outcome.config, AppConfig::default());

        let backup = dir.join("config.json.bak");
        assert!(backup.is_file());
        assert_eq!(
            std::fs::read_to_string(&backup).expect("read backup"),
            "{not json"
        );

        cleanup(&dir);
    }

    #[test]
    fn load_tolerates_backup_failure() {
        let dir = unique_temp_dir();
        let path = dir.join("config.json");
        std::fs::write(&path, "{not json").expect("write corrupt file");
        std::fs::create_dir(dir.join("config.json.bak")).expect("block the backup path");

        let outcome = load_from(&path).expect("load must not hard-fail on backup I/O");
        assert!(outcome.recovered);
        let error = outcome.error.expect("recovery error recorded");
        assert!(
            error.contains("failed to back up"),
            "error must mention the backup failure: {}",
            error
        );
        assert_eq!(outcome.config, AppConfig::default());

        cleanup(&dir);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let dir = unique_temp_dir();
        let path = dir.join("config.json");

        let outcome = load_from(&path).expect("load config");
        assert!(!outcome.recovered);
        assert!(outcome.error.is_none());
        assert_eq!(outcome.config, AppConfig::default());
        assert!(!dir.join("config.json.bak").exists());

        cleanup(&dir);
    }

    #[test]
    fn command_and_args_orders_args() {
        let mut service = ServiceConfig::default();
        service.script = "production/app.js".to_string();
        let (command, args) = service.command_and_args("node");
        assert_eq!(command, "node");
        assert_eq!(
            args,
            ["--enable-source-maps", "--max-old-space-size=8192", "production/app.js"]
        );

        let mut with_extra = ServiceConfig::default();
        with_extra.extra_args = vec!["--trace-warnings".to_string()];
        let (command, args) = with_extra.command_and_args("C:/node/node.exe");
        assert_eq!(command, "C:/node/node.exe");
        assert_eq!(
            args,
            [
                "--enable-source-maps",
                "--max-old-space-size=8192",
                "--trace-warnings",
                "app.js"
            ]
        );
    }

    #[test]
    fn path_issues_reports_missing_dir() {
        let dir = unique_temp_dir();
        let missing = dir.join("does-not-exist");

        let mut config = AppConfig::default();
        config.services.get_mut("daemon").expect("daemon service").working_dir =
            missing.to_string_lossy().into_owned();

        let issues = config.path_issues();
        assert!(issues.len() >= 1);
        assert!(issues
            .iter()
            .any(|issue| issue.contains(&missing.to_string_lossy().into_owned())));

        cleanup(&dir);
    }

    #[test]
    fn path_issues_empty_for_default_config() {
        let config = AppConfig::default();
        assert!(config.path_issues().is_empty());
    }

    #[test]
    fn path_issues_skips_disabled_service() {
        let dir = unique_temp_dir();
        let missing = dir.join("does-not-exist");

        let mut config = AppConfig::default();
        config.services.get_mut("daemon").expect("daemon service").enabled = false;
        config.services.get_mut("daemon").expect("daemon service").working_dir =
            missing.to_string_lossy().into_owned();

        assert!(config.path_issues().is_empty());

        cleanup(&dir);
    }

    #[test]
    fn load_fills_missing_fields_with_defaults_and_ignores_unknown() {
        let dir = unique_temp_dir();
        let path = dir.join("config.json");
        let json = r#"{"language":"zh","panelUrl":"https://panel.example.test:23333","stopTimeoutMs":5000,"unknownField":true,"services":{"daemon":{"enabled":false,"extraArgs":["production/app.js"],"readyPort":null},"panel":{"startDelayMs":1500}}}"#;
        std::fs::write(&path, json).expect("write config");

        let outcome = load_from(&path).expect("load config");
        assert!(!outcome.recovered);
        let config = &outcome.config;
        assert_eq!(config.language, Language::Zh);
        assert_eq!(config.panel_url, "https://panel.example.test:23333");
        assert_eq!(config.stop_timeout_ms, 5000);
        assert_eq!(config.version, 1);
        assert_eq!(config.node_path, "node");
        assert_eq!(config.max_log_lines, 2000);

        let daemon = config.services.get("daemon").expect("daemon service");
        assert!(!daemon.enabled);
        assert_eq!(daemon.extra_args, ["production/app.js"]);
        assert_eq!(daemon.ready_port, None);
        assert_eq!(daemon.script, "app.js");

        let panel = config.services.get("panel").expect("panel service");
        assert_eq!(panel.start_delay_ms, 1500);

        cleanup(&dir);
    }

    #[test]
    fn save_rejects_invalid_config() {
        let dir = unique_temp_dir();
        let path = dir.join("config.json");
        let mut config = AppConfig::default();
        config.stop_timeout_ms = 0;

        let result = save_to(&path, &config);
        assert!(matches!(result, Err(ConfigError::Invalid(_))));
        assert!(!path.exists());

        cleanup(&dir);
    }

    #[test]
    fn load_recovers_from_invalid_values() {
        let dir = unique_temp_dir();
        let path = dir.join("config.json");
        std::fs::write(&path, r#"{"stopTimeoutMs":0}"#).expect("write config");

        let outcome = load_from(&path).expect("load config");
        assert!(outcome.recovered);
        assert!(outcome.error.is_some());
        assert_eq!(outcome.config, AppConfig::default());
        assert!(dir.join("config.json.bak").is_file());

        cleanup(&dir);
    }
}
