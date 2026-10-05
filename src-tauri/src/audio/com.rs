use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

/// Inicializa COM en el hilo actual y lo desinicializa al salir de scope.
///
/// Los objetos COM de Core Audio NO son thread-safe: cada hilo que quiera
/// tocarlos necesita su propia inicializacion. Por eso todo el acceso al audio
/// vive en un unico hilo con su propio guard (ver `com_thread.rs`).
pub struct ComGuard {
    /// Si fuimos NOSOTROS quienes inicializamos COM en este hilo.
    ///
    /// Importa en los hilos reutilizados, como el pool de `spawn_blocking`: si
    /// el hilo ya venia en otro apartamento, `CoInitializeEx` falla y llamar
    /// igualmente a `CoUninitialize` desharia la inicializacion de otro. El
    /// sintoma es de los malos: cosas que funcionan sueltas y fallan dentro de
    /// la aplicacion, sin error, y solo a veces.
    nuestro: bool,
}

impl ComGuard {
    pub fn new() -> Self {
        // S_FALSE significa que ya estaba inicializado en este hilo con el
        // mismo modelo: cuenta como exito y hay que soltarlo igual.
        let resultado = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        Self {
            nuestro: resultado.is_ok(),
        }
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.nuestro {
            unsafe { CoUninitialize() };
        }
    }
}
