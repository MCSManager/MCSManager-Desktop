mod commands;
pub mod config;
pub mod process;

use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use tauri::Manager;

use commands::AppState;
use process::manager::ProcessManager;

type ShutdownSlot = Arc<Mutex<Option<std::thread::JoinHandle<()>>>>;

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
            if outcome.recovered {
                if let Some(error) = &outcome.error {
                    eprintln!("config recovered from invalid file: {}", error);
                }
            }
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
                manager: Arc::new(Mutex::new(manager)),
                config: Arc::new(Mutex::new(app_config)),
                config_path,
            });
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
                    manager
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner())
                        .shutdown();
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
