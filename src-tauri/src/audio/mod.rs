//! Capa de acceso al audio de Windows (Core Audio / WASAPI).
//!
//! Todo el COM crudo vive aqui dentro. El resto de la aplicacion habla con
//! este modulo mediante tipos normales de Rust y nunca ve un puntero COM.

pub mod com;
pub mod com_thread;
pub mod devices;
pub mod ducking;
pub mod icons;
pub mod process;
pub mod sessions;

pub use com::ComGuard;
pub use sessions::{
    list_sessions, master_volume, set_master_volume, set_session_mute, set_session_volume,
    AudioSession,
};
