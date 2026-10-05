import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Mic, RotateCcw, Volume2, VolumeX } from "lucide-react";

import { prettyAccel } from "../../hooks/useHotkeys";
import type { AppGroup } from "../../lib/group";
import { iconComponent } from "../../lib/icons";
import type { AudioDevice } from "../../lib/ipc";
import type { Mode } from "../../lib/modes";
import { AppIcon } from "../mixer/AppIcon";
import { VolumeSlider } from "../ui/VolumeSlider";

type Props = {
  modes: Mode[];
  activeMode?: Mode;
  groups: AppGroup[];
  icons: Record<string, string>;
  master: number;
  device: AudioDevice | null;
  duckingGain: number;
  /** PIDs que estan midiendo todo el sistema y no disparan el ducking */
  espejos: number[];
  resetHotkey: string;
  onActivate: (mode: Mode) => void;
  onMaster: (volume: number) => void;
  onVolume: (pids: number[], volume: number) => void;
  onToggleMute: (pids: number[], muted: boolean) => void;
  onReset: () => void;
};

/**
 * Pantalla de inicio: lo que se mira a diario.
 *
 * En qué modo estás, cómo cambiar sin buscar, y qué está sonando ahora mismo.
 * El mezclador completo sigue en su pestaña; aquí solo salen las aplicaciones
 * que están emitiendo, en filas horizontales —más fáciles de leer de un
 * vistazo que las tiras verticales de la mesa.
 */
