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
 * Una regla de prioridad: "cuando suene X, baja Y hasta Z%".
 * Espejo de `DuckingRule` en Rust (src-tauri/src/audio/ducking.rs).
 */
export type DuckingRule = {
  enabled: boolean;
  /** Patrones de ejecutable que disparan la atenuacion */
  triggers: string[];
  /** Que se atenua. Vacio = todo lo que no sea un disparador. */
  targets: string[];
  /** Pico a partir del cual se considera que hay voz (0..1) */
  threshold: number;
  /** Cuanto tiene que aguantar por encima del umbral para contar como voz */
  sustainMs: number;
  /** 0.4 = baja al 40%. En modo proporcional es el tope. */
  reduction: number;
  /** La bajada acompaña al volumen del disparador en vez de ser fija */
  proportional: boolean;
  /** Cuánto sonido por encima del umbral hace falta para llegar al tope */
  range: number;
  attackMs: number;
  releaseMs: number;
  holdMs: number;
};

export const DEFAULT_RULE: DuckingRule = {
  enabled: true,
  triggers: ["*discord*", "*teamspeak*", "*ventrilo*"],
  targets: [],
  // Suficiente para que no lo dispare un teclazo o el ventilador; se afina
  // con el medidor en vivo del editor.
  // Medido en una llamada real de Discord con amigos: el ruido de fondo de los
  // micros abiertos vive sobre 0,04 y da picos de 0,12. Por debajo de esto, la
  // musica bajaba el 15% del tiempo sin que nadie hablara.
  threshold: 0.12,
  // Medido en una llamada real: los avisos y clics duran 150 ms de mediana, y
  // una voz dura segundos. 300 ms deja fuera lo primero sin tocar lo segundo.
  sustainMs: 300,
  reduction: 0.4,
  proportional: false,
  range: 0.25,
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
  /** Se pone solo al abrir Sonora. Solo un modo puede tenerlo. */
  onStartup: boolean;
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
  onStartup: false,
  processes: [],
  devices: [],
  schedule: null,
};

export type Mode = {
  id: string;
  name: string;
  /** Nota tuya sobre para qué sirve el modo. Se ve en su tarjeta. */
  description: string;
  /** Clave de MODE_ICONS; ver src/lib/icons.ts */
  icon: string;
  /** Color hex; al activar el modo tine la aplicacion entera */
  accent: string;
  /** Acelerador global, formato de Tauri: "CommandOrControl+Alt+1" */
  hotkey: string | null;
  /** Varias a la vez: permite montar las dos direcciones */
  duckingRules: DuckingRule[];
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

/**
 * Convierte un patron en algo legible: "*ventrilo*" -> "Ventrilo".
 *
 * Los asteriscos son sintaxis interna; nadie deberia tener que descifrarlos
 * para entender su propia configuracion.
 */
export function prettyPattern(pattern: string): string {
  const limpio = pattern.replace(/\*/g, "").replace(/\.exe$/i, "").trim();
  if (!limpio) return pattern;
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
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

/** Regla nueva vacía, para el botón "Añadir regla". */
export function newRule(): DuckingRule {
  return { ...DEFAULT_RULE, triggers: [], targets: [] };
}

export function newMode(): Mode {
  return {
    id: crypto.randomUUID(),
    name: "Modo nuevo",
    description: "",
    icon: "sliders",
    accent: "#38bdf8",
    hotkey: null,
    duckingRules: [],
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
/** Convierte la configuracion antigua de una sola regla en la lista nueva. */
function migrateRules(mode: Mode & { ducking?: Partial<DuckingRule> }): DuckingRule[] {
  if (Array.isArray(mode.duckingRules)) {
    return mode.duckingRules.map((rule) => ({ ...DEFAULT_RULE, ...rule, ...subeUmbralViejo(rule) }));
  }
  // Solo se conserva si estaba activada; una regla apagada no aporta nada.
  if (mode.ducking?.enabled) return [{ ...DEFAULT_RULE, ...mode.ducking }];
  return [];
}

/**
 * Sube el umbral de las reglas guardadas antes de medirlo bien.
 *
 * El 0,05 de antes no lo eligio nadie: era nuestro valor por defecto, y con el
 * la musica bajaba sola el 15% del tiempo en una llamada normal. Solo se toca
 * si esta clavado en ese valor Y la regla es de antes (no tiene `sustainMs`);
 * si alguien lo movio a mano, se respeta.
 */
function subeUmbralViejo(rule: Partial<DuckingRule>): Partial<DuckingRule> {
  const esDeAntes = rule.sustainMs === undefined;
  const nuncaTocado = rule.threshold === 0.05;
  return esDeAntes && nuncaTocado ? { threshold: DEFAULT_RULE.threshold } : {};
}

export function normalize(mode: Mode): Mode {
  return {
    ...mode,
    // El modo de fabrica se llamo "Musica", sin tilde. Solo se corrige si nadie
    // lo ha renombrado.
    name: mode.id === "music" && mode.name === "Musica" ? "Música" : mode.name,
    // Los modos guardados con emoji se traducen al icono equivalente.
    icon: resolveIcon(mode.icon),
    description: mode.description ?? "",
    // Los modos guardados antes tenian UNA sola regla en `ducking`.
    duckingRules: migrateRules(mode),
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
    description: "Voz por encima de todo. El juego baja en cuanto alguien habla.",
    icon: "crosshair",
    accent: "#f43f5e",
    hotkey: "CommandOrControl+Alt+1",
    duckingRules: [{ ...DEFAULT_RULE, ...DUCKING_PRESETS.agresivo }],
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
    description: "La película manda: Discord bajo y la música callada.",
    icon: "clapperboard",
    accent: "#a78bfa",
    hotkey: "CommandOrControl+Alt+2",
    duckingRules: [],
    autoActivate: { ...DEFAULT_AUTO },
    rules: [
      { match: "*discord*", volume: 0.25, muted: false },
      { match: "Spotify.exe", volume: 0, muted: true },
    ],
    fallbackVolume: 1,
  },
  {
    id: "music",
    name: "Música",
    description: "Música al 100% que baja al 30% mientras alguien habla.",
    icon: "headphones",
    accent: "#34d399",
    hotkey: "CommandOrControl+Alt+3",
    // La música baja al 30% mientras alguien habla, con curva suave para que
    // no dé un tirón. Discord se queda al 100%: si bajas la música para oír a
    // quien habla, lo último que quieres es tenerlo a medio volumen.
    duckingRules: [
      { ...DEFAULT_RULE, ...DUCKING_PRESETS.suave, reduction: 0.3 },
    ],
    autoActivate: { ...DEFAULT_AUTO },
    rules: [
      { match: "Spotify.exe", volume: 1, muted: false },
      { match: "*discord*", volume: 1, muted: false },
    ],
    fallbackVolume: null,
  },
  {
    id: "stream",
    name: "Stream",
    description: "Equilibrio para directo: se oye todo sin taparse.",
    icon: "radio",
    accent: "#fb923c",
    hotkey: "CommandOrControl+Alt+4",
    duckingRules: [{ ...DEFAULT_RULE, ...DUCKING_PRESETS.normal }],
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
    description: "Todo bajito a partir de las 23:00 para no despertar a nadie.",
    icon: "moon",
    accent: "#60a5fa",
    hotkey: "CommandOrControl+Alt+5",
    duckingRules: [],
    autoActivate: { ...DEFAULT_AUTO, schedule: { from: "23:00", to: "08:00" } },
    rules: [],
    fallbackVolume: 0.25,
  },
];
