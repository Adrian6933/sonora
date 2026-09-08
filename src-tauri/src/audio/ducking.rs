//! Motor de ducking: baja las demas aplicaciones cuando alguien habla.
//!
//! Es lo que hace el interruptor de "prioridad voz" de los Astro. La idea es
//! simple —detectar que Discord esta emitiendo y atenuar el resto— pero lo que
//! separa un ducking agradable de uno molesto son las curvas: bajar rapido
//! (attack corto) para no perder la primera silaba, aguantar abajo un momento
//! (hold) para que las pausas entre palabras no provoquen un bombeo, y subir
//! despacio (release largo) para que la vuelta no se note.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::sessions::AudioSession;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckingConfig {
    pub enabled: bool,
    /// Patrones de ejecutable que disparan el ducking ("*discord*")
    pub triggers: Vec<String>,
    /// Que se atenua. Vacio = todo lo que no sea un disparador.
    pub targets: Vec<String>,
    /// Pico a partir del cual se considera que hay voz (0..1)
    pub threshold: f32,
    /// Cuanto se baja: 0.4 = al 40% del volumen normal
    pub reduction: f32,
    pub attack_ms: u32,
    pub release_ms: u32,
    pub hold_ms: u32,
}

impl Default for DuckingConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            triggers: vec!["*discord*".into()],
            targets: Vec::new(),
            threshold: 0.02,
            reduction: 0.4,
            attack_ms: 60,
            release_ms: 400,
            hold_ms: 250,
        }
    }
}

/// Casa un patron con un ejecutable. Mismas reglas que en el frontend
/// (`src/lib/modes.ts`): sin comodines es igualdad, con `*` es subcadena.
fn matches(pattern: &str, exe: &str) -> bool {
    let pattern = pattern.trim().to_lowercase();
    let exe = exe.to_lowercase();
    if pattern.is_empty() {
        return false;
    }

    let starts = pattern.starts_with('*');
    let ends = pattern.ends_with('*');

    match (starts, ends) {
        (true, true) if pattern.len() > 2 => exe.contains(&pattern[1..pattern.len() - 1]),
        (true, false) => exe.ends_with(&pattern[1..]),
        (false, true) => exe.starts_with(&pattern[..pattern.len() - 1]),
        _ => exe == pattern,
    }
}

pub struct Ducker {
    config: DuckingConfig,
    /// Ganancia aplicada ahora mismo: 1.0 = sin atenuar
    gain: f32,
    /// Tiempo transcurrido desde la ultima vez que se detecto voz.
    ///
    /// Se acumula con el `dt` de cada tick en vez de mirar el reloj, igual que
    /// las rampas. Asi el motor es una funcion pura de sus entradas: mismo
    /// `dt`, mismo resultado, y se puede probar sin esperar en tiempo real.
    since_trigger: Duration,
    /// Volumen "de verdad" de cada aplicacion, el que tendria sin ducking
    bases: HashMap<u32, f32>,
    /// Si el tick anterior estabamos atenuando. Sirve para saber cuando toca
    /// escribir el volumen final exacto al volver a reposo.
    was_ducking: bool,
}

impl Ducker {
    pub fn new() -> Self {
        Self {
            config: DuckingConfig::default(),
            gain: 1.0,
            since_trigger: Duration::MAX,
            bases: HashMap::new(),
            was_ducking: false,
        }
    }

    pub fn gain(&self) -> f32 {
        self.gain
    }

    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Cambiar de configuracion suelta el estado: las bases guardadas eran de
    /// otro modo y aplicarlas seria dejar volumenes a medio camino.
    pub fn configure(&mut self, config: DuckingConfig) -> Vec<(u32, f32)> {
        let restore = self.release_all();
        self.config = config;
        restore
    }

    /// Devuelve los volumenes originales para dejar todo como estaba.
    pub fn release_all(&mut self) -> Vec<(u32, f32)> {
        let restore: Vec<(u32, f32)> = if self.gain < 0.999 {
            self.bases.iter().map(|(pid, base)| (*pid, *base)).collect()
        } else {
            Vec::new()
        };

        self.gain = 1.0;
        self.since_trigger = Duration::MAX;
        self.was_ducking = false;
        self.bases.clear();
        restore
    }

