//! Motor de prioridad de audio: baja unas aplicaciones cuando suenan otras.
//!
//! Es lo que hace el interruptor de "prioridad voz" de los Astro. La idea es
//! simple —detectar que Discord esta emitiendo y atenuar el resto— pero lo que
//! separa un ducking agradable de uno molesto son las curvas: bajar rapido
//! (attack corto) para no perder la primera silaba, aguantar abajo un momento
//! (hold) para que las pausas entre palabras no provoquen bombeo, y subir
//! despacio (release largo) para que la vuelta no se note.
//!
//! Admite VARIAS reglas a la vez, y a proposito: el caso que la gente quiere de
//! verdad es tener las dos direcciones montadas —"si hablan por Discord baja el
//! juego" y "si el juego pega un petardazo baja Discord"— y elegir cual manda
//! por como estan configuradas. Con una sola regla habria que elegir.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use super::sessions::AudioSession;

/// Cuanto tiene que durar el sonido por defecto, en milisegundos.
///
/// Medido en una llamada real de Discord: los avisos y clics duran 150 ms de
/// mediana, y una voz dura segundos. 300 ms deja fuera lo primero sin tocar lo
/// segundo.
fn sustain_por_defecto() -> u32 {
    300
}

/// Una regla: "cuando suene X, baja Y hasta Z%".
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckingRule {
    pub enabled: bool,
    /// Patrones de ejecutable que disparan la atenuacion ("*discord*")
    pub triggers: Vec<String>,
    /// Que se atenua. Vacio = todo lo que no sea un disparador de esta regla.
    pub targets: Vec<String>,
    /// Pico a partir del cual se considera que hay sonido (0..1)
    pub threshold: f32,
    /// Cuanto tiene que aguantar por encima del umbral para contar como voz.
    ///
    /// Es lo que separa a alguien hablando de un aviso o un clic. A cero,
    /// cualquier golpe momentaneo dispara la atenuacion.
    #[serde(default = "sustain_por_defecto")]
    pub sustain_ms: u32,
    /// Cuanto se baja: 0.4 = al 40% del volumen normal.
    ///
    /// En modo proporcional esto es el TOPE: lo maximo que llegaria a bajar
    /// cuando el disparador suena a tope.
    pub reduction: f32,
    /// Si la bajada acompana al volumen del disparador en vez de ser fija.
    pub proportional: bool,
    /// Cuanto sonido por encima del umbral hace falta para llegar al tope.
    ///
    /// Es la "amplitud": con un rango pequeno, un habla normal ya baja del
    /// todo; con uno grande hay que gritar para llegar al maximo, y las voces
    /// suaves apenas bajan nada.
    pub range: f32,
    pub attack_ms: u32,
    pub release_ms: u32,
    pub hold_ms: u32,
}

impl Default for DuckingRule {
    fn default() -> Self {
        Self {
            enabled: true,
            triggers: vec!["*discord*".into()],
            targets: Vec::new(),
            threshold: 0.12,
            sustain_ms: sustain_por_defecto(),
            reduction: 0.4,
            proportional: false,
            range: 0.25,
            attack_ms: 60,
            release_ms: 400,
            hold_ms: 350,
        }
    }
}

/// Lo que manda el frontend al activar un modo.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuckingConfig {
    pub rules: Vec<DuckingRule>,
}

