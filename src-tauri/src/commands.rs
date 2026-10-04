use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::config::{self, AppConfig, ConfigError, ServiceConfig};
use crate::process::events::{EventSink, OutputStream, ProcessEvent, ProcessSpec, ServiceStatus};
use crate::process::manager::ProcessManager;

pub struct AppState {
    pub manager: Arc<Mutex<ProcessManager>>,
    pub config: Arc<Mutex<AppConfig>>,
    pub config_path: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigResponse {
    pub config: AppConfig,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub config_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputEvent {
    pub id: String,
    pub stream: OutputStream,
    pub line: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorEvent {
    pub id: String,
    pub message: String,
}

pub fn make_event_sink(app: tauri::AppHandle) -> EventSink {
    Arc::new(move |event| {
        let _ = match event {
            ProcessEvent::Status(status) => app.emit("service-status", status),
            ProcessEvent::Output {
                id,
                stream,
                line,
                timestamp,
            } => app.emit(
                "service-output",
                OutputEvent {
                    id,
                    stream,
                    line,
                    timestamp,
                },
            ),
            ProcessEvent::Error { id, message } => {
                app.emit("service-error", ErrorEvent { id, message })
            }
        };
    })
}

fn lock_manager(manager: &Mutex<ProcessManager>) -> MutexGuard<'_, ProcessManager> {
    manager
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn lock_config(config: &Mutex<AppConfig>) -> MutexGuard<'_, AppConfig> {
    config
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn map_config_error(error: ConfigError) -> String {
    error.to_string()
}

pub(crate) fn make_spec(id: &str, service: &ServiceConfig, node_path: &str) -> ProcessSpec {
    let (command, args) = service.command_and_args(node_path);
    ProcessSpec {
        id: id.to_string(),
        display_name: id.to_string(),
        command,
        args,
        working_dir: service.working_dir.clone(),
        start_delay_ms: service.start_delay_ms,
    }
}

pub(crate) fn build_spec(id: &str, config: &AppConfig) -> Result<ProcessSpec, String> {
    let service = config
        .services
        .get(id)
        .ok_or_else(|| format!("service not found in config: {}", id))?;
    Ok(make_spec(id, service, &config.node_path))
}

pub(crate) fn enabled_specs(config: &AppConfig) -> Vec<ProcessSpec> {
    let mut specs = Vec::new();
    for id in ["daemon", "panel"] {
        if let Some(service) = config.services.get(id) {
            if service.enabled {
                specs.push(make_spec(id, service, &config.node_path));
            }
        }
    }
    specs
}

async fn run_blocking<T, F>(work: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(result) => result,
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> ConfigResponse {
    let config = lock_config(&state.config).clone();
    let warnings = config.path_issues();
    ConfigResponse { config, warnings }
}

#[tauri::command]
pub fn save_config(config: AppConfig, state: State<'_, AppState>) -> Result<(), String> {
    config.validate().map_err(map_config_error)?;
    config::save_to(&state.config_path, &config).map_err(map_config_error)?;
    *lock_config(&state.config) = config;
    Ok(())
}

#[tauri::command]
pub fn get_service_statuses(state: State<'_, AppState>) -> Vec<ServiceStatus> {
    lock_manager(&state.manager).statuses()
}

#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").to_string(),
        config_path: state.config_path.display().to_string(),
    }
}

#[tauri::command]
pub fn probe_tcp(host: String, port: u16, timeout_ms: u64) -> bool {
    let Ok(mut addrs) = (host.as_str(), port).to_socket_addrs() else {
        return false;
    };
    addrs
        .next()
        .map(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(timeout_ms)).is_ok())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn start_service(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    let config = Arc::clone(&state.config);
    run_blocking(move || {
        let spec = {
            let config = lock_config(&config);
            build_spec(&id, &config)?
        };
        let mut manager = lock_manager(&manager);
        manager
            .register_or_update(spec)
            .map_err(|error| error.to_string())?;
        manager.start(&id).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn stop_service(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    run_blocking(move || lock_manager(&manager).stop(&id).map_err(|error| error.to_string())).await
}

#[tauri::command]
pub async fn restart_service(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    let config = Arc::clone(&state.config);
    run_blocking(move || {
        lock_manager(&manager)
            .stop(&id)
            .map_err(|error| error.to_string())?;
        let spec = {
            let config = lock_config(&config);
            build_spec(&id, &config)?
        };
        let mut manager = lock_manager(&manager);
        manager
            .register_or_update(spec)
            .map_err(|error| error.to_string())?;
        manager.start(&id).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn start_all_services(state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    let config = Arc::clone(&state.config);
    run_blocking(move || {
        let specs = enabled_specs(&lock_config(&config));
        let mut manager = lock_manager(&manager);
        for spec in specs {
            let _ = manager.register_or_update(spec);
        }
        manager.start_all().map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn stop_all_services(state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    run_blocking(move || lock_manager(&manager).stop_all().map_err(|error| error.to_string())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn probe_tcp_detects_open_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        assert!(probe_tcp("127.0.0.1".to_string(), port, 1000));
    }

    #[test]
    fn probe_tcp_detects_closed_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        assert!(!probe_tcp("127.0.0.1".to_string(), port, 1000));
    }
}
