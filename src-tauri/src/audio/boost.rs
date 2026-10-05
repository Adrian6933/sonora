//! Subir una aplicacion por encima del 100% que permite Windows.
//!
//! `ISimpleAudioVolume` esta topado en 1.0 y no hay manera de pasar de ahi: no
//! es una decision nuestra, es la API. Lo que si se puede desde Windows 10 2004
//! es capturar el audio de UN proceso concreto, multiplicarlo aqui y volver a
//! reproducirlo.
//!
//! Tres cosas se descubrieron midiendo, y las tres condicionan el diseño:
//!
//! 1. La captura entrega el audio DESPUES del volumen de la sesion. Silenciar
//!    la aplicacion original para no oirla dos veces no funciona: lo que llega
//!    entonces es silencio. Por eso la dejamos sonando a un 2%, inaudible al
//!    lado de nuestra copia, y compensamos ese 2% en la ganancia.
//! 2. La captura hay que pedirla en el formato nativo del dispositivo. Pidiendo
//!    estereo en unos auriculares 7.1, Windows mezcla los ocho canales en dos y
//!    la señal llega casi cinco veces mas floja.
//! 3. El `PROPVARIANT` de la activacion no se puede dejar caer. Ver el
//!    comentario en `captura_de_proceso`.
//!
//! Lo que cuesta: unos milisegundos de retardo, y un limitador obligatorio.
//! Multiplicar una señal que ya llega cerca del maximo sin limitar no sube el
//! volumen, solo mete distorsion.

use std::mem::ManuallyDrop;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;

use windows::core::{implement, Interface, Ref, IUnknown, HRESULT};
use windows::Win32::Foundation::{CloseHandle, HANDLE};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, ActivateAudioInterfaceAsync, IActivateAudioInterfaceAsyncOperation,
    IActivateAudioInterfaceCompletionHandler, IActivateAudioInterfaceCompletionHandler_Impl,
    IAudioCaptureClient, IAudioClient, IAudioRenderClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
    AUDCLNT_STREAMFLAGS_LOOPBACK, AUDIOCLIENT_ACTIVATION_PARAMS, AUDIOCLIENT_ACTIVATION_PARAMS_0,
    AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK, AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS,
    PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE, VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
    WAVEFORMATEX,
};
use windows::Win32::System::Com::StructuredStorage::{
    PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, BLOB, CLSCTX_ALL,
    COINIT_MULTITHREADED,
};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject};
use windows::Win32::System::Variant::VT_BLOB;

use super::sessions::Result;

/// Maximo que dejamos pedir. Por encima de esto ya no se gana volumen real,
/// solo se aplasta la señal contra el limitador.
pub const MAX_BOOST: f32 = 4.0;

/// Volumen al que se queda la aplicacion original mientras la amplificamos.
///
/// No puede ser cero: la captura va despues del volumen y a cero no llega nada
/// que amplificar. Un 2% queda 34 dB por debajo de nuestra copia, o sea
/// inaudible, y en coma flotante no se pierde precision al compensarlo.
/// Comprobado con un tono de 0.2000: al 5% el pico capturado es exactamente
/// 0.0100, al 2% es 0.0040 y al 1% es 0.0020.
pub const SOMBRA: f32 = 0.02;

/// A partir de aqui el limitador comprime en vez de dejar pasar.
const RODILLA: f32 = 0.85;

/// Techo absoluto de la señal.
///
/// Un pelo por debajo del maximo a proposito: nuestra copia se mezcla con el
/// resto del sistema y llegar clavado al tope no deja margen para nadie mas.
const TECHO: f32 = 0.995;

/// Por encima de esto damos por hecho que la captura funciona.
///
/// Muy bajo a proposito: lo que separa "esta funcionando" de "no llega nada" no
/// es el volumen, es que llegue algo. Medido en la maquina de pruebas, una
/// aplicacion que no se puede capturar entrega picos de 0.002 o menos aunque su
/// propio medidor marque 0.4.
const UMBRAL_CAPTURA: f32 = 0.005;

