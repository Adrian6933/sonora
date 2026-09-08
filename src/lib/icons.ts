import {
  Clapperboard,
  Crosshair,
  Gamepad2,
  Headphones,
  Mic,
  Moon,
  Music,
  Radio,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Iconos que puede llevar un modo.
 *
 * Antes eran emojis. Un emoji lo pinta la fuente del sistema, viene con su
 * propio color y su propio estilo, y en una interfaz oscura y sobria canta
 * muchisimo: es lo que hace que una aplicacion parezca un prototipo. Estos son
 * vectores del mismo juego que el resto y heredan el color del modo.
 */
export const MODE_ICONS = {
  crosshair: Crosshair,
  gamepad: Gamepad2,
  headphones: Headphones,
  music: Music,
  clapperboard: Clapperboard,
  radio: Radio,
  mic: Mic,
  moon: Moon,
  zap: Zap,
  shield: Shield,
  sparkles: Sparkles,
  sliders: SlidersHorizontal,
} satisfies Record<string, LucideIcon>;

export type ModeIcon = keyof typeof MODE_ICONS;

export const MODE_ICON_KEYS = Object.keys(MODE_ICONS) as ModeIcon[];

/** Equivalencias para los modos guardados cuando el icono era un emoji. */
const FROM_EMOJI: Record<string, ModeIcon> = {
  "🎯": "crosshair",
  "🎬": "clapperboard",
  "🎧": "headphones",
  "🔴": "radio",
  "🌙": "moon",
  "🎛️": "sliders",
  "🎛": "sliders",
  "🎮": "gamepad",
  "🎵": "music",
  "🎤": "mic",
};

/** Devuelve siempre un icono valido, venga lo que venga de disco. */
export function resolveIcon(value: string | undefined): ModeIcon {
  if (value && value in MODE_ICONS) return value as ModeIcon;
  if (value && FROM_EMOJI[value]) return FROM_EMOJI[value];
  return "sliders";
}

export function iconComponent(value: string | undefined): LucideIcon {
  return MODE_ICONS[resolveIcon(value)];
}
