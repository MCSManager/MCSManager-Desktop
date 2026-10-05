use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    #[default]
    En,
    Zh,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ServiceConfig {
    pub enabled: bool,
    pub script: String,
    pub extra_args: Vec<String>,
    pub start_delay_ms: u64,
    pub ready_port: Option<u16>,
}

impl Default for ServiceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            script: "app.js".to_string(),
            extra_args: Vec::new(),
            start_delay_ms: 0,
            ready_port: None,
        }
    }
}

impl ServiceConfig {
    pub fn command_and_args(&self, node_path: &str) -> (String, Vec<String>) {
        let mut args = Vec::with_capacity(3 + self.extra_args.len());
        args.push("--enable-source-maps".to_string());
        args.push("--max-old-space-size=8192".to_string());
        args.extend(self.extra_args.iter().cloned());
        args.push(self.script.clone());
        (node_path.to_owned(), args)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub version: u32,
    pub language: Language,
    pub node_path: String,
    pub panel_url: String,
    pub stop_timeout_ms: u64,
    pub max_log_lines: usize,
    pub services: BTreeMap<String, ServiceConfig>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let mut services = BTreeMap::new();
        services.insert(
            "daemon".to_string(),
            ServiceConfig {
                start_delay_ms: 0,
                ready_port: Some(24444),
                ..ServiceConfig::default()
            },
        );
        services.insert(
            "panel".to_string(),
            ServiceConfig {
                start_delay_ms: 1500,
                ready_port: Some(23333),
                ..ServiceConfig::default()
            },
        );
        Self {
            version: 1,
            language: Language::En,
            node_path: "node".to_string(),
            panel_url: "http://localhost:23333".to_string(),
            stop_timeout_ms: 35000,
            max_log_lines: 2000,
            services,
        }
    }
}

impl AppConfig {
    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.version != 1 {
            return Err(ConfigError::Invalid(format!(
                "unsupported config version {}; expected 1",
                self.version
            )));
        }
        if !(1000..=120000).contains(&self.stop_timeout_ms) {
            return Err(ConfigError::Invalid(format!(
                "stopTimeoutMs {} out of range; expected 1000..=120000",
                self.stop_timeout_ms
            )));
        }
        if !(100..=20000).contains(&self.max_log_lines) {
            return Err(ConfigError::Invalid(format!(
                "maxLogLines {} out of range; expected 100..=20000",
                self.max_log_lines
            )));
        }
        if !(self.panel_url.starts_with("http://") || self.panel_url.starts_with("https://")) {
            return Err(ConfigError::Invalid(format!(
                "panelUrl must start with http:// or https://; got \"{}\"",
                self.panel_url
            )));
        }
        if !self.services.contains_key("panel") || !self.services.contains_key("daemon") {
            return Err(ConfigError::Invalid(
                "services map must contain \"panel\" and \"daemon\"".to_string(),
            ));
        }
        Ok(())
    }

    /// Reports path problems for enabled services under the real run directory.
    pub fn path_issues(&self) -> Vec<String> {
        self.path_issues_in(&super::paths::run_dir())
    }

    /// Reports path problems for enabled services under a given run directory.
    /// Service folders are fixed (`daemon` and `web` next to the run directory).
    pub fn path_issues_in(&self, run_dir: &Path) -> Vec<String> {
        let mut issues = Vec::new();
        for (name, service) in &self.services {
            if !service.enabled {
                continue;
            }
            let Some(folder) = super::paths::service_folder_name(name) else {
                continue;
            };
            let service_dir = run_dir.join(folder);
            if !service_dir.is_dir() {
                issues.push(format!(
                    "[{}] service folder is not an existing directory: {}",
                    name,
                    service_dir.display()
                ));
                continue;
            }
            let script_path = service_dir.join(&service.script);
            if !script_path.is_file() {
                issues.push(format!(
                    "[{}] script is not an existing file: {}",
                    name,
                    script_path.display()
                ));
            }
        }
        issues
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    Io(String),
    Invalid(String),
}

impl std::fmt::Display for ConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ConfigError::Io(message) => write!(f, "{}", message),
            ConfigError::Invalid(message) => write!(f, "{}", message),
        }
    }
}

impl std::error::Error for ConfigError {}
