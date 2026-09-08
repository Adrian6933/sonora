import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Si la ventana esta maximizada.
 *
 * Hace falta en dos sitios: para cambiar el icono del boton de maximizar y para
 * quitar las esquinas redondeadas —una ventana maximizada con esquinas
 * redondeadas deja huecos con el escritorio en las cuatro puntas.
 *
 * Windows tambien maximiza al arrastrar la ventana al borde superior, asi que
 * no vale con seguir solo nuestro boton: hay que escuchar el redimensionado.
 */
export function useMaximized() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    const sync = () => {
      appWindow
        .isMaximized()
        .then((value) => {
          if (!cancelled) setMaximized(value);
        })
        .catch(() => {});
    };

    sync();

    appWindow
      .onResized(sync)
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return maximized;
}