/// Lo que hay que enseñar de una aplicacion amplificada.
///
/// Mientras amplificamos, su volumen real en Windows esta clavado en SOMBRA.
/// Ese 2% es un detalle de fontaneria: si se enseñara tal cual, el mezclador
/// diria "2%" de algo que se esta oyendo mas alto que nunca. Aqui se guarda lo
/// que el usuario entiende por volumen, y `sessions` lo usa para tapar el 2%.
#[derive(Clone)]
pub struct Visible {
    /// Volumen normal, el del mando de toda la vida (0..1).
    pub base: Arc<AtomicU32>,
    /// Multiplicador de la amplificacion (1..MAX_BOOST).
    pub ganancia: Arc<AtomicU32>,
}

fn visibles() -> &'static std::sync::Mutex<std::collections::HashMap<u32, Visible>> {
    static REGISTRO: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<u32, Visible>>,
    > = std::sync::OnceLock::new();
    REGISTRO.get_or_init(Default::default)
}

/// Lo que hay que enseñar de esta aplicacion, si esta amplificada.
pub fn visible_de(pid: u32) -> Option<Visible> {
    visibles().lock().ok()?.get(&pid).cloned()
}

/// Amplificador en marcha para una aplicacion.
///
/// Mientras vive, un hilo copia el audio de ese proceso, lo sube y lo
/// reproduce. Al soltarlo, todo vuelve a su sitio.
pub struct Boost {
    pid: u32,
    /// Volumen normal que el usuario cree tener. Multiplica a la ganancia.
    base: Arc<AtomicU32>,
    ganancia: Arc<AtomicU32>,
    parar: Arc<AtomicBool>,
    /// (cuadros capturados, cuadros escritos). Si divergen, se esta perdiendo
    /// audio por el camino.
    contadores: Arc<(AtomicU32, AtomicU32)>,
    /// Pico del ultimo bloque capturado, en bits de f32. Instantaneo y no
    /// acumulado: un maximo historico se quedaria clavado en el primer golpe.
    pico_entrada: Arc<AtomicU32>,
    hilo: Option<JoinHandle<()>>,
}

