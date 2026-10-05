import { useCallback, useEffect, useRef, useState } from "react";

import { ipc, type BoostInfo } from "../lib/ipc";

/** Cada cuanto se refrescan los medidores de las amplificaciones activas. */
const REFRESCO_MS = 100;

/**
 * Las amplificaciones en marcha.
 *
 * El backend es la unica fuente de verdad: si una aplicacion se cierra, su
 * amplificacion desaparece sola y aqui nos enteramos en el siguiente refresco.
 * Por eso no guardamos una copia optimista mas alla del momento del cambio.
 */
export function useBoosts(activo: boolean) {
  const [boosts, setBoosts] = useState<BoostInfo[]>([]);
  /** Motivo por el que el backend ha rechazado amplificar, por PID. */
  const [errores, setErrores] = useState<Record<number, string>>({});
  const pendientes = useRef(new Map<number, number>());

  useEffect(() => {
    if (!activo) return;

    let vivo = true;
    const tick = async () => {
      try {
        const lista = await ipc.listBoosts();
        if (!vivo) return;

        // Un cambio recien pedido tarda un instante en verse en el backend.
        // Sin esto, el mando saltaria hacia atras al soltarlo.
        for (const [pid, gain] of pendientes.current) {
          const encontrado = lista.find((boost) => boost.pid === pid);
          if (encontrado && Math.abs(encontrado.gain - gain) < 0.01) {
            pendientes.current.delete(pid);
          } else if (!encontrado && gain <= 1) {
            pendientes.current.delete(pid);
          }
        }

        setBoosts(lista);
      } catch {
        // Un fallo puntual de IPC no merece vaciar la lista y hacer parpadear
        // los controles; el siguiente tick lo arregla.
      }
    };

    void tick();
    const id = setInterval(tick, REFRESCO_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [activo]);

  const setBoost = useCallback(async (pid: number, gain: number) => {
    pendientes.current.set(pid, gain);
    setErrores(({ [pid]: _, ...resto }) => resto);

    // Pintar ya el valor nuevo: esperar al backend haria que el mando se
    // moviera a tirones.
    setBoosts((previos) => {
      const resto = previos.filter((boost) => boost.pid !== pid);
      if (gain <= 1) return resto;
      const anterior = previos.find((boost) => boost.pid === pid);
      return [...resto, { pid, gain, level: anterior?.level ?? 0 }];
    });

    try {
      await ipc.setAppBoost(pid, gain);
    } catch (fallo) {
      // Hay aplicaciones que no se pueden capturar. Callarselo dejaba el mando
      // subido y sin sonido, que es la peor combinacion posible.
      pendientes.current.delete(pid);
      setBoosts((previos) => previos.filter((boost) => boost.pid !== pid));
      setErrores((previos) => ({ ...previos, [pid]: String(fallo) }));
    }
  }, []);

  const clearBoosts = useCallback(async () => {
    setBoosts([]);
    setErrores({});
    pendientes.current.clear();
    await ipc.clearBoosts();
  }, []);

  const gainFor = useCallback(
    (pids: number[]) =>
      boosts.find((boost) => pids.includes(boost.pid))?.gain ?? 1,
    [boosts]
  );

  return { boosts, errores, setBoost, clearBoosts, gainFor };
}
