//! El hilo dueno de COM.
//!
//! Los objetos de Core Audio estan atados al hilo que los creo, asi que TODO el
//! acceso al audio pasa por aqui: un unico hilo con su propia inicializacion de
//! COM que recibe ordenes por un canal.
//!
//! El mismo hilo aprovecha los huecos entre ordenes para muestrear los niveles
//! y emitir el evento `sessions` al frontend. Al ser un solo hilo no hay
//! carreras posibles, y nos ahorramos toda la sincronizacion.

use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use super::devices::{self, AudioDevice};
use super::ducking::{DuckingConfig, Ducker};
use super::{sessions, AudioSession, ComGuard};

/// Cada cuanto se muestrean los niveles. 50 ms = 20 Hz: suficiente para que los
/// medidores se vean fluidos sin cargar la CPU con un juego corriendo.
const POLL_INTERVAL: Duration = Duration::from_millis(50);

type Reply<T> = Sender<Result<T, String>>;

pub enum Request {
    List(Reply<Vec<AudioSession>>),
    SetVolume(u32, f32, Reply<()>),
    SetMute(u32, bool, Reply<()>),
    GetMaster(Reply<f32>),
    SetMaster(f32, Reply<()>),
    /// Pausa el envio de medidores a la interfaz cuando la ventana no se ve.
    /// OJO: no para el bucle, porque el ducking tiene que seguir funcionando
    /// con la app escondida en la bandeja — que es justo cuando mas falta hace.
    SetPolling(bool),
    ListDevices(Reply<Vec<AudioDevice>>),
    SetDucking(Box<DuckingConfig>),
    /// Devuelve los volumenes atenuados a su valor original y espera a que este
    /// hecho. Se usa antes de salir: si el proceso muriera atenuando, las
    /// aplicaciones se quedarian al 40% y el usuario no sabria por que.
    ReleaseDucking(Reply<()>),
}

#[derive(Clone)]
pub struct AudioHandle {
    tx: Sender<Request>,
}

impl AudioHandle {
    pub fn spawn(app: AppHandle) -> Self {
        let (tx, rx) = channel::<Request>();

        thread::Builder::new()
            .name("sonora-audio".into())
            .spawn(move || {
                // COM vive tanto como el hilo.
                let _com = ComGuard::new();
                let mut polling = true;
                let mut ducker = Ducker::new();
                let mut last_tick = Instant::now();
                let mut last_gain = 1.0_f32;
                let mut last_device = String::new();

                loop {
                    match rx.recv_timeout(POLL_INTERVAL) {
                        Ok(Request::SetPolling(value)) => polling = value,
                        Ok(Request::SetDucking(config)) => {
                            // Al cambiar de modo hay que devolver los
                            // volumenes que el ducking anterior tenia bajados,
                            // o se quedarian atenuados para siempre.
                            let restore = ducker.configure(*config);
                            let _ = sessions::apply_volumes(&restore);
                        }
                        Ok(Request::ReleaseDucking(reply)) => {
                            let restore = ducker.release_all();
                            let _ = sessions::apply_volumes(&restore);
                            let _ = reply.send(Ok(()));
                        }
                        Ok(request) => handle(request),

                        Err(RecvTimeoutError::Timeout) => {
                            let dt = last_tick.elapsed();
                            last_tick = Instant::now();

                            // Conectar unos cascos cambia el dispositivo por
                            // defecto: es la senal para el auto-cambio de modo.
                            if let Ok(id) = devices::default_output_id() {
                                if id != last_device {
                                    let first = last_device.is_empty();
                                    last_device = id.clone();
                                    // El primer valor es el estado inicial, no
                                    // un cambio: no debe disparar nada.
                                    if !first {
                                        let _ = app.emit("device", &id);
                                    }
                                }
                            }

                            let Ok(list) = sessions::list_sessions() else {
                                continue;
                            };

                            if ducker.is_enabled() {
                                let changes = ducker.tick(&list, dt);
                                if !changes.is_empty() {
                                    let _ = sessions::apply_volumes(&changes);
                                }

                                // Solo avisamos a la interfaz cuando la
                                // atenuacion cambia de verdad, no 20 veces por
                                // segundo con el mismo valor.
                                let gain = ducker.gain();
                                if (gain - last_gain).abs() > 0.01 {
                                    last_gain = gain;
                                    let _ = app.emit("ducking", gain);
                                }
                            }

                            if polling {
                                let _ = app.emit("sessions", list);
                            }
                        }

                        // El canal se cerro: la app se esta apagando.
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .expect("no se pudo crear el hilo de audio");

        Self { tx }
    }

    fn ask<T, F>(&self, build: F) -> Result<T, String>
    where
        F: FnOnce(Reply<T>) -> Request,
    {
        let (tx, rx) = channel();
        self.tx
            .send(build(tx))
            .map_err(|_| "el hilo de audio no responde".to_string())?;
        rx.recv()
            .map_err(|_| "el hilo de audio murio durante la peticion".to_string())?
    }

    pub fn list(&self) -> Result<Vec<AudioSession>, String> {
        self.ask(Request::List)
    }

    pub fn set_volume(&self, pid: u32, volume: f32) -> Result<(), String> {
        self.ask(|reply| Request::SetVolume(pid, volume, reply))
    }

    pub fn set_mute(&self, pid: u32, muted: bool) -> Result<(), String> {
        self.ask(|reply| Request::SetMute(pid, muted, reply))
    }

    pub fn master(&self) -> Result<f32, String> {
        self.ask(Request::GetMaster)
    }

    pub fn devices(&self) -> Result<Vec<AudioDevice>, String> {
        self.ask(Request::ListDevices)
    }

    pub fn set_master(&self, volume: f32) -> Result<(), String> {
        self.ask(|reply| Request::SetMaster(volume, reply))
    }

    pub fn set_polling(&self, value: bool) {
        let _ = self.tx.send(Request::SetPolling(value));
    }

    pub fn set_ducking(&self, config: DuckingConfig) {
        let _ = self.tx.send(Request::SetDucking(Box::new(config)));
    }

    /// Bloquea hasta que los volumenes atenuados vuelven a su sitio.
    pub fn release_ducking(&self) -> Result<(), String> {
        self.ask(Request::ReleaseDucking)
    }
}

fn handle(request: Request) {
    // Si el que pregunto ya no esta escuchando, `send` falla y da igual.
    match request {
        Request::List(reply) => {
            let _ = reply.send(sessions::list_sessions().map_err(stringify));
        }
        Request::SetVolume(pid, volume, reply) => {
            let _ = reply.send(sessions::set_session_volume(pid, volume).map_err(stringify));
        }
        Request::SetMute(pid, muted, reply) => {
            let _ = reply.send(sessions::set_session_mute(pid, muted).map_err(stringify));
        }
        Request::GetMaster(reply) => {
            let _ = reply.send(sessions::master_volume().map_err(stringify));
        }
        Request::SetMaster(volume, reply) => {
            let _ = reply.send(sessions::set_master_volume(volume).map_err(stringify));
        }
        Request::ListDevices(reply) => {
            let _ = reply.send(devices::list_output_devices().map_err(stringify));
        }
        Request::SetPolling(_) | Request::SetDucking(_) | Request::ReleaseDucking(_) => {
            unreachable!("se tratan en el bucle, donde vive el estado")
        }
    }
}

fn stringify(error: windows::core::Error) -> String {
    error.message().to_string()
}
