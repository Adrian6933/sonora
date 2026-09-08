import * as Slider from "@radix-ui/react-slider";
import { Volume2, VolumeX } from "lucide-react";

import type { AppGroup } from "../../lib/group";
import { AppIcon } from "./AppIcon";

type Props = {
  session: AppGroup;
  icon?: string;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
};

/**
 * Un canal del mezclador: fader vertical, medidor al lado, nombre debajo.
 *
 * Es la forma que tiene cualquier mesa de mezclas y la razon de que se
 * reconozca al instante como una aplicacion de audio. La alternativa —tarjetas
 * flotantes con barras horizontales— se lee como un panel de control generico
 * de cualquier cosa.
 */
export function ChannelStrip({
  session,
  icon,
  onVolume,
  onToggleMute,
}: Props) {
  const dimmed = session.muted;
  const level = Math.min(1, Math.max(0, session.peak));
  const clipping = level > 0.85;

  return (
    <div className="flex w-[96px] shrink-0 flex-col items-center px-3 py-4">
      <span
        className="tabular text-[17px] font-semibold leading-none tracking-[-0.02em]"
        style={{ color: dimmed ? "var(--color-faint)" : "var(--color-text)" }}
      >
        {Math.round(session.volume * 100)}
      </span>

      <div className="mt-4 flex h-[228px] items-stretch gap-2">
        {/* Medidor de nivel, a la izquierda del fader como en una mesa real */}
        <div className="relative w-[4px] overflow-hidden rounded-full bg-black/50">
          <div
            className="absolute inset-x-0 bottom-0 rounded-full"
            style={{
              height: `${level * 100}%`,
              background: clipping ? "#f5a524" : "var(--accent)",
              opacity: dimmed ? 0.25 : 1,
              transition: "height 90ms linear, background-color 200ms linear",
            }}
          />
        </div>

        <Slider.Root
          orientation="vertical"
          className="relative flex w-[22px] touch-none justify-center select-none"
          value={[Math.round(session.volume * 100)]}
          max={100}
          step={1}
          onValueChange={([next]) => onVolume(next / 100)}
        >
          <Slider.Track className="relative h-full w-[5px] overflow-hidden rounded-full bg-black/50 shadow-[inset_0_0_2px_rgba(0,0,0,0.7)]">
            <Slider.Range
              className="absolute w-full rounded-full"
              style={{
                background: dimmed
                  ? "rgba(255,255,255,0.10)"
                  : "rgba(255,255,255,0.22)",
              }}
            />
          </Slider.Track>

          {/* Cabeza de fader, no una bolita: es lo que lo hace parecer una mesa */}
          <Slider.Thumb
            aria-label={`Volumen de ${session.name}`}
            className="block h-[11px] w-[22px] rounded-[3px]
                       bg-gradient-to-b from-[#f2f4f8] to-[#b9c0cd]
                       shadow-[0_2px_5px_rgba(0,0,0,0.65),inset_0_-1px_0_rgba(0,0,0,0.25)]
                       outline-none transition-transform
                       hover:scale-x-105 focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            <span className="mx-auto mt-[5px] block h-px w-[12px] bg-black/35" />
          </Slider.Thumb>
        </Slider.Root>
      </div>

      <button
        onClick={onToggleMute}
        aria-label={session.muted ? "Quitar silencio" : "Silenciar"}
        className="mt-4 flex h-6 w-6 items-center justify-center rounded-md transition"
        style={
          session.muted
            ? { color: "#f5a524", background: "rgba(245,165,36,0.14)" }
            : { color: "var(--color-faint)" }
        }
      >
        {session.muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
      </button>

      <div className="mt-3">
        <AppIcon
          name={session.name}
          exe={session.exe}
          isSystem={session.isSystem}
          dimmed={dimmed}
          icon={icon}
        />
      </div>

      <span
        className="mt-2 w-full truncate text-center text-[10.5px] font-medium"
        style={{ color: dimmed ? "var(--color-faint)" : "var(--color-muted)" }}
        title={session.path || session.exe}
      >
        {session.name}
      </span>
    </div>
  );
}
