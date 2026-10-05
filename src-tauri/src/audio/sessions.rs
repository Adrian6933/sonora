use serde::Serialize;
use windows::core::Interface;
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioMeterInformation};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateActive, AudioSessionStateExpired, IAudioSessionControl2,
    IAudioSessionManager2, IMMDevice, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};

use super::process::{display_name, exe_name, forget_missing, process_path_cached};

pub type Result<T> = std::result::Result<T, windows::core::Error>;

/// Una aplicacion con audio en el dispositivo de salida por defecto.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSession {
    pub pid: u32,
    /// Nombre para la UI: "Discord"
    pub name: String,
    /// Ejecutable: "Discord.exe" — es la clave con la que casan las reglas
    pub exe: String,
    pub path: String,
    /// 0.0 - 1.0
    pub volume: f32,
    pub muted: bool,
    /// Pico actual 0.0 - 1.0, para el medidor
    pub peak: f32,
    /// false = la app tiene sesion pero no esta emitiendo ahora mismo
    pub active: bool,
    pub is_system: bool,
    /// Multiplicador de amplificacion, 1.0 = sin amplificar.
    pub boost: f32,
    /// Lo que marcaba el medidor de Windows cuando `peak` se ha sustituido por
    /// lo que la aplicacion reproduce de verdad. La diferencia es reflejo.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meter_peak: Option<f32>,
}

/// Dispositivo de salida por defecto (rol Multimedia).
fn default_output_device() -> Result<IMMDevice> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)
    }
}

/// Sesiones de audio de CADA dispositivo de salida activo.
///
/// Diagnostico. Sirve para responder a "esta aplicacion aparece en el
/// mezclador pero no se oye": lo normal es que este reproduciendo en otra
/// salida distinta de la predeterminada.
pub fn sessions_por_dispositivo() -> Result<Vec<(String, f32, Vec<AudioSession>)>> {
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let coleccion = enumerator.EnumAudioEndpoints(
            eRender,
            windows::Win32::Media::Audio::DEVICE_STATE_ACTIVE,
        )?;

        let mut salida = Vec::new();
        for indice in 0..coleccion.GetCount()? {
            let dispositivo = coleccion.Item(indice)?;
            let nombre = super::devices::friendly_name(&dispositivo)
                .unwrap_or_else(|_| "(sin nombre)".to_string());
            // El pico del propio dispositivo: es lo que de verdad sale por ahi,
            // y comparado con el de cada sesion dice si el sonido esta llegando.
            let pico = dispositivo
                .Activate::<IAudioMeterInformation>(CLSCTX_ALL, None)
                .and_then(|m| m.GetPeakValue())
                .unwrap_or(0.0);
            let sesiones = sessions_of(&dispositivo).unwrap_or_default();
            salida.push((nombre, pico, sesiones));
        }

        Ok(salida)
    }
}

/// Enumera las sesiones de audio del dispositivo de salida por defecto.
///
/// Descartamos las sesiones expiradas (procesos ya cerrados que Windows aun no
/// ha limpiado), pero SI devolvemos las inactivas: una app abierta y en
/// silencio debe seguir apareciendo en el mezclador.
pub fn list_sessions() -> Result<Vec<AudioSession>> {
    unsafe { sessions_of(&default_output_device()?) }
}

/// Las sesiones de un dispositivo concreto.
unsafe fn sessions_of(device: &IMMDevice) -> Result<Vec<AudioSession>> {
    unsafe {
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let enumerator = manager.GetSessionEnumerator()?;
        let count = enumerator.GetCount()?;

        let mut out = Vec::with_capacity(count as usize);

        for index in 0..count {
            let control = enumerator.GetSession(index)?;
            let control2: IAudioSessionControl2 = control.cast()?;

            let state = control2.GetState()?;
            if state == AudioSessionStateExpired {
                continue;
            }

            let pid = control2.GetProcessId().unwrap_or(0);
            let is_system = pid == 0;

            let path = process_path_cached(pid).unwrap_or_default();
            let exe = if is_system {
                "System.exe".to_string()
            } else {
                exe_name(&path)
            };
            let name = if is_system {
                "Sonidos del sistema".to_string()
            } else {
                display_name(&exe)
            };

            let volume_control: ISimpleAudioVolume = control2.cast()?;
            let meter: IAudioMeterInformation = control2.cast()?;

            out.push(AudioSession {
                pid,
                name,
                exe,
                path,
                volume: volume_control.GetMasterVolume().unwrap_or(0.0),
                muted: volume_control.GetMute().map(|m| m.as_bool()).unwrap_or(false),
                peak: meter.GetPeakValue().unwrap_or(0.0),
                active: state == AudioSessionStateActive,
                is_system,
                boost: 1.0,
                meter_peak: None,
            });
        }

        // Una aplicacion amplificada tiene su volumen real clavado en el 2% que
        // necesita la captura. Enseñar ese 2% seria mentir: lo que se oye es su
        // volumen de siempre multiplicado por la amplificacion.
        for session in &mut out {
            if let Some(visible) = super::boost::visible_de(session.pid) {
                session.volume =
                    f32::from_bits(visible.base.load(std::sync::atomic::Ordering::Relaxed));
                session.boost =
                    f32::from_bits(visible.ganancia.load(std::sync::atomic::Ordering::Relaxed));
            }
        }

        // Suelta del cache los procesos que ya no tienen sesion de audio.
        let alive: Vec<u32> = out.iter().map(|s| s.pid).collect();
        forget_missing(&alive);

        Ok(out)
    }
}

