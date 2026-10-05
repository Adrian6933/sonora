import { useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";

/** Veces que se reintenta un icono que no llega antes de rendirse. */
const INTENTOS = 3;

/** Espera antes de volver a intentarlo, en milisegundos. */
const ESPERA_MS = 1500;

/**
 * Iconos de las aplicaciones, indexados por ruta del ejecutable.
 *
 * Cada icono se pide una vez y no caduca: el de un .exe no cambia mientras la
 * aplicacion vive. Lo que si se reintenta es el fallo. Sacar un icono puede
 * fallar por motivos pasajeros, y darlo por perdido a la primera dejaba
 * aplicaciones como Steam con la letra de siempre aunque su icono se sacara sin
 * problema un segundo despues.
 */
export function useIcons(paths: string[]) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const resueltos = useRef(new Set<string>());
  const enVuelo = useRef(new Set<string>());
  const intentos = useRef(new Map<string, number>());

  // La lista se recrea en cada refresco, asi que dependemos de su contenido y
  // no de la identidad del array.
  const key = paths.join("|");

  useEffect(() => {
    let vivo = true;
    const temporizadores: number[] = [];

    const pedir = (path: string) => {
      if (!vivo || !path) return;
      if (resueltos.current.has(path) || enVuelo.current.has(path)) return;
      if ((intentos.current.get(path) ?? 0) >= INTENTOS) return;

      enVuelo.current.add(path);

      ipc
        .getAppIcon(path)
        .then((uri) => {
          enVuelo.current.delete(path);
          if (!vivo) return;

          if (uri) {
            resueltos.current.add(path);
            setIcons((previos) => ({ ...previos, [path]: uri }));
            return;
          }

          reintentar(path);
        })
        .catch(() => {
          enVuelo.current.delete(path);
          if (vivo) reintentar(path);
        });
    };

    const reintentar = (path: string) => {
      const hechos = (intentos.current.get(path) ?? 0) + 1;
      intentos.current.set(path, hechos);
      if (hechos >= INTENTOS) return;

      temporizadores.push(
        window.setTimeout(() => pedir(path), ESPERA_MS * hechos)
      );
    };

    for (const path of paths) pedir(path);

    return () => {
      vivo = false;
      for (const id of temporizadores) window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return icons;
}