impl Boost {
    /// Arranca la amplificacion de `pid`.
    ///
    /// `ganancia` es un multiplicador: 1.0 deja el sonido igual, 2.0 lo dobla.
    pub fn start(pid: u32, ganancia: f32) -> Result<Self> {
        let volumen_original = super::sessions::list_sessions()?
            .into_iter()
            .find(|sesion| sesion.pid == pid)
            .map(|sesion| sesion.volume)
            .ok_or_else(|| {
                windows::core::Error::new(
                    windows::Win32::Foundation::E_INVALIDARG,
                    "esa aplicacion no tiene sesion de audio",
                )
            })?;

        let ganancia = Arc::new(AtomicU32::new(limpia(ganancia).to_bits()));
        let base = Arc::new(AtomicU32::new(volumen_original.to_bits()));
        let parar = Arc::new(AtomicBool::new(false));
        let contadores = Arc::new((AtomicU32::new(0), AtomicU32::new(0)));
        let pico_entrada = Arc::new(AtomicU32::new(0));

        // El arranque puede fallar por motivos legitimos, por ejemplo que la
        // aplicacion cierre su stream justo ahora. El hilo avisa del resultado
        // antes de ponerse a copiar audio.
        let (aviso, espera) = std::sync::mpsc::channel();

        let hilo = {
            let ganancia = Arc::clone(&ganancia);
            let base = Arc::clone(&base);
            let parar = Arc::clone(&parar);
            let contadores = Arc::clone(&contadores);
            let pico_entrada = Arc::clone(&pico_entrada);
            std::thread::spawn(move || {
                if let Err(error) = bucle(
                    pid,
                    &ganancia,
                    &base,
                    &parar,
                    &aviso,
                    &contadores,
                    &pico_entrada,
                ) {
                    // Si fallo antes de arrancar, el canal se lo lleva; si fallo
                    // despues, ya no hay nadie escuchando.
                    let _ = aviso.send(Err(error));
                }
            })
        };

        match espera.recv_timeout(std::time::Duration::from_secs(5)) {
            Ok(Ok(())) => {
                if let Ok(mut mapa) = visibles().lock() {
                    mapa.insert(
                        pid,
                        Visible {
                            base: Arc::clone(&base),
                            ganancia: Arc::clone(&ganancia),
                        },
                    );
                }

                Ok(Self {
                pid,
                base,
                ganancia,
                parar,
                contadores,
                pico_entrada,
                hilo: Some(hilo),
                })
            }
            Ok(Err(error)) => Err(error),
            Err(_) => {
                parar.store(true, Ordering::Relaxed);
                Err(windows::core::Error::new(
                    windows::Win32::Foundation::E_FAIL,
                    "la amplificacion no arranco a tiempo",
                ))
            }
        }
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn set_gain(&self, ganancia: f32) {
        self.ganancia
            .store(limpia(ganancia).to_bits(), Ordering::Relaxed);
    }

    /// Mueve el volumen normal sin tocar la amplificacion.
    ///
    /// Es lo que pasa al arrastrar el mando del mezclador de una aplicacion que
    /// esta amplificada: lo que cambia es el volumen de siempre, y la
    /// amplificacion sigue multiplicando por encima.
    pub fn set_base(&self, base: f32) {
        self.base
            .store(base.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn base(&self) -> f32 {
        f32::from_bits(self.base.load(Ordering::Relaxed))
    }

    pub fn gain(&self) -> f32 {
        f32::from_bits(self.ganancia.load(Ordering::Relaxed))
    }

    /// (cuadros capturados, cuadros escritos) desde que arranco.
    pub fn caudal(&self) -> (u32, u32) {
        (
            self.contadores.0.load(Ordering::Relaxed),
            self.contadores.1.load(Ordering::Relaxed),
        )
    }

    /// Nivel al que suena de verdad la aplicacion, 0..1.
    ///
    /// Lo que entrega la captura viene multiplicado por SOMBRA; deshacerlo
    /// devuelve el nivel que tendria la aplicacion a volumen normal.
    pub fn nivel_entrada(&self) -> f32 {
        f32::from_bits(self.pico_entrada.load(Ordering::Relaxed)) / SOMBRA
    }
}

impl Drop for Boost {
    fn drop(&mut self) {
        if let Ok(mut mapa) = visibles().lock() {
            mapa.remove(&self.pid);
        }
        self.parar.store(true, Ordering::Relaxed);
        if let Some(hilo) = self.hilo.take() {
            let _ = hilo.join();
        }
        // Devolver la aplicacion a su volumen. Sin esto se quedaria al 2% para
        // siempre y el usuario no tendria forma de adivinar por que.
        // El volumen que se devuelve es el que el usuario dejo en el mando,
        // no el que habia al empezar: si lo movio mientras amplificaba, esa es
        // su ultima palabra.
        let _ = super::sessions::set_session_volume(self.pid, self.base());
    }
}

fn limpia(ganancia: f32) -> f32 {
    if ganancia.is_finite() {
        ganancia.clamp(1.0, MAX_BOOST)
    } else {
        1.0
    }
}

/// Limitador de rodilla suave.
///
/// Por debajo de `RODILLA` no toca nada, asi que el sonido normal pasa intacto.
/// Por encima comprime con una tangente hiperbolica, que nunca llega al techo:
/// es imposible que recorte aunque la ganancia sea absurda.
fn limita(x: f32) -> f32 {
    if x.abs() <= RODILLA {
        return x;
    }
    let margen = TECHO - RODILLA;
    let exceso = (x.abs() - RODILLA) / margen;
    x.signum() * (RODILLA + margen * exceso.tanh())
}

/// Espera a ver si la captura entrega audio de verdad.
///
/// Devuelve `false` solo cuando estamos seguros de que no: la aplicacion suena
/// segun su propio medidor y aun asi no llega nada. Si la aplicacion esta
/// callada no se puede saber, y entonces se da por buena y ya lo vigilara el
/// bucle.
unsafe fn hay_captura(
    lector: &IAudioCaptureClient,
    evento: HANDLE,
    pid: u32,
    canales: usize,
) -> Result<bool> {
    let hasta = std::time::Instant::now() + std::time::Duration::from_millis(1200);
    let mut capturado = 0.0_f32;
    let mut sonaba = 0.0_f32;

    while std::time::Instant::now() < hasta {
        WaitForSingleObject(evento, 100);

        // Lo que dice la propia aplicacion que esta emitiendo. Este medidor va
        // antes del volumen, asi que sigue valiendo pase lo que pase con el.
        if let Ok(sesiones) = super::sessions::list_sessions() {
            if let Some(sesion) = sesiones.iter().find(|s| s.pid == pid) {
                sonaba = sonaba.max(sesion.peak);
            }
        }

        loop {
            if lector.GetNextPacketSize()? == 0 {
                break;
            }
            let mut datos: *mut u8 = std::ptr::null_mut();
            let mut cuadros = 0u32;
            let mut banderas = 0u32;
            lector.GetBuffer(&mut datos, &mut cuadros, &mut banderas, None, None)?;

            if banderas & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 == 0 && !datos.is_null() {
                let muestras =
                    std::slice::from_raw_parts(datos as *const f32, cuadros as usize * canales);
                for muestra in muestras {
                    capturado = capturado.max(muestra.abs());
                }
            }

            lector.ReleaseBuffer(cuadros)?;
        }

        if capturado > UMBRAL_CAPTURA {
            return Ok(true);
        }
    }

    // Si la aplicacion no ha sonado, no hay nada que concluir.
    Ok(sonaba < 0.02)
}

/// Anota un error con el paso en el que ocurrio.
///
/// Un `E_INVALIDARG` a secas no dice nada. Saber que reventó al abrir la
/// captura y no la salida es la diferencia entre arreglarlo y adivinar.
fn paso<T>(que: &str, resultado: Result<T>) -> Result<T> {
    resultado.map_err(|error| {
        windows::core::Error::new(error.code(), format!("{que}: {}", error.message()))
    })
}

// ---------------------------------------------------------------- activacion

/// Recibe el aviso de que la activacion asincrona termino.
///
/// `ActivateAudioInterfaceAsync` no acepta un manejador nulo, asi que hay que
/// implementar la interfaz aunque lo unico que queramos sea esperar.
#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Aviso {
    /// HANDLE crudo: el tipo de windows no es Send y aqui no hace falta.
    evento: isize,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Aviso_Impl {
    fn ActivateCompleted(
        &self,
        _operacion: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        unsafe {
            let _ = SetEvent(HANDLE(self.evento as *mut _));
        }
        Ok(())
    }
}

/// Abre una captura del audio de un proceso y de los que cuelgan de el.
///
/// El arbol de procesos importa: Spotify, Chrome y los juegos modernos reparten
/// el audio en procesos hijos, y apuntar solo al padre no capturaria nada.
pub(crate) unsafe fn captura_de_proceso(pid: u32, formato: *const WAVEFORMATEX) -> Result<IAudioClient> {
    let mut params = AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    };

    // Los parametros viajan dentro de un PROPVARIANT de tipo BLOB. Es feo, pero
    // es la forma que documenta Microsoft.
    //
    // ManuallyDrop a proposito, y no es una mania: soltar este PROPVARIANT
    // corrompe el heap y tumba el proceso con STATUS_HEAP_CORRUPTION. Lleva
    // dentro un puntero a `params`, que vive en la pila, y al liberarlo se
    // intenta devolver al asignador una direccion que nunca salio de el.
    // Comprobado: con el drop mueren tres de tres ejecuciones; sin el, ninguna.
    let pv = ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                wReserved1: 0,
                wReserved2: 0,
                wReserved3: 0,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: &mut params as *mut _ as *mut u8,
                    },
                },
            }),
        },
    });

    let evento = CreateEventW(None, true, false, None)?;
    let aviso: IActivateAudioInterfaceCompletionHandler = Aviso {
        evento: evento.0 as isize,
    }
    .into();

    let operacion: IActivateAudioInterfaceAsyncOperation = ActivateAudioInterfaceAsync(
        VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
        &IAudioClient::IID,
        Some(&*pv as *const PROPVARIANT),
        &aviso,
    )?;

    WaitForSingleObject(evento, 5000);
    let _ = CloseHandle(evento);

    let mut estado = HRESULT(0);
    let mut interfaz: Option<IUnknown> = None;
    operacion.GetActivateResult(&mut estado, &mut interfaz)?;
    estado.ok()?;

    let cliente: IAudioClient = interfaz
        .ok_or_else(|| {
            windows::core::Error::new(
                windows::Win32::Foundation::E_FAIL,
                "la captura por proceso no devolvio cliente",
            )
        })?
        .cast()?;

    // Para captura por proceso, duracion y periodo TIENEN que ir a cero: es el
    // motor de audio quien decide el tamaño del buffer.
    cliente.Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        0,
        0,
        formato,
        None,
    )?;

    // `params` tiene que seguir en pie hasta aqui: el blob guarda su direccion
    // y Windows la lee durante la activacion.
    let _ = &params;

    Ok(cliente)
}

