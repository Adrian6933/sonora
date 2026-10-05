import { useEffect, useRef, useState } from "react";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";

import { ipc } from "../../lib/ipc";

import type { AppGroup } from "../../lib/group";
import type { KnownApp } from "../../lib/known";
import {
  DUCKING_PRESETS,
  matches,
  newRule,
  prettyPattern,
  type DuckingRule,
} from "../../lib/modes";
import { VolumeSlider } from "../ui/VolumeSlider";
import { AppIcon } from "../mixer/AppIcon";
import { ThresholdMeter } from "./ThresholdMeter";

type Props = {
  rules: DuckingRule[];
  accent: string;
  /** Aplicaciones con audio ahora mismo */
  groups: AppGroup[];
  /** Aplicaciones vistas alguna vez, aunque ahora estén cerradas */
  knownApps: KnownApp[];
  /** Iconos ya extraidos, indexados por ruta del ejecutable */
  icons: Record<string, string>;
  onChange: (rules: DuckingRule[]) => void;
};

/**
 * Lista de reglas de prioridad de audio.
 *
 * Se lee como una frase —"cuando suene X, baja Y hasta el Z%"— porque el motor
 * admite las dos direcciones y eso no es obvio: lo normal es bajar el juego
 * cuando habla Discord, pero también puedes bajar Discord cuando el juego pega
 * un petardazo. Con varias reglas puedes tener las dos montadas a la vez.
 */
export function DuckingEditor({
  rules,
  accent,
  groups,
  knownApps,
  icons,
  onChange,
}: Props) {
  const update = (index: number, changes: Partial<DuckingRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...changes } : rule)));

  // Mientras el editor esta abierto, se escucha lo que reproducen de verdad
  // los disparadores, aunque este modo no este activo. Sin esto el medidor
  // enseñaria el de Windows, con el reflejo incluido.
  const firma = rules.flatMap((rule) => rule.triggers).join("|");
  useEffect(() => {
    const patrones = firma ? firma.split("|") : [];
    void ipc.setListenPatterns(patrones).catch(() => {});
    return () => {
      void ipc.setListenPatterns([]).catch(() => {});
    };
  }, [firma]);

  return (
    <div className="space-y-2.5">
      {rules.length === 0 && (
        <p className="rounded-[12px] bg-[var(--color-surface)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-faint)]">
          Sin reglas. Con una regla puedes hacer que el juego baje solo mientras
          alguien habla por Discord, o al revés.
        </p>
      )}

      {rules.map((rule, index) => (
        <RuleCard
          key={index}
          rule={rule}
          accent={accent}
          groups={groups}
          knownApps={knownApps}
          icons={icons}
          onChange={(changes) => update(index, changes)}
          onRemove={() => onChange(rules.filter((_, i) => i !== index))}
        />
      ))}

      <button
        onClick={() => onChange([...rules, newRule()])}
        className="flex w-full items-center justify-center gap-1.5 rounded-[12px]
                   border border-dashed border-[var(--color-line)] py-2
                   text-[11px] text-[var(--color-faint)] transition
                   hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        <Plus size={12} />
        Añadir regla
      </button>
    </div>
  );
}

