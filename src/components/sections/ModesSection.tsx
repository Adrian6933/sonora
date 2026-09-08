import { motion } from "motion/react";
import { Check, Clock, Mic, Monitor, Pencil, Plus } from "lucide-react";

import { prettyAccel } from "../../hooks/useHotkeys";
import { iconComponent } from "../../lib/icons";
import type { Mode } from "../../lib/modes";

type Props = {
  modes: Mode[];
  activeId: string | null;
  onActivate: (mode: Mode) => void;
  onEdit: (mode: Mode) => void;
  onCreate: () => void;
};

export function ModesSection({
  modes,
  activeId,
  onActivate,
  onEdit,
  onCreate,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {modes.map((mode) => {
        const active = mode.id === activeId;
        const Icon = iconComponent(mode.icon);

        return (
          <motion.div
            key={mode.id}
            layout
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.985 }}
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            onClick={() => onActivate(mode)}
            className="group relative flex min-h-[168px] cursor-pointer flex-col overflow-hidden rounded-[16px] border p-4"
            style={{
              borderColor: active
                ? `color-mix(in srgb, ${mode.accent} 55%, transparent)`
                : "var(--color-line)",
              // Cada modo tine su propia tarjeta: es lo que les da identidad y
              // lo que hace que los reconozcas sin leer el nombre.
              background: `linear-gradient(158deg, color-mix(in srgb, ${mode.accent} ${
                active ? 20 : 11
              }%, var(--color-surface)), var(--color-surface) 72%)`,
              boxShadow: active
                ? `inset 0 1px 0 rgba(255,255,255,0.07), 0 0 24px -8px ${mode.accent}`
                : "inset 0 1px 0 rgba(255,255,255,0.05)",
            }}
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                onEdit(mode);
              }}
              aria-label={`Editar ${mode.name}`}
              className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center
                         rounded-lg text-[var(--color-faint)] opacity-0 transition
                         hover:bg-white/10 hover:text-[var(--color-text)]
                         group-hover:opacity-100"
            >
              <Pencil size={12} />
            </button>

            <div className="mb-3 flex items-center gap-2.5">
              <span
                className="flex h-11 w-11 items-center justify-center rounded-[13px]
                           shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                style={{
                  background: `color-mix(in srgb, ${mode.accent} 20%, #0b0d10)`,
                  color: `color-mix(in srgb, ${mode.accent} 72%, white)`,
                }}
              >
                <Icon size={20} strokeWidth={1.9} />
              </span>

              {active && (
                <span
                  className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                  style={{
                    background: `color-mix(in srgb, ${mode.accent} 26%, #0d1016)`,
                    color: `color-mix(in srgb, ${mode.accent} 65%, white)`,
                  }}
                >
                  <Check size={9} strokeWidth={3} />
                  activo
                </span>
              )}
            </div>

            <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">
              {mode.name}
            </div>

            <div className="mt-0.5 text-[10px] text-[var(--color-faint)]">
              {mode.rules.length > 0
                ? `${mode.rules.length} aplicaciones`
                : "Sin reglas"}
              {mode.fallbackVolume !== null &&
                ` · resto al ${Math.round(mode.fallbackVolume * 100)}%`}
            </div>

            <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
              {mode.hotkey && <Chip>{prettyAccel(mode.hotkey)}</Chip>}
              {mode.ducking.enabled && (
                <Chip accent={mode.accent}>
                  <Mic size={9} />
                  voz
                </Chip>
              )}
              {mode.autoActivate.processes.length > 0 && (
                <Chip title={mode.autoActivate.processes.join(", ")}>
                  <Monitor size={9} />
                  {mode.autoActivate.processes[0]}
                </Chip>
              )}
              {mode.autoActivate.schedule && (
                <Chip>
                  <Clock size={9} />
                  {mode.autoActivate.schedule.from}
                </Chip>
              )}
            </div>
          </motion.div>
        );
      })}

      <button
        onClick={onCreate}
        className="flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-[16px]
                   border border-dashed border-[var(--color-line)] text-[var(--color-faint)]
                   transition hover:border-[var(--accent)] hover:bg-white/[0.02]
                   hover:text-[var(--accent)]"
      >
        <Plus size={20} strokeWidth={1.8} />
        <span className="text-[11px] font-medium">Modo nuevo</span>
      </button>
    </div>
  );
}

function Chip({
  children,
  accent,
  title,
}: {
  children: React.ReactNode;
  accent?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="tabular flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-1 text-[9.5px] font-medium"
      style={{
        background: accent
          ? `color-mix(in srgb, ${accent} 20%, #0d1016)`
          : "rgba(255,255,255,0.055)",
        color: accent
          ? `color-mix(in srgb, ${accent} 60%, white)`
          : "var(--color-muted)",
      }}
    >
      {children}
    </span>
  );
}
