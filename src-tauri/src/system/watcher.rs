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
