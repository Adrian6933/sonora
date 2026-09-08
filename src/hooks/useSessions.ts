import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupSessions } from "../lib/group";
import { ipc, onSessions, type AudioSession } from "../lib/ipc";

/**
 * Cuanto tiempo mandan los cambios locales sobre lo que llega del backend.
 *
 * El backend emite el estado 20 veces por segundo. Sin esto, arrastrar un
 * slider seria una pelea: sueltas el raton en el 40%, llega un evento con el
 * valor viejo y el mando salta hacia atras. Durante esta ventana ignoramos el
 * volumen que llega para ese PID concreto (los niveles siguen pasando).
 */
const LOCAL_OVERRIDE_MS = 500;

type Override = { volume?: number; muted?: boolean; until: number };

export function useSessions() {
  const [sessions, setSessions] = useState<AudioSession[]>([]);
  const [master, setMaster] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const overrides = useRef(new Map<number, Override>());
  const masterOverride = useRef(0);

  const applyOverrides = useCallback((incoming: AudioSession[]) => {
    const now = Date.now();

    return incoming.map((session) => {
      const pending = overrides.current.get(session.pid);
      if (!pending) return session;

      if (pending.until < now) {
        overrides.current.delete(session.pid);
        return session;
      }

      return {
        ...session,
        volume: pending.volume ?? session.volume,
        muted: pending.muted ?? session.muted,
      };
    });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    // Primera carga inmediata para no ensenar la lista vacia medio segundo.
    ipc
      .listSessions()
      .then((list) => !cancelled && setSessions(list))
      .catch((e) => setError(String(e)));

    ipc
      .getMasterVolume()
      .then((v) => !cancelled && setMaster(v))
      .catch(() => {});

    onSessions((list) => {
      if (!cancelled) setSessions(applyOverrides(list));
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((e) => setError(String(e)));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [applyOverrides]);

  // En bandeja o minimizada no hay que gastar CPU en medidores.
  useEffect(() => {
    const sync = () => ipc.setPolling(!document.hidden).catch(() => {});
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  /** Un control de la UI manda sobre todas las sesiones de esa aplicacion. */
  const setVolume = useCallback((pids: number[], volume: number) => {
    const until = Date.now() + LOCAL_OVERRIDE_MS;
    for (const pid of pids) {
      overrides.current.set(pid, {
        ...overrides.current.get(pid),
        volume,
        until,
      });
    }

    setSessions((prev) =>
      prev.map((s) => (pids.includes(s.pid) ? { ...s, volume } : s))
    );

    for (const pid of pids) {
      ipc.setAppVolume(pid, volume).catch((e) => setError(String(e)));
    }
  }, []);

  const toggleMute = useCallback((pids: number[], muted: boolean) => {
    const until = Date.now() + LOCAL_OVERRIDE_MS;
    for (const pid of pids) {
      overrides.current.set(pid, {
        ...overrides.current.get(pid),
        muted,
        until,
      });
    }

    setSessions((prev) =>
      prev.map((s) => (pids.includes(s.pid) ? { ...s, muted } : s))
    );

    for (const pid of pids) {
      ipc.setAppMute(pid, muted).catch((e) => setError(String(e)));
    }
  }, []);

  const setMasterVolume = useCallback((volume: number) => {
    masterOverride.current = Date.now() + LOCAL_OVERRIDE_MS;
    setMaster(volume);
    ipc.setMasterVolume(volume).catch((e) => setError(String(e)));
  }, []);

  const groups = useMemo(() => groupSessions(sessions), [sessions]);

  return { groups, master, error, setVolume, toggleMute, setMasterVolume };
}
