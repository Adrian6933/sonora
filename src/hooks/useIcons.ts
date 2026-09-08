import { useEffect, useRef, useState } from "react";
import { ipc } from "../lib/ipc";

/**
 * Iconos de las aplicaciones, indexados por ruta del ejecutable.
 *
 * Se piden una sola vez por ruta y nunca caducan: el icono de un .exe no cambia
 * mientras la aplicacion vive. `requested` evita que los 20 refrescos por
 * segundo del mezclador disparen 20 peticiones del mismo icono.
 */
export function useIcons(paths: string[]) {
  const [icons, setIcons] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());

  // La lista se recrea en cada refresco, asi que dependemos de su contenido y
  // no de la identidad del array.
  const key = paths.join("|");

  useEffect(() => {
    for (const path of paths) {
      if (!path || requested.current.has(path)) continue;
      requested.current.add(path);

      ipc
        .getAppIcon(path)
        .then((uri) => {
          if (uri) setIcons((prev) => ({ ...prev, [path]: uri }));
        })
        .catch(() => {
          // Hay procesos protegidos de los que no se puede sacar el icono.
          // No es un error: se queda el placeholder con la inicial.
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return icons;
}
