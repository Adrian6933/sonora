//! Icono de bandeja.
//!
//! La app esta pensada para vivir aqui: cerrar la ventana solo la esconde, y es
//! desde este icono desde donde se vuelve a abrir o se sale de verdad.
//!
//! El menu tambien deja cambiar de modo sin abrir la ventana. Con un juego a
//! pantalla completa, sacar Sonora para pulsar un modo es justo lo que no se
//! quiere hacer; dos clics en la bandeja si.

use serde::Deserialize;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::audio::com_thread::AudioHandle;

const ID_BANDEJA: &str = "main";
const PREFIJO_MODO: &str = "modo:";

/// Lo minimo de un modo que necesita el menu.
#[derive(Debug, Clone, Deserialize)]
pub struct ModoEnBandeja {
    pub id: String,
    pub name: String,
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = menu(app, &[], None)?;

    let mut builder = TrayIconBuilder::with_id(ID_BANDEJA)
        .tooltip("Sonora")
        .menu(&menu)
        // En Windows lo normal es que el clic izquierdo abra la app y el
        // derecho saque el menu.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let id = event.id.as_ref();

            if let Some(modo) = id.strip_prefix(PREFIJO_MODO) {
                // Quien sabe aplicar un modo es la interfaz: tiene las reglas,
                // el aviso flotante y la automatizacion. Aqui solo se le avisa.
                let _ = app.emit("tray-mode", Some(modo.to_string()));
                return;
            }

            match id {
                "show" => reveal(app),
                "sin-modo" => {
                    let _ = app.emit("tray-mode", None::<String>);
                }
                "reset" => {
                    let _ = app.emit("tray-reset", ());
                }
                "quit" => {
                    // Antes de morir hay que deshacer la atenuacion, o las
                    // aplicaciones se quedan bajadas sin nadie que las suba.
                    if let Some(audio) = app.try_state::<AudioHandle>() {
                        let _ = audio.release_ducking();
                    }
                    // Lo mismo con la amplificacion, y con mas motivo: una
                    // aplicacion amplificada tiene su volumen real en un 2%, y
                    // salir sin devolverlo la dejaria practicamente muda.
                    if let Some(boosts) = app.try_state::<crate::audio::boosts::Boosts>() {
                        boosts.clear();
                    }
                    app.exit(0);
                }
                _ => {}
            }
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

/// Rehace el menu con los modos que haya y marca el activo.
///
/// Se llama cada vez que cambian los modos o el activo. Rehacerlo entero es
/// mas simple que ir tocando elementos sueltos, y son una docena de lineas.
pub fn actualiza<R: Runtime>(
    app: &AppHandle<R>,
    modos: &[ModoEnBandeja],
    activo: Option<&str>,
) -> tauri::Result<()> {
    let Some(bandeja) = app.tray_by_id(ID_BANDEJA) else {
        return Ok(());
    };

    let nuevo = menu(app, modos, activo)?;
    bandeja.set_menu(Some(nuevo))?;

    let tooltip = match activo.and_then(|id| modos.iter().find(|m| m.id == id)) {
        Some(modo) => format!("Sonora · {}", modo.name),
        None => "Sonora".to_string(),
    };
    bandeja.set_tooltip(Some(tooltip))?;
    Ok(())
}

fn menu<R: Runtime>(
    app: &AppHandle<R>,
    modos: &[ModoEnBandeja],
    activo: Option<&str>,
) -> tauri::Result<Menu<R>> {
    let menu = Menu::new(app)?;

    menu.append(&MenuItem::with_id(app, "show", "Mostrar Sonora", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;

    if !modos.is_empty() {
        for modo in modos {
            let marcado = activo == Some(modo.id.as_str());
            menu.append(&CheckMenuItem::with_id(
                app,
                format!("{PREFIJO_MODO}{}", modo.id),
                &modo.name,
                true,
                marcado,
                None::<&str>,
            )?)?;
        }
        menu.append(&CheckMenuItem::with_id(
            app,
            "sin-modo",
            "Sin modo",
            true,
            activo.is_none(),
            None::<&str>,
        )?)?;
        menu.append(&PredefinedMenuItem::separator(app)?)?;
    }

    menu.append(&MenuItem::with_id(app, "reset", "Todo al 100%", true, None::<&str>)?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?)?;

    Ok(menu)
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
