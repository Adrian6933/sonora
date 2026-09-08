use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use windows::core::PWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

/// La ruta de un proceso no cambia mientras vive, y el hilo de medidores
/// enumera 20 veces por segundo. Sin cache serian cientos de OpenProcess por
/// segundo para obtener siempre lo mismo.
///
/// Windows reutiliza PIDs, asi que la entrada se invalida cuando la sesion de
/// audio de ese PID desaparece (ver `forget_missing`).
fn cache() -> &'static Mutex<HashMap<u32, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<u32, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Igual que `process_path` pero memoizado.
pub fn process_path_cached(pid: u32) -> Option<String> {
    if let Ok(map) = cache().lock() {
        if let Some(hit) = map.get(&pid) {
            return hit.clone();
        }
    }

    let path = process_path(pid);

    if let Ok(mut map) = cache().lock() {
        map.insert(pid, path.clone());
    }

    path
}

/// Olvida los PIDs que ya no aparecen entre las sesiones vivas, para que
/// Windows pueda reutilizar el numero sin que nos quedemos con la ruta vieja.
pub fn forget_missing(alive: &[u32]) {
    if let Ok(mut map) = cache().lock() {
        map.retain(|pid, _| alive.contains(pid));
    }
}

/// Ruta completa del ejecutable de un proceso: "C:\\...\\Discord.exe".
///
/// Usamos PROCESS_QUERY_LIMITED_INFORMATION en vez de PROCESS_QUERY_INFORMATION
/// porque el primero funciona sin privilegios elevados contra casi cualquier
/// proceso. Aun asi puede fallar con procesos protegidos: devolvemos None y ya.
pub fn process_path(pid: u32) -> Option<String> {
    if pid == 0 {
        return None;
    }

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut len,
        );

        let _ = CloseHandle(handle);
        result.ok()?;

        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// "C:\\Program Files\\Discord\\Discord.exe" -> "Discord.exe"
pub fn exe_name(path: &str) -> String {
    path.rsplit(['\\', '/'])
        .next()
        .unwrap_or(path)
        .to_string()
}

/// "Discord.exe" -> "Discord". Lo que se ensena en la UI.
pub fn display_name(exe: &str) -> String {
    let stem = exe.strip_suffix(".exe").unwrap_or(exe);
    if stem.is_empty() {
        return exe.to_string();
    }

    // Muchos ejecutables van en minuscula ("chrome.exe"). Capitalizamos la
    // primera letra para que no cante en la interfaz.
    let mut chars = stem.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => stem.to_string(),
    }
}