// -------------------------------------------------------------------- bucle

type Canal = std::sync::mpsc::Sender<Result<()>>;

fn bucle(
    pid: u32,
    ganancia: &AtomicU32,
    base: &AtomicU32,
    parar: &AtomicBool,
    aviso: &Canal,
    contadores: &(AtomicU32, AtomicU32),
    pico_entrada: &AtomicU32,
) -> Result<()> {
    unsafe {
        // Hilo propio, apartamento propio.
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let _guardia = Descom;

        let enumerador: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dispositivo = enumerador.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let salida: IAudioClient =
            paso("abrir la salida", dispositivo.Activate(CLSCTX_ALL, None))?;

        // Un unico formato para las dos puntas: el nativo del dispositivo. Asi
        // no hay conversiones por el camino, que es justo donde se perdia nivel.
        let formato = paso("leer el formato de mezcla", salida.GetMixFormat())?;
        let _libera = LiberaFormato(formato);

        let canales = (*formato).nChannels as usize;
        if (*formato).wBitsPerSample != 32 {
            return Err(windows::core::Error::new(
                windows::Win32::Foundation::E_FAIL,
                "el dispositivo no mezcla en coma flotante de 32 bits",
            ));
        }

        // 200 ms de holgura: absorbe un tiron del sistema sin que se note
        // retardo al mover el control.
        paso(
            "preparar la salida",
            salida.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                2_000_000,
                0,
                formato,
                None,
            ),
        )?;

        let evento_salida = CreateEventW(None, false, false, None)?;
        paso(
            "enganchar el evento de salida",
            salida.SetEventHandle(evento_salida),
        )?;

        let render: IAudioRenderClient = paso("obtener el render", salida.GetService())?;
        let hueco_total = salida.GetBufferSize()?;

        let captura = paso(
            "abrir la captura del proceso",
            captura_de_proceso(pid, formato),
        )?;
        let evento_captura = CreateEventW(None, false, false, None)?;
        paso(
            "enganchar el evento de captura",
            captura.SetEventHandle(evento_captura),
        )?;
        let lector: IAudioCaptureClient = paso("obtener el lector", captura.GetService())?;

        paso("arrancar la captura", captura.Start())?;

        // Comprobar que de verdad llega audio ANTES de tocarle el volumen a
        // nadie. Hay aplicaciones que no se pueden capturar: si el sonido va
        // directo al hardware sin pasar por el mezclador del sistema, la
        // captura devuelve silencio. Bajando primero el volumen, el usuario se
        // quedaria sin sonido y sin ninguna pista de por que.
        if !hay_captura(&lector, evento_captura, pid, canales)? {
            let _ = captura.Stop();
            let _ = CloseHandle(evento_captura);
            let _ = CloseHandle(evento_salida);
            return Err(windows::core::Error::new(
                windows::Win32::Foundation::E_FAIL,
                concat!(
                    "Windows no deja capturar el sonido de esta aplicacion. ",
                    "Prueba a cerrarla y volver a abrirla, o a cambiar de salida."
                ),
            ));
        }

        // Ahora si: la original baja a la sombra. Hacerlo antes de arrancar la
        // salida evita que los primeros paquetes, capturados a volumen entero,
        // se multipliquen por 1/SOMBRA y suelten un petardazo.
        let _ = super::sessions::set_session_volume(pid, SOMBRA);
        paso("arrancar la salida", salida.Start())?;

        let _ = aviso.send(Ok(()));

        while !parar.load(Ordering::Relaxed) {
            // Despertar con el reloj de la captura, no con un sleep: es lo que
            // mantiene el retardo bajo y estable.
            WaitForSingleObject(evento_captura, 200);

            // Lo que capturamos viene ya multiplicado por SOMBRA, asi que hay
            // que deshacerlo ademas de aplicar lo que pidio el usuario.
            // base por ganancia: el mando de siempre multiplicado por la
            // amplificacion. Y dividido por SOMBRA, que es lo que ya trae
            // aplicado lo que capturamos.
            let g = f32::from_bits(base.load(Ordering::Relaxed))
                * f32::from_bits(ganancia.load(Ordering::Relaxed))
                / SOMBRA;

            loop {
                if lector.GetNextPacketSize()? == 0 {
                    break;
                }

                let mut datos: *mut u8 = std::ptr::null_mut();
                let mut cuadros = 0u32;
                let mut banderas = 0u32;
                lector.GetBuffer(&mut datos, &mut cuadros, &mut banderas, None, None)?;
                contadores.0.fetch_add(cuadros, Ordering::Relaxed);

                let silencio = banderas & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0;
                let hueco = hueco_total - salida.GetCurrentPadding()?;
                let escribibles = cuadros.min(hueco);

                if escribibles > 0 {
                    let destino = render.GetBuffer(escribibles)?;
                    let muestras = escribibles as usize * canales;
                    let salida_f = std::slice::from_raw_parts_mut(destino as *mut f32, muestras);

                    if silencio || datos.is_null() {
                        salida_f.fill(0.0);
                    } else {
                        let origen = std::slice::from_raw_parts(datos as *const f32, muestras);
                        let mut pico = 0.0_f32;
                        for (hueco, muestra) in salida_f.iter_mut().zip(origen) {
                            pico = pico.max(muestra.abs());
                            *hueco = limita(muestra * g);
                        }
                        pico_entrada.store(pico.to_bits(), Ordering::Relaxed);
                    }

                    render.ReleaseBuffer(escribibles, 0)?;
                    contadores.1.fetch_add(escribibles, Ordering::Relaxed);
                }

                lector.ReleaseBuffer(cuadros)?;
            }
        }

        let _ = captura.Stop();
        let _ = salida.Stop();
        let _ = CloseHandle(evento_captura);
        let _ = CloseHandle(evento_salida);

        Ok(())
    }
}