    /// Un paso del motor. Devuelve los cambios de volumen que hay que aplicar.
    pub fn tick(&mut self, sessions: &[AudioSession], dt: Duration) -> Vec<(u32, f32)> {
        if !self.config.enabled {
            return Vec::new();
        }

        // 1. Hay voz?
        let speaking = sessions.iter().any(|session| {
            !session.muted
                && session.peak >= self.config.threshold
                && self
                    .config
                    .triggers
                    .iter()
                    .any(|pattern| matches(pattern, &session.exe))
        });

        if speaking {
            self.since_trigger = Duration::ZERO;
        } else {
            self.since_trigger = self.since_trigger.saturating_add(dt);
        }

        // 2. El hold evita el bombeo en las pausas entre palabras.
        let holding = self.since_trigger < Duration::from_millis(self.config.hold_ms as u64);

        let target = if speaking || holding {
            self.config.reduction.clamp(0.0, 1.0)
        } else {
            1.0
        };

        // 3. Rampa hacia el objetivo. Bajar usa attack; subir, release.
        let ramp_ms = if target < self.gain {
            self.config.attack_ms
        } else {
            self.config.release_ms
        }
        .max(1) as f32;

        // La rampa es LINEAL, no exponencial. Con una exponencial
        // (`gain += (target - gain) * dt/ramp`) el recorrido completo tarda
        // mucho mas que `ramp_ms` —se acerca al objetivo asintoticamente— y
        // entonces "400 ms de release" no significaria nada para quien lo
        // configura. Asi, recorrer todo el rango tarda exactamente ramp_ms.
        let span = (1.0 - self.config.reduction).abs().max(0.01);
        let delta = (dt.as_millis() as f32 / ramp_ms) * span;

        self.gain = if target > self.gain {
            (self.gain + delta).min(target)
        } else {
            (self.gain - delta).max(target)
        };

        // 4. Calcular volumenes.
        let mut changes = Vec::new();
        let resting = self.gain >= 0.999;

        for session in sessions {
            if session.is_system || !self.is_target(session) {
                continue;
            }

            if !resting {
                let base = *self.bases.entry(session.pid).or_insert(session.volume);
                let desired = (base * self.gain).clamp(0.0, 1.0);

                // Escribir solo si de verdad cambia: cada escritura es una
                // llamada COM y esto corre 20 veces por segundo.
                if (session.volume - desired).abs() > 0.004 {
                    changes.push((session.pid, desired));
                }
                continue;
            }

            if self.was_ducking {
                // Primer tick en reposo: hay que escribir el volumen original
                // EXACTO. Sin esto la aplicacion se queda en el ultimo valor de
                // la rampa (un 97%, por ejemplo) y, peor todavia, ese valor
                // pasaria a ser la nueva base en el tick siguiente: cada ciclo
                // de ducking dejaria el volumen un poco mas bajo, para siempre.
                if let Some(base) = self.bases.get(&session.pid) {
                    if (session.volume - *base).abs() > 0.004 {
                        changes.push((session.pid, *base));
                    }
                }
            } else {
                // En reposo la base sigue al usuario: si mueves un slider ahora,
                // ese pasa a ser el volumen bueno. Mientras atenua no lo
                // hacemos, o tomariamos un valor ya reducido como base.
                self.bases.insert(session.pid, session.volume);
            }
        }

        self.was_ducking = !resting;

        if resting {
            // Dejamos de seguir a quien ya no tiene sesion.
            let alive: Vec<u32> = sessions.iter().map(|s| s.pid).collect();
            self.bases.retain(|pid, _| alive.contains(pid));
        }

        changes
    }

