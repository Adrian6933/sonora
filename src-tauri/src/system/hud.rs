//! Aviso flotante al cambiar de modo.
//!
//! Sin esto los atajos globales son de fe: pulsas Ctrl+Alt+1 con el juego en
//! primer plano y no tienes ninguna senal de que haya pasado algo. La ventana
//! `hud` aparece un segundo y medio en la esquina y se va sola.
//!
//! Es una ventana aparte, no un toast dentro de la aplicacion, porque el caso
//! de uso es justamente tener la ventana principal escondida en la bandeja.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalPosition, Manager, Runtime};

/// Cuanto se queda en pantalla.
const VISIBLE_MS: u64 = 2200;

/// Margen respecto a la esquina inferior derecha.
const MARGIN: f64 = 24.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HudPayload {
    pub name: String,
    pub icon: String,
    pub accent: String,
}

#[derive(Default)]
pub struct Hud {
    /// Cada aviso incrementa esto. El hilo que esconde comprueba que sigue
    /// siendo el ultimo: si mientras tanto has cambiado de modo otra vez, el
    /// suyo ya no vale y no debe esconder el aviso nuevo.
    generation: Arc<AtomicU64>,
}

impl Hud {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn flash<R: Runtime>(&self, app: &AppHandle<R>, payload: HudPayload) {
        let Some(window) = app.get_webview_window("hud") else {
            eprintln!("[hud] no existe la ventana 'hud'");
            return;
        };

        // Que los clics atraviesen el aviso: esta encima de todo y no debe
        // comerse un disparo en mitad de una partida.
        let _ = window.set_ignore_cursor_events(true);

        position_bottom_right(&window);

        if let Err(error) = window.emit_to("hud", "hud", &payload) {
            eprintln!("[hud] fallo al emitir: {error}");
        }
        if let Err(error) = window.show() {
            eprintln!("[hud] fallo al mostrar: {error}");
        }
        let _ = window.set_always_on_top(true);

        eprintln!(
            "[hud] flash '{}' visible={:?} pos={:?} size={:?}",
            payload.name,
            window.is_visible(),
            window.outer_position(),
            window.outer_size()
        );

        let generation = Arc::clone(&self.generation);
        let mine = generation.fetch_add(1, Ordering::SeqCst) + 1;

        thread::spawn(move || {
            // Segundo envio de cortesia. El primero se pierde si el webview del
            // aviso todavia no tenia su listener puesto (recien arrancado, o
            // recargado en desarrollo); entonces la ventana se ensena vacia,
            // que es exactamente "no aparece nada". Reenviar es inofensivo: el
            // componente pinta lo mismo.
            thread::sleep(Duration::from_millis(120));
            if generation.load(Ordering::SeqCst) == mine {
                let _ = window.emit_to("hud", "hud", &payload);
            }

            thread::sleep(Duration::from_millis(VISIBLE_MS - 120));
            if generation.load(Ordering::SeqCst) == mine {
                let _ = window.hide();
            }
        });
    }
}

fn position_bottom_right<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };

    let scale = monitor.scale_factor();
    let screen = monitor.size().to_logical::<f64>(scale);
    let Ok(size) = window.outer_size() else { return };
    let size = size.to_logical::<f64>(scale);

    let _ = window.set_position(LogicalPosition::new(
        screen.width - size.width - MARGIN,
        screen.height - size.height - MARGIN * 3.0,
    ));
}
