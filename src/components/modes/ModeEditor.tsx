import { useState } from "react";
import { motion } from "motion/react";
import { Camera, Power, Trash2, X } from "lucide-react";

import type { AppGroup } from "../../lib/group";
import type { AudioDevice } from "../../lib/ipc";
import type { KnownApp } from "../../lib/known";
import { MODE_ICONS, MODE_ICON_KEYS, resolveIcon } from "../../lib/icons";
import { prettyPattern, rulesFromCurrent, type Mode } from "../../lib/modes";
import { AppPicker } from "./AppPicker";
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

/**
 * Las cuatro cosas que tiene un modo, separadas.
 *
 * Antes estaba todo en una sola columna larga y habia que hacer scroll para
 * entender que hacia cada parte. Cada apartado responde a una pregunta
 * distinta, asi que se ven de uno en uno.
 */
const PESTANAS = [
  { id: "general", label: "General", pista: "Nombre, icono y atajo" },
  { id: "auto", label: "Cuándo se activa", pista: "Solo, sin tocar nada" },
  { id: "prioridad", label: "Prioridad", pista: "Qué baja mientras suena qué" },
  { id: "volumenes", label: "Volúmenes", pista: "Cómo queda todo al entrar" },
] as const;

type Pestana = (typeof PESTANAS)[number]["id"];

