import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, Speaker } from "lucide-react";

import { prettyAccel } from "../../hooks/useHotkeys";
import type { AppGroup } from "../../lib/group";
import type { AudioDevice } from "../../lib/ipc";
import { ChannelStrip } from "../mixer/ChannelStrip";

type Props = {
  groups: AppGroup[];
  icons: Record<string, string>;
  master: number;
  device: AudioDevice | null;
  duckingGain: number;
  onMaster: (volume: number) => void;
  onVolume: (pids: number[], volume: number) => void;
  onToggleMute: (pids: number[], muted: boolean) => void;
  /** Todo al 100%, sin silencios, sin modo y sin ducking */
  onReset: () => void;
  resetHotkey: string;
  modeActive: boolean;
};

export function MixerSection({
  groups,
  icons,
  master,
  device,
  duckingGain,
  onMaster,
  onVolume,
  onToggleMute,
  onReset,
  resetHotkey,
  modeActive,
}: Props) {
  const ducking = duckingGain < 0.99;

  return (
    <div className="overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)]">
      {/* Cabecera de la mesa */}
      <div className="flex items-center gap-3 border-b border-[var(--color-line)] bg-black/20 px-4 py-2.5">
        <Speaker size={14} className="shrink-0 text-[var(--color-faint)]" />

        <span
          className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-muted)]"
          title={device?.name}
        >
          {device?.name ?? "Dispositivo por defecto"}
        </span>

        <AnimatePresence>
          {ducking && (
            <motion.span
              initial={{ opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              title="Alguien está hablando: el resto está atenuado"
              className="tabular flex shrink-0 items-center gap-1.5 text-[11px] font-medium"
              style={{ color: "var(--accent)" }}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                  style={{ background: "var(--accent)" }}
                />
                <span
                  className="relative inline-flex h-1.5 w-1.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
              </span>
              voz prioritaria
            </motion.span>
          )}
        </AnimatePresence>

        <button
          onClick={onReset}
          title={
            modeActive
              ? "Pone todo al 100%, quita los silencios y desactiva el modo y la prioridad de voz"
              : "Pone todo al 100% y quita los silencios"
          }
          className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px]
                     text-[var(--color-muted)] transition hover:bg-white/[0.07]
                     hover:text-[var(--color-text)]"
        >
          <RotateCcw size={12} />
          Todo al 100%
          <span className="tabular text-[10px] text-[var(--color-faint)]">
            {prettyAccel(resetHotkey)}
          </span>
        </button>
      </div>

      {/* Canales */}
      <div className="flex">
        <div className="flex min-w-0 flex-1 divide-x divide-[var(--color-line)] overflow-x-auto">
          {groups.map((group) => (
            <ChannelStrip
              key={group.key}
              session={group}
              icon={icons[group.path]}
              onVolume={(volume) => onVolume(group.pids, volume)}
              onToggleMute={() => onToggleMute(group.pids, !group.muted)}
            />
          ))}

          {groups.length === 0 && (
            <p className="flex-1 px-6 py-20 text-center text-[12px] leading-relaxed text-[var(--color-faint)]">
              Ninguna aplicación está usando el audio.
              <br />
              Pon música o abre un juego y aparecerá aquí.
            </p>
          )}
        </div>

        {/* Canal principal, separado del resto como en una mesa de verdad */}
        <div className="flex w-[128px] shrink-0 flex-col items-center border-l-2 border-[var(--color-line)] bg-black/20 px-4 py-4">
          <span className="tabular text-[17px] font-semibold leading-none tracking-[-0.02em]">
            {Math.round(master * 100)}
          </span>

          <div className="mt-4 flex h-[228px] items-stretch">
            <Slider.Root
              orientation="vertical"
              className="relative flex w-[26px] touch-none justify-center select-none"
              value={[Math.round(master * 100)]}
              max={100}
              step={1}
              onValueChange={([next]) => onMaster(next / 100)}
            >
              <Slider.Track className="relative h-full w-[6px] overflow-hidden rounded-full bg-black/55 shadow-[inset_0_0_2px_rgba(0,0,0,0.7)]">
                <Slider.Range
                  className="absolute w-full rounded-full"
                  style={{ background: "rgba(255,255,255,0.26)" }}
                />
              </Slider.Track>
              <Slider.Thumb
                aria-label="Volumen general"
                className="block h-[13px] w-[26px] rounded-[3px]
                           bg-gradient-to-b from-[#f2f4f8] to-[#b3bac7]
                           shadow-[0_2px_6px_rgba(0,0,0,0.7),inset_0_-1px_0_rgba(0,0,0,0.28)]
                           outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <span className="mx-auto mt-[6px] block h-px w-[14px] bg-black/35" />
              </Slider.Thumb>
            </Slider.Root>
          </div>

          <span className="mt-auto pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            General
          </span>
        </div>
      </div>
    </div>
  );
}