/// Si cada salida activa admite descarga por hardware.
///
/// Diagnostico, y de los importantes: cuando una aplicacion usa esa descarga,
/// su sonido va directo al hardware sin pasar por el mezclador de Windows, y
/// entonces no hay forma de capturarlo ni de amplificarlo.
pub fn salidas_con_descarga() -> Result<Vec<(String, bool)>> {
    use windows::Win32::Media::Audio::{AudioCategory_Media, IAudioClient2, DEVICE_STATE_ACTIVE};

    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let _guardia = Descom;

        let enumerador: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let coleccion = enumerador.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;

        let mut salida = Vec::new();
        for indice in 0..coleccion.GetCount()? {
            let dispositivo = coleccion.Item(indice)?;
            let nombre = super::devices::friendly_name(&dispositivo)
                .unwrap_or_else(|_| "(sin nombre)".to_string());
            let cliente: IAudioClient2 = dispositivo.Activate(CLSCTX_ALL, None)?;
            let descarga = cliente
                .IsOffloadCapable(AudioCategory_Media)
                .map(|b| b.as_bool())
                .unwrap_or(false);
            salida.push((nombre, descarga));
        }

        Ok(salida)
    }
}

/// Formato en el que mezcla el dispositivo de salida por defecto.
///
/// Diagnostico. Devuelve (frecuencia, canales, bits, wFormatTag, subformato).
///
/// El subformato es lo que de verdad decide si las muestras son coma flotante
/// o enteros: con `WAVE_FORMAT_EXTENSIBLE`, `wFormatTag` no dice nada.
pub fn formato_salida() -> Result<(u32, u16, u16, u16, String)> {
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        let _guardia = Descom;

        let enumerador: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let dispositivo = enumerador.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        let cliente: IAudioClient = dispositivo.Activate(CLSCTX_ALL, None)?;
        let formato = cliente.GetMixFormat()?;
        let _libera = LiberaFormato(formato);

        let subformato = if (*formato).cbSize >= 22 {
            let ext = formato as *const windows::Win32::Media::Audio::WAVEFORMATEXTENSIBLE;
            let guid = std::ptr::addr_of!((*ext).SubFormat).read_unaligned();
            format!("{guid:?}")
        } else {
            "(sin extension)".to_string()
        };

        Ok((
            (*formato).nSamplesPerSec,
            (*formato).nChannels,
            (*formato).wBitsPerSample,
            (*formato).wFormatTag,
            subformato,
        ))
    }
}