    fn is_target(&self, session: &AudioSession) -> bool {
        // Un disparador nunca se atenua a si mismo: bajarle el volumen a quien
        // habla seria justo lo contrario de lo que queremos.
        let is_trigger = self
            .config
            .triggers
            .iter()
            .any(|pattern| matches(pattern, &session.exe));
        if is_trigger {
            return false;
        }

        if self.config.targets.is_empty() {
            return true;
        }

        self.config
            .targets
            .iter()
            .any(|pattern| matches(pattern, &session.exe))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patrones() {
        assert!(matches("Discord.exe", "discord.exe"));
        assert!(matches("*discord*", "Discord.exe"));
        assert!(matches("chrome*", "chrome.exe"));
        assert!(matches("*.exe", "spotify.exe"));
        assert!(!matches("Discord.exe", "Spotify.exe"));
        assert!(!matches("", "spotify.exe"));
    }

    fn session(pid: u32, exe: &str, peak: f32, volume: f32) -> AudioSession {
        AudioSession {
            pid,
            name: exe.into(),
            exe: exe.into(),
            path: String::new(),
            volume,
            muted: false,
            peak,
            active: true,
            is_system: false,
        }
    }

    fn config() -> DuckingConfig {
        DuckingConfig {
            enabled: true,
            triggers: vec!["*discord*".into()],
            targets: Vec::new(),
            threshold: 0.02,
            reduction: 0.5,
            attack_ms: 50,
            release_ms: 200,
            hold_ms: 100,
        }
    }

    #[test]
    fn atenua_cuando_hay_voz_y_no_toca_al_que_habla() {
        let mut ducker = Ducker::new();
        ducker.configure(config());
        let dt = Duration::from_millis(50);

        // Primer tick en silencio: solo aprende el volumen base.
        let silence = vec![
            session(1, "Discord.exe", 0.0, 1.0),
            session(2, "game.exe", 0.5, 1.0),
        ];
        assert!(ducker.tick(&silence, dt).is_empty());

        // Ahora Discord emite: el juego baja, Discord no.
        let talking = vec![
            session(1, "Discord.exe", 0.6, 1.0),
            session(2, "game.exe", 0.5, 1.0),
        ];
        let changes = ducker.tick(&talking, dt);

        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].0, 2);
        assert!(changes[0].1 < 1.0);
    }

    /// Simula el bucle real: aplica al "mezclador" los cambios que devuelve el
    /// motor, que es lo unico que revela los errores acumulativos.
    fn run(ducker: &mut Ducker, speaking: bool, ticks: usize, game_volume: &mut f32) {
        let dt = Duration::from_millis(50);

        for _ in 0..ticks {
            let sessions = vec![
                session(1, "Discord.exe", if speaking { 0.6 } else { 0.0 }, 1.0),
                session(2, "game.exe", 0.0, *game_volume),
            ];

            for (pid, volume) in ducker.tick(&sessions, dt) {
                if pid == 2 {
                    *game_volume = volume;
                }
            }
        }
    }

    /// Regresion: el volumen tiene que volver EXACTO tras cada ciclo.
    ///
    /// Antes se quedaba en el ultimo valor de la rampa (~97%) y ese valor
    /// pasaba a ser la nueva base, asi que cada ciclo de ducking dejaba la
    /// aplicacion un poco mas baja. Tras un rato de partida el juego acababa
    /// inaudible sin que nadie hubiera tocado nada.
    #[test]
    fn el_volumen_no_va_bajando_ciclo_a_ciclo() {
        let mut ducker = Ducker::new();
        ducker.configure(config());
        let mut game_volume = 0.8_f32;

        for ciclo in 1..=4 {
            run(&mut ducker, false, 5, &mut game_volume);
            run(&mut ducker, true, 20, &mut game_volume);
            run(&mut ducker, false, 40, &mut game_volume);

            assert!(
                (game_volume - 0.8).abs() < 0.001,
                "tras el ciclo {ciclo} quedo en {game_volume}, deberia ser 0.8"
            );
        }
    }

    #[test]
    fn vuelve_al_volumen_original_al_callarse() {
        let mut ducker = Ducker::new();
        ducker.configure(config());
        let dt = Duration::from_millis(50);

        let talking = vec![
            session(1, "Discord.exe", 0.6, 1.0),
            session(2, "game.exe", 0.5, 0.8),
        ];
        ducker.tick(&talking, dt);
        for _ in 0..10 {
            ducker.tick(&talking, dt);
        }
        assert!(ducker.gain() < 0.6);

        // Silencio: pasado el hold, la ganancia vuelve a 1.
        let silence = vec![
            session(1, "Discord.exe", 0.0, 1.0),
            session(2, "game.exe", 0.5, 0.4),
        ];
        for _ in 0..40 {
            ducker.tick(&silence, dt);
        }
        assert_eq!(ducker.gain(), 1.0);
    }
}
