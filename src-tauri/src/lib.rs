mod commands;
pub mod config;
pub mod process;

use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;

use tauri::Manager;
#[cfg(not(dev))]
use tauri::{ipc::CapabilityBuilder, Url};
use tauri::{WebviewUrl, WebviewWindowBuilder};

use commands::{read_manager, AppState};
use process::manager::ProcessManager;

type ShutdownSlot = Arc<Mutex<Option<std::thread::JoinHandle<()>>>>;

const TARGET_WIDTH: f64 = 1400.0;
const TARGET_HEIGHT: f64 = 960.0;

const MIN_WINDOW_WIDTH: f64 = 1024.0;
const MIN_WINDOW_HEIGHT: f64 = 680.0;
const WINDOW_LABEL: &str = "main";
const WINDOW_TITLE: &str = "MCSManager Desktop";

/// The panel web UI is embedded in an iframe. Browsers only attach cookies to
/// same-site requests, but the production custom-protocol origin on Windows
/// (`http://tauri.localhost`) is a different site than the panel origin
/// (`http://localhost:23333`). The login session cookie therefore becomes a
/// cross-site cookie and WebView2 refuses to store/send it, which is why the
/// authenticated `/api/auth/` call is rejected.
///
/// Serving the shell over a loopback HTTP server puts it on the same site
/// (`localhost`) as the panel, mirroring `tauri dev` where the Vite dev server
/// already runs on `localhost` and cookies work.
fn pick_unused_port() -> Option<u16> {
    std::net::TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
}

/// Picks the loopback host the shell is served from so it stays on the same
/// site as the configured panel. `127.0.0.1` and `localhost` are different
/// sites for cookie purposes, so the shell host must mirror whichever one the
/// panel uses; anything else (remote hosts, IPv6) falls back to `localhost`.
#[cfg(not(dev))]
fn shell_host_for_panel(panel_url: &str) -> String {
    match panel_url
        .parse::<Url>()
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned))
    {
        Some(host) if host == "127.0.0.1" => host,
        _ => "localhost".to_string(),
    }
}

fn fits_target_size(width: f64, height: f64) -> bool {
    width >= TARGET_WIDTH && height >= TARGET_HEIGHT
}

fn lock_slot(slot: &Mutex<Option<std::thread::JoinHandle<()>>>) -> MutexGuard<'_, Option<std::thread::JoinHandle<()>>> {
    slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shutdown: ShutdownSlot = Arc::new(Mutex::new(None));
    let shutdown_on_close = Arc::clone(&shutdown);
    let localhost_port = pick_unused_port().unwrap_or(0);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_localhost::Builder::new(localhost_port)
                .host("127.0.0.1")
                .build(),
        )
        .setup(move |app| {
            let config_path = app.path().app_config_dir()?.join("config.json");
            let outcome = config::load_from(&config_path)?;
            let startup_warnings: Vec<String> = outcome
                .error
                .iter()
                .map(|error| format!("config recovered from invalid file: {}", error))
                .collect();
            let app_config = outcome.config;
            let sink = commands::make_event_sink(app.handle().clone());
            let mut manager = ProcessManager::new(
                sink,
                Duration::from_millis(app_config.stop_timeout_ms),
            );
            for spec in commands::enabled_specs(&app_config) {
                let _ = manager.register_or_update(spec);
            }
            app.manage(AppState {
                manager: Arc::new(RwLock::new(manager)),
                config: Arc::new(Mutex::new(app_config)),
                config_path,
                startup_warnings,
            });

            let url = {
                #[cfg(dev)]
                {
                    // In development Vite serves the shell on http://localhost:1420,
                    // which shares the `localhost` site with the panel already.
                    WebviewUrl::App("index.html".into())
                }
                #[cfg(not(dev))]
                {
                    if localhost_port == 0 {
                        // Extremely unlikely fallback: no loopback port was
                        // available, so keep the default asset origin.
                        WebviewUrl::App("index.html".into())
                    } else {
                        let panel_url = {
                            let state = app.state::<AppState>();
                            let config = state
                                .config
                                .lock()
                                .unwrap_or_else(|poisoned| poisoned.into_inner());
                            config.panel_url.clone()
                        };
                        let host = shell_host_for_panel(&panel_url);
                        let origin = format!("http://{host}:{localhost_port}");
                        app.add_capability(
                            CapabilityBuilder::new("desktop-localhost")
                                .remote(origin.clone())
                                .window(WINDOW_LABEL)
                                .permission("core:default")
                                .permission("opener:default")
                                .permission("allow-desktop-commands"),
                        )?;
                        WebviewUrl::External(origin.parse::<Url>()?)
                    }
                }
            };

            WebviewWindowBuilder::new(app, WINDOW_LABEL, url)
                .title(WINDOW_TITLE)
                .inner_size(TARGET_WIDTH, TARGET_HEIGHT)
                .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
                .build()?;

            if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
                let fits = window
                    .primary_monitor()
                    .ok()
                    .flatten()
                    .map(|monitor| {
                        let logical = monitor.size().to_logical::<f64>(monitor.scale_factor());
                        fits_target_size(logical.width, logical.height)
                    })
                    .unwrap_or(true);
                if !fits {
                    let _ = window.maximize();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::save_config,
            commands::get_service_statuses,
            commands::start_service,
            commands::stop_service,
            commands::restart_service,
            commands::start_all_services,
            commands::stop_all_services,
            commands::probe_tcp,
            commands::check_start_conflict,
            commands::force_free_port,
            commands::get_app_info,
        ])
        .on_window_event(move |window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == WINDOW_LABEL {
                let manager = Arc::clone(&window.state::<AppState>().manager);
                let handle = std::thread::spawn(move || {
                    read_manager(&manager).shutdown();
                });
                *lock_slot(&shutdown_on_close) = Some(handle);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(move |_app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Some(handle) = lock_slot(&shutdown).take() {
                    let _ = handle.join();
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::fits_target_size;

    #[test]
    fn fits_exact_target_size() {
        assert!(fits_target_size(1400.0, 960.0));
    }

    #[test]
    fn fits_larger_monitor() {
        assert!(fits_target_size(2560.0, 1440.0));
    }

    #[test]
    fn too_short_monitor_does_not_fit() {
        assert!(!fits_target_size(1920.0, 900.0));
    }

    #[test]
    fn too_narrow_monitor_does_not_fit() {
        assert!(!fits_target_size(1280.0, 1080.0));
    }
}
