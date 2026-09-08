import type { AppGroup } from "./group";
import { resolveIcon } from "./icons";

/** Una regla de volumen para una aplicacion dentro de un modo. */
export type AppRule = {
  /** Ejecutable, o patron con comodines: "chrome.exe", "*discord*" */
  match: string;
  /** 0..1 */
  volume: number;
  muted: boolean;
};

/**
 * Configuracion del ducking. Espejo de `DuckingConfig` en Rust
 * (src-tauri/src/audio/ducking.rs).
 */
export type Ducking = {
  enabled: boolean;
  /** Patrones de ejecutable que disparan la atenuacion */
  triggers: string[];
  /** Que se atenua. Vacio = todo lo que no sea un disparador. */
  targets: string[];
  /** Pico a partir del cual se considera que hay voz (0..1) */
  threshold: number;
  /** 0.4 = baja al 40% */
  reduction: number;
  attackMs: number;
  releaseMs: number;
  holdMs: number;
};

export const DEFAULT_DUCKING: Ducking = {
  enabled: false,
  triggers: ["*discord*", "*teamspeak*", "*ventrilo*"],
  targets: [],
  threshold: 0.02,
  reduction: 0.4,
  attackMs: 60,
  releaseMs: 400,
  holdMs: 350,
};

/** Preajustes de agresividad, para no obligar a tocar cuatro numeros. */
export const DUCKING_PRESETS = {
  suave: { reduction: 0.65, attackMs: 120, releaseMs: 600, holdMs: 500 },
  normal: { reduction: 0.4, attackMs: 60, releaseMs: 400, holdMs: 350 },
  agresivo: { reduction: 0.15, attackMs: 25, releaseMs: 250, holdMs: 250 },
} as const;

/** Cuando debe activarse un modo solo, sin que nadie pulse nada. */
export type AutoActivate = {
  /** Ejecutables que lo disparan: ["VALORANT.exe"] */
  processes: string[];
  /** Identificadores de dispositivo de salida que lo disparan */
  devices: string[];
  /** Franja horaria, formato "23:00". Puede cruzar la medianoche. */
  schedule: { from: string; to: string } | null;
};

/**
 * Atajo para pasar al siguiente modo.
 *
 * NO usamos Ctrl+Alt+Tab aunque seria lo natural: Windows se lo queda para la
 * vista de tareas y el registro fallaria.
 */
export const CYCLE_HOTKEY = "CommandOrControl+Alt+0";

/** Atajo de panico: devolver todo al 100% sin soltar el raton del juego. */
export const RESET_HOTKEY = "CommandOrControl+Alt+9";

export const DEFAULT_AUTO: AutoActivate = {
  processes: [],
  devices: [],
  schedule: null,
};

export type Mode = {
  id: string;
  name: string;
  /** Clave de MODE_ICONS; ver src/lib/icons.ts */
  icon: string;
  /** Color hex; al activar el modo tine la aplicacion entera */
  accent: string;
  /** Acelerador global, formato de Tauri: "CommandOrControl+Alt+1" */
  hotkey: string | null;
  ducking: Ducking;
  autoActivate: AutoActivate;
  rules: AppRule[];
  /**
   * Que hacer con las apps que no tienen regla.
   * `null` = no tocarlas, que es lo prudente por defecto: un modo no deberia
   * cambiar el volumen de cosas de las que no sabe nada.
   */
  fallbackVolume: number | null;
};

/**
 * Casa una regla con un ejecutable. Sin comodines es igualdad exacta
 * (sin distinguir mayusculas); con `*` alrededor, subcadena.
 */
export function matches(pattern: string, exe: string): boolean {
  const p = pattern.toLowerCase().trim();
  const target = exe.toLowerCase();
  if (!p) return false;

  if (p.startsWith("*") && p.endsWith("*") && p.length > 2) {
    return target.includes(p.slice(1, -1));
  }
  if (p.startsWith("*")) return target.endsWith(p.slice(1));
  if (p.endsWith("*")) return target.startsWith(p.slice(0, -1));
  return target === p;
}

export function ruleFor(mode: Mode, exe: string): AppRule | undefined {
  return mode.rules.find((rule) => matches(rule.match, exe));
}

/** Los cambios de volumen y mute que implica activar un modo. */
export function planFor(
  mode: Mode,
  groups: AppGroup[]
): Array<{ pids: number[]; volume: number; muted: boolean }> {
  const plan = [];

  for (const group of groups) {
    const rule = ruleFor(mode, group.exe);

    if (rule) {
      plan.push({ pids: group.pids, volume: rule.volume, muted: rule.muted });
    } else if (mode.fallbackVolume !== null) {
      plan.push({
        pids: group.pids,
        volume: mode.fallbackVolume,
        muted: false,
      });
    }
  }

  return plan;
}

