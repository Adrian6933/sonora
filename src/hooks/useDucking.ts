import { useEffect, useState } from "react";
import { onDucking } from "../lib/ipc";

/**
 * Ganancia actual del ducking: 1 = sin atenuar.
 *
 * El backend solo emite cuando el valor cambia de verdad, asi que esto no
 * provoca un render por cada tick del motor.
 */
export function useDuckingGain() {
  const [gain, setGain] = useState(1);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onDucking((value) => {
      if (!cancelled) setGain(value);
    })
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

  return gain;
}
