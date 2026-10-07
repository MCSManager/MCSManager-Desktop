use std::net::{TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::Duration;

use serde::Serialize;
use tauri::{Emitter, State};

use crate::config::{self, AppConfig, ConfigError, ServiceConfig};
use crate::process::events::{EventSink, OutputStream, ProcessEvent, ProcessSpec, ServiceStatus};
use crate::process::manager::ProcessManager;
use crate::process::net_port;

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
    pub path_issues: Vec<String>,
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

fn config_response(config: &AppConfig, startup_warnings: Vec<String>) -> ConfigResponse {
    let path_issues = config.path_issues();
    let mut warnings = startup_warnings;
    warnings.extend(path_issues.iter().cloned());
    ConfigResponse {
        config: config.clone(),
        warnings,
        path_issues,
    }
}

#[tauri::command]
pub fn get_config(state: State<'_, AppState>) -> ConfigResponse {
    let config = lock_config(&state.config).clone();
    config_response(&config, state.startup_warnings.clone())
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

/// PIDs that must never be terminated by the port guard: this app process and
/// every service it manages.
fn protected_pids(state: &AppState) -> Vec<u32> {
    let mut pids = vec![std::process::id()];
    for status in read_manager(&state.manager).statuses() {
        if let Some(pid) = status.pid {
            pids.push(pid);
        }
    }
    pids
}

/// Reports `port` as in conflict when a process that is not protected listens on
/// it. A port that cannot be probed (missing platform tooling) is not a conflict.
fn conflict_for_port(port: u16, protected: &[u32]) -> Option<u16> {
    net_port::conflict_occupant(&net_port::probe_port(port), protected).map(|_| port)
}

/// Only configured `readyPort` values may be freed; anything else is rejected.
fn is_configured_port(config: &AppConfig, port: u16) -> bool {
    config
        .services
        .values()
        .any(|service| service.ready_port == Some(port))
}

/// Returns the service's port when another program is occupying it.
#[tauri::command]
pub async fn check_start_conflict(
    id: String,
    state: State<'_, AppState>,
) -> Result<Option<u16>, String> {
    let port = {
        let config = lock_config(&state.config);
        config.services.get(&id).and_then(|service| service.ready_port)
    };
    let Some(port) = port else {
        return Ok(None);
    };
    let protected = protected_pids(&state);
    run_blocking(move || Ok(conflict_for_port(port, &protected))).await
}

/// Force-frees a configured service port by gracefully terminating the program
/// that occupies it, escalating to a forced tree-kill when needed.
#[tauri::command]
pub async fn force_free_port(port: u16, state: State<'_, AppState>) -> Result<(), String> {
    {
        let config = lock_config(&state.config);
        if !is_configured_port(&config, port) {
            return Err(format!("port {} is not a configured service port", port));
        }
    }
    let protected = protected_pids(&state);
    run_blocking(move || net_port::terminate_port_listener(port, &protected)).await
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
    use std::process::{Command, Stdio};
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

    fn pick_free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
        listener.local_addr().expect("local addr").port()
    }

    fn spawn_node_listener(port: u16) -> std::process::Child {
        let code = format!(
            "const net=require('net');net.createServer().listen({},'127.0.0.1');setInterval(()=>{{}},1000);",
            port
        );
        let mut cmd = Command::new("node");
        cmd.args(["-e", &code])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = cmd.spawn().expect("spawn node listener");
        thread::sleep(Duration::from_millis(200));
        child
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
    fn config_response_exposes_path_issues() {
        let mut config = AppConfig::default();
        config
            .services
            .get_mut("daemon")
            .expect("daemon service")
            .script = "definitely-missing-script-xyz/app.js".to_string();

        let response = config_response(&config, vec!["config recovered".to_string()]);

        assert!(response.warnings.contains(&"config recovered".to_string()));
        assert!(
            response
                .path_issues
                .iter()
                .any(|issue| issue.contains("definitely-missing-script-xyz")),
            "path issues must include the missing script: {:?}",
            response.path_issues
        );
        assert_eq!(
            response.warnings.len(),
            response.path_issues.len() + 1,
            "path issues must also be surfaced as warnings"
        );
    }

    #[test]
    fn is_configured_port_matches_ready_ports() {
        let config = AppConfig::default();
        assert!(is_configured_port(&config, 23333));
        assert!(is_configured_port(&config, 24444));
        assert!(!is_configured_port(&config, 12345));

        let mut without_panel_port = AppConfig::default();
        without_panel_port
            .services
            .get_mut("panel")
            .expect("panel service")
            .ready_port = None;
        assert!(!is_configured_port(&without_panel_port, 23333));
    }

    #[test]
    fn conflict_for_port_detects_and_respects_protected() {
        let port = pick_free_port();
        let mut child = spawn_node_listener(port);
        assert!(
            wait_until(Duration::from_secs(5), || net_port::find_port_listener(port).is_some()),
            "node listener must be detectable on port {}",
            port
        );
        let pid = net_port::find_port_listener(port).expect("listener pid");

        assert_eq!(conflict_for_port(port, &[]), Some(port));
        assert_eq!(
            conflict_for_port(port, &[pid]),
            None,
            "a protected listener must not count as a conflict"
        );
        let free = pick_free_port();
        assert_eq!(conflict_for_port(free, &[]), None);

        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn protected_pids_include_self_and_managed_services() {
        let sink: EventSink = Arc::new(|_event| {});
        let mut manager = ProcessManager::new(sink, Duration::from_millis(300));
        manager
            .register(test_spec("guarded", LONG_RUN))
            .expect("register guarded service");
        manager.start("guarded").expect("start guarded service");
        let manager = Arc::new(RwLock::new(manager));
        let state = AppState {
            manager,
            config: Arc::new(Mutex::new(AppConfig::default())),
            config_path: PathBuf::from("test-config.json"),
            startup_warnings: Vec::new(),
        };

        let pids = protected_pids(&state);
        assert!(pids.contains(&std::process::id()), "self must be protected");
        let managed_pid = read_manager(&state.manager)
            .status("guarded")
            .expect("guarded status")
            .pid
            .expect("guarded pid");
        assert!(
            pids.contains(&managed_pid),
            "managed service pid must be protected"
        );

        read_manager(&state.manager).shutdown();
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
        // The force-kill can land shortly after stop() returns, so let the state
        // settle like process::managed::tests::stop_force_kills_after_timeout does.
        let stopped = wait_until(Duration::from_secs(30), || {
            read_manager(&manager)
                .status("busy-a")
                .map(|status| status.state == ServiceState::Stopped)
                .unwrap_or(false)
        });
        assert!(
            stopped,
            "busy-a must settle to Stopped after the stop request completes"
        );
        read_manager(&manager).shutdown();
    }
}
