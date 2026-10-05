import { useEffect, useState } from "react";
import { onDucking, onEspejos } from "../lib/ipc";

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

/**
 * Aplicaciones cuyo medidor esta midiendo todo el sistema en vez de su propio
 * audio, y que por eso no disparan el ducking.
 *
 * El caso real es Discord compartiendo audio o monitorizando el microfono: su
 * barra sube con la musica aunque nadie hable. Sin enseñarlo, el usuario veria
 * que su regla "no funciona" y no tendria forma de saber por que.
 */
export function useEspejos() {
  const [pids, setPids] = useState<number[]>([]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onEspejos((value) => {
      if (!cancelled) setPids(value);
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

  return pids;
}
