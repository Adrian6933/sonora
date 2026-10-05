import * as Slider from "@radix-ui/react-slider";
import { AnimatePresence, motion } from "motion/react";
import { RotateCcw, Speaker } from "lucide-react";

import { prettyAccel } from "../../hooks/useHotkeys";
import type { AppGroup } from "../../lib/group";
import type { AudioDevice } from "../../lib/ipc";
import { offlineApps, type KnownApp, type Preset } from "../../lib/known";
import { ChannelStrip } from "../mixer/ChannelStrip";
import { PresetStrip } from "../mixer/PresetStrip";

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

  /** Aplicaciones vistas alguna vez, para la pestaña "Todas" */
  knownApps: KnownApp[];
  presets: Record<string, Preset>;
  onPreset: (key: string, preset: Preset | null) => void;
  onForget: (key: string) => void;
  tab: MixerTab;
  onTab: (tab: MixerTab) => void;
};

export type MixerTab = "sonando" | "todas";

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
  knownApps,
  presets,
  onPreset,
  onForget,
  tab,
  onTab,
}: Props) {
  const ducking = duckingGain < 0.99;

  // "Sonando" son las que emiten audio ahora mismo. "Todas" añade las que
  // Sonora ha visto alguna vez, para dejarles el volumen preparado.
  const sonando = groups.filter((group) => group.active);
  const visibles = tab === "sonando" ? sonando : groups;
  const offline = tab === "todas" ? offlineApps(knownApps, groups) : [];

  return (
    <div className="flex h-full max-h-[640px] w-full flex-col overflow-hidden rounded-[10px] border border-[var(--color-line)] bg-[var(--color-surface)]">
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

      {/* Pestañas */}
      <div className="flex gap-1 border-b border-[var(--color-line)] bg-black/10 px-3 py-1.5">
        <Tab
          selected={tab === "sonando"}
          onClick={() => onTab("sonando")}
          count={sonando.length}
        >
          Sonando ahora
        </Tab>
        <Tab
          selected={tab === "todas"}
          onClick={() => onTab("todas")}
          count={groups.length + offlineApps(knownApps, groups).length}
        >
          Todas
        </Tab>
      </div>

      {/* Canales */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 divide-x divide-[var(--color-line)] overflow-x-auto">
          {visibles.map((group) => (
            <ChannelStrip
              key={group.key}
              session={group}
              icon={icons[group.path]}
              onVolume={(volume) => onVolume(group.pids, volume)}
              onToggleMute={() => onToggleMute(group.pids, !group.muted)}
            />
          ))}

          {offline.map((app) => (
            <PresetStrip
              key={app.key}
              app={app}
              icon={icons[app.path]}
              preset={presets[app.key]}
              onPreset={(preset) => onPreset(app.key, preset)}
              onForget={() => onForget(app.key)}
            />
          ))}

          {visibles.length === 0 && offline.length === 0 && (
            <p className="flex-1 px-6 py-20 text-center text-[12px] leading-relaxed text-[var(--color-faint)]">
              {tab === "sonando"
                ? "Ninguna aplicación está emitiendo audio ahora mismo."
                : "Todavía no se ha visto ninguna aplicación usar el audio."}
              <br />
              Pon música o abre un juego y aparecerá aquí.
            </p>
          )}
        </div>

        {/* Canal principal, separado del resto como en una mesa de verdad */}
        <div className="flex h-full w-[132px] shrink-0 flex-col items-center border-l-2 border-[var(--color-line)] bg-black/20 px-4 py-4">
          <span className="tabular text-[17px] font-semibold leading-none tracking-[-0.02em]">
            {Math.round(master * 100)}
          </span>

          <div className="mt-3 flex min-h-[90px] w-full min-w-0 flex-1 items-stretch justify-center">
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

          {/* Huecos del mismo alto que el boton de mute y el icono de los
              otros canales, para que el fader General acabe a la misma altura
              que los demas en vez de colgar por debajo. */}
          <div className="mt-4 h-6 shrink-0" />
          <div className="mt-3 h-9 shrink-0" />

          <span className="mt-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-faint)]">
            General
          </span>
        </div>
      </div>
    </div>
  );
}

function Tab({
  selected,
  onClick,
  count,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition"
      style={{
        background: selected
          ? "color-mix(in srgb, var(--accent) 14%, transparent)"
          : "transparent",
        color: selected ? "var(--accent)" : "var(--color-faint)",
      }}
    >
      {children}
      <span
        className="tabular rounded px-1 text-[9px]"
        style={{
          background: selected
            ? "color-mix(in srgb, var(--accent) 22%, transparent)"
            : "rgba(255,255,255,0.06)",
        }}
      >
        {count}
      </span>
    </button>
  );
}
