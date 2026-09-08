//! Comandos que expone el backend al frontend.
//!
//! Son deliberadamente finos: validan poco y delegan en el hilo de audio.

use tauri::State;

use crate::audio::com_thread::AudioHandle;
use crate::audio::devices::AudioDevice;
use crate::audio::ducking::DuckingConfig;
use crate::audio::{icons, AudioSession, ComGuard};
use crate::system::hud::{Hud, HudPayload};
use crate::system::watcher::ProcessWatcher;

#[tauri::command]
pub fn list_sessions(audio: State<AudioHandle>) -> Result<Vec<AudioSession>, String> {
    audio.list()
}

#[tauri::command]
pub fn set_app_volume(audio: State<AudioHandle>, pid: u32, volume: f32) -> Result<(), String> {
    audio.set_volume(pid, volume)
}

#[tauri::command]
pub fn set_app_mute(audio: State<AudioHandle>, pid: u32, muted: bool) -> Result<(), String> {
    audio.set_mute(pid, muted)
}

#[tauri::command]
pub fn get_master_volume(audio: State<AudioHandle>) -> Result<f32, String> {
    audio.master()
}

#[tauri::command]
pub fn set_master_volume(audio: State<AudioHandle>, volume: f32) -> Result<(), String> {
    audio.set_master(volume)
}

/// Ensena el aviso flotante de cambio de modo.
#[tauri::command]
pub fn flash_hud(app: tauri::AppHandle, hud: State<Hud>, payload: HudPayload) {
    hud.flash(&app, payload);
}

/// Dispositivos de salida activos, con el nombre que ensena Windows.
#[tauri::command]
pub fn list_devices(audio: State<AudioHandle>) -> Result<Vec<AudioDevice>, String> {
    audio.devices()
}

/// Ejecutables que hay que vigilar para el auto-cambio de modo.
#[tauri::command]
pub fn set_watched_processes(watcher: State<ProcessWatcher>, names: Vec<String>) {
    watcher.set_watched(names);
}

/// Configura el ducking. Se llama al activar un modo.
#[tauri::command]
pub fn set_ducking(audio: State<AudioHandle>, config: DuckingConfig) {
    audio.set_ducking(config);
}

/// Icono de un ejecutable como data URI PNG.
///
/// Va en su propio hilo y NO por el hilo de audio: sacar un icono tarda unos
/// milisegundos y bloquearia el muestreo de niveles. Ademas no toca Core Audio,
/// asi que no necesita ese hilo para nada. El resultado esta cacheado por ruta,
/// asi que solo se paga una vez por aplicacion.
#[tauri::command]
pub async fn get_app_icon(path: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _com = ComGuard::new();
        icons::icon_data_uri(&path)
    })
    .await
    .map_err(|error| error.to_string())
}

/// El frontend avisa cuando la ventana deja de verse para parar el muestreo.
#[tauri::command]
pub fn set_polling(audio: State<AudioHandle>, enabled: bool) {
    audio.set_polling(enabled);
}