/// Compara, en el mismo instante, el medidor de una sesion con lo que ese
/// proceso reproduce de verdad. Diagnostico.
///
/// Devuelve filas (medidor de la sesion, captura del proceso, dispositivo)
/// cada 100 ms. Si el medidor sube y la captura no, lo que marca el medidor no
/// es sonido de esa aplicacion.
pub fn compara_medidor_y_captura(pid: u32, segundos: u64) -> Result<Vec<(f32, f32, f32)>> {
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

        let mut filas = Vec::new();
        let hasta = std::time::Instant::now() + std::time::Duration::from_secs(segundos);
        let mut siguiente = std::time::Instant::now();
        let mut capturado = 0.0_f32;

        while std::time::Instant::now() < hasta {
            WaitForSingleObject(evento, 20);
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
                    for m in muestras {
                        capturado = capturado.max(m.abs());
                    }
                }
                lector.ReleaseBuffer(cuadros)?;
            }

            if std::time::Instant::now() >= siguiente {
                siguiente += std::time::Duration::from_millis(100);
                let medidor = super::sessions::list_sessions()
                    .ok()
                    .and_then(|l| l.into_iter().find(|s| s.pid == pid))
                    .map(|s| s.peak)
                    .unwrap_or(0.0);
                let disp = super::sessions::endpoint_peak().unwrap_or(0.0);
                filas.push((medidor, capturado, disp));
                capturado = 0.0;
            }
        }

        let _ = captura.Stop();
        let _ = CloseHandle(evento);
        Ok(filas)
    }
}