/// Localiza la sesion de un PID y le aplica una operacion.
///
/// Reenumeramos en cada llamada en vez de cachear los punteros COM: una sesion
/// puede morir en cualquier momento y usar un puntero muerto es un crash. El
/// coste es despreciable (unas pocas decenas de sesiones como mucho).
fn with_session<F>(pid: u32, mut op: F) -> Result<()>
where
    F: FnMut(&ISimpleAudioVolume) -> Result<()>,
{
    unsafe {
        let device = default_output_device()?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let enumerator = manager.GetSessionEnumerator()?;
        let count = enumerator.GetCount()?;

        for index in 0..count {
            let control = enumerator.GetSession(index)?;
            let control2: IAudioSessionControl2 = control.cast()?;

            if control2.GetProcessId().unwrap_or(0) != pid {
                continue;
            }

            let volume_control: ISimpleAudioVolume = control2.cast()?;
            return op(&volume_control);
        }
    }

    Err(windows::core::Error::new(
        windows::Win32::Foundation::E_INVALIDARG,
        "no existe ninguna sesion de audio con ese PID",
    ))
}

pub fn set_session_volume(pid: u32, volume: f32) -> Result<()> {
    let volume = volume.clamp(0.0, 1.0);

    // Si esta amplificada, su volumen real lo manda el amplificador. Lo que se
    // mueve aqui es el volumen de siempre, que la amplificacion multiplica.
    // Escribir directo dejaria la captura sin nada y se cortaria el sonido.
    if let Some(visible) = super::boost::visible_de(pid) {
        visible
            .base
            .store(volume.to_bits(), std::sync::atomic::Ordering::Relaxed);
        return Ok(());
    }

    // El `eventcontext` sirve para reconocer los cambios propios cuando uno
    // escucha IAudioSessionEvents. Todavia no escuchamos nada, asi que null.
    with_session(pid, |control| unsafe {
        control.SetMasterVolume(volume, std::ptr::null())
    })
}

/// Aplica varios volumenes en UNA sola enumeracion.
///
/// El ducking cambia el volumen de varias aplicaciones en el mismo tick; con
/// `set_session_volume` haria una enumeracion completa por cada una.
pub fn apply_volumes(changes: &[(u32, f32)]) -> Result<()> {
    if changes.is_empty() {
        return Ok(());
    }

    unsafe {
        let device = default_output_device()?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let enumerator = manager.GetSessionEnumerator()?;
        let count = enumerator.GetCount()?;

        for index in 0..count {
            let control = enumerator.GetSession(index)?;
            let control2: IAudioSessionControl2 = control.cast()?;
            let pid = control2.GetProcessId().unwrap_or(0);

            let Some((_, volume)) = changes.iter().find(|(target, _)| *target == pid) else {
                continue;
            };

            // Misma razon que en `set_session_volume`: al amplificado se le
            // mueve la base, nunca su volumen real.
            if let Some(visible) = super::boost::visible_de(pid) {
                visible
                    .base
                    .store(volume.clamp(0.0, 1.0).to_bits(), std::sync::atomic::Ordering::Relaxed);
                continue;
            }

            let volume_control: ISimpleAudioVolume = control2.cast()?;
            // Una sesion puede morir entre la lectura y la escritura; que falle
            // una no debe abortar el resto.
            let _ = volume_control.SetMasterVolume(volume.clamp(0.0, 1.0), std::ptr::null());
        }
    }

    Ok(())
}

pub fn set_session_mute(pid: u32, muted: bool) -> Result<()> {
    with_session(pid, |control| unsafe {
        control.SetMute(muted, std::ptr::null())
    })
}

/// Volumen de cada canal de la sesion de un proceso.
///
/// Diagnostico. Windows enseña un solo volumen por aplicacion, pero debajo hay
/// uno por canal que multiplica al general y que el mezclador no enseña. Si una
/// aplicacion lo toca, suena bajo con el mando al 100% y nadie ve por que.
pub fn canales_de(pid: u32) -> Result<Vec<f32>> {
    use windows::Win32::Media::Audio::IChannelAudioVolume;
    unsafe {
        let device = default_output_device()?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let enumerator = manager.GetSessionEnumerator()?;
        for index in 0..enumerator.GetCount()? {
            let control2: IAudioSessionControl2 = enumerator.GetSession(index)?.cast()?;
            if control2.GetProcessId().unwrap_or(0) != pid {
                continue;
            }
            let canales: IChannelAudioVolume = control2.cast()?;
            let n = canales.GetChannelCount()?;
            return (0..n).map(|c| canales.GetChannelVolume(c)).collect();
        }
    }
    Ok(Vec::new())
}

/// Pico del dispositivo entero: la mezcla final que sale por los altavoces.
///
/// Solo se usa para diagnostico: sirve para distinguir si el medidor de una
/// aplicacion refleja su propio audio o el de todo el sistema.
pub fn endpoint_peak() -> Result<f32> {
    unsafe {
        let device = default_output_device()?;
        let meter: IAudioMeterInformation = device.Activate(CLSCTX_ALL, None)?;
        meter.GetPeakValue()
    }
}

/// Volumen general del dispositivo de salida (0.0 - 1.0).
pub fn master_volume() -> Result<f32> {
    unsafe {
        let device = default_output_device()?;
        let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        endpoint.GetMasterVolumeLevelScalar()
    }
}

pub fn set_master_volume(volume: f32) -> Result<()> {
    let volume = volume.clamp(0.0, 1.0);
    unsafe {
        let device = default_output_device()?;
        let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
        endpoint.SetMasterVolumeLevelScalar(volume, std::ptr::null())
    }
}
