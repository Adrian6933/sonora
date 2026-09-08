import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { listen } from "@tauri-apps/api/event";

import { iconComponent } from "./lib/icons";

type Payload = { name: string; icon: string; accent: string };

/**
 * Aviso flotante que confirma el cambio de modo.
 *
 * Vive en su propia ventana, sin bordes y siempre encima, porque el momento en
 * el que hace falta es justo cuando la ventana principal esta escondida y tienes
 * un juego en primer plano.
 *
 * Quien la ensena y la esconde es Rust; aqui solo pintamos.
 */
export default function Hud() {
  const [payload, setPayload] = useState<Payload | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<Payload>("hud", (event) => {
      if (!cancelled) setPayload(event.payload);
    })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch((problem) => console.error("[hud] fallo al escuchar:", problem));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const Icon = payload ? iconComponent(payload.icon) : null;

  return (
    <div className="flex h-full w-full items-center justify-end pr-1">
      <AnimatePresence mode="wait">
        {payload && (
          <motion.div
            // La clave hace que un cambio de modo reinicie la animacion en vez
            // de dejar el aviso anterior quieto en pantalla.
            key={`${payload.name}-${payload.accent}`}
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 24, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="flex items-center gap-2.5 rounded-[14px] border py-2.5 pl-3 pr-4"
            style={{
              borderColor: `color-mix(in srgb, ${payload.accent} 45%, transparent)`,
              background: "rgba(10, 10, 12, 0.92)",
              boxShadow: `0 8px 28px rgba(0,0,0,0.55), 0 0 0 1px color-mix(in srgb, ${payload.accent} 18%, transparent)`,
              backdropFilter: "blur(12px)",
            }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-[11px]"
              style={{
                background: `color-mix(in srgb, ${payload.accent} 20%, #0b0d10)`,
                color: `color-mix(in srgb, ${payload.accent} 72%, white)`,
              }}
            >
              {Icon && <Icon size={17} strokeWidth={1.9} />}
            </span>

            <span className="flex flex-col leading-tight">
              <span
                className="text-[9px] font-semibold uppercase tracking-[0.1em]"
                style={{ color: payload.accent }}
              >
                Sonora
              </span>
              <span className="text-[13px] font-medium text-[#ededf0]">
                {payload.name}
              </span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