/// Mide el nivel de lo que entrega la captura por proceso.
///
/// Diagnostico, no camino normal. Devuelve (pico, cuadros, paquetes mudos). Es
/// lo que permitio ver que la captura va despues del volumen de la sesion.
pub fn nivel_capturado(pid: u32, segundos: u64) -> Result<(f32, u64, u64)> {
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

        let hasta = std::time::Instant::now() + std::time::Duration::from_secs(segundos);
        let (mut pico, mut total, mut mudos) = (0.0_f32, 0u64, 0u64);

        while std::time::Instant::now() < hasta {
            WaitForSingleObject(evento, 200);
            loop {
                if lector.GetNextPacketSize()? == 0 {
                    break;
                }
                let mut datos: *mut u8 = std::ptr::null_mut();
                let mut cuadros = 0u32;
                let mut banderas = 0u32;
                lector.GetBuffer(&mut datos, &mut cuadros, &mut banderas, None, None)?;

                if banderas & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                    mudos += 1;
                } else if !datos.is_null() {
                    let muestras =
                        std::slice::from_raw_parts(datos as *const f32, cuadros as usize * canales);
                    for muestra in muestras {
                        pico = pico.max(muestra.abs());
                    }
                }
                total += cuadros as u64;
                lector.ReleaseBuffer(cuadros)?;
            }
        }

        let _ = captura.Stop();
        let _ = CloseHandle(evento);
        Ok((pico, total, mudos))
    }
}

