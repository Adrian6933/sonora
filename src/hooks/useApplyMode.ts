import { useCallback, useRef } from "react";

import type { AppGroup } from "../lib/group";
import { planFor, type Mode } from "../lib/modes";

type Setters = {
  setVolume: (pids: number[], volume: number) => void;
  toggleMute: (pids: number[], muted: boolean) => void;
};

/**
 * Devuelve una funcion ESTABLE para aplicar un modo.
 *
 * Estable importa: esta funcion acaba dentro del handler de un atajo global,
 * que se registra una sola vez. Si cambiara de identidad en cada render, el
 * atajo se quedaria aplicando el modo con la lista de aplicaciones que hubiera
 * en el momento del registro. Con refs siempre ve el estado actual.
 */
export function useApplyMode(groups: AppGroup[], setters: Setters) {
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const settersRef = useRef(setters);
  settersRef.current = setters;

  return useCallback((mode: Mode) => {
    const { setVolume, toggleMute } = settersRef.current;

    for (const step of planFor(mode, groupsRef.current)) {
      setVolume(step.pids, step.volume);
      toggleMute(step.pids, step.muted);
    }
  }, []);
}
