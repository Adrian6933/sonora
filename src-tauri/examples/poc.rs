//! Prueba de concepto de la capa de audio, sin interfaz.
//!
//! Es el paso 1 del PLAN.md: verificar que podemos leer y controlar el audio de
//! Windows desde Rust antes de invertir nada en la UI.
//!
//!   cargo run --bin poc                    lista las sesiones de audio
//!   cargo run --bin poc -- vol 1234 0.5    pone la app con PID 1234 al 50%
//!   cargo run --bin poc -- mute 1234       silencia la app con PID 1234
//!   cargo run --bin poc -- unmute 1234
//!   cargo run --bin poc -- master 0.8      volumen general al 80%

use base64::Engine;
use sonora_lib::audio::{self, ComGuard};

const NL: &str = "";

fn main() {
    // COM tiene que estar vivo durante toda la funcion, de ahi el guard.
    let _com = ComGuard::new();

    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args.first().map(String::as_str) {
        None => list(),
        Some("vol") => set_volume(&args),
        Some("mute") => set_mute(&args, true),
        Some("unmute") => set_mute(&args, false),
        Some("master") => set_master(&args),
        Some("icon") => dump_icon(&args),
        Some("duck") => duck(&args),
        Some("procs") => procs(&args),
        Some("watch") => watch(&args),
        Some("boost") => boost(&args),
        Some("boostab") => boost_ab(&args),
        Some("salidas") => {
            match audio::sessions::sessions_por_dispositivo() {
                Ok(lista) => {
                    for (nombre, pico, sesiones) in lista {
                        println!("
  {nombre}   [dispositivo {pico:.4}]");
                        if sesiones.is_empty() {
                            println!("     (sin sesiones)");
                        }
                        for s in sesiones.iter().filter(|s| !s.is_system) {
                            println!(
                                "     {:<16} vol={:>3.0}%  pico {:.4}  {}",
                                truncate(&s.name, 16),
                                s.volume * 100.0,
                                s.peak,
                                if s.active { "sonando" } else { "inactiva" }
                            );
                        }
                    }
                    println!();
                    Ok(())
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("descarga") => {
            match sonora_lib::audio::boost::salidas_con_descarga() {
                Ok(lista) => {
                    for (nombre, descarga) in lista {
                        println!("  {:<50} descarga por hardware: {}", nombre,
                                 if descarga { "SI" } else { "no" });
                    }
                    Ok(())
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("canales") => {
            let pid: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            match audio::sessions::canales_de(pid) {
                Ok(v) => {
                    println!("  volumen por canal: {:?}", v);
                    Ok(())
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("cuelgue") => {
            // Amplifica y muere sin soltar nada, como un cierre brusco.
            let pid: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let boosts = sonora_lib::audio::boosts::Boosts::new();
            match boosts.set(pid, 2.0) {
                Ok(()) => {
                    println!("  amplificada; muero sin limpiar");
                    std::thread::sleep(std::time::Duration::from_secs(2));
                    std::process::exit(0);
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("rescata") => {
            let n = sonora_lib::audio::boosts::recupera_tras_cierre();
            println!("  rescatadas: {n}");
            Ok(())
        }
        Some("compara") => {
            let pid: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            let seg: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(10);
            match sonora_lib::audio::boost::compara_medidor_y_captura(pid, seg) {
                Ok(filas) => {
                    println!("  MEDIDOR  CAPTURA  DISPOSIT");
                    for (m, c, d) in filas {
                        println!("  {m:.4}   {c:.4}   {d:.4}");
                    }
                    Ok(())
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("formato") => {
            match sonora_lib::audio::boost::formato_salida() {
                Ok((hz, canales, bits, tag, sub)) => {
                    println!("  {hz} Hz · {canales} canales · {bits} bits · tag {tag}");
                    println!("  subformato: {sub}");
                    Ok(())
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("nivel") => {
            let pid: u32 = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);
            match sonora_lib::audio::boost::nivel_capturado(pid, 4) {
                Ok((pico, cuadros, mudos)) => {
                    println!("  pico capturado {pico:.4}  cuadros {cuadros}  paquetes mudos {mudos}");
                    Ok(())
                }
                Err(e) => Err(e.into()),
            }
        }
        Some("devices") => devices(),
        Some(other) => {
            eprintln!("orden desconocida: {other}");
            std::process::exit(2);
        }
    };

    if let Err(error) = result {
        eprintln!("\nERROR: {error}");
        std::process::exit(1);
    }
}

fn list() -> Result<(), Box<dyn std::error::Error>> {
    let sessions = audio::list_sessions()?;
    let master = audio::master_volume()?;

    println!("\n  Volumen general: {:.0}%\n", master * 100.0);
    println!(
        "  {:<8} {:<24} {:>7}  {:<6} {:<9} {}",
        "PID", "APLICACION", "VOL", "MUTE", "ESTADO", "NIVEL"
    );
    println!("  {}", "-".repeat(72));

    if sessions.is_empty() {
        println!("  (ninguna sesion de audio activa)");
    }

    for session in &sessions {
        // Medidor de 20 caracteres, para ver de un vistazo quien esta sonando.
        let filled = (session.peak * 20.0).round() as usize;
        let meter = format!(
            "{}{}",
            "#".repeat(filled.min(20)),
            ".".repeat(20 - filled.min(20))
        );

        println!(
            "  {:<8} {:<24} {:>6.0}%  {:<6} {:<9} {}",
            session.pid,
            truncate(&session.name, 24),
            session.volume * 100.0,
            if session.muted { "SI" } else { "no" },
            if session.active { "sonando" } else { "inactiva" },
            meter
        );
    }

    println!();
    Ok(())
}

fn set_volume(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let pid: u32 = args.get(1).ok_or("falta el PID")?.parse()?;
    let volume: f32 = args.get(2).ok_or("falta el volumen (0.0 - 1.0)")?.parse()?;
    audio::set_session_volume(pid, volume)?;
    println!("PID {pid} -> {:.0}%", volume * 100.0);
    Ok(())
}

fn set_mute(args: &[String], muted: bool) -> Result<(), Box<dyn std::error::Error>> {
    let pid: u32 = args.get(1).ok_or("falta el PID")?.parse()?;
    audio::set_session_mute(pid, muted)?;
    println!("PID {pid} -> {}", if muted { "silenciado" } else { "activo" });
    Ok(())
}

fn set_master(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let volume: f32 = args.get(1).ok_or("falta el volumen (0.0 - 1.0)")?.parse()?;
    audio::set_master_volume(volume)?;
    println!("volumen general -> {:.0}%", volume * 100.0);
    Ok(())
}

/// Ejecuta el motor de ducking contra el audio real durante unos segundos.
///
///   cargo run --example poc -- duck "*powershell*" 8
///   cargo run --example poc -- duck "*discord*" 15 prop
///
/// Con `prop` la bajada acompana al volumen del disparador en vez de ser
/// fija. Deja los volumenes como estaban al terminar.
fn duck(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use sonora_lib::audio::ducking::{matches, DuckingConfig, DuckingRule, Ducker};
    use std::time::{Duration, Instant};

    let trigger = args.get(1).ok_or("falta el patron disparador")?.clone();
    let seconds: u64 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(8);
    let proportional = args.iter().any(|a| a == "prop");

    let mut ducker = Ducker::new();
    ducker.configure(DuckingConfig {
        rules: vec![DuckingRule {
            enabled: true,
            triggers: vec![trigger.clone()],
            targets: Vec::new(),
            threshold: 0.01,
            sustain_ms: 0,
            reduction: 0.4,
            proportional,
            range: 0.4,
            attack_ms: 60,
            release_ms: 400,
            hold_ms: 250,
        }],
    });

    println!(
        "\n  Disparador: {trigger}   ({seconds}s){}\n",
        if proportional { "   [proporcional]" } else { "" }
    );
    println!("  {:<7} {:>6} {:>6}  {}", "t", "PICO", "GAIN", "VOLUMENES");
    println!("  {}", "-".repeat(70));

    let tick = Duration::from_millis(50);
    let start = Instant::now();
    let mut last = Instant::now();
    let mut printed = Instant::now() - Duration::from_secs(1);

    while start.elapsed() < Duration::from_secs(seconds) {
        std::thread::sleep(tick);

        let dt = last.elapsed();
        last = Instant::now();

        let sessions = audio::list_sessions()?;
        let changes = ducker.tick(&sessions, dt);
        if !changes.is_empty() {
            audio::sessions::apply_volumes(&changes)?;
        }

        if printed.elapsed() >= Duration::from_millis(250) {
            printed = Instant::now();

            let levels: Vec<String> = sessions
                .iter()
                .filter(|s| !s.is_system)
                .map(|s| format!("{}={:.0}%", short(&s.name), s.volume * 100.0))
                .collect();

            // El pico del disparador es lo que gobierna la bajada en modo
            // proporcional; verlo al lado del gain explica cada numero.
            let pico = sessions
                .iter()
                .filter(|s| matches(&trigger, &s.exe))
                .fold(0.0_f32, |max, s| max.max(s.peak));

            println!(
                "  {:<7.2} {:>6.3} {:>6.2}   {}",
                start.elapsed().as_secs_f32(),
                pico,
                ducker.gain(),
                levels.join("  ")
            );
        }
    }

    // Devolver todo a su sitio.
    let restore = ducker.release_all();
    audio::sessions::apply_volumes(&restore)?;
    println!("\n  Restaurados {} volumenes.\n", restore.len());

    Ok(())
}

/// Amplifica una aplicacion por encima del 100% durante unos segundos.
///
///   cargo run --example poc -- boost 28900 2.5 10
///
/// Es la prueba que decide si el invento sirve: hay que OIR que sube, y que al
/// terminar vuelve a sonar como antes.
fn boost(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use sonora_lib::audio::boost::Boost;
    use std::time::{Duration, Instant};

    let pid: u32 = args.get(1).ok_or("falta el PID")?.parse()?;
    let ganancia: f32 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(2.0);
    let segundos: u64 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(10);

    println!("{}", NL);
    println!("  Amplificando PID {pid} x{ganancia:.1} durante {segundos}s");
    println!("{}", NL);

    let amplificador = Boost::start(pid, ganancia)?;
    println!("  arranco OK");
    println!("  {:<7} {:>8}  {}", "t", "PICO", "ESTADO DE LA SESION");
    println!("  {}", "-".repeat(64));

    let inicio = Instant::now();
    let mut impreso = Instant::now() - Duration::from_secs(1);

    while inicio.elapsed() < Duration::from_secs(segundos) {
        std::thread::sleep(Duration::from_millis(50));
        if impreso.elapsed() < Duration::from_millis(500) {
            continue;
        }
        impreso = Instant::now();

        let sesiones = audio::list_sessions()?;
        let propia = sesiones.iter().find(|s| s.pid == pid);
        let dispositivo = audio::sessions::endpoint_peak().unwrap_or(0.0);

        match propia {
            Some(s) => println!(
                "  {:<7.1} {:>8.4}  {} vol={:.0}% mute={}   [disposit {:.4}]",
                inicio.elapsed().as_secs_f32(),
                s.peak,
                short(&s.name),
                s.volume * 100.0,
                if s.muted { "SI" } else { "no" },
                dispositivo
            ),
            None => println!("  la sesion desaparecio"),
        }
    }

    drop(amplificador);
    println!("  Amplificacion detenida, la aplicacion vuelve a sonar sola.");
    Ok(())
}

/// Compara dos ganancias alternandolas dentro de la MISMA ejecucion.
///
/// Medir 10 segundos sin amplificar y otros 10 amplificando no vale de nada:
/// cada tramo de una cancion suena distinto y la diferencia que salga puede ser
/// de la musica, no del amplificador. Alternando cada segundo y medio, el
/// contenido se reparte entre las dos condiciones.
fn boost_ab(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use sonora_lib::audio::boost::Boost;
    use std::time::{Duration, Instant};

    let pid: u32 = args.get(1).ok_or("falta el PID")?.parse()?;
    let alta: f32 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(3.0);
    let vueltas: u32 = args.get(3).map(|s| s.parse()).transpose()?.unwrap_or(6);

    let amplificador = Boost::start(pid, 1.0)?;
    let mut sin = Vec::new();
    let mut con = Vec::new();

    for vuelta in 0..vueltas * 2 {
        let amplificando = vuelta % 2 == 1;
        amplificador.set_gain(if amplificando { alta } else { 1.0 });

        // Un respiro para que el cambio llegue al buffer antes de medir.
        std::thread::sleep(Duration::from_millis(250));

        let hasta = Instant::now() + Duration::from_millis(1250);
        while Instant::now() < hasta {
            std::thread::sleep(Duration::from_millis(50));
            let pico = audio::sessions::endpoint_peak().unwrap_or(0.0);
            if amplificando { con.push(pico) } else { sin.push(pico) }
        }
    }

    let (capturados, escritos) = amplificador.caudal();
    let entrada = amplificador.nivel_entrada();
    drop(amplificador);

    println!("  caudal       : {capturados} cuadros capturados, {escritos} escritos");
    println!("  pico entrada : {:.4} (nivel real de la aplicacion)", entrada);
    let media = |v: &Vec<f32>| v.iter().sum::<f32>() / v.len().max(1) as f32;
    let maximo = |v: &Vec<f32>| v.iter().cloned().fold(0.0_f32, f32::max);

    println!("  ganancia 1.0 : media {:.4}  maximo {:.4}  ({} muestras)", media(&sin), maximo(&sin), sin.len());
    println!("  ganancia {alta:.1} : media {:.4}  maximo {:.4}  ({} muestras)", media(&con), maximo(&con), con.len());
    println!("  subida real  : x{:.2}", media(&con) / media(&sin).max(1e-6));
    Ok(())
}

/// Imprime el pico de cada sesion varias veces por segundo.
///
/// Sirve para responder a "el medidor de X se mueve igual que el de Y": si los
/// numeros suben y bajan a la vez, el audio de una se esta colando en la otra.
fn watch(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use std::time::{Duration, Instant};

    let segundos: u64 = args.get(1).map(|s| s.parse()).transpose()?.unwrap_or(6);
    let inicio = Instant::now();

    let nombres: Vec<String> = audio::list_sessions()?
        .into_iter()
        .filter(|s| !s.is_system)
        .map(|s| s.name)
        .collect();

    println!();
    print!("{:>6}{:>12}", "t", "[DISPOSIT]");
    for n in &nombres {
        print!("{:>12}", short(n));
    }
    println!();

    while inicio.elapsed() < Duration::from_secs(segundos) {
        std::thread::sleep(Duration::from_millis(120));
        let ahora = audio::list_sessions()?;

        let disp = audio::sessions::endpoint_peak().unwrap_or(-1.0);
        print!("{:>6.1}{:>12.4}", inicio.elapsed().as_secs_f32(), disp);
        for n in &nombres {
            let pico = ahora
                .iter()
                .find(|s| &s.name == n)
                .map(|s| s.peak)
                .unwrap_or(0.0);
            print!("{:>12.4}", pico);
        }
        println!();
    }

    println!();
    Ok(())
}

/// Lista los dispositivos de salida con su nombre legible.
fn devices() -> Result<(), Box<dyn std::error::Error>> {
    let list = audio::devices::list_output_devices()?;

    println!("\n  {} dispositivos de salida activos\n", list.len());
    for device in &list {
        println!(
            "  {} {}",
            if device.is_default { "->" } else { "  " },
            device.name
        );
        println!("     {}", device.id);
    }
    println!();

    Ok(())
}

/// Comprueba la enumeracion de procesos que usa el auto-cambio de modo.
fn procs(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let all = sonora_lib::system::watcher::running_processes();
    println!("\n  {} procesos abiertos", all.len());

    for needle in args.iter().skip(1) {
        let needle = needle.to_lowercase();
        let hit = all.contains(&needle);
        println!("  {needle}: {}", if hit { "ABIERTO" } else { "cerrado" });
    }

    println!();
    Ok(())
}

fn short(name: &str) -> String {
    name.chars().take(8).collect()
}

/// Saca el icono de la app con ese PID a un .png, para comprobar a ojo que la
/// conversion HICON -> RGBA -> PNG esta bien.
fn dump_icon(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    let pid: u32 = args.get(1).ok_or("falta el PID")?.parse()?;
    let destination = args.get(2).map(String::as_str).unwrap_or("icono.png");

    let session = audio::list_sessions()?
        .into_iter()
        .find(|s| s.pid == pid)
        .ok_or("no hay ninguna sesion con ese PID")?;

    let uri = audio::icons::icon_data_uri(&session.path)
        .ok_or("no se pudo extraer el icono")?;

    let base64_part = uri.split(",").nth(1).ok_or("data URI mal formado")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(base64_part)?;
    std::fs::write(destination, &bytes)?;

    println!(
        "{} -> {} ({} bytes de PNG)",
        session.name,
        destination,
        bytes.len()
    );
    Ok(())
}

fn truncate(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        text.chars().take(max - 1).collect::<String>() + "…"
    }
}
