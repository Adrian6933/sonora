import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { DuckingRule } from "./modes";

/** Espejo de `AudioSession` en Rust (src-tauri/src/audio/sessions.rs). */
export type AudioSession = {
  pid: number;
  /** Nombre para la UI: "Discord" */
  name: string;
  /** Ejecutable: "Discord.exe" — la clave con la que casan las reglas */
  exe: string;
  path: string;
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** Pico actual 0..1 */
  peak: number;
  /** false = tiene sesion abierta pero no esta emitiendo ahora */
  active: boolean;
  isSystem: boolean;
  /** Multiplicador de amplificacion, 1 = sin amplificar */
  boost: number;
  /**
   * Lo que marcaba el medidor de Windows cuando `peak` es lo que la aplicacion
   * reproduce de verdad. Si es mayor que `peak`, la diferencia es reflejo del
   * sonido de otras aplicaciones.
   */
  meterPeak?: number;
};

/** Espejo de `BoostInfo` en Rust (src-tauri/src/audio/boosts.rs). */
export type BoostInfo = {
  pid: number;
  /** Multiplicador: 2 es el doble de volumen */
  gain: number;
  /** Nivel real de la aplicacion, 0..1, para el medidor */
  level: number;
};

/** Espejo de `AudioDevice` en Rust (src-tauri/src/audio/devices.rs). */
export type AudioDevice = {
  /** Identificador estable de Windows; es lo que guardan los modos */
  id: string;
  /** "Altavoces (2- Logitech G733 Gaming Headset)" */
  name: string;
  isDefault: boolean;
};

export const ipc = {
  listSessions: () => invoke<AudioSession[]>("list_sessions"),

  setAppVolume: (pid: number, volume: number) =>
    invoke<void>("set_app_volume", { pid, volume }),

  setAppMute: (pid: number, muted: boolean) =>
    invoke<void>("set_app_mute", { pid, muted }),

  getMasterVolume: () => invoke<number>("get_master_volume"),

  setMasterVolume: (volume: number) =>
    invoke<void>("set_master_volume", { volume }),

  /**
   * Amplifica una aplicacion por encima del 100% de Windows.
   *
   * Con `gain` a 1 se apaga y la aplicacion recupera su volumen normal.
   */
  setAppBoost: (pid: number, gain: number) =>
    invoke<void>("set_app_boost", { pid, gain }),

  listBoosts: () => invoke<BoostInfo[]>("list_boosts"),

  /** Programas abiertos ahora mismo, para elegir disparadores sin escribir. */
  listOpenApps: () => invoke<string[]>("list_open_apps"),

  clearBoosts: () => invoke<void>("clear_boosts"),

  /** Aplicaciones cuyo sonido real hay que medir para el editor de prioridad. */
  setListenPatterns: (patterns: string[]) =>
    invoke<void>("set_listen_patterns", { patterns }),

  /** Pone los modos en el menu de la bandeja, con el activo marcado. */
  setTrayModes: (modes: Array<{ id: string; name: string }>, active: string | null) =>
    invoke<void>("set_tray_modes", { modes, active }),

  /** Ensena el aviso flotante de cambio de modo (ventana aparte). */
  flashHud: (payload: { name: string; icon: string; accent: string }) =>
    invoke<void>("flash_hud", { payload }),

  /** Dispositivos de salida activos, con el nombre que ensena Windows. */
  listDevices: () => invoke<AudioDevice[]>("list_devices"),

  /** Ejecutables a vigilar para el auto-cambio de modo. */
  setWatchedProcesses: (names: string[]) =>
    invoke<void>("set_watched_processes", { names }),

  /** Configura el motor de ducking. Se llama al activar un modo. */
  setDucking: (rules: DuckingRule[]) =>
    invoke<void>("set_ducking", { config: { rules } }),

  /** Icono del .exe como data URI PNG. Cacheado en Rust por ruta. */
  getAppIcon: (path: string) => invoke<string | null>("get_app_icon", { path }),

  /** Para de muestrear niveles cuando la ventana no se ve. */
  setPolling: (enabled: boolean) => invoke<void>("set_polling", { enabled }),
};

/** El backend emite esto 20 veces por segundo con el estado completo. */
export function onSessions(
  handler: (sessions: AudioSession[]) => void
): Promise<UnlistenFn> {
  return listen<AudioSession[]>("sessions", (event) => handler(event.payload));
}

/**
 * El dispositivo de salida por defecto ha cambiado (te has puesto los cascos).
 * Solo llega cuando cambia de verdad; el valor inicial no se emite.
 */
export function onDevice(
  handler: (deviceId: string) => void
): Promise<UnlistenFn> {
  return listen<string>("device", (event) => handler(event.payload));
}

/**
 * Cuales de los ejecutables vigilados estan abiertos ahora mismo,
 * en minusculas. Solo llega cuando la lista cambia.
 */
export function onProcesses(
  handler: (running: string[]) => void
): Promise<UnlistenFn> {
  return listen<string[]>("processes", (event) => handler(event.payload));
}

/**
 * Ganancia del ducking: 1 = sin atenuar, 0.4 = todo al 40%.
 * Solo llega cuando cambia de verdad, no en cada tick.
 */
export function onDucking(
  handler: (gain: number) => void
): Promise<UnlistenFn> {
  return listen<number>("ducking", (event) => handler(event.payload));
}

/**
 * PIDs cuyo medidor esta reflejando la mezcla de todo el sistema en vez de su
 * propio audio, y que por eso se ignoran como disparadores del ducking.
 *
 * Le pasa a Discord cuando comparte audio o monitoriza el microfono. Solo llega
 * cuando la lista cambia.
 */
export function onEspejos(
  handler: (pids: number[]) => void
): Promise<UnlistenFn> {
  return listen<number[]>("espejos", (event) => handler(event.payload));
}

/** Alguien ha elegido un modo desde la bandeja. `null` es "Sin modo". */
export function onTrayMode(
  handler: (modeId: string | null) => void
): Promise<UnlistenFn> {
  return listen<string | null>("tray-mode", (event) => handler(event.payload));
}

/** Alguien ha pulsado "Todo al 100%" en la bandeja. */
export function onTrayReset(handler: () => void): Promise<UnlistenFn> {
  return listen("tray-reset", () => handler());
}
