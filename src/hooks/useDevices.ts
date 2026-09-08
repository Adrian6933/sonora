import { useCallback, useEffect, useState } from "react";

import { ipc, onDevice, type AudioDevice } from "../lib/ipc";

/**
 * Dispositivos de salida y cual esta activo.
 *
 * La lista se refresca cuando Windows cambia el dispositivo por defecto, que es
 * lo que pasa al conectar o quitar unos cascos.
 */
export function useDevices() {
  const [devices, setDevices] = useState<AudioDevice[]>([]);

  const refresh = useCallback(() => {
    ipc
      .listDevices()
      .then(setDevices)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refresh();

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onDevice(() => refresh())
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [refresh]);

  return {
    devices,
    current: devices.find((device) => device.isDefault) ?? null,
  };
}
