import { useState } from "react";
import { motion } from "motion/react";
import { Camera, Trash2, X } from "lucide-react";

import type { AppGroup } from "../../lib/group";
import type { AudioDevice } from "../../lib/ipc";
import { MODE_ICONS, MODE_ICON_KEYS, resolveIcon } from "../../lib/icons";
import { rulesFromCurrent, type Mode } from "../../lib/modes";
import { DuckingEditor } from "./DuckingEditor";
import { VolumeSlider } from "../ui/VolumeSlider";
import { HotkeyRecorder } from "./HotkeyRecorder";

const ACCENTS = [
  "#38bdf8",
  "#f43f5e",
  "#a78bfa",
  "#34d399",
  "#fb923c",
  "#facc15",
];

type Props = {
  mode: Mode;
  groups: AppGroup[];
  devices: AudioDevice[];
  /** false para los modos de fabrica recien creados que aun no se han guardado */
  canDelete: boolean;
  onSave: (mode: Mode) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export function ModeEditor({
  mode,
  groups,
  devices,
  canDelete,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Mode>(mode);
  const patch = (changes: Partial<Mode>) =>
    setDraft((current) => ({ ...current, ...changes }));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 p-6 backdrop-blur-[3px]"
    >
      <motion.div
        // El clic en el fondo cierra; dentro del panel no debe propagarse.
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="flex max-h-full w-[440px] flex-col overflow-hidden rounded-[16px]
                   border border-[var(--color-line)] bg-[var(--color-base)] shadow-2xl"
      >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-[var(--color-line)] pl-4 pr-1">
        <span className="text-[12px] font-semibold">Editar modo</span>
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="flex h-8 w-10 items-center justify-center rounded-lg
                     text-[var(--color-faint)] hover:bg-[var(--color-surface-2)]
                     hover:text-[var(--color-text)]"
        >
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* Identidad */}
        <input
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="Nombre del modo"
          placeholder="Nombre del modo"
          className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]
                     px-3 py-2 text-[13px] outline-none focus:border-[var(--accent)]"
        />

        <div>
          <Label>Icono</Label>
          <div className="grid grid-cols-6 gap-1.5">
            {MODE_ICON_KEYS.map((key) => {
              const Icon = MODE_ICONS[key];
              const selected = resolveIcon(draft.icon) === key;

              return (
                <button
                  key={key}
                  onClick={() => patch({ icon: key })}
                  aria-label={key}
                  className="flex h-9 items-center justify-center rounded-lg border"
                  style={{
                    borderColor: selected ? draft.accent : "var(--color-line)",
                    background: selected
                      ? `color-mix(in srgb, ${draft.accent} 16%, transparent)`
                      : "var(--color-surface)",
                    color: selected ? draft.accent : "var(--color-faint)",
                  }}
                >
                  <Icon size={15} strokeWidth={1.9} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Color */}
        <div>
          <Label>Color</Label>
          <div className="flex gap-2">
            {ACCENTS.map((color) => (
              <button
                key={color}
                onClick={() => patch({ accent: color })}
                aria-label={`Color ${color}`}
                className="h-6 w-6 rounded-full border-2"
                style={{
                  background: color,
                  borderColor:
                    draft.accent === color ? "var(--color-text)" : "transparent",
                }}
              />
            ))}
          </div>
        </div>

        {/* Atajo */}
        <div>
          <Label>Atajo global</Label>
          <HotkeyRecorder
            value={draft.hotkey}
            onChange={(hotkey) => patch({ hotkey })}
          />
        </div>

        {/* Automatizacion */}
        <div>
          <Label>Activarse solo</Label>

          <div className="rounded-lg bg-[var(--color-surface)] px-2.5 py-2">
            <div className="mb-1.5 text-[10px] text-[var(--color-muted)]">
              Al abrir estos programas
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.autoActivate.processes.map((name) => (
                <span
                  key={name}
                  className="flex items-center gap-1 rounded-md bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px]"
                >
                  {name}
                  <button
                    onClick={() =>
                      patch({
                        autoActivate: {
                          ...draft.autoActivate,
                          processes: draft.autoActivate.processes.filter(
                            (p) => p !== name
                          ),
                        },
                      })
                    }
                    aria-label={`Quitar ${name}`}
                    className="text-[var(--color-faint)] hover:text-[#f43f5e]"
                  >
                    <X size={9} />
                  </button>
                </span>
              ))}
              {draft.autoActivate.processes.length === 0 && (
                <span className="text-[10px] text-[var(--color-faint)]">
                  Ninguno
                </span>
              )}
            </div>

            <input
              placeholder="VALORANT.exe y Enter"
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                const value = event.currentTarget.value.trim();
                if (!value) return;

                if (!draft.autoActivate.processes.includes(value)) {
                  patch({
                    autoActivate: {
                      ...draft.autoActivate,
                      processes: [...draft.autoActivate.processes, value],
                    },
                  });
                }
                event.currentTarget.value = "";
              }}
              className="w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]
                         px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]"
            />

            <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-faint)]">
              Al cerrarlos vuelve al modo que tuvieras antes.
            </p>
          </div>

          {devices.length > 0 && (
            <div className="mt-2 rounded-lg bg-[var(--color-surface)] px-2.5 py-2">
              <div className="mb-1.5 text-[10px] text-[var(--color-muted)]">
                Al cambiar a estos dispositivos
              </div>

              <div className="space-y-1">
                {devices.map((device) => {
                  const checked = draft.autoActivate.devices.includes(device.id);

                  return (
                    <label
                      key={device.id}
                      className="flex cursor-pointer items-center gap-2 text-[10px] text-[var(--color-muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          patch({
                            autoActivate: {
                              ...draft.autoActivate,
                              devices: e.target.checked
                                ? [...draft.autoActivate.devices, device.id]
                                : draft.autoActivate.devices.filter(
                                    (id) => id !== device.id
                                  ),
                            },
                          })
                        }
                        className="accent-[var(--accent)]"
                      />
                      <span className="truncate" title={device.name}>
                        {device.name}
                      </span>
                      {device.isDefault && (
                        <span className="shrink-0 text-[9px] text-[var(--color-faint)]">
                          activo
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={draft.autoActivate.schedule !== null}
              onChange={(e) =>
                patch({
                  autoActivate: {
                    ...draft.autoActivate,
                    schedule: e.target.checked
                      ? { from: "23:00", to: "08:00" }
                      : null,
                  },
                })
              }
              className="accent-[var(--accent)]"
            />
            En una franja horaria
          </label>

          {draft.autoActivate.schedule && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--color-surface)] px-2.5 py-2">
              <TimeInput
                value={draft.autoActivate.schedule.from}
                onChange={(from) =>
                  patch({
                    autoActivate: {
                      ...draft.autoActivate,
                      schedule: { ...draft.autoActivate.schedule!, from },
                    },
                  })
                }
              />
              <span className="text-[10px] text-[var(--color-faint)]">a</span>
              <TimeInput
                value={draft.autoActivate.schedule.to}
                onChange={(to) =>
                  patch({
                    autoActivate: {
                      ...draft.autoActivate,
                      schedule: { ...draft.autoActivate.schedule!, to },
                    },
                  })
                }
              />
            </div>
          )}
        </div>

        {/* Prioridad de audio */}
        <div>
          <Label>Prioridad de audio</Label>
          <DuckingEditor
            value={draft.ducking}
            accent={draft.accent}
            groups={groups}
            onChange={(ducking) => patch({ ducking })}
          />
        </div>

        {/* Reglas */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">Aplicaciones ({draft.rules.length})</Label>
            <button
              onClick={() => patch({ rules: rulesFromCurrent(groups) })}
              title="Copia los volumenes que tienes ahora mismo en el mezclador"
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]
                         text-[var(--color-faint)] hover:bg-[var(--color-surface-2)]
                         hover:text-[var(--color-text)]"
            >
              <Camera size={11} />
              Guardar niveles actuales
            </button>
          </div>

          {draft.rules.length === 0 && (
            <p className="rounded-lg bg-[var(--color-surface)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
              Sin reglas todavia. Ajusta el mezclador como lo quieras y pulsa
              «Guardar niveles actuales».
            </p>
          )}

          <div className="space-y-2">
            {draft.rules.map((rule, index) => (
              <div
                key={`${rule.match}-${index}`}
                className="rounded-lg bg-[var(--color-surface)] px-2.5 py-2"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="truncate text-[11px]">{rule.match}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className="tabular text-[10px] text-[var(--color-muted)]">
                      {Math.round(rule.volume * 100)}%
                    </span>
                    <button
                      onClick={() =>
                        patch({
                          rules: draft.rules.filter((_, i) => i !== index),
                        })
                      }
                      aria-label={`Quitar ${rule.match}`}
                      className="text-[var(--color-faint)] hover:text-[#f43f5e]"
                    >
                      <Trash2 size={11} />
                    </button>
                  </span>
                </div>
                <VolumeSlider
                  value={rule.volume}
                  onChange={(volume) => {
                    const rules = [...draft.rules];
                    rules[index] = { ...rule, volume, muted: volume === 0 };
                    patch({ rules });
                  }}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Resto de aplicaciones */}
        <div>
          <Label>Las demas aplicaciones</Label>
          <label className="mb-2 flex cursor-pointer items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <input
              type="checkbox"
              checked={draft.fallbackVolume !== null}
              onChange={(e) =>
                patch({ fallbackVolume: e.target.checked ? 0.5 : null })
              }
              className="accent-[var(--accent)]"
            />
            Fijarles tambien un volumen
          </label>

          {draft.fallbackVolume !== null && (
            <div className="rounded-lg bg-[var(--color-surface)] px-2.5 py-2">
              <div className="mb-1.5 text-right">
                <span className="tabular text-[10px] text-[var(--color-muted)]">
                  {Math.round(draft.fallbackVolume * 100)}%
                </span>
              </div>
              <VolumeSlider
                value={draft.fallbackVolume}
                onChange={(fallbackVolume) => patch({ fallbackVolume })}
              />
            </div>
          )}
        </div>
      </div>

      {/* Acciones */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-line)] px-4 py-3">
        {canDelete && (
          <button
            onClick={() => {
              onDelete(draft.id);
              onClose();
            }}
            className="rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--color-faint)]
                       hover:bg-[#450a0a] hover:text-[#fca5a5]"
          >
            Eliminar
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded-lg px-3 py-1.5 text-[11px] text-[var(--color-muted)]
                     hover:bg-[var(--color-surface-2)]"
        >
          Cancelar
        </button>
        <button
          onClick={() => {
            onSave(draft);
            onClose();
          }}
          className="rounded-lg px-3 py-1.5 text-[11px] font-medium text-black"
          style={{ background: draft.accent }}
        >
          Guardar
        </button>
      </div>
      </motion.div>
    </motion.div>
  );
}

function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="time"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="tabular rounded-md border border-[var(--color-line)] bg-[var(--color-surface-2)]
                 px-2 py-1 text-[11px] outline-none focus:border-[var(--accent)]"
    />
  );
}

function Label({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.09em] text-[var(--color-faint)] ${className}`}
    >
      {children}
    </div>
  );
}