/// Casa un patron con un ejecutable. Mismas reglas que en el frontend
/// (`src/lib/modes.ts`): sin comodines es igualdad, con `*` es subcadena.
pub fn matches(pattern: &str, exe: &str) -> bool {
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

/// Estado vivo de una regla.
/// Ticks seguidos con el patron de espejo antes de creerselo.
///
/// A 20 Hz son medio segundo. Suficiente para que una coincidencia de niveles
/// de un instante no apague el ducking.
const TICKS_ESPEJO: u8 = 10;

struct RuleState {
    rule: DuckingRule,
    /// Pico mas alto reciente del disparador, con caida lenta. Solo se usa en
    /// modo proporcional.
    pico_retenido: f32,
    /// Cuanto lleva el disparador por encima del umbral, descontando las
    /// bajadas. Es lo que distingue una voz de un golpe suelto.
    tiempo_alto: Duration,
    /// Ganancia que aplica ahora mismo: 1.0 = sin atenuar
    gain: f32,
    /// Tiempo desde la ultima deteccion, acumulado con el `dt` de cada tick.
    /// Se acumula en vez de mirar el reloj para que el motor sea una funcion
    /// pura de sus entradas y se pueda probar sin esperar en tiempo real.
    since_trigger: Duration,
}

pub struct Ducker {
    rules: Vec<RuleState>,
    /// Volumen "de verdad" de cada aplicacion, el que tendria sin ducking
    bases: HashMap<u32, f32>,
    /// Si el tick anterior alguna regla estaba atenuando
    was_ducking: bool,
    /// Pico del dispositivo entero y volumen general, si el hilo de audio los
    /// ha medido. A cero, la deteccion de espejos queda desactivada.
    dispositivo: (f32, f32),
    /// Cuantos ticks seguidos lleva cada PID pareciendo un espejo.
    espejos: HashMap<u32, u8>,
}

impl Ducker {
    pub fn new() -> Self {
        Self {
            rules: Vec::new(),
            bases: HashMap::new(),
            was_ducking: false,
            dispositivo: (0.0, 0.0),
            espejos: HashMap::new(),
        }
    }

    /// Pico de la mezcla final y volumen general, medidos por el hilo de audio.
    ///
    /// Sin esto no se pueden reconocer los medidores que en realidad estan
    /// midiendo todo el sistema en vez de su propia aplicacion.
    pub fn set_device(&mut self, pico: f32, master: f32) {
        self.dispositivo = (pico, master);
    }

    /// Aplicaciones cuyo medidor esta reflejando la mezcla de todo el sistema.
    ///
    /// Le pasa a Discord cuando comparte audio o monitoriza el microfono: su
    /// medidor sube con la musica de Spotify aunque nadie hable, y una regla que
    /// lo use de disparador se activaria sola. Se ignoran como disparadores, y
    /// la lista sale a la interfaz para que se vea por que.
    pub fn espejos(&self) -> Vec<u32> {
        self.espejos
            .iter()
            .filter(|(_, ticks)| **ticks >= TICKS_ESPEJO)
            .map(|(pid, _)| *pid)
            .collect()
    }

    /// Revisa quien esta reflejando la mezcla en vez de su propio audio.
    ///
    /// Dos condiciones, y la segunda es la que evita romper el caso normal:
    ///
    /// 1. Su medidor coincide clavado con el del dispositivo entero.
    /// 2. Hay OTRA aplicacion cuyo sonido, ya con su volumen aplicado, explica
    ///    por si sola ese nivel.
    ///
    /// Sin la segunda, hablar por Discord sin nada mas sonando cumpliria la
    /// primera y dejariamos de atenuar justo cuando hace falta.
    fn revisa_espejos(&mut self, sessions: &[AudioSession]) {
        let (pico_dispositivo, master) = self.dispositivo;
        if pico_dispositivo <= 0.02 || master <= 0.0 {
            return;
        }

        for session in sessions {
            if session.is_system {
                continue;
            }

            let coincide = (session.peak - pico_dispositivo).abs() < 0.004;
            let explicada_por_otra = sessions.iter().any(|otra| {
                otra.pid != session.pid
                    && !otra.is_system
                    && !otra.muted
                    && otra.peak > 0.02
                    && ((otra.peak * otra.volume * master) - pico_dispositivo).abs() < 0.01
            });

            let ticks = self.espejos.entry(session.pid).or_insert(0);
            if coincide && explicada_por_otra {
                *ticks = ticks.saturating_add(1);
            } else {
                *ticks = 0;
            }
        }
    }

    /// Patrones de las aplicaciones que disparan alguna regla activa.
    ///
    /// El hilo de audio los usa para saber a quien escuchar de verdad en vez
    /// de fiarse de su medidor.
    pub fn disparadores(&self) -> Vec<String> {
        self.rules
            .iter()
            .filter(|state| state.rule.enabled)
            .flat_map(|state| state.rule.triggers.iter().cloned())
            .collect()
    }

    /// La atenuacion mas fuerte que aplica ahora mismo (para la interfaz).
    pub fn gain(&self) -> f32 {
        self.rules
            .iter()
            .map(|state| state.gain)
            .fold(1.0_f32, f32::min)
    }

    pub fn is_enabled(&self) -> bool {
        self.rules.iter().any(|state| state.rule.enabled)
    }

    /// Cambiar de configuracion suelta el estado: las bases guardadas eran de
    /// otro modo y aplicarlas seria dejar volumenes a medio camino.
    pub fn configure(&mut self, config: DuckingConfig) -> Vec<(u32, f32)> {
        let restore = self.release_all();

        self.rules = config
            .rules
            .into_iter()
            .map(|rule| RuleState {
                rule,
                pico_retenido: 0.0,
                tiempo_alto: Duration::ZERO,
                gain: 1.0,
                since_trigger: Duration::MAX,
            })
            .collect();

        restore
    }

    /// Devuelve los volumenes originales para dejar todo como estaba.
    pub fn release_all(&mut self) -> Vec<(u32, f32)> {
        let restore: Vec<(u32, f32)> = if self.was_ducking {
            self.bases.iter().map(|(pid, base)| (*pid, *base)).collect()
        } else {
            Vec::new()
        };

        for state in &mut self.rules {
            state.gain = 1.0;
            state.since_trigger = Duration::MAX;
            state.pico_retenido = 0.0;
            state.tiempo_alto = Duration::ZERO;
        }
        self.was_ducking = false;
        self.bases.clear();
        self.espejos.clear();

        restore
    }

    /// Un paso del motor. Devuelve los cambios de volumen que hay que aplicar.
    pub fn tick(&mut self, sessions: &[AudioSession], dt: Duration) -> Vec<(u32, f32)> {
        if !self.is_enabled() {
            return Vec::new();
        }

        self.revisa_espejos(sessions);
        let espejos: std::collections::HashSet<u32> = self
            .espejos
            .iter()
            .filter(|(_, ticks)| **ticks >= TICKS_ESPEJO)
            .map(|(pid, _)| *pid)
            .collect();

        // 1. Avanzar cada regla por separado.
        for state in &mut self.rules {
            if !state.rule.enabled {
                state.gain = 1.0;
                continue;
            }

            // Pico mas alto entre los disparadores de esta regla, saltandose
            // los medidores que estan reflejando la mezcla del sistema.
            let pico = sessions
                .iter()
                .filter(|session| {
                    !session.muted
                        && !espejos.contains(&session.pid)
                        && state
                            .rule
                            .triggers
                            .iter()
                            .any(|pattern| matches(pattern, &session.exe))
                })
                .fold(0.0_f32, |max, session| max.max(session.peak));

            // No basta con pasar el umbral: hay que MANTENERSE por encima. Un
            // aviso de Discord o un clic duran 150 ms; una voz dura segundos.
            // Sin esto, un ping cada pocos segundos deja la musica baja casi
            // todo el rato y parece que el ducking se ha vuelto loco.
            // El tope evita que una conversacion larga acumule tanto que luego
            // tarde en soltarse. El minimo es para que con exigencia cero el
            // contador siga pudiendo subir.
            let tope = Duration::from_millis((state.rule.sustain_ms as u64 * 2).max(100));
            if pico >= state.rule.threshold {
                state.tiempo_alto = (state.tiempo_alto + dt).min(tope);
            } else {
                // Restar en vez de poner a cero: entre silaba y silaba se baja
                // del umbral un instante, y reiniciar ahi cortaria el ducking
                // en mitad de una frase.
                state.tiempo_alto = state.tiempo_alto.saturating_sub(dt);
            }

            // El `> ZERO` es lo que hace que con exigencia cero siga valiendo:
            // sin el, "lleva cero milisegundos" contaria como sonando siempre.
            let sounding = state.tiempo_alto > Duration::ZERO
                && state.tiempo_alto >= Duration::from_millis(state.rule.sustain_ms as u64);

            // En modo proporcional recordamos lo fuerte que sono, no solo que
            // sono: es lo que permite que una voz suave baje poco y un grito
            // baje del todo.
            if sounding {
                state.pico_retenido = state.pico_retenido.max(pico);
            }

            if sounding {
                state.since_trigger = Duration::ZERO;
            } else {
                state.since_trigger = state.since_trigger.saturating_add(dt);
            }

            // El pico retenido baja poco a poco: si no, un grito puntual
            // dejaria la atenuacion al maximo el resto de la conversacion.
            let caida = dt.as_millis() as f32 / 400.0;
            state.pico_retenido = (state.pico_retenido - caida).max(pico).max(0.0);

            // El hold evita el bombeo en las pausas entre palabras.
            let holding =
                state.since_trigger < Duration::from_millis(state.rule.hold_ms as u64);

            let target = if sounding || holding {
                if state.rule.proportional {
                    // Cuanto se pasa del umbral, de 0 a 1 dentro del rango.
                    let rango = state.rule.range.max(0.01);
                    let exceso =
                        ((state.pico_retenido - state.rule.threshold) / rango).clamp(0.0, 1.0);

                    // Sin exceso no baja nada; con el maximo llega al tope.
                    1.0 - exceso * (1.0 - state.rule.reduction.clamp(0.0, 1.0))
                } else {
                    state.rule.reduction.clamp(0.0, 1.0)
                }
            } else {
                state.pico_retenido = 0.0;
                1.0
            };

            let ramp_ms = if target < state.gain {
                state.rule.attack_ms
            } else {
                state.rule.release_ms
            }
            .max(1) as f32;

            // Rampa LINEAL, no exponencial. Con una exponencial el recorrido
            // completo tarda mucho mas que `ramp_ms` y entonces "400 ms de
            // release" no significaria nada para quien lo configura.
            let span = (1.0 - state.rule.reduction).abs().max(0.01);
            let delta = (dt.as_millis() as f32 / ramp_ms) * span;

            state.gain = if target > state.gain {
                (state.gain + delta).min(target)
            } else {
                (state.gain - delta).max(target)
            };
        }

        // 2. Calcular volumenes.
        let mut changes = Vec::new();
        let resting = self.rules.iter().all(|state| state.gain >= 0.999);

        for session in sessions {
            if session.is_system {
                continue;
            }

            if !resting {
                let factor = self.factor_for(session);
                // Si ninguna regla le afecta, ni lo tocamos.
                if factor >= 0.999 && !self.bases.contains_key(&session.pid) {
                    continue;
                }

                let base = *self.bases.entry(session.pid).or_insert(session.volume);
                let desired = (base * factor).clamp(0.0, 1.0);

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
            let alive: Vec<u32> = sessions.iter().map(|s| s.pid).collect();
            self.bases.retain(|pid, _| alive.contains(pid));
        }

        changes
    }

    /// Atenuacion combinada que le toca a una sesion.
    ///
    /// Si varias reglas apuntan a la misma aplicacion se multiplican, asi que
    /// manda la mas agresiva sin que las demas se ignoren.
    fn factor_for(&self, session: &AudioSession) -> f32 {
        let mut factor = 1.0_f32;

        for state in &self.rules {
            if !state.rule.enabled || state.gain >= 0.999 {
                continue;
            }

            // Un disparador nunca se atenua a si mismo: bajarle el volumen a
            // quien esta sonando seria lo contrario de lo que queremos.
            let is_trigger = state
                .rule
                .triggers
                .iter()
                .any(|pattern| matches(pattern, &session.exe));
            if is_trigger {
                continue;
            }

            let is_target = state.rule.targets.is_empty()
                || state
                    .rule
                    .targets
                    .iter()
                    .any(|pattern| matches(pattern, &session.exe));

            if is_target {
                factor *= state.gain;
            }
        }

        factor
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
            boost: 1.0,
            meter_peak: None,
        }
    }

    fn rule(triggers: &[&str], targets: &[&str], reduction: f32) -> DuckingRule {
        DuckingRule {
            enabled: true,
            triggers: triggers.iter().map(|s| s.to_string()).collect(),
            targets: targets.iter().map(|s| s.to_string()).collect(),
            threshold: 0.02,
            sustain_ms: 0,
            reduction,
            proportional: false,
            range: 0.25,
            attack_ms: 50,
            release_ms: 200,
            hold_ms: 100,
        }
    }

    /// En modo proporcional, hablar bajito debe bajar menos que gritar.
    #[test]
    fn proporcional_baja_segun_lo_fuerte_que_suene() {
        fn gain_para(pico: f32) -> f32 {
            let mut ducker = Ducker::new();
            let mut regla = rule(&["*discord*"], &[], 0.2);
            regla.proportional = true;
            regla.range = 0.4;
            ducker.configure(config(vec![regla]));

            let dt = Duration::from_millis(50);
            let sessions = vec![
                session(1, "Discord.exe", pico, 1.0),
                session(2, "game.exe", 0.0, 1.0),
            ];
            // Suficientes ticks para que la rampa llegue al objetivo.
            for _ in 0..40 {
                ducker.tick(&sessions, dt);
            }
            ducker.gain()
        }

        let flojito = gain_para(0.08);
        let normal = gain_para(0.25);
        let grito = gain_para(0.60);

        assert!(
            flojito > normal && normal > grito,
            "deberia bajar mas cuanto mas fuerte suene: {flojito} / {normal} / {grito}"
        );
        // Hablando bajito apenas se nota.
        assert!(flojito > 0.85, "flojito bajo demasiado: {flojito}");
        // Gritando llega al tope configurado (0.2).
        assert!(grito < 0.25, "el grito no llego al tope: {grito}");
    }

    fn config(rules: Vec<DuckingRule>) -> DuckingConfig {
        DuckingConfig { rules }
    }

    /// Deja pasar los ticks necesarios para que se confirme un espejo.
    fn rueda(ducker: &mut Ducker, sessions: &[AudioSession], veces: u32) {
        for _ in 0..veces {
            ducker.tick(sessions, Duration::from_millis(50));
        }
    }

    /// Un aviso de Discord no puede bajar la musica; una voz si.
    ///
    /// Es el caso real que lo motivo: medido en una llamada, los pings y clics
    /// duran 150 ms de mediana y aparecian cada pocos segundos, asi que con el
    /// hold encadenado la musica se quedaba baja practicamente siempre.
    #[test]
    fn un_golpe_corto_no_baja_la_musica_pero_una_voz_si() {
        fn gain_tras(ms_sonando: u64) -> f32 {
            let mut ducker = Ducker::new();
            let mut regla = rule(&["*discord*"], &[], 0.3);
            regla.sustain_ms = 300;
            regla.threshold = 0.05;
            ducker.configure(config(vec![regla]));

            let dt = Duration::from_millis(50);
            let fuerte = vec![
                session(1, "Discord.exe", 0.5, 1.0),
                session(2, "Spotify.exe", 0.4, 1.0),
            ];

            for _ in 0..(ms_sonando / 50) {
                ducker.tick(&fuerte, dt);
            }
            ducker.gain()
        }

        // Un ping de 150 ms, que es la mediana medida, no debe mover nada.
        assert!(
            gain_tras(150) > 0.99,
            "un golpe corto ha bajado la musica: {}",
            gain_tras(150)
        );

        // Alguien hablando medio segundo si.
        assert!(
            gain_tras(500) < 0.95,
            "medio segundo de voz tendria que haber bajado: {}",
            gain_tras(500)
        );
    }

    /// Y las pausas entre silabas no pueden cortar la atenuacion.
    #[test]
    fn los_huecos_entre_palabras_no_reinician_la_cuenta() {
        let mut ducker = Ducker::new();
        let mut regla = rule(&["*discord*"], &[], 0.3);
        regla.sustain_ms = 300;
        regla.threshold = 0.05;
        ducker.configure(config(vec![regla]));

        let dt = Duration::from_millis(50);
        let hablando = vec![
            session(1, "Discord.exe", 0.5, 1.0),
            session(2, "Spotify.exe", 0.4, 1.0),
        ];
        let hueco = vec![
            session(1, "Discord.exe", 0.0, 1.0),
            session(2, "Spotify.exe", 0.4, 1.0),
        ];

        // Medio segundo hablando, un hueco de 100 ms, y sigue.
        for _ in 0..10 {
            ducker.tick(&hablando, dt);
        }
        for _ in 0..2 {
            ducker.tick(&hueco, dt);
        }
        for _ in 0..4 {
            ducker.tick(&hablando, dt);
        }

        assert!(
            ducker.gain() < 0.95,
            "la pausa entre palabras ha cortado la atenuacion: {}",
            ducker.gain()
        );
    }

    /// Discord midiendo la mezcla del sistema no debe disparar la atenuacion.
    ///
    /// El sintoma real: su medidor va clavado al de la salida, subiendo y
    /// bajando con la musica de Spotify aunque nadie hable.
    #[test]
    fn ignora_al_que_mide_todo_el_sistema() {
        let mut ducker = Ducker::new();
        ducker.configure(config(vec![rule(&["*discord*"], &["Spotify.exe"], 0.3)]));

        // Spotify suena a 0.50 y su volumen esta al 80%, asi que la mezcla
        // final marca 0.40. Discord marca exactamente eso mismo: esta
        // reflejando la salida entera, no su propio audio.
        let sessions = vec![
            session(1, "Discord.exe", 0.40, 1.0),
            session(2, "Spotify.exe", 0.50, 0.8),
        ];
        ducker.set_device(0.40, 1.0);

        rueda(&mut ducker, &sessions, TICKS_ESPEJO as u32 + 2);

        assert_eq!(
            ducker.espejos(),
            vec![1],
            "deberia haber reconocido a Discord como espejo"
        );

        // Durante el medio segundo que tarda en confirmarlo si atenua, y eso
        // esta bien: mas vale medio segundo de duda que apagar el ducking a la
        // primera coincidencia. Lo que importa es que despues suelte.
        rueda(&mut ducker, &sessions, 20);
        assert!(
            ducker.gain() > 0.99,
            "tendria que haber soltado al reconocer el espejo: gain {}",
            ducker.gain()
        );
    }

    /// Y el caso que NO puede romperse: hablar por Discord sin nada mas
    /// sonando. Ahi su pico tambien coincide con el de la salida, porque es lo
    /// unico que suena, y aun asi tiene que atenuar.
    #[test]
    fn hablar_a_solas_sigue_atenuando() {
        let mut ducker = Ducker::new();
        ducker.configure(config(vec![rule(&["*discord*"], &["Spotify.exe"], 0.3)]));

        let sessions = vec![
            session(1, "Discord.exe", 0.40, 1.0),
            session(2, "Spotify.exe", 0.0, 1.0),
        ];
        ducker.set_device(0.40, 1.0);

        rueda(&mut ducker, &sessions, TICKS_ESPEJO as u32 + 2);

        assert!(
            ducker.espejos().is_empty(),
            "nadie explica ese nivel salvo Discord: no es un espejo"
        );
        assert!(
            ducker.gain() < 0.5,
            "tendria que estar atenuando: gain {}",
            ducker.gain()
        );
    }

    #[test]
    fn atenua_cuando_hay_voz_y_no_toca_al_que_habla() {
        let mut ducker = Ducker::new();
        ducker.configure(config(vec![rule(&["*discord*"], &[], 0.5)]));
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

    /// El caso que pidio el usuario: solo baja Spotify, el juego se queda.
    #[test]
    fn una_regla_con_objetivo_concreto_no_toca_a_los_demas() {
        let mut ducker = Ducker::new();
        ducker.configure(config(vec![rule(&["*discord*"], &["Spotify.exe"], 0.3)]));
        let dt = Duration::from_millis(50);

        let sessions = vec![
            session(1, "Discord.exe", 0.6, 1.0),
            session(2, "Spotify.exe", 0.4, 1.0),
            session(3, "VALORANT.exe", 0.7, 1.0),
        ];

        ducker.tick(&sessions, dt);
        let changes = ducker.tick(&sessions, dt);

        assert!(
            changes.iter().all(|(pid, _)| *pid == 2),
            "solo Spotify deberia cambiar, pero cambio: {changes:?}"
        );
    }

    /// Las dos direcciones montadas a la vez, sin pisarse.
    #[test]
    fn dos_reglas_opuestas_conviven() {
        let mut ducker = Ducker::new();
        ducker.configure(config(vec![
            rule(&["*discord*"], &["VALORANT.exe"], 0.4),
            rule(&["VALORANT.exe"], &["*discord*"], 0.6),
        ]));
        let dt = Duration::from_millis(50);

        // Solo habla Discord -> baja VALORANT, Discord intacto.
        let hablando = vec![
            session(1, "Discord.exe", 0.6, 1.0),
            session(2, "VALORANT.exe", 0.0, 1.0),
        ];
        ducker.tick(&hablando, dt);
        for _ in 0..6 {
            ducker.tick(&hablando, dt);
        }
        let changes = ducker.tick(&hablando, dt);
        assert!(
            changes.iter().all(|(pid, _)| *pid == 2),
            "hablando por Discord solo deberia bajar VALORANT: {changes:?}"
        );
    }

    /// Simula el bucle real aplicando los cambios, que es lo unico que revela
    /// los errores acumulativos.
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
        ducker.configure(config(vec![rule(&["*discord*"], &[], 0.5)]));
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
        ducker.configure(config(vec![rule(&["*discord*"], &[], 0.5)]));
        let dt = Duration::from_millis(50);

        let talking = vec![
            session(1, "Discord.exe", 0.6, 1.0),
            session(2, "game.exe", 0.5, 0.8),
        ];
        for _ in 0..11 {
            ducker.tick(&talking, dt);
        }
        assert!(ducker.gain() < 0.6);

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
