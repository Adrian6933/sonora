//! Vigilante de procesos.
//!
//! Sirve para que un modo se active solo al abrir un juego. Solo informamos de
//! los ejecutables que alguien ha pedido vigilar: enumerar procesos es barato,
//! pero mandar los ~300 que hay abiertos al frontend cada dos segundos no.

use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};

/// Cada cuanto se mira. Dos segundos es de sobra para "he abierto el juego" y
/// no se nota en la CPU.
const INTERVAL: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct ProcessWatcher {
    /// Ejecutables a vigilar, en minusculas.
    watch: Arc<Mutex<HashSet<String>>>,
}

impl ProcessWatcher {
    pub fn spawn(app: AppHandle) -> Self {
        let watch: Arc<Mutex<HashSet<String>>> = Arc::new(Mutex::new(HashSet::new()));
        let thread_watch = Arc::clone(&watch);

        thread::Builder::new()
            .name("sonora-watcher".into())
            .spawn(move || {
                let mut previous: Vec<String> = Vec::new();

                loop {
                    thread::sleep(INTERVAL);

                    let wanted = match thread_watch.lock() {
                        Ok(guard) => guard.clone(),
                        Err(_) => break,
                    };

                    if wanted.is_empty() {
                        if !previous.is_empty() {
                            previous.clear();
                            let _ = app.emit("processes", &previous);
                        }
                        continue;
                    }

                    let running = running_processes();
                    let mut current: Vec<String> = wanted
                        .iter()
                        .filter(|name| running.contains(*name))
                        .cloned()
                        .collect();
                    current.sort();

                    // Solo avisamos cuando cambia de verdad.
                    if current != previous {
                        previous = current;
                        let _ = app.emit("processes", &previous);
                    }
                }
            })
            .expect("no se pudo crear el hilo vigilante");

        Self { watch }
    }

    pub fn set_watched(&self, names: Vec<String>) {
        if let Ok(mut guard) = self.watch.lock() {
            *guard = names.into_iter().map(|n| n.to_lowercase()).collect();
        }
    }
}

/// Programas abiertos ahora mismo, con su nombre tal cual lo ve Windows.
///
/// Para el selector del editor de modos: escribir "VALORANT.exe" a mano es
/// justo lo que nadie deberia tener que hacer. Se queda solo con lo que parece
/// una aplicacion de verdad; el resto es ruido del sistema que llenaria la
/// lista sin aportar nada.
pub fn aplicaciones_abiertas() -> Vec<String> {
    let mut nombres: Vec<String> = Vec::new();
    let mut vistos = HashSet::new();

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return nombres;
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let fin = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                let nombre = String::from_utf16_lossy(&entry.szExeFile[..fin]);

                if es_aplicacion(&nombre) && vistos.insert(nombre.to_lowercase()) {
                    nombres.push(nombre);
                }

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    nombres.sort_by_key(|n| n.to_lowercase());
    nombres
}

/// Filtro de ruido del sistema.
///
/// No pretende ser exacto: vale con quitar lo que todo el mundo tiene abierto y
/// nadie querria usar como disparador. Si se cuela alguno de mas, el buscador
/// del selector lo tapa.
fn es_aplicacion(nombre: &str) -> bool {
    const SISTEMA: &[&str] = &[
        "svchost.exe",
        "dllhost.exe",
        "conhost.exe",
        "csrss.exe",
        "wininit.exe",
        "winlogon.exe",
        "services.exe",
        "lsass.exe",
        "smss.exe",
        "fontdrvhost.exe",
        "dwm.exe",
        "sihost.exe",
        "taskhostw.exe",
        "ctfmon.exe",
        "runtimebroker.exe",
        "searchhost.exe",
        "startmenuexperiencehost.exe",
        "shellexperiencehost.exe",
        "applicationframehost.exe",
        "systemsettings.exe",
        "registry",
        "memory compression",
        "system",
        "idle",
        "audiodg.exe",
        "spoolsv.exe",
        "wmiprvse.exe",
        "backgroundtaskhost.exe",
        "crashpad_handler.exe",
        "textinputhost.exe",
        "widgets.exe",
        "widgetservice.exe",
        "lockapp.exe",
        "useroobebroker.exe",
        "wudfhost.exe",
        "nissrv.exe",
        "msmpeng.exe",
        "securityhealthservice.exe",
        "securityhealthsystray.exe",
    ];

    let bajo = nombre.to_lowercase();
    !SISTEMA.contains(&bajo.as_str()) && bajo.ends_with(".exe")
}

/// Nombres de ejecutable de todos los procesos, en minusculas.
pub fn running_processes() -> HashSet<String> {
    let mut names = HashSet::new();

    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
            return names;
        };

        let mut entry = PROCESSENTRY32W {
            dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };

        if Process32FirstW(snapshot, &mut entry).is_ok() {
            loop {
                let end = entry
                    .szExeFile
                    .iter()
                    .position(|c| *c == 0)
                    .unwrap_or(entry.szExeFile.len());
                names.insert(String::from_utf16_lossy(&entry.szExeFile[..end]).to_lowercase());

                if Process32NextW(snapshot, &mut entry).is_err() {
                    break;
                }
            }
        }

        let _ = CloseHandle(snapshot);
    }

    names
}
