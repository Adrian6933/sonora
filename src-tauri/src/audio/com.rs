use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

/// Inicializa COM en el hilo actual y lo desinicializa al salir de scope.
///
/// Los objetos COM de Core Audio NO son thread-safe: cada hilo que quiera
/// tocarlos necesita su propia inicializacion. Por eso todo el acceso al audio
/// vive en un unico hilo con su propio guard (ver `com_thread.rs`).
pub struct ComGuard;

impl ComGuard {
    pub fn new() -> Self {
        unsafe {
            // Devuelve S_FALSE si COM ya estaba inicializado en este hilo,
            // que para nosotros es igual de valido que S_OK.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        Self
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}