type Props = {
  mode: Mode;
  groups: AppGroup[];
  devices: AudioDevice[];
  knownApps: KnownApp[];
  /** Iconos ya extraídos, indexados por ruta del ejecutable */
  icons: Record<string, string>;
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
  knownApps,
  icons,
  canDelete,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Mode>(mode);
  const [pestana, setPestana] = useState<Pestana>("general");

  const patch = (changes: Partial<Mode>) =>
    setDraft((current) => ({ ...current, ...changes }));
  const patchAuto = (changes: Partial<Mode["autoActivate"]>) =>
    patch({ autoActivate: { ...draft.autoActivate, ...changes } });

  const Icono = MODE_ICONS[resolveIcon(draft.icon)];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="absolute inset-0 z-10 flex items-center justify-center
                 bg-black/60 p-4 backdrop-blur-[3px] sm:p-8"
    >
      <motion.div
        // El clic en el fondo cierra; dentro del panel no debe propagarse.
        onClick={(event) => event.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        className="flex max-h-full w-full max-w-[760px] flex-col overflow-hidden
                   rounded-[18px] border border-[var(--color-line)]
                   bg-[var(--color-base)] shadow-2xl"
        style={{ ["--accent" as string]: draft.accent }}
      >
        {/* Cabecera: el modo se ve tal y como quedara */}
        <div
          className="flex shrink-0 items-center gap-3 border-b border-[var(--color-line)] px-4 py-3.5"
          style={{
            background: `linear-gradient(120deg, color-mix(in srgb, ${draft.accent} 14%, transparent), transparent 60%)`,
          }}
        >
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px]"
            style={{
              background: `color-mix(in srgb, ${draft.accent} 20%, transparent)`,
              color: draft.accent,
            }}
          >
            <Icono size={19} strokeWidth={1.9} />
          </span>

          <input
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
            aria-label="Nombre del modo"
            placeholder="Nombre del modo"
            className="min-w-0 flex-1 bg-transparent text-[19px] font-semibold
                       tracking-[-0.02em] outline-none placeholder:text-[var(--color-faint)]"
          />

          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-9 shrink-0 items-center justify-center rounded-lg
                       text-[var(--color-faint)] hover:bg-[var(--color-surface-2)]
                       hover:text-[var(--color-text)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Pestañas */}
        <div className="flex shrink-0 gap-1 border-b border-[var(--color-line)] px-3">
          {PESTANAS.map(({ id, label, pista }) => {
            const activa = id === pestana;

            return (
              <button
                key={id}
                onClick={() => setPestana(id)}
                title={pista}
                className="relative px-3 py-2.5 text-[12px] transition-colors"
                style={{
                  color: activa ? draft.accent : "var(--color-faint)",
                  fontWeight: activa ? 600 : 400,
                }}
              >
                {label}
                {activa && (
                  <motion.span
                    layoutId="pestana-modo"
                    transition={{ type: "spring", stiffness: 500, damping: 38 }}
                    className="absolute inset-x-2 -bottom-px h-[2px] rounded-full"
                    style={{ background: draft.accent }}
                  />
                )}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {pestana === "general" && (
            <div className="flex flex-col gap-5">
              <Bloque
                titulo="Para qué lo usas"
                pista="Se ve en la tarjeta del modo, para no adivinar qué hacía"
              >
                <textarea
                  value={draft.description}
                  onChange={(e) =>
                    patch({ description: e.target.value.slice(0, 160) })
                  }
                  placeholder="Música alta y el juego bajo, para cuando estoy solo."
                  rows={2}
                  className="w-full resize-none rounded-[10px] border border-[var(--color-line)]
                             bg-[var(--color-surface-2)] px-3 py-2.5 text-[12px] leading-relaxed
                             outline-none focus:border-[var(--accent)]"
                />
                <div className="mt-1 text-right text-[9px] text-[var(--color-faint)]">
                  {draft.description.length}/160
                </div>
              </Bloque>

              <Bloque titulo="Icono y color" pista="Para reconocerlo de un vistazo">
                <div className="grid grid-cols-6 gap-1.5">
                  {MODE_ICON_KEYS.map((key) => {
                    const Icon = MODE_ICONS[key];
                    const selected = resolveIcon(draft.icon) === key;

                    return (
                      <button
                        key={key}
                        onClick={() => patch({ icon: key })}
                        aria-label={key}
                        className="flex h-10 items-center justify-center rounded-[10px] border transition-colors"
                        style={{
                          borderColor: selected
                            ? draft.accent
                            : "var(--color-line)",
                          background: selected
                            ? `color-mix(in srgb, ${draft.accent} 16%, transparent)`
                            : "var(--color-surface-2)",
                          color: selected
                            ? draft.accent
                            : "var(--color-muted)",
                        }}
                      >
                        <Icon size={16} strokeWidth={1.9} />
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2.5 flex gap-2">
                  {ACCENTS.map((color) => (
                    <button
                      key={color}
                      onClick={() => patch({ accent: color })}
                      aria-label={`Color ${color}`}
                      className="h-7 w-7 rounded-full transition-transform"
                      style={{
                        background: color,
                        outline:
                          draft.accent === color
                            ? `2px solid ${color}`
                            : "none",
                        outlineOffset: 2,
                      }}
                    />
                  ))}
                </div>
              </Bloque>

              <Bloque
                titulo="Atajo de teclado"
                pista="Funciona con el juego a pantalla completa"
              >
                <HotkeyRecorder
                  value={draft.hotkey}
                  onChange={(hotkey) => patch({ hotkey })}
                />
              </Bloque>
            </div>
          )}

          {pestana === "auto" && (
            <div className="flex flex-col gap-5">
              <p className="text-[12px] leading-relaxed text-[var(--color-muted)]">
                Todo esto es opcional. Sin nada marcado, el modo solo entra
                cuando lo eliges tú o pulsas su atajo.
              </p>

              <Bloque
                titulo="Al abrir Sonora"
                pista="El modo con el que quieres empezar siempre"
              >
                <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed">
                  <input
                    type="checkbox"
                    checked={draft.autoActivate.onStartup}
                    onChange={(e) => patchAuto({ onStartup: e.target.checked })}
                    className="mt-0.5 accent-[var(--accent)]"
                  />
                  <span>
                    Empezar con este modo
                    <span className="mt-0.5 block text-[10px] text-[var(--color-faint)]">
                      Solo puede tenerlo un modo. Si lo marcas aquí, se le quita
                      al que lo tuviera.
                    </span>
                  </span>
                </label>

                {draft.autoActivate.onStartup && (
                  <p
                    className="mt-2.5 flex items-center gap-1.5 text-[11px]"
                    style={{ color: draft.accent }}
                  >
                    <Power size={11} strokeWidth={2} />
                    Este es tu modo de arranque
                  </p>
                )}
              </Bloque>

              <Bloque
                titulo="Al abrir un programa"
                pista="Elígelo de la lista, sin escribir nombres"
              >
                <AppPicker
                  elegidos={draft.autoActivate.processes}
                  knownApps={knownApps}
                  accent={draft.accent}
                  onChange={(processes) => patchAuto({ processes })}
                />
                <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-faint)]">
                  Al cerrar el programa, Sonora vuelve al modo que tuvieras
                  antes.
                </p>
              </Bloque>

              {devices.length > 0 && (
                <Bloque
                  titulo="Al cambiar de salida"
                  pista="Por ejemplo, al ponerte los cascos"
                >
                  <div className="space-y-1.5">
                    {devices.map((device) => {
                      const checked = draft.autoActivate.devices.includes(
                        device.id
                      );

                      return (
                        <label
                          key={device.id}
                          className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-muted)]"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              patchAuto({
                                devices: e.target.checked
                                  ? [...draft.autoActivate.devices, device.id]
                                  : draft.autoActivate.devices.filter(
                                      (id) => id !== device.id
                                    ),
                              })
                            }
                            className="accent-[var(--accent)]"
                          />
                          <span className="truncate" title={device.name}>
                            {device.name}
                          </span>
                          {device.isDefault && (
                            <span className="shrink-0 text-[9px] text-[var(--color-faint)]">
                              en uso
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                </Bloque>
              )}

              <Bloque titulo="A cierta hora" pista="Puede cruzar la medianoche">
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    checked={draft.autoActivate.schedule !== null}
                    onChange={(e) =>
                      patchAuto({
                        schedule: e.target.checked
                          ? { from: "23:00", to: "08:00" }
                          : null,
                      })
                    }
                    className="accent-[var(--accent)]"
                  />
                  En una franja horaria
                </label>

                {draft.autoActivate.schedule && (
                  <div className="mt-2.5 flex items-center gap-2">
                    <TimeInput
                      value={draft.autoActivate.schedule.from}
                      onChange={(from) =>
                        patchAuto({
                          schedule: { ...draft.autoActivate.schedule!, from },
                        })
                      }
                    />
                    <span className="text-[10px] text-[var(--color-faint)]">
                      a
                    </span>
                    <TimeInput
                      value={draft.autoActivate.schedule.to}
                      onChange={(to) =>
                        patchAuto({
                          schedule: { ...draft.autoActivate.schedule!, to },
                        })
                      }
                    />
                  </div>
                )}
              </Bloque>
            </div>
          )}

          {pestana === "prioridad" && (
            <div>
              <p className="mb-4 max-w-[62ch] text-[12px] leading-relaxed text-[var(--color-muted)]">
                Baja unas aplicaciones automáticamente mientras suenan otras. Lo
                típico: que el juego baje solo mientras alguien habla, y vuelva
                al callarse.
              </p>
              <DuckingEditor
                rules={draft.duckingRules}
                accent={draft.accent}
                groups={groups}
                knownApps={knownApps}
                icons={icons}
                onChange={(duckingRules) => patch({ duckingRules })}
              />
            </div>
          )}

          {pestana === "volumenes" && (
            <div className="flex flex-col gap-5">
              <Bloque
                titulo={`Al entrar en el modo (${draft.rules.length})`}
                pista="Deja el mezclador como tú quieras y guárdalo de un golpe"
                accion={
                  <button
                    onClick={() => patch({ rules: rulesFromCurrent(groups) })}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--color-line)]
                               px-2.5 py-1.5 text-[11px] text-[var(--color-muted)]
                               transition-colors hover:text-[var(--color-text)]"
                  >
                    <Camera size={12} />
                    Guardar niveles actuales
                  </button>
                }
              >
                {draft.rules.length === 0 ? (
                  <p className="rounded-[10px] bg-[var(--color-surface)] px-3 py-3 text-[11px] leading-relaxed text-[var(--color-faint)]">
                    Sin nada guardado todavía. Pon el mezclador como te guste y
                    pulsa «Guardar niveles actuales».
                  </p>
                ) : (
                  <div className="space-y-2">
                    {draft.rules.map((rule, index) => (
                      <div
                        key={`${rule.match}-${index}`}
                        className="rounded-[10px] bg-[var(--color-surface)] px-3 py-2.5"
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="truncate text-[12px]">
                            {prettyPattern(rule.match)}
                          </span>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="tabular text-[12px] font-medium text-[var(--color-muted)]">
                              {Math.round(rule.volume * 100)}%
                            </span>
                            <button
                              onClick={() =>
                                patch({
                                  rules: draft.rules.filter(
                                    (_, i) => i !== index
                                  ),
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
                            rules[index] = {
                              ...rule,
                              volume,
                              muted: volume === 0,
                            };
                            patch({ rules });
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Bloque>

              <Bloque
                titulo="Las demás aplicaciones"
                pista="Las que no tienen nada guardado arriba"
              >
                <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[var(--color-muted)]">
                  <input
                    type="checkbox"
                    checked={draft.fallbackVolume !== null}
                    onChange={(e) =>
                      patch({ fallbackVolume: e.target.checked ? 0.5 : null })
                    }
                    className="accent-[var(--accent)]"
                  />
                  Fijarles también un volumen
                </label>

                {draft.fallbackVolume !== null && (
                  <div className="mt-2.5 rounded-[10px] bg-[var(--color-surface)] px-3 py-2.5">
                    <div className="mb-1.5 text-right">
                      <span className="tabular text-[11px] text-[var(--color-muted)]">
                        {Math.round(draft.fallbackVolume * 100)}%
                      </span>
                    </div>
                    <VolumeSlider
                      value={draft.fallbackVolume}
                      onChange={(fallbackVolume) => patch({ fallbackVolume })}
                    />
                  </div>
                )}
              </Bloque>
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-line)] px-5 py-3.5">
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
            className="rounded-[10px] px-4 py-2 text-[12px] font-semibold text-black transition"
            style={{ background: draft.accent }}
          >
            Guardar
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Un apartado con su titulo y una linea que explica para que sirve.
 *
 * La pista es lo importante: un titulo solo dice como se llama, no que hace.
 */
function Bloque({
  titulo,
  pista,
  accion,
  children,
}: {
  titulo: string;
  pista: string;
  accion?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
            {titulo}
          </h3>
          <p className="mt-0.5 text-[11px] text-[var(--color-faint)]">{pista}</p>
        </div>
        {accion}
      </div>
      {children}
    </section>
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
                 px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
    />
  );
}
