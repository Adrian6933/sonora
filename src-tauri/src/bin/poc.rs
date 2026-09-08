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
///   cargo run --bin poc -- duck "*powershell*" 8
///
/// Deja los volumenes como estaban al terminar.
fn duck(args: &[String]) -> Result<(), Box<dyn std::error::Error>> {
    use sonora_lib::audio::ducking::{DuckingConfig, Ducker};
    use std::time::{Duration, Instant};

    let trigger = args.get(1).ok_or("falta el patron disparador")?.clone();
    let seconds: u64 = args.get(2).map(|s| s.parse()).transpose()?.unwrap_or(8);

    let mut ducker = Ducker::new();
    ducker.configure(DuckingConfig {
        enabled: true,
        triggers: vec![trigger.clone()],
        targets: Vec::new(),
        threshold: 0.01,
        reduction: 0.4,
        attack_ms: 60,
        release_ms: 400,
        hold_ms: 250,
    });

    println!("\n  Disparador: {trigger}   ({seconds}s)\n");
    println!("  {:<7} {:>6}  {}", "t", "GAIN", "VOLUMENES");
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

            println!(
                "  {:<7.2} {:>5.2}   {}",
                start.elapsed().as_secs_f32(),
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
