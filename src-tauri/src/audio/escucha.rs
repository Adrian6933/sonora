//! Lo que reproduce DE VERDAD cada aplicacion que dispara el ducking.
//!
//! El medidor de sesion de Windows no es fiable para esto. Medido con el Discord
//! de Adrian durante 12 segundos: en 99 de 121 muestras Discord no reproducia
//! nada, y aun asi su medidor marcaba; en 91 de ellas era identico al sonido de
//! todo el ordenador, con reflejos de hasta 0,32. Eso bajaba la musica sin que
//! nadie hablara, y ningun umbral lo arregla porque el reflejo es tan fuerte
//! como la musica que refleja.
//!
//! La captura por proceso, en cambio, entrega solo lo que ese proceso manda a
//! los altavoces. Cuando Discord sonaba de verdad, captura y medidor coincidian;
//! cuando solo reflejaba, la captura daba 0,0000. Asi que para los disparadores
//! se escucha la captura, y el medidor queda solo como plan B si la captura no
//! arranca.
//!
//! Cada escucha es un hilo que acumula el pico mas alto desde la ultima vez que
//! se lo pidieron. Es la misma idea que `GetPeakValue`, pero con un solo lector
//! posible, asi que nadie puede robarle las muestras a nadie.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator,
    MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT,
};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject};

use super::boost::{captura_de_proceso, Descom, LiberaFormato};
use super::sessions::Result;

const ARRANCANDO: u8 = 0;
const FUNCIONANDO: u8 = 1;
const FALLIDA: u8 = 2;

/// En que punto esta una escucha.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Estado {
    /// Todavia activandose. Dura unas decenas de milisegundos.
    Arrancando,
    /// Entregando audio real.
    Funcionando,
    /// Windows no la dejo abrir. Hay que tirar del medidor de siempre.
    Fallida,
}

struct Escucha {
    pico: Arc<AtomicU32>,
    estado: Arc<AtomicU8>,
    parar: Arc<AtomicBool>,
    hilo: Option<JoinHandle<()>>,
}

impl Escucha {
    /// Arranca sin esperar: la activacion va en su propio hilo para no frenar
    /// el tick del hilo de audio, que corre veinte veces por segundo.
    fn start(pid: u32) -> Self {
        let pico = Arc::new(AtomicU32::new(0));
        let estado = Arc::new(AtomicU8::new(ARRANCANDO));
        let parar = Arc::new(AtomicBool::new(false));

        let hilo = {
            let pico = Arc::clone(&pico);
            let estado = Arc::clone(&estado);
            let parar = Arc::clone(&parar);
            std::thread::Builder::new()
                .name(format!("sonora-escucha-{pid}"))
                .spawn(move || {
                    if bucle(pid, &pico, &estado, &parar).is_err() {
                        estado.store(FALLIDA, Ordering::Relaxed);
                    }
                })
                .ok()
        };

        if hilo.is_none() {
            estado.store(FALLIDA, Ordering::Relaxed);
        }

        Self {
            pico,
            estado,
            parar,
            hilo,
        }
    }

    fn estado(&self) -> Estado {
        match self.estado.load(Ordering::Relaxed) {
            FUNCIONANDO => Estado::Funcionando,
            FALLIDA => Estado::Fallida,
            _ => Estado::Arrancando,
        }
    }

    /// Pico mas alto desde la ultima llamada, y lo pone a cero.
    fn toma_pico(&self) -> f32 {
        f32::from_bits(self.pico.swap(0, Ordering::Relaxed))
    }
}

impl Drop for Escucha {
    fn drop(&mut self) {
        self.parar.store(true, Ordering::Relaxed);
        if let Some(hilo) = self.hilo.take() {
            let _ = hilo.join();
        }
    }
}

fn bucle(pid: u32, pico: &AtomicU32, estado: &AtomicU8, parar: &AtomicBool) -> Result<()> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let _guardia = Descom;

        let enumerador: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dispositivo = enumerador.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let temporal: IAudioClient = dispositivo.Activate(CLSCTX_ALL, None)?;
        let formato = temporal.GetMixFormat()?;
        let _libera = LiberaFormato(formato);
        let canales = (*formato).nChannels as usize;

        let captura = captura_de_proceso(pid, formato)?;
        let evento = CreateEventW(None, false, false, None)?;
        captura.SetEventHandle(evento)?;
        let lector: IAudioCaptureClient = captura.GetService()?;
        captura.Start()?;
        estado.store(FUNCIONANDO, Ordering::Relaxed);

        while !parar.load(Ordering::Relaxed) {
            WaitForSingleObject(evento, 100);

            let mut local = 0.0_f32;
            loop {
                if lector.GetNextPacketSize()? == 0 {
                    break;
                }
                let mut datos: *mut u8 = std::ptr::null_mut();
                let mut cuadros = 0u32;
                let mut banderas = 0u32;
                lector.GetBuffer(&mut datos, &mut cuadros, &mut banderas, None, None)?;

                if banderas & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 && !datos.is_null() {
                    let muestras = std::slice::from_raw_parts(
                        datos as *const f32,
                        cuadros as usize * canales,
                    );
                    for muestra in muestras {
                        local = local.max(muestra.abs());
                    }
                }

                lector.ReleaseBuffer(cuadros)?;
            }

            if local > 0.0 {
                // Acumular el maximo hasta que el hilo de audio lo recoja. Si
                // se pisara, un golpe entre dos lecturas se perderia.
                let _ = pico.fetch_update(Ordering::Relaxed, Ordering::Relaxed, |anterior| {
                    Some(f32::from_bits(anterior).max(local).to_bits())
                });
            }
        }

        let _ = captura.Stop();
        let _ = CloseHandle(evento);
        Ok(())
    }
}

/// Las escuchas en marcha, una por PID. Vive dentro del hilo de audio.
#[derive(Default)]
pub struct Escuchas {
    activas: HashMap<u32, Escucha>,
}

impl Escuchas {
    /// Deja escuchando exactamente estos PIDs: arranca los nuevos y suelta los
    /// que ya no hacen falta.
    pub fn sincroniza(&mut self, pids: &HashSet<u32>) {
        self.activas.retain(|pid, _| pids.contains(pid));
        for pid in pids {
            self.activas.entry(*pid).or_insert_with(|| Escucha::start(*pid));
        }
    }

    /// Lo que ha reproducido de verdad este PID desde la ultima vez.
    ///
    /// `None` si no se esta escuchando o la captura fallo: entonces hay que
    /// quedarse con el medidor normal. Mientras arranca devuelve cero, porque
    /// usar el medidor esos milisegundos es justo dejar pasar el reflejo.
    pub fn pico_real(&self, pid: u32) -> Option<f32> {
        let escucha = self.activas.get(&pid)?;
        match escucha.estado() {
            Estado::Funcionando => Some(escucha.toma_pico()),
            Estado::Arrancando => Some(0.0),
            Estado::Fallida => None,
        }
    }
}
