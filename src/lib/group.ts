import type { AudioSession } from "./ipc";

/**
 * Una aplicacion en el mezclador, que puede tener varias sesiones de audio.
 *
 * Windows abre una sesion por proceso, no por aplicacion: Discord tiene dos,
 * Steam suma `steamwebhelper.exe`, y Chrome abre una por pestana que suene. Sin
 * agrupar, el mezclador seria una lista inmanejable de duplicados.
 */
export type AppGroup = {
  /** Clave estable: el ejecutable en minusculas */
  key: string;
  name: string;
  exe: string;
  path: string;
  /** Todas las sesiones que manda este control */
  pids: number[];
  /** El mas alto del grupo: es el que de verdad se oye */
  volume: number;
  /** Solo si TODAS estan silenciadas */
  muted: boolean;
  /** El pico mas alto del grupo */
  peak: number;
  /** Si alguna esta emitiendo */
  active: boolean;
  isSystem: boolean;
};

export function groupSessions(sessions: AudioSession[]): AppGroup[] {
  const groups = new Map<string, AppGroup>();

  for (const session of sessions) {
    const key = session.exe.toLowerCase();
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, {
        key,
        name: session.name,
        exe: session.exe,
        path: session.path,
        pids: [session.pid],
        volume: session.volume,
        muted: session.muted,
        peak: session.peak,
        active: session.active,
        isSystem: session.isSystem,
      });
      continue;
    }

    existing.pids.push(session.pid);
    existing.volume = Math.max(existing.volume, session.volume);
    existing.peak = Math.max(existing.peak, session.peak);
    existing.muted = existing.muted && session.muted;
    existing.active = existing.active || session.active;
  }

  return [...groups.values()].sort((a, b) => {
    // Lo que esta sonando, arriba; el resto alfabetico.
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
