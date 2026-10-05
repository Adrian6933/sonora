pub mod audio;
mod commands;
pub mod system;

use tauri::{Manager, WindowEvent};

use crate::audio::com_thread::AudioHandle;
use crate::system::hud::Hud;
use crate::system::watcher::ProcessWatcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Tiene que ir el PRIMERO: si ya hay una Sonora corriendo, este cierra
        // la nueva y saca al frente la que estaba. Dos instancias significan dos
        // juegos de atajos globales peleandose por las mismas teclas, dos hilos
        // de audio y dos iconos en la bandeja.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // Arrancar con Windows solo tiene sentido si arranca escondida en
            // la bandeja; abrir una ventana en cada inicio de sesion seria
            // justo lo contrario de lo que quiere quien activa esto.
            Some(vec!["--minimized"]),
        ))
        .setup(|app| {
            // El hilo de audio arranca con la app y vive hasta que se cierra.
            let handle = AudioHandle::spawn(app.handle().clone());
            app.manage(handle);

            let watcher = ProcessWatcher::spawn(app.handle().clone());
            app.manage(watcher);

            app.manage(Hud::new());
            app.manage(crate::audio::boosts::Boosts::new());

            // Si la ultima vez Sonora se cerro de golpe con algo amplificado,
            // esa aplicacion sigue en el 2%. Se devuelve antes de nada.
            std::thread::spawn(|| {
                let _com = crate::audio::ComGuard::new();
                crate::audio::boosts::recupera_tras_cierre();
            });

            system::tray::build(app.handle())?;

            // Prueba del aviso flotante al arrancar, solo en desarrollo: sin
            // ella habria que pulsar un atajo a mano en cada ciclo de depuracion.
            #[cfg(debug_assertions)]
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    if let Some(hud) = handle.try_state::<Hud>() {
                        hud.flash(
                            &handle,
                            crate::system::hud::HudPayload {
                                name: "Prueba del aviso".into(),
                                icon: "🔧".into(),
                                accent: "#38bdf8".into(),
                            },
                        );
                    }
                });
            }

            // Arranque con Windows: la aplicacion se lanza con --minimized y se
            // queda solo en la bandeja. Abrir una ventana en cada inicio de
            // sesion seria justo lo que no quiere quien activa esa opcion.
            if std::env::args().any(|arg| arg == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Cerrar la ventana esconde la app en la bandeja en vez de
                // matarla: si el proceso muriera, se irian con el los atajos
                // globales y el ducking, que es justo lo que tiene que seguir
                // funcionando mientras juegas. Para salir de verdad esta la
                // opcion "Salir" del menu de la bandeja.
                api.prevent_close();
                let _ = window.hide();

                // Escondida no hay medidores que mirar: paramos el muestreo.
                if let Some(audio) = window.app_handle().try_state::<AudioHandle>() {
                    audio.set_polling(false);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sessions,
            commands::set_app_volume,
            commands::set_app_mute,
            commands::get_master_volume,
            commands::set_master_volume,
            commands::get_app_icon,
            commands::set_app_boost,
            commands::list_boosts,
            commands::clear_boosts,
            commands::set_ducking,
            commands::flash_hud,
            commands::list_devices,
            commands::set_watched_processes,
            commands::list_open_apps,
            commands::set_tray_modes,
            commands::set_listen_patterns,
            commands::set_polling,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar la aplicacion");
}
