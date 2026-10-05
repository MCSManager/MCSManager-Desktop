mod commands;
pub mod config;
pub mod process;

use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::time::Duration;

use tauri::Manager;

use commands::{read_manager, AppState};
use process::manager::ProcessManager;

type ShutdownSlot = Arc<Mutex<Option<std::thread::JoinHandle<()>>>>;

const TARGET_WIDTH: f64 = 1400.0;
const TARGET_HEIGHT: f64 = 960.0;

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

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            if let Some(window) = app.get_webview_window("main") {
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
            commands::get_app_info,
        ])
        .on_window_event(move |window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "main" {
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
