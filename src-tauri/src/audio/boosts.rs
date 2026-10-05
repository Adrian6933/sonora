//! Los amplificadores que hay en marcha, uno por aplicacion.
//!
//! Vive como estado de Tauri. El motor de verdad esta en `boost`; aqui solo se
//! guarda cual esta activo y con cuanta ganancia, para poder apagarlo despues.
//!
//! Tambien es el guardian de lo peor que puede pasar con la amplificacion: que
//! Sonora se cierre de golpe con una aplicacion amplificada. Esa aplicacion
//! tiene su volumen real clavado en un 2%, y sin nadie que lo devuelva se
//! quedaria asi para siempre. Por eso cada amplificacion se apunta en disco y
//! al arrancar se deshace lo que hubiera quedado a medias.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use super::boost::{Boost, MAX_BOOST, SOMBRA};

/// Una amplificacion activa, tal y como la ve el frontend.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoostInfo {
    pub pid: u32,
    /// Multiplicador: 2.0 es el doble de volumen.
    pub gain: f32,
    /// Nivel real que sale de la aplicacion, 0..1, para el medidor.
    pub level: f32,
}

/// Lo que se apunta en disco de cada amplificacion.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Apunte {
    /// Ejecutable, no PID: tras un cierre brusco los PIDs ya no valen.
    exe: String,
    /// Volumen al que hay que devolverla.
    volumen: f32,
}

struct Activo {
    boost: Boost,
    exe: String,
}

#[derive(Default)]
pub struct Boosts {
    activos: Mutex<HashMap<u32, Activo>>,
}

impl Boosts {
    pub fn new() -> Self {
        Self::default()
    }

    /// Pone la ganancia de una aplicacion.
    ///
    /// Con 1.0 se apaga: no tiene sentido dejar el motor copiando audio para no
    /// cambiar nada, y ademas asi la aplicacion recupera su volumen normal.
    pub fn set(&self, pid: u32, ganancia: f32) -> Result<(), String> {
        let mut activos = self.activos.lock().map_err(|_| "estado corrupto")?;
        poda(&mut activos);

        if ganancia <= 1.0 {
            // El Drop del amplificador es quien devuelve el volumen original.
            activos.remove(&pid);
            apunta(&activos);
            return Ok(());
        }

        let ganancia = ganancia.min(MAX_BOOST);

        // Si ya estaba amplificando, mover el mando basta: volver a arrancar
        // cortaria el sonido un instante por nada.
        if let Some(activo) = activos.get(&pid) {
            activo.boost.set_gain(ganancia);
            return Ok(());
        }

        let exe = super::process::process_path(pid)
            .map(|ruta| super::process::exe_name(&ruta))
            .unwrap_or_default();

        let boost = Boost::start(pid, ganancia).map_err(|error| error.message())?;
        activos.insert(pid, Activo { boost, exe });
        apunta(&activos);
        Ok(())
    }

    pub fn list(&self) -> Vec<BoostInfo> {
        let Ok(mut activos) = self.activos.lock() else {
            return Vec::new();
        };

        if poda(&mut activos) {
            apunta(&activos);
        }

        activos
            .values()
            .map(|activo| BoostInfo {
                pid: activo.boost.pid(),
                gain: activo.boost.gain(),
                level: activo.boost.nivel_entrada(),
            })
            .collect()
    }

    /// Apaga todas. Se usa al cerrar y en el boton de "todo al 100%".
    pub fn clear(&self) {
        if let Ok(mut activos) = self.activos.lock() {
            activos.clear();
            apunta(&activos);
        }
    }
}

/// Quita las amplificaciones cuya aplicacion ya se ha cerrado.
///
/// Si no, se quedarian para siempre en la lista con un PID muerto y el mando
/// seguiria diciendo "amplificada" de algo que ya no existe. Devuelve si ha
/// quitado alguna.
fn poda(activos: &mut HashMap<u32, Activo>) -> bool {
    let antes = activos.len();
    activos.retain(|pid, _| super::process::process_path(*pid).is_some());
    activos.len() != antes
}

// ------------------------------------------------------------- en disco

fn ruta_apuntes() -> Option<std::path::PathBuf> {
    // La misma carpeta en la que Tauri guarda la configuracion de Sonora.
    let base = std::env::var_os("APPDATA")?;
    Some(
        std::path::PathBuf::from(base)
            .join("com.sonora.app")
            .join("amplificaciones-activas.json"),
    )
}

/// Deja en disco lo que hay amplificado ahora mismo.
///
/// Se reescribe entero en cada cambio: son un par de lineas y asi nunca puede
/// quedar a medias con una entrada vieja.
fn apunta(activos: &HashMap<u32, Activo>) {
    let Some(ruta) = ruta_apuntes() else {
        return;
    };

    if activos.is_empty() {
        let _ = std::fs::remove_file(&ruta);
        return;
    }

    let apuntes: Vec<Apunte> = activos
        .values()
        .filter(|activo| !activo.exe.is_empty())
        .map(|activo| Apunte {
            exe: activo.exe.clone(),
            volumen: activo.boost.base(),
        })
        .collect();

    if let Some(carpeta) = ruta.parent() {
        let _ = std::fs::create_dir_all(carpeta);
    }
    if let Ok(texto) = serde_json::to_string(&apuntes) {
        let _ = std::fs::write(&ruta, texto);
    }
}

/// Deshace lo que dejo a medias un cierre brusco. Se llama al arrancar.
///
/// Solo toca las aplicaciones que siguen clavadas en la sombra: si alguien ya
/// les ha cambiado el volumen a mano desde entonces, esa decision manda.
/// Devuelve cuantas ha rescatado.
pub fn recupera_tras_cierre() -> usize {
    let Some(ruta) = ruta_apuntes() else {
        return 0;
    };
    let Ok(texto) = std::fs::read_to_string(&ruta) else {
        return 0;
    };
    let _ = std::fs::remove_file(&ruta);

    let Ok(apuntes) = serde_json::from_str::<Vec<Apunte>>(&texto) else {
        return 0;
    };
    let Ok(sesiones) = super::sessions::list_sessions() else {
        return 0;
    };

    let mut rescatadas = 0;
    for apunte in &apuntes {
        for sesion in &sesiones {
            let es_ella = sesion.exe.eq_ignore_ascii_case(&apunte.exe);
            let en_sombra = (sesion.volume - SOMBRA).abs() < 0.006;
            if es_ella && en_sombra {
                let volumen = if apunte.volumen > SOMBRA { apunte.volumen } else { 1.0 };
                if super::sessions::set_session_volume(sesion.pid, volumen).is_ok() {
                    rescatadas += 1;
                }
            }
        }
    }

    rescatadas
}
