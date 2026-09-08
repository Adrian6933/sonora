import { useEffect, useRef } from "react";

import { ipc, onDevice, onProcesses } from "../lib/ipc";
import { inSchedule, type Mode } from "../lib/modes";

/** Cada cuanto se comprueban las franjas horarias. */
const SCHEDULE_INTERVAL_MS = 30_000;

type AutoState = {
  /** Modo que activo la automatizacion */
  modeId: string;
  /** Que lo disparo: un ejecutable en minusculas, o "schedule" */
  trigger: string;
  /** Modo que estaba activo antes, para devolverlo al terminar */
  previous: string | null;
};

/**
 * Activa modos solos: al abrir un juego, o al entrar en una franja horaria.
 *
 * Regla de oro: la automatizacion actua solo en los CAMBIOS del disparador
 * (abrir el juego, cerrarlo, dar las 23:00), nunca de forma continua. Si
 * actuase continuamente, elegir un modo a mano con el juego abierto seria
 * imposible: al segundo siguiente lo pisaria. Asi, tu eleccion manual manda
 * hasta que el disparador vuelva a cambiar.
 */
export function useAutomation(
  modes: Mode[],
  activeModeId: string | null,
  activate: (mode: Mode) => void,
  clear: () => void
) {
  // Refs para que los listeners, que se registran una sola vez, no se queden
  // mirando una foto vieja del estado.
  const modesRef = useRef(modes);
  modesRef.current = modes;

  const activeRef = useRef(activeModeId);
  activeRef.current = activeModeId;

  const activateRef = useRef(activate);
  activateRef.current = activate;

  const clearRef = useRef(clear);
  clearRef.current = clear;

  const running = useRef<string[]>([]);
  const auto = useRef<AutoState | null>(null);
  /**
   * El primer aviso solo sirve para saber que hay abierto ya.
   *
   * Sin esto, arrancar Sonora con el juego (o la franja) ya activos contaria
   * como "acaba de empezar" y reordenaria el mezclador nada mas abrir la
   * aplicacion. Abrir Sonora no debe cambiarte el sonido.
   */
  const seeded = useRef(false);

  /** Vuelve a donde estabamos antes de que saltara la automatizacion. */
  function restore() {
    const state = auto.current;
    auto.current = null;
    if (!state) return;

    const previous = state.previous
      ? modesRef.current.find((mode) => mode.id === state.previous)
      : undefined;

    if (previous) activateRef.current(previous);
    else clearRef.current();
  }

  // 1. Decirle a Rust que ejecutables tiene que vigilar.
  const watched = [
    ...new Set(
      modes.flatMap((mode) =>
        mode.autoActivate.processes.map((name) => name.toLowerCase())
      )
    ),
  ];
  const watchKey = watched.join("|");

  useEffect(() => {
    ipc.setWatchedProcesses(watchKey ? watchKey.split("|") : []).catch(() => {});
  }, [watchKey]);

  // 2. Reaccionar a que se abran o cierren.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onProcesses((current) => {
      if (cancelled) return;

      if (!seeded.current) {
        seeded.current = true;
        running.current = current;
        return;
      }

      const before = running.current;
      const started = current.filter((name) => !before.includes(name));
      const stopped = before.filter((name) => !current.includes(name));
      running.current = current;

      // Se cerro lo que habia disparado el modo activo -> volver atras.
      if (auto.current && stopped.includes(auto.current.trigger)) {
        restore();
      }

      for (const exe of started) {
        const mode = modesRef.current.find((candidate) =>
          candidate.autoActivate.processes.some(
            (name) => name.toLowerCase() === exe
          )
        );
        if (!mode || mode.id === activeRef.current) continue;

        auto.current = {
          modeId: mode.id,
          trigger: exe,
          previous: activeRef.current,
        };
        activateRef.current(mode);
        break;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 3. Cambio de dispositivo de salida (te pones los cascos).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    onDevice((deviceId) => {
      if (cancelled) return;

      const mode = modesRef.current.find((candidate) =>
        candidate.autoActivate.devices.includes(deviceId)
      );

      // Quitarse los cascos deshace el modo que pusieron.
      if (!mode) {
        if (auto.current?.trigger.startsWith("device:")) restore();
        return;
      }

      if (mode.id === activeRef.current) return;

      auto.current = {
        modeId: mode.id,
        trigger: `device:${deviceId}`,
        previous: auto.current?.previous ?? activeRef.current,
      };
      activateRef.current(mode);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 4. Franjas horarias.
  useEffect(() => {
    let inWindow: string | null = null;
    let first = true;

    const check = () => {
      const match = modesRef.current.find(
        (mode) => mode.autoActivate.schedule && inSchedule(mode.autoActivate.schedule)
      );

      // La primera pasada solo toma nota: abrir la aplicacion dentro de una
      // franja no cuenta como haber entrado en ella.
      if (first) {
        first = false;
        inWindow = match?.id ?? null;
        return;
      }

      // Nada ha cambiado desde la ultima comprobacion.
      if ((match?.id ?? null) === inWindow) return;

      // Salimos de una franja que habiamos activado nosotros.
      if (!match) {
        inWindow = null;
        if (auto.current?.trigger === "schedule") restore();
        return;
      }

      inWindow = match.id;

      // Un proceso manda sobre el horario: si estas jugando a las 23:00, el
      // modo del juego pesa mas que el modo Noche.
      if (auto.current && auto.current.trigger !== "schedule") return;
      if (match.id === activeRef.current) return;

      auto.current = {
        modeId: match.id,
        trigger: "schedule",
        previous: auto.current?.previous ?? activeRef.current,
      };
      activateRef.current(match);
    };

    check();
    const timer = setInterval(check, SCHEDULE_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
