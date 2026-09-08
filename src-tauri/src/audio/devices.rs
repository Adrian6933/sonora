//! Dispositivos de salida.
//!
//! Sirve para dos cosas: ensenar por donde esta sonando el audio, y detectar
//! cuando cambia para que un modo pueda activarse solo al conectar los cascos.
//!
//! OJO: aqui solo LEEMOS. Cambiar el dispositivo por defecto desde codigo no
//! tiene API publica en Windows —hace falta `IPolicyConfig`, que no esta
//! documentada— asi que eso sigue pendiente (ver la fase v4 del PLAN).

use serde::Serialize;
use windows::core::PWSTR;
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IMMDevice, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};

use super::sessions::Result;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    /// Identificador estable de Windows; es lo que guardan los modos
    pub id: String,
    /// Nombre legible: "Altavoces (Realtek Audio)"
    pub name: String,
    pub is_default: bool,
}

fn enumerator() -> Result<IMMDeviceEnumerator> {
    unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL) }
}

/// Identificador del dispositivo de salida por defecto.
pub fn default_output_id() -> Result<String> {
    unsafe {
        let device = enumerator()?.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
        device_id(&device)
    }
}

/// Todos los dispositivos de salida activos.
pub fn list_output_devices() -> Result<Vec<AudioDevice>> {
    unsafe {
        let enumerator = enumerator()?;
        let default = default_output_id().unwrap_or_default();

        let collection = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let count = collection.GetCount()?;

        let mut out = Vec::with_capacity(count as usize);

        for index in 0..count {
            let device = collection.Item(index)?;
            let Ok(id) = device_id(&device) else { continue };

            out.push(AudioDevice {
                is_default: id == default,
                name: friendly_name(&device).unwrap_or_else(|_| "Dispositivo".into()),
                id,
            });
        }

        Ok(out)
    }
}

unsafe fn device_id(device: &IMMDevice) -> Result<String> {
    unsafe {
        let raw = device.GetId()?;
        let id = raw.to_string().unwrap_or_default();
        // GetId reserva memoria con CoTaskMemAlloc; nos toca soltarla.
        CoTaskMemFree(Some(raw.0 as *const _));
        Ok(id)
    }
}

unsafe fn friendly_name(device: &IMMDevice) -> Result<String> {
    unsafe {
        let store = device.OpenPropertyStore(STGM_READ)?;
        let value = store.GetValue(&PKEY_Device_FriendlyName)?;

        // PropVariantToStringAlloc nos ahorra hurgar en la union del
        // PROPVARIANT a mano, que es donde se cometen los errores.
        let raw: PWSTR = PropVariantToStringAlloc(&value)?;
        let name = raw.to_string().unwrap_or_default();
        CoTaskMemFree(Some(raw.0 as *const _));

        Ok(name)
    }
}
