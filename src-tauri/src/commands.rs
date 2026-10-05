//! Comandos que expone el backend al frontend.
//!
//! Son deliberadamente finos: validan poco y delegan en el hilo de audio.

use tauri::{Manager, State};

use crate::audio::boosts::{BoostInfo, Boosts};
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

/// Programas abiertos ahora mismo, para el selector del editor de modos.
///
/// Se piden bajo demanda y no por evento: la lista solo hace falta mientras
/// alguien tiene el selector abierto.
#[tauri::command]
pub async fn list_open_apps() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(crate::system::watcher::aplicaciones_abiertas)
        .await
        .unwrap_or_default()
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

/// Amplifica una aplicacion por encima del 100% de Windows.
///
/// `gain` es un multiplicador; con 1.0 se apaga y la aplicacion recupera su
/// volumen. Mientras esta activo, esa aplicacion suena a traves de Sonora, asi
/// que su volumen en el mezclador de Windows deja de mandar.
#[tauri::command]
pub async fn set_app_boost(app: tauri::AppHandle, pid: u32, gain: f32) -> Result<(), String> {
    // En segundo plano a proposito. Arrancar una amplificacion comprueba la
    // captura durante algo mas de un segundo, y una orden sincrona de Tauri
    // corre en el hilo principal: la ventana se quedaba congelada ese rato.
    tauri::async_runtime::spawn_blocking(move || app.state::<Boosts>().set(pid, gain))
        .await
        .map_err(|error| error.to_string())?
}

/// Las amplificaciones en marcha, con su nivel de entrada para el medidor.
///
/// Tambien en segundo plano: mientras otra amplificacion arranca, el registro
/// esta ocupado, y esperar aqui congelaria la ventana igual.
#[tauri::command]
pub async fn list_boosts(app: tauri::AppHandle) -> Vec<BoostInfo> {
    tauri::async_runtime::spawn_blocking(move || app.state::<Boosts>().list())
        .await
        .unwrap_or_default()
}

/// Apaga todas las amplificaciones. Lo usa el boton de "todo al 100%".
#[tauri::command]
pub fn clear_boosts(boosts: State<Boosts>) {
    boosts.clear();
}

/// Pone los modos en el menu de la bandeja y marca el activo.
#[tauri::command]
pub fn set_tray_modes(
    app: tauri::AppHandle,
    modes: Vec<crate::system::tray::ModoEnBandeja>,
    active: Option<String>,
) -> Result<(), String> {
    crate::system::tray::actualiza(&app, &modes, active.as_deref()).map_err(|e| e.to_string())
}

/// Aplicaciones a escuchar de verdad para el medidor del editor de prioridad.
#[tauri::command]
pub fn set_listen_patterns(audio: State<AudioHandle>, patterns: Vec<String>) {
    audio.set_listen_patterns(patterns);
}

/// El frontend avisa cuando la ventana deja de verse para parar el muestreo.
#[tauri::command]
pub fn set_polling(audio: State<AudioHandle>, enabled: bool) {
    audio.set_polling(enabled);
}