/// Deja el apartamento COM al salir del hilo, pase lo que pase.
pub(crate) struct Descom;
impl Drop for Descom {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}

/// `GetMixFormat` reserva con CoTaskMemAlloc y nos toca soltarlo.
pub(crate) struct LiberaFormato(pub(crate) *mut WAVEFORMATEX);
impl Drop for LiberaFormato {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0 as *const _)) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_limitador_no_toca_el_sonido_normal() {
        // Lo importante: por debajo de la rodilla la señal sale identica, asi
        // que amplificar no cambia el timbre del material tranquilo.
        for x in [0.0, 0.1, 0.5, 0.84] {
            assert!((limita(x) - x).abs() < 1e-6, "{x} salio alterado");
        }
    }

    #[test]
    fn el_limitador_nunca_recorta() {
        // Aunque pidamos una barbaridad, nada puede salir fuera de rango: eso es
        // lo que separa "mas alto" de "distorsionado".
        for x in [1.0, 2.0, 8.0, 100.0] {
            assert!(limita(x) <= TECHO, "{x} se salio por arriba");
            assert!(limita(-x) >= -TECHO, "-{x} se salio por abajo");
        }
        // Y sigue siendo monotono: mas entrada nunca da menos salida.
        assert!(limita(2.0) > limita(1.0));
    }

    #[test]
    fn la_ganancia_se_queda_en_rango() {
        assert_eq!(
            limpia(0.2),
            1.0,
            "no dejamos bajar con esto, para eso esta el mezclador"
        );
        assert_eq!(limpia(99.0), MAX_BOOST);
        assert_eq!(limpia(f32::NAN), 1.0);
        assert_eq!(limpia(2.0), 2.0);
    }

    #[test]
    fn la_sombra_se_compensa_entera() {
        // La cadena completa es: original por SOMBRA, que es lo que capturamos,
        // y luego por ganancia/SOMBRA, que es lo que aplicamos. Tiene que dar la
        // ganancia pedida, ni mas ni menos, o el control mentiria.
        for pedida in [1.0_f32, 1.5, 2.0, 4.0] {
            let capturado = 0.3 * SOMBRA;
            let salida = capturado * (pedida / SOMBRA);
            assert!(
                (salida - 0.3 * pedida).abs() < 1e-5,
                "con ganancia {pedida} salio {salida}"
            );
        }
    }
}