export function HomeSection({
  modes,
  activeMode,
  groups,
  icons,
  master,
  device,
  duckingGain,
  espejos,
  resetHotkey,
  onActivate,
  onMaster,
  onVolume,
  onToggleMute,
  onReset,
}: Props) {
  const sonando = groups.filter((group) => group.active);
  const espejando = groups.filter((group) =>
    group.pids.some((pid) => espejos.includes(pid))
  );
  const otros = modes.filter((mode) => mode.id !== activeMode?.id);
  const ducking = duckingGain < 0.99;

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-4">
      <Espejos groups={espejando} />

      {/* Modo activo */}
      <div
        className="surface relative overflow-hidden rounded-[18px] border p-5"
        style={{
          borderColor: activeMode
            ? `color-mix(in srgb, ${activeMode.accent} 45%, transparent)`
            : "var(--color-line)",
          background: activeMode
            ? `linear-gradient(150deg, color-mix(in srgb, ${activeMode.accent} 16%, var(--color-surface)), var(--color-surface) 70%)`
            : undefined,
        }}
      >
        {activeMode ? (
          <ActiveMode mode={activeMode} />
        ) : (
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-[16px] bg-white/[0.05] text-[var(--color-faint)]">
              <Volume2 size={26} strokeWidth={1.8} />
            </span>
            <div>
              <div className="text-[18px] font-semibold">Sin modo</div>
              <p className="mt-0.5 text-[12px] text-[var(--color-faint)]">
                Los volúmenes están como los dejaste. Elige un modo abajo.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Cambio rápido */}
      {otros.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-medium text-[var(--color-muted)]">
            Cambiar a
          </div>
          <div className="flex flex-wrap gap-2">
            {otros.map((mode) => {
              const Icon = iconComponent(mode.icon);

              return (
                <button
                  key={mode.id}
                  onClick={() => onActivate(mode)}
                  className="surface flex items-center gap-2.5 rounded-[14px] border
                             border-[var(--color-line)] py-2.5 pl-2.5 pr-4 transition
                             hover:-translate-y-px"
                  style={{ borderColor: "var(--color-line)" }}
                >
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-[11px]"
                    style={{
                      background: `color-mix(in srgb, ${mode.accent} 20%, #0b0d10)`,
                      color: `color-mix(in srgb, ${mode.accent} 72%, white)`,
                    }}
                  >
                    <Icon size={17} strokeWidth={1.9} />
                  </span>
                  <span className="text-left">
                    <span className="block text-[13px] font-medium">
                      {mode.name}
                    </span>
                    {mode.hotkey && (
                      <span className="tabular block text-[10px] text-[var(--color-faint)]">
                        {prettyAccel(mode.hotkey)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Volumen general */}
      <div className="surface rounded-[16px] border border-[var(--color-line)] px-4 py-3.5">
        <div className="mb-2.5 flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-muted)]">
            {device?.name ?? "Volumen general"}
          </span>

          <AnimatePresence>
            {ducking && (
              <motion.span
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="tabular flex items-center gap-1.5 text-[11px] font-medium"
                style={{ color: "var(--accent)" }}
              >
                <Mic size={11} />
                voz prioritaria
              </motion.span>
            )}
          </AnimatePresence>

          <span className="tabular w-14 text-right text-[18px] font-semibold">
            {Math.round(master * 100)}
            <span className="ml-0.5 text-[11px] font-normal text-[var(--color-faint)]">
              %
            </span>
          </span>
        </div>
        <VolumeSlider value={master} onChange={onMaster} />
      </div>

      {/* Sonando ahora */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[12px] font-medium text-[var(--color-muted)]">
            Sonando ahora
            <span className="ml-1.5 text-[var(--color-faint)]">
              {sonando.length}
            </span>
          </span>

          <button
            onClick={onReset}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]
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

        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {sonando.map((group) => (
              <motion.div
                key={group.key}
                layout
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="surface flex items-center gap-3.5 rounded-[14px] border border-[var(--color-line)] px-4 py-3"
              >
                <AppIcon
                  name={group.name}
                  exe={group.exe}
                  isSystem={group.isSystem}
                  icon={icons[group.path]}
                  dimmed={group.muted}
                  size={38}
                />

                <span className="w-[132px] shrink-0 truncate text-[13px] font-medium">
                  {group.name}
                </span>

                <div className="min-w-0 flex-1">
                  <VolumeSlider
                    value={group.volume}
                    peak={group.peak}
                    dimmed={group.muted}
                    onChange={(volume) => onVolume(group.pids, volume)}
                  />
                </div>

                <span className="tabular w-12 shrink-0 text-right text-[14px] font-medium">
                  {Math.round(group.volume * 100)}
                  <span className="text-[10px] text-[var(--color-faint)]">%</span>
                </span>

                {group.boost > 1 && (
                  <span
                    className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                    style={{
                      background:
                        "color-mix(in srgb, var(--accent) 18%, transparent)",
                      color: "var(--accent)",
                    }}
                    title="Amplificada por Sonora"
                  >
                    x{group.boost.toFixed(1).replace(".", ",")}
                  </span>
                )}

                <button
                  onClick={() => onToggleMute(group.pids, !group.muted)}
                  aria-label={group.muted ? "Quitar silencio" : "Silenciar"}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg
                             text-[var(--color-faint)] transition hover:bg-white/[0.07]
                             hover:text-[var(--color-text)]"
                  style={group.muted ? { color: "#f5a524" } : undefined}
                >
                  {group.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {sonando.length === 0 && (
            <p className="rounded-[14px] border border-dashed border-[var(--color-line)] px-4 py-10 text-center text-[12px] leading-relaxed text-[var(--color-faint)]">
              Ahora mismo no suena nada.
              <br />
              Pon música o abre un juego y aparecerá aquí.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ActiveMode({ mode }: { mode: Mode }) {
  const Icon = iconComponent(mode.icon);

  return (
    <div className="flex items-start gap-4">
      <span
        className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px]
                   shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
        style={{
          background: `color-mix(in srgb, ${mode.accent} 22%, #0b0d10)`,
          color: `color-mix(in srgb, ${mode.accent} 75%, white)`,
        }}
      >
        <Icon size={30} strokeWidth={1.7} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
            style={{
              background: `color-mix(in srgb, ${mode.accent} 26%, #0b0d10)`,
              color: `color-mix(in srgb, ${mode.accent} 68%, white)`,
            }}
          >
            modo activo
          </span>
          {mode.hotkey && (
            <span className="tabular text-[10px] text-[var(--color-faint)]">
              {prettyAccel(mode.hotkey)}
            </span>
          )}
        </div>

        <div className="text-[22px] font-semibold leading-tight tracking-[-0.02em]">
          {mode.name}
        </div>

        {mode.description && (
          <p className="mt-1 max-w-[560px] text-[12px] leading-relaxed text-[var(--color-muted)]">
            {mode.description}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Aviso de que una aplicacion esta midiendo todo el sistema.
 *
 * Sin esto, el usuario veria que su regla "dejo de funcionar" sin ninguna
 * pista. Se cuenta lo que pasa y que hacer, no el detalle tecnico.
 */
function Espejos({ groups }: { groups: AppGroup[] }) {
  if (groups.length === 0) return null;

  const nombres = groups.map((group) => group.name).join(" y ");

  return (
    <div
      className="flex items-start gap-3 rounded-[14px] border p-4"
      style={{
        borderColor: "color-mix(in srgb, #fb923c 45%, transparent)",
        background: "color-mix(in srgb, #fb923c 8%, var(--color-surface))",
      }}
    >
      <AlertTriangle size={16} strokeWidth={2} className="mt-[1px] shrink-0" style={{ color: "#fb923c" }} />
      <div className="min-w-0">
        <div className="text-[12px] font-medium text-[var(--color-text)]">
          {nombres} está reproduciendo el sonido de todo el sistema
        </div>
        <p className="mt-1 max-w-[70ch] text-[11px] leading-relaxed text-[var(--color-muted)]">
          Su medidor sube con la música aunque nadie hable, así que una regla
          que lo use de disparador se activaría sola. Sonora lo ha dejado de
          tener en cuenta mientras dure. Suele venir de compartir pantalla con
          sonido, o de tener el micrófono monitorizado en sus ajustes de voz.
        </p>
      </div>
    </div>
  );
}
