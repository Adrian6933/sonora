import { useState } from "react";
import { Plus, X } from "lucide-react";

import type { AppGroup } from "../../lib/group";
import { DUCKING_PRESETS, matches, type Ducking } from "../../lib/modes";
import { VolumeSlider } from "../ui/VolumeSlider";

type Props = {
  value: Ducking;
  accent: string;
  /** Aplicaciones con audio ahora mismo, para elegirlas de una lista */
  groups: AppGroup[];
  onChange: (ducking: Ducking) => void;
};

/**
 * Editor de la regla de prioridad de audio.
 *
 * Es deliberadamente literal —"cuando suene X, baja Y hasta el Z%"— porque el
 * motor admite las dos direcciones y no es obvio: lo normal es bajar el juego
 * cuando habla Discord, pero tambien puedes bajar Discord cuando el juego pega
 * un petardazo, que es justo lo contrario.
 */
export function DuckingEditor({ value, accent, groups, onChange }: Props) {
  const patch = (changes: Partial<Ducking>) =>
    onChange({ ...value, ...changes });

  const allTargets = value.targets.length === 0;

  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-start gap-2 rounded-[12px] bg-[var(--color-surface)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
          className="mt-0.5 accent-[var(--accent)]"
        />
        <span>
          Bajar unas aplicaciones cuando suenen otras
          <span className="mt-0.5 block text-[10px] text-[var(--color-faint)]">
            Se nota sobre todo con la voz: el juego baja solo mientras alguien
            habla y vuelve al soltar.
          </span>
        </span>
      </label>

      {value.enabled && (
        <>
          <Field label="Cuando suene">
            <AppChips
              patterns={value.triggers}
              groups={groups}
              accent={accent}
              placeholder="Discord.exe"
              onChange={(triggers) => patch({ triggers })}
            />
          </Field>

          <Field label="Baja">
            <div className="mb-2 flex gap-1.5">
              <Choice
                selected={allTargets}
                accent={accent}
                onClick={() => patch({ targets: [] })}
              >
                Todo lo demás
              </Choice>
              <Choice
                selected={!allTargets}
                accent={accent}
                onClick={() => {
                  // Al pasar a "solo estas" hay que sembrar algo o el selector
                  // sale vacio y no se entiende que hay que hacer.
                  if (value.targets.length === 0) {
                    const first = groups.find(
                      (group) =>
                        !group.isSystem &&
                        !value.triggers.some((pattern) =>
                          matches(pattern, group.exe)
                        )
                    );
                    patch({ targets: first ? [first.exe] : [""] });
                  }
                }}
              >
                Solo estas
              </Choice>
            </div>

            {!allTargets && (
              <AppChips
                patterns={value.targets}
                groups={groups}
                accent={accent}
                placeholder="Spotify.exe"
                onChange={(targets) => patch({ targets })}
              />
            )}
          </Field>

          <Field label={`Hasta el ${Math.round(value.reduction * 100)}%`}>
            <VolumeSlider
              value={value.reduction}
              onChange={(reduction) => patch({ reduction })}
            />
          </Field>

          <Field label="Suavidad">
            <div className="flex gap-1.5">
              {(
                Object.keys(DUCKING_PRESETS) as Array<
                  keyof typeof DUCKING_PRESETS
                >
              ).map((name) => {
                const preset = DUCKING_PRESETS[name];
                const selected =
                  value.attackMs === preset.attackMs &&
                  value.releaseMs === preset.releaseMs;

                return (
                  <Choice
                    key={name}
                    selected={selected}
                    accent={accent}
                    onClick={() =>
                      patch({
                        attackMs: preset.attackMs,
                        releaseMs: preset.releaseMs,
                        holdMs: preset.holdMs,
                      })
                    }
                  >
                    <span className="capitalize">{name}</span>
                  </Choice>
                );
              })}
            </div>

            <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
              Baja en {value.attackMs} ms, aguanta {value.holdMs} ms tras el
              silencio para que las pausas entre palabras no provoquen bombeo, y
              tarda {value.releaseMs} ms en volver.
            </p>
          </Field>
        </>
      )}
    </div>
  );
}

/** Lista de patrones de ejecutable, elegibles de las apps que suenan ahora. */
function AppChips({
  patterns,
  groups,
  accent,
  placeholder,
  onChange,
}: {
  patterns: string[];
  groups: AppGroup[];
  accent: string;
  placeholder: string;
  onChange: (patterns: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const candidates = groups.filter(
    (group) =>
      !group.isSystem &&
      !patterns.some((pattern) => matches(pattern, group.exe))
  );

  /** Si el patron casa con algo que suena, mejor ensenar su nombre bonito. */
  function label(pattern: string) {
    const hit = groups.find((group) => matches(pattern, group.exe));
    return hit ? hit.name : pattern;
  }

  return (
    <div className="rounded-[12px] bg-[var(--color-surface)] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {patterns.filter(Boolean).map((pattern) => (
          <span
            key={pattern}
            title={pattern}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px]"
            style={{
              background: `color-mix(in srgb, ${accent} 14%, transparent)`,
              color: accent,
            }}
          >
            {label(pattern)}
            <button
              onClick={() => onChange(patterns.filter((p) => p !== pattern))}
              aria-label={`Quitar ${pattern}`}
              className="opacity-60 hover:opacity-100"
            >
              <X size={9} />
            </button>
          </span>
        ))}

        <button
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1 rounded-md bg-[var(--color-surface-2)] px-1.5 py-1
                     text-[10px] text-[var(--color-faint)] hover:text-[var(--color-text)]"
        >
          <Plus size={9} />
          Añadir
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-1 border-t border-[var(--color-line)] pt-2">
          {candidates.length === 0 && (
            <p className="text-[10px] text-[var(--color-faint)]">
              No hay más aplicaciones con audio ahora mismo. Escribe el nombre
              del ejecutable abajo.
            </p>
          )}

          {candidates.map((group) => (
            <button
              key={group.key}
              onClick={() => {
                onChange([...patterns.filter(Boolean), group.exe]);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between rounded-md px-1.5 py-1
                         text-[10px] text-[var(--color-muted)] hover:bg-[var(--color-surface-2)]
                         hover:text-[var(--color-text)]"
            >
              <span>{group.name}</span>
              <span className="text-[var(--color-faint)]">{group.exe}</span>
            </button>
          ))}

          <input
            placeholder={`${placeholder} y Enter`}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const raw = event.currentTarget.value.trim();
              if (!raw) return;

              if (!patterns.includes(raw)) {
                onChange([...patterns.filter(Boolean), raw]);
              }
              event.currentTarget.value = "";
              setOpen(false);
            }}
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]
                       px-2 py-1 text-[10px] outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--color-faint)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Choice({
  selected,
  accent,
  onClick,
  children,
}: {
  selected: boolean;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 rounded-lg border px-2 py-1.5 text-[10px]"
      style={{
        borderColor: selected ? accent : "var(--color-line)",
        color: selected ? accent : "var(--color-muted)",
        background: selected
          ? `color-mix(in srgb, ${accent} 14%, transparent)`
          : "var(--color-surface)",
      }}
    >
      {children}
    </button>
  );
}
