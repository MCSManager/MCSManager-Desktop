use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::config::{self, AppConfig, ConfigError, ServiceConfig};
use crate::process::events::{EventSink, OutputStream, ProcessEvent, ProcessSpec, ServiceStatus};
use crate::process::manager::ProcessManager;

pub struct AppState {
    pub manager: Arc<RwLock<ProcessManager>>,
    pub config: Arc<Mutex<AppConfig>>,
    pub config_path: PathBuf,
    pub startup_warnings: Vec<String>,
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

pub(crate) fn read_manager(manager: &RwLock<ProcessManager>) -> RwLockReadGuard<'_, ProcessManager> {
    manager
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

pub(crate) fn write_manager(
    manager: &RwLock<ProcessManager>,
) -> RwLockWriteGuard<'_, ProcessManager> {
    manager
        .write()
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
        working_dir: crate::config::service_dir(id)
            .map(|dir| dir.to_string_lossy().into_owned())
            .unwrap_or_default(),
        start_delay_ms: service.start_delay_ms,
    }
}

pub(crate) fn build_spec(id: &str, config: &AppConfig) -> Result<ProcessSpec, String> {
    let service = config
        .services
        .get(id)
        .ok_or_else(|| format!("service not found in config: {}", id))?;
    if !service.enabled {
        return Err(format!("service is disabled: {}", id));
    }
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
    let mut warnings = state.startup_warnings.clone();
    warnings.extend(config.path_issues());
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
    read_manager(&state.manager).statuses()
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
        write_manager(&manager)
            .register_or_update(spec)
            .map_err(|error| error.to_string())?;
        read_manager(&manager)
            .start(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn stop_service(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    run_blocking(move || read_manager(&manager).stop(&id).map_err(|error| error.to_string())).await
}

#[tauri::command]
pub async fn restart_service(id: String, state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    let config = Arc::clone(&state.config);
    run_blocking(move || {
        read_manager(&manager)
            .stop(&id)
            .map_err(|error| error.to_string())?;
        let spec = {
            let config = lock_config(&config);
            build_spec(&id, &config)?
        };
        write_manager(&manager)
            .register_or_update(spec)
            .map_err(|error| error.to_string())?;
        read_manager(&manager)
            .start(&id)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn start_all_services(state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    let config = Arc::clone(&state.config);
    run_blocking(move || {
        let specs = enabled_specs(&lock_config(&config));
        let ids: Vec<String> = specs.iter().map(|spec| spec.id.clone()).collect();
        {
            let mut manager = write_manager(&manager);
            for spec in specs {
                let _ = manager.register_or_update(spec);
            }
        }
        read_manager(&manager)
            .start_only(&ids)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn stop_all_services(state: State<'_, AppState>) -> Result<(), String> {
    let manager = Arc::clone(&state.manager);
    run_blocking(move || read_manager(&manager).stop_all().map_err(|error| error.to_string())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::process::events::ServiceState;
    use std::net::TcpListener;
    use std::thread;
    use std::time::Instant;

    const LONG_RUN: &str = "console.log('ready-'+process.pid); process.stdin.on('data',()=>process.exit(0)); setInterval(()=>{},1e3)";
    const STUBBORN: &str = "setInterval(()=>{},1e3)";

    fn test_spec(id: &str, code: &str) -> ProcessSpec {
        ProcessSpec {
            id: id.to_string(),
            display_name: format!("test {}", id),
            command: "node".to_string(),
            args: vec!["-e".to_string(), code.to_string()],
            working_dir: std::env::temp_dir().to_string_lossy().into_owned(),
            start_delay_ms: 0,
        }
    }

    fn wait_until(limit: Duration, mut condition: impl FnMut() -> bool) -> bool {
        let deadline = Instant::now() + limit;
        loop {
            if condition() {
                return true;
            }
            if Instant::now() >= deadline {
                return condition();
            }
            thread::sleep(Duration::from_millis(20));
        }
    }

    fn is_running(manager: &ProcessManager, id: &str) -> bool {
        manager
            .status(id)
            .map(|status| status.state == ServiceState::Running && status.pid.is_some())
            .unwrap_or(false)
    }

    fn state_seen(events: &Arc<Mutex<Vec<ProcessEvent>>>, id: &str, state: ServiceState) -> bool {
        events.lock().unwrap().iter().any(|event| match event {
            ProcessEvent::Status(status) => status.id == id && status.state == state,
            _ => false,
        })
    }

    #[test]
    fn probe_tcp_detects_open_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        assert!(probe_tcp("127.0.0.1".to_string(), port, 1000));
    }

    #[test]
    fn build_spec_rejects_disabled_service() {
        let mut config = AppConfig::default();
        config
            .services
            .get_mut("daemon")
            .expect("daemon service")
            .enabled = false;
        let err = build_spec("daemon", &config)
            .expect_err("spec for a disabled service must not build");
        assert!(
            err.contains("disabled"),
            "error must mention the service is disabled: {}",
            err
        );
    }

    #[test]
    fn make_spec_uses_fixed_service_directories() {
        let config = AppConfig::default();

        let daemon = config.services.get("daemon").expect("daemon service");
        let spec = make_spec("daemon", daemon, &config.node_path);
        assert_eq!(
            PathBuf::from(&spec.working_dir),
            crate::config::service_dir("daemon").expect("daemon dir")
        );

        let panel = config.services.get("panel").expect("panel service");
        let spec = make_spec("panel", panel, &config.node_path);
        assert_eq!(
            PathBuf::from(&spec.working_dir),
            crate::config::service_dir("panel").expect("panel dir")
        );
    }

    #[test]
    fn probe_tcp_detects_closed_port() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        let port = listener.local_addr().expect("local addr").port();
        drop(listener);
        assert!(!probe_tcp("127.0.0.1".to_string(), port, 1000));
    }

    #[test]
    fn statuses_available_while_other_service_stops() {
        let events: Arc<Mutex<Vec<ProcessEvent>>> = Arc::new(Mutex::new(Vec::new()));
        let recorded = Arc::clone(&events);
        let sink: EventSink = Arc::new(move |event| {
            recorded.lock().unwrap().push(event);
        });
        let mut manager = ProcessManager::new(sink, Duration::from_millis(2500));
        manager
            .register(test_spec("busy-a", STUBBORN))
            .expect("register busy-a");
        manager
            .register(test_spec("busy-b", LONG_RUN))
            .expect("register busy-b");
        let manager = Arc::new(RwLock::new(manager));
        read_manager(&manager).start("busy-a").expect("start busy-a");
        read_manager(&manager).start("busy-b").expect("start busy-b");
        let both_up = wait_until(Duration::from_secs(2), || {
            let manager = read_manager(&manager);
            is_running(&manager, "busy-a") && is_running(&manager, "busy-b")
        });
        assert!(both_up, "both services must be Running before the stop");

        let stopper = {
            let manager = Arc::clone(&manager);
            thread::spawn(move || read_manager(&manager).stop("busy-a").expect("stop busy-a"))
        };
        let stopping = wait_until(Duration::from_secs(2), || {
            state_seen(&events, "busy-a", ServiceState::Stopping)
        });
        assert!(
            stopping,
            "stop of busy-a must be in flight (Stopping event seen)"
        );

        let began = Instant::now();
        let statuses = read_manager(&manager).statuses();
        let elapsed = began.elapsed();
        assert!(
            elapsed < Duration::from_millis(500),
            "statuses() must not block behind the in-flight stop (took {:?})",
            elapsed
        );
        let busy_a = statuses
            .iter()
            .find(|status| status.id == "busy-a")
            .expect("busy-a in snapshot");
        assert_eq!(
            busy_a.state,
            ServiceState::Stopping,
            "snapshot must be taken mid-stop"
        );
        let busy_b = statuses
            .iter()
            .find(|status| status.id == "busy-b")
            .expect("busy-b in snapshot");
        assert_eq!(busy_b.state, ServiceState::Running);

        stopper.join().expect("stop thread must not panic");
        let final_state = read_manager(&manager)
            .status("busy-a")
            .expect("busy-a status")
            .state;
        assert_eq!(final_state, ServiceState::Stopped);
        read_manager(&manager).shutdown();
    }
}
