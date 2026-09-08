import { motion } from "motion/react";
import { Pencil, Plus } from "lucide-react";

import { prettyAccel } from "../../hooks/useHotkeys";
import type { Mode } from "../../lib/modes";

type Props = {
  modes: Mode[];
  activeId: string | null;
  onActivate: (mode: Mode) => void;
  onEdit: (mode: Mode) => void;
  onCreate: () => void;
};

export function ModeBar({
  modes,
  activeId,
  onActivate,
  onEdit,
  onCreate,
}: Props) {
  return (
    <div className="px-3 pb-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--color-faint)]">
          Modos
        </span>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]
                     text-[var(--color-faint)] hover:bg-[var(--color-surface-2)]
                     hover:text-[var(--color-text)]"
        >
          <Plus size={11} />
          Nuevo
        </button>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {modes.map((mode) => {
          const active = mode.id === activeId;

          return (
            <motion.button
              key={mode.id}
              layout
              onClick={() => onActivate(mode)}
              onContextMenu={(event) => {
                event.preventDefault();
                onEdit(mode);
              }}
              whileTap={{ scale: 0.96 }}
              title={
                mode.hotkey
                  ? `${mode.name} · ${prettyAccel(mode.hotkey)} · clic derecho para editar`
                  : `${mode.name} · clic derecho para editar`
              }
              className="group relative flex shrink-0 items-center gap-1.5 rounded-[10px]
                         border px-2.5 py-1.5 text-[11px] font-medium"
              style={{
                borderColor: active ? mode.accent : "var(--color-line)",
                background: active
                  ? `color-mix(in srgb, ${mode.accent} 16%, transparent)`
                  : "var(--color-surface)",
                color: active ? mode.accent : "var(--color-muted)",
              }}
            >
              <span className="text-[12px] leading-none">{mode.icon}</span>
              <span className="whitespace-nowrap">{mode.name}</span>

              <span
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(mode);
                }}
                role="button"
                aria-label={`Editar ${mode.name}`}
                className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              >
                <Pencil size={10} />
              </span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