/** Snapshot del mezclador tal y como esta ahora, para guardarlo en un modo. */
export function rulesFromCurrent(groups: AppGroup[]): AppRule[] {
  return groups
    .filter((group) => !group.isSystem)
    .map((group) => ({
      match: group.exe,
      volume: group.volume,
      muted: group.muted,
    }));
}

export function newMode(): Mode {
  return {
    id: crypto.randomUUID(),
    name: "Modo nuevo",
    icon: "sliders",
    accent: "#38bdf8",
    hotkey: null,
    ducking: { ...DEFAULT_DUCKING },
    autoActivate: { ...DEFAULT_AUTO },
    rules: [],
    fallbackVolume: null,
  };
}

/**
 * Ahora mismo cae dentro de la franja? Soporta cruzar la medianoche
 * ("23:00" a "08:00"), que es justo el caso del modo Noche.
 */
export function inSchedule(
  schedule: { from: string; to: string },
  now = new Date()
): boolean {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  const from = parse(schedule.from);
  const to = parse(schedule.to);

  return from <= to
    ? minutes >= from && minutes < to
    : minutes >= from || minutes < to;
}

/**
 * Rellena lo que falte en un modo leido de disco.
 *
 * Los modos guardados por una version anterior no tienen los campos nuevos, y
 * pasarle un `ducking` undefined a Rust reventaria la deserializacion.
 */
export function normalize(mode: Mode): Mode {
  return {
    ...mode,
    // Los modos guardados con emoji se traducen al icono equivalente.
    icon: resolveIcon(mode.icon),
    ducking: { ...DEFAULT_DUCKING, ...(mode.ducking ?? {}) },
    autoActivate: { ...DEFAULT_AUTO, ...(mode.autoActivate ?? {}) },
    rules: mode.rules ?? [],
    fallbackVolume: mode.fallbackVolume ?? null,
  };
}

/**
 * Modos de fabrica.
 *
 * Las reglas apuntan a ejecutables corrientes; las que no existan en esta
 * maquina simplemente no casan con nada y no molestan. La idea es que sirvan de
 * punto de partida y el usuario los ajuste con "Guardar niveles actuales".
 */
export const DEFAULT_MODES: Mode[] = [
  {
    id: "competitive",
    name: "Competitivo",
    icon: "crosshair",
    accent: "#f43f5e",
    hotkey: "CommandOrControl+Alt+1",
    ducking: { ...DEFAULT_DUCKING, enabled: true, ...DUCKING_PRESETS.agresivo },
    autoActivate: { ...DEFAULT_AUTO },
    rules: [
      { match: "*discord*", volume: 1, muted: false },
      { match: "*teamspeak*", volume: 1, muted: false },
      { match: "Spotify.exe", volume: 0.15, muted: false },
      { match: "chrome.exe", volume: 0.3, muted: false },
    ],
    fallbackVolume: 0.55,
  },
  {
    id: "cinema",
    name: "Cine",
    icon: "clapperboard",
    accent: "#a78bfa",
    hotkey: "CommandOrControl+Alt+2",
    ducking: { ...DEFAULT_DUCKING, enabled: false },
    autoActivate: { ...DEFAULT_AUTO },
    rules: [
      { match: "*discord*", volume: 0.25, muted: false },
      { match: "Spotify.exe", volume: 0, muted: true },
    ],
    fallbackVolume: 1,
  },
  {
    id: "music",
    name: "Musica",
    icon: "headphones",
    accent: "#34d399",
    hotkey: "CommandOrControl+Alt+3",
    ducking: { ...DEFAULT_DUCKING, enabled: true, ...DUCKING_PRESETS.suave },
    autoActivate: { ...DEFAULT_AUTO },
    rules: [
      { match: "Spotify.exe", volume: 1, muted: false },
      { match: "*discord*", volume: 0.5, muted: false },
    ],
    fallbackVolume: 0.4,
  },
  {
    id: "stream",
    name: "Stream",
    icon: "radio",
    accent: "#fb923c",
    hotkey: "CommandOrControl+Alt+4",
    ducking: { ...DEFAULT_DUCKING, enabled: true, ...DUCKING_PRESETS.normal },
    autoActivate: { ...DEFAULT_AUTO, processes: ["obs64.exe"] },
    rules: [
      { match: "*discord*", volume: 0.8, muted: false },
      { match: "Spotify.exe", volume: 0.35, muted: false },
    ],
    fallbackVolume: 0.7,
  },
  {
    id: "night",
    name: "Noche",
    icon: "moon",
    accent: "#60a5fa",
    hotkey: "CommandOrControl+Alt+5",
    ducking: { ...DEFAULT_DUCKING, enabled: false },
    autoActivate: { ...DEFAULT_AUTO, schedule: { from: "23:00", to: "08:00" } },
    rules: [],
    fallbackVolume: 0.25,
  },
];
