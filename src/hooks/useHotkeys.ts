import { useEffect, useRef, useState } from "react";
import {
  register,
  unregisterAll,
} from "@tauri-apps/plugin-global-shortcut";

import type { Mode } from "../lib/modes";

export type HotkeyFailure = { hotkey: string; message: string };

/**
 * Cola global de operaciones sobre los atajos.
 *
 * Registrar y desregistrar son efectos globales del sistema, y en desarrollo
 * StrictMode monta el efecto, lo desmonta y lo vuelve a montar. Sin serializar,
 * el `unregisterAll` de la limpieza del primer montaje puede resolverse DESPUES
 * de los registros del segundo y dejarlos borrados: atajos que la interfaz da
 * por buenos y no hacen nada. La cola garantiza el orden.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => {});
  return next;
}

/**
 * Registra los atajos globales de los modos.
 *
 * Son globales de verdad: funcionan con el juego en primer plano, que es todo
 * el sentido de la aplicacion. El registro puede fallar porque otro programa ya
 * tenga esa combinacion, asi que devolvemos los fallos con su motivo en vez de
 * quedarnos callados con un atajo muerto.
 */
export function useHotkeys(
  modes: Mode[],
  onActivate: (id: string) => void,
  /**
   * Atajos que no pertenecen a ningun modo (ciclar, volver al 100%...).
   *
   * Se registran aqui, junto a los demas, porque `unregisterAll` es global:
   * dos hooks registrando por su cuenta se borrarian los atajos el uno al otro.
   */
  extras: Array<{ accel: string; run: () => void }> = []
) {
  const [failed, setFailed] = useState<HotkeyFailure[]>([]);

  // El handler se recrea en cada render; la referencia lo mantiene fresco sin
  // tener que volver a registrar los atajos en cada uno.
  const handler = useRef(onActivate);
  handler.current = onActivate;

  // Igual que `handler`: los extras se recrean en cada render, pero los atajos
  // se registran una sola vez y deben ejecutar siempre la version actual.
  const extrasRef = useRef(extras);
  extrasRef.current = extras;

  // Solo hay que reregistrar si cambia alguna combinacion.
  const key = [
    ...modes.map((mode) => `${mode.id}:${mode.hotkey ?? ""}`),
    ...extras.map((extra) => `extra:${extra.accel}`),
  ].join("|");

  useEffect(() => {
    let cancelled = false;

    void enqueue(async () => {
      if (cancelled) return;

      const failures: HotkeyFailure[] = [];

      for (const mode of modes) {
        if (!mode.hotkey) continue;

        try {
          const id = mode.id;
          await register(mode.hotkey, (event) => {
            // El evento llega al pulsar y al soltar; solo queremos uno.
            if (event.state === "Pressed") handler.current(id);
          });
        } catch (error) {
          failures.push({ hotkey: mode.hotkey, message: String(error) });
        }
      }

      for (const [index, extra] of extras.entries()) {
        if (!extra.accel) continue;

        try {
          await register(extra.accel, (event) => {
            if (event.state === "Pressed") extrasRef.current[index]?.run();
          });
        } catch (error) {
          failures.push({ hotkey: extra.accel, message: String(error) });
        }
      }

      if (!cancelled) setFailed(failures);
    });

    return () => {
      cancelled = true;
      void enqueue(() => unregisterAll().catch(() => {}));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return failed;
}

/**
 * Convierte un evento de teclado en un acelerador con el formato de Tauri.
 * Devuelve null mientras solo hay modificadores pulsados.
 */
export function accelFromEvent(event: KeyboardEvent): string | null {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("CommandOrControl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");

  const code = event.code;
  let main: string | null = null;

  if (code.startsWith("Key")) main = code.slice(3);
  else if (code.startsWith("Digit")) main = code.slice(5);
  else if (code.startsWith("Numpad")) main = `num${code.slice(6)}`;
  else if (/^F\d{1,2}$/.test(code)) main = code;
  else if (code === "Space") main = "Space";
  else if (code === "Tab") main = "Tab";
  else if (code.startsWith("Arrow")) main = code.slice(5);

  if (!main) return null;

  // Un atajo global sin modificadores secuestraria la tecla en todo el sistema.
  if (parts.length === 0) return null;

  parts.push(main);
  return parts.join("+");
}

/** "CommandOrControl+Alt+1" -> "Ctrl + Alt + 1", para ensenarlo en la UI. */
export function prettyAccel(accel: string): string {
  return accel
    .replace("CommandOrControl", "Ctrl")
    .replace("Super", "Win")
    .split("+")
    .join(" + ");
}