function RuleCard({
  rule,
  accent,
  groups,
  knownApps,
  icons,
  onChange,
  onRemove,
}: {
  rule: DuckingRule;
  accent: string;
  groups: AppGroup[];
  knownApps: KnownApp[];
  icons: Record<string, string>;
  onChange: (changes: Partial<DuckingRule>) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allTargets = rule.targets.length === 0;

  // Lo que estan emitiendo ahora mismo los disparadores de esta regla. Llega
  // del backend 20 veces por segundo, asi que el medidor se mueve en vivo.
  const disparadores = groups.filter((group) =>
    rule.triggers.some((pattern) => matches(pattern, group.exe))
  );
  const nivelDisparadores = disparadores.reduce(
    (max, group) => Math.max(max, group.peak),
    0
  );
  // Lo que marca el medidor de Windows. Si esta por encima del nivel real, lo
  // que sobra no es sonido de estas aplicaciones: es reflejo del resto.
  const nivelMedidor = disparadores.reduce(
    (max, group) => Math.max(max, group.meterPeak ?? group.peak),
    0
  );

  return (
    <div
      className="rounded-[12px] border p-3"
      style={{
        borderColor: rule.enabled
          ? `color-mix(in srgb, ${accent} 35%, var(--color-line))`
          : "var(--color-line)",
        background: "var(--color-surface)",
        opacity: rule.enabled ? 1 : 0.55,
      }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
          aria-label="Activar regla"
          className="accent-[var(--accent)]"
        />
        <span className="flex-1 text-[11px] font-medium text-[var(--color-muted)]">
          {describe(rule)}
        </span>
        <button
          onClick={onRemove}
          aria-label="Quitar regla"
          className="text-[var(--color-faint)] transition hover:text-[#f43f5e]"
        >
          <Trash2 size={12} />
        </button>
      </div>

      <Field label="Cuando suene">
        <AppChips
          patterns={rule.triggers}
          groups={groups}
          knownApps={knownApps}
          icons={icons}
          accent={accent}
          onChange={(triggers) => onChange({ triggers })}
        />
      </Field>

      <Field label="A partir de qué volumen">
        <label className="mb-2 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={rule.threshold > 0}
            onChange={(e) =>
              onChange({ threshold: e.target.checked ? 0.05 : 0 })
            }
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Ignorar los sonidos flojos
            <span className="mt-0.5 block text-[10px] text-[var(--color-faint)]">
              Sin esto, cualquier ruidito dispara la bajada.
            </span>
          </span>
        </label>

        {rule.threshold > 0 && (
          <Calibrador
            nivel={nivelDisparadores}
            accent={accent}
            onListo={(threshold) => onChange({ threshold })}
          />
        )}

        {rule.threshold > 0 && (
          <ThresholdMeter
            level={nivelDisparadores}
            reflejo={nivelMedidor}
            nombre={prettyPattern(rule.triggers[0] ?? "")}
            threshold={rule.threshold}
            accent={accent}
            onChange={(threshold) => onChange({ threshold })}
          />
        )}

        <div className="mt-3 rounded-[10px] bg-[var(--color-surface-2)] px-3 py-2.5">
          <Tiempo
            label="Y tiene que durar al menos"
            value={rule.sustainMs}
            max={1500}
            accent={accent}
            onChange={(sustainMs) => onChange({ sustainMs })}
          />
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
            Esto es lo que separa a alguien hablando de un aviso de Discord o un
            clic. Un aviso dura un pestañeo; una voz dura segundos. Si la música
            te baja sola sin que nadie hable, sube este número.
          </p>
        </div>
      </Field>

      <Field label="Baja">
        <div className="mb-2 flex gap-1.5">
          <Choice
            selected={allTargets}
            accent={accent}
            onClick={() => onChange({ targets: [] })}
          >
            Todo lo demás
          </Choice>
          <Choice
            selected={!allTargets}
            accent={accent}
            onClick={() => {
              // Al pasar a "solo estas" hay que sembrar algo, o el selector
              // sale vacío y no se entiende qué hay que hacer.
              if (rule.targets.length === 0) {
                const first = groups.find(
                  (group) =>
                    !group.isSystem &&
                    !rule.triggers.some((pattern) => matches(pattern, group.exe))
                );
                onChange({ targets: first ? [first.exe] : [""] });
              }
            }}
          >
            Solo estas
          </Choice>
        </div>

        {!allTargets && (
          <AppChips
            patterns={rule.targets}
            groups={groups}
            knownApps={knownApps}
            icons={icons}
            accent={accent}
            onChange={(targets) => onChange({ targets })}
          />
        )}
      </Field>

      <Field
        label={
          rule.proportional
            ? `Como mucho, hasta el ${Math.round(rule.reduction * 100)}%`
            : `Hasta el ${Math.round(rule.reduction * 100)}%`
        }
      >
        <VolumeSlider
          value={rule.reduction}
          onChange={(reduction) => onChange({ reduction })}
        />

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={rule.proportional}
            onChange={(e) => onChange({ proportional: e.target.checked })}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Bajar según lo fuerte que suene
            <span className="mt-0.5 block text-[10px] text-[var(--color-faint)]">
              Si hablan bajito baja poco; si gritan, baja del todo. Sin esto la
              bajada es siempre la misma.
            </span>
          </span>
        </label>

        {rule.proportional && (
          <div className="mt-2.5 rounded-[10px] bg-[var(--color-surface-2)] px-3 py-2.5">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11px] text-[var(--color-muted)]">
                Cuánto hay que subir la voz para llegar al tope
              </span>
              <span className="tabular text-[10px] text-[var(--color-faint)]">
                {rule.range < 0.15
                  ? "poco"
                  : rule.range > 0.45
                    ? "mucho"
                    : "normal"}
              </span>
            </div>

            <VolumeSlider
              value={rule.range}
              onChange={(range) => onChange({ range: Math.max(0.05, range) })}
            />

            <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
              Hacia la izquierda, casi cualquier voz baja del todo. Hacia la
              derecha hay más matiz: solo las voces fuertes bajan al máximo.
            </p>
          </div>
        )}
      </Field>

      <button
        onClick={() => setOpen((value) => !value)}
        className="mt-1 flex items-center gap-1 text-[10px] text-[var(--color-faint)] hover:text-[var(--color-muted)]"
      >
        <ChevronDown
          size={11}
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
        Suavidad
      </button>

      {open && (
        <div className="mt-2">
          <div className="flex gap-1.5">
            {(
              Object.keys(DUCKING_PRESETS) as Array<keyof typeof DUCKING_PRESETS>
            ).map((name) => {
              const preset = DUCKING_PRESETS[name];
              const selected =
                rule.attackMs === preset.attackMs &&
                rule.releaseMs === preset.releaseMs;

              return (
                <Choice
                  key={name}
                  selected={selected}
                  accent={accent}
                  onClick={() =>
                    onChange({
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
            Los preajustes son atajos. Debajo puedes afinar cada tiempo.
          </p>

          <div className="mt-2.5 space-y-2.5">
            <Tiempo
              label="Tarda en bajar"
              value={rule.attackMs}
              max={600}
              accent={accent}
              onChange={(attackMs) => onChange({ attackMs })}
            />
            <Tiempo
              label="Aguanta abajo tras el silencio"
              value={rule.holdMs}
              max={2000}
              accent={accent}
              onChange={(holdMs) => onChange({ holdMs })}
            />
            <Tiempo
              label="Tarda en volver"
              value={rule.releaseMs}
              max={3000}
              accent={accent}
              onChange={(releaseMs) => onChange({ releaseMs })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Resumen de la regla en una frase, para leerla de un vistazo. */
function describe(rule: DuckingRule): string {
  const from = rule.triggers.length
    ? rule.triggers.map(prettyPattern).join(" o ")
    : "algo";
  const to = rule.targets.length
    ? rule.targets.map(prettyPattern).join(" y ")
    : "todo lo demás";
  return `${from} → ${to} al ${Math.round(rule.reduction * 100)}%`;
}

/** Selector de aplicaciones: las que suenan ahora y las conocidas. */
function AppChips({
  patterns,
  groups,
  knownApps,
  icons,
  accent,
  onChange,
}: {
  patterns: string[];
  groups: AppGroup[];
  knownApps: KnownApp[];
  icons: Record<string, string>;
  accent: string;
  onChange: (patterns: string[]) => void;
}) {
  const [open, setOpen] = useState(false);

  const running = groups.filter((group) => !group.isSystem);
  const runningKeys = new Set(running.map((group) => group.key));

  const candidates = [
    ...running.map((group) => ({
      key: group.key,
      exe: group.exe,
      name: group.name,
      path: group.path,
      live: true,
    })),
    ...knownApps
      .filter((app) => !runningKeys.has(app.key))
      .map((app) => ({
        key: app.key,
        exe: app.exe,
        name: app.name,
        path: app.path,
        live: false,
      })),
  ].filter(
    (option) => !patterns.some((pattern) => matches(pattern, option.exe))
  );

  /** La aplicacion concreta a la que apunta un patron, si la conocemos. */
  function appFor(pattern: string) {
    return (
      groups.find((group) => matches(pattern, group.exe)) ??
      knownApps.find((app) => matches(pattern, app.exe))
    );
  }

  return (
    <div className="rounded-[10px] bg-[var(--color-surface-2)] px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {patterns.filter(Boolean).map((pattern) => {
          const app = appFor(pattern);

          return (
            <span
              key={pattern}
              title={pattern}
              className="flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1.5 text-[11px]"
              style={{
                background: `color-mix(in srgb, ${accent} 15%, transparent)`,
                color: accent,
              }}
            >
              <AppIcon
                name={app?.name ?? prettyPattern(pattern)}
                exe={app?.exe ?? pattern}
                isSystem={false}
                icon={app ? icons[app.path] : undefined}
                size={22}
              />
              {app?.name ?? prettyPattern(pattern)}
              <button
                onClick={() => onChange(patterns.filter((p) => p !== pattern))}
                aria-label={`Quitar ${pattern}`}
                className="opacity-60 hover:opacity-100"
              >
                <X size={11} />
              </button>
            </span>
          );
        })}

        <button
          onClick={() => setOpen((value) => !value)}
          className="flex items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 py-2
                     text-[11px] text-[var(--color-faint)] transition
                     hover:bg-white/[0.1] hover:text-[var(--color-text)]"
        >
          <Plus size={12} />
          Elegir aplicacion
        </button>
      </div>

      {open && (
        <div className="mt-2 max-h-[230px] space-y-0.5 overflow-y-auto border-t border-[var(--color-line)] pt-2">
          {candidates.length === 0 && (
            <p className="text-[10px] text-[var(--color-faint)]">
              No queda ninguna. Escribe el ejecutable abajo.
            </p>
          )}

          {candidates.map((option) => (
            <button
              key={option.key}
              onClick={() => {
                onChange([...patterns.filter(Boolean), option.exe]);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5
                         text-[11px] text-[var(--color-muted)] transition
                         hover:bg-white/[0.07] hover:text-[var(--color-text)]"
            >
              <AppIcon
                name={option.name}
                exe={option.exe}
                isSystem={false}
                icon={icons[option.path]}
                size={26}
                dimmed={!option.live}
              />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate">{option.name}</span>
                <span className="block truncate text-[9px] text-[var(--color-faint)]">
                  {option.exe}
                </span>
              </span>
              {option.live && (
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: accent }}
                  title="Sonando ahora"
                />
              )}
            </button>
          ))}

          <input
            placeholder="o escribe: VALORANT.exe"
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
            className="mt-1 w-full rounded-md border border-[var(--color-line)] bg-[var(--color-surface)]
                       px-2 py-1 text-[10px] outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}
    </div>
  );
}

/** Un tiempo del ducking, en milisegundos. */
function Tiempo({
  label,
  value,
  max,
  accent,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  accent: string;
  onChange: (ms: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
        <span className="tabular text-[10px]" style={{ color: accent }}>
          {value} ms
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        step={10}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-black/45
                   accent-[var(--accent)]"
      />
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
    <div className="mb-2.5">
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.09em] text-[var(--color-faint)]">
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
          : "var(--color-surface-2)",
      }}
    >
      {children}
    </button>
  );
}

/**
 * Pone el umbral por encima del ruido de fondo, escuchando unos segundos.
 *
 * Es la unica forma honesta de acertar: el ruido de una llamada depende de los
 * micros de los demas, y no hay un numero bueno para todo el mundo. Se mide lo
 * que hay cuando nadie habla y se deja un margen por encima.
 */
function Calibrador({
  nivel,
  accent,
  onListo,
}: {
  nivel: number;
  accent: string;
  onListo: (umbral: number) => void;
}) {
  const [restante, setRestante] = useState(0);
  const maximo = useRef(0);

  // El nivel llega por props y cambia muchas veces por segundo; el maximo se
  // acumula en una ref para no provocar un render por cada muestra.
  useEffect(() => {
    if (restante > 0) maximo.current = Math.max(maximo.current, nivel);
  }, [nivel, restante]);

  useEffect(() => {
    if (restante <= 0) return;

    const id = window.setTimeout(() => {
      const quedan = restante - 1;
      setRestante(quedan);

      if (quedan === 0) {
        // Un 30% de margen sobre lo que se ha visto, y un minimo para que el
        // silencio absoluto no deje el umbral pegado a cero.
        const umbral = Math.min(0.6, Math.max(0.04, maximo.current * 1.3 + 0.02));
        onListo(Number(umbral.toFixed(3)));
      }
    }, 1000);

    return () => window.clearTimeout(id);
  }, [restante, onListo]);

  const midiendo = restante > 0;

  return (
    <div className="mb-2.5">
      <button
        onClick={() => {
          maximo.current = 0;
          setRestante(5);
        }}
        disabled={midiendo}
        className="rounded-[10px] border border-[var(--color-line)] px-3 py-1.5
                   text-[11px] transition-colors disabled:opacity-60"
        style={{ color: midiendo ? accent : "var(--color-muted)" }}
      >
        {midiendo ? `Escuchando... ${restante}` : "Calibrar con el silencio"}
      </button>

      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--color-faint)]">
        {midiendo
          ? "No hables. Estoy midiendo el ruido de fondo para dejar el umbral justo por encima."
          : "Púlsalo con la llamada abierta y sin que nadie hable. Mide el ruido de fondo y coloca el umbral por encima."}
      </p>
    </div>
  );
}
