//! Icono de bandeja.
//!
//! La app esta pensada para vivir aqui: cerrar la ventana solo la esconde, y es
//! desde este icono desde donde se vuelve a abrir o se sale de verdad.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Runtime};

use crate::audio::com_thread::AudioHandle;

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Mostrar Sonora", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Sonora")
        .menu(&menu)
        // En Windows lo normal es que el clic izquierdo abra la app y el
        // derecho saque el menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => reveal(app),
            "quit" => {
                // Antes de morir hay que deshacer la atenuacion, o las
                // aplicaciones se quedan bajadas sin nadie que las suba.
                if let Some(audio) = app.try_state::<AudioHandle>() {
                    let _ = audio.release_ducking();
                }
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Saca la ventana al frente y vuelve a encender el muestreo de niveles.
fn reveal<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }

    if let Some(audio) = app.try_state::<AudioHandle>() {
        audio.set_polling(true);
    }
}
