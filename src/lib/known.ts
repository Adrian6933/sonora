import type { AppGroup } from "./group";

/**
 * Una aplicación que Sonora ha visto usar el audio alguna vez.
 *
 * El mezclador solo puede tocar lo que está sonando ahora —Windows no expone
 * una sesión para una aplicación cerrada—, pero sí podemos recordar cuáles
 * existen. Eso permite dos cosas que pedías: elegirlas en las reglas aunque
 * estén cerradas, y dejarles el volumen preparado para cuando se abran.
 */
export type KnownApp = {
  /** Clave: el ejecutable en minúsculas */
  key: string;
  exe: string;
  name: string;
  /** Ruta del .exe, para recuperar su icono */
  path: string;
  /** Marca de tiempo de la última vez que se la vio */
  lastSeen: number;
};

/** Volumen que se aplicará a una aplicación en cuanto vuelva a sonar. */
export type Preset = { volume: number; muted: boolean };

/** Mezcla las aplicaciones que suenan ahora con las ya conocidas. */
export function remember(
  known: KnownApp[],
  groups: AppGroup[]
): { list: KnownApp[]; changed: boolean } {
  const byKey = new Map(known.map((app) => [app.key, app]));
  let changed = false;
  const now = Date.now();

  for (const group of groups) {
    if (group.isSystem) continue;

    const previous = byKey.get(group.key);

    // Solo consideramos "cambio" lo que merece escribirse a disco: una
    // aplicación nueva, o una cuya ruta o nombre han cambiado. La marca de
    // tiempo se actualiza siempre pero no dispara un guardado por sí sola.
    if (
      !previous ||
      previous.path !== group.path ||
      previous.name !== group.name
    ) {
      changed = true;
    }

    byKey.set(group.key, {
      key: group.key,
      exe: group.exe,
      name: group.name,
      path: group.path || previous?.path || "",
      lastSeen: now,
    });
  }

  return {
    list: [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name)),
    changed,
  };
}

/** Las conocidas que ahora mismo NO están sonando. */
export function offlineApps(
  known: KnownApp[],
  groups: AppGroup[]
): KnownApp[] {
  const running = new Set(groups.map((group) => group.key));
  return known.filter((app) => !running.has(app.key));
}
