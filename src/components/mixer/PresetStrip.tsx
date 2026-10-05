import * as Slider from "@radix-ui/react-slider";
import { Check, X } from "lucide-react";

import type { KnownApp, Preset } from "../../lib/known";
import { AppIcon } from "./AppIcon";

type Props = {
  app: KnownApp;
  icon?: string;
  preset?: Preset;
  onPreset: (preset: Preset | null) => void;
  onForget: () => void;
};

/**
 * Canal de una aplicación que ahora mismo NO está sonando.
 *
 * Windows no expone sesión para una aplicación cerrada, así que aquí no se
 * cambia ningún volumen: se deja *preparado*. En cuanto la aplicación vuelva a
 * emitir audio, Sonora le aplica este valor. Sirve para dejar Spotify al 20%
 * antes siquiera de abrirlo.
 */
export function PresetStrip({
  app,
  icon,
  preset,
  onPreset,
  onForget,
}: Props) {
  const armed = preset !== undefined;
  const value = preset?.volume ?? 1;

  return (
    <div className="group flex h-full w-full min-w-[88px] max-w-[168px] flex-1 shrink-0 flex-col items-center px-3 py-4">
      <span
        className="tabular text-[17px] font-semibold leading-none tracking-[-0.02em]"
        style={{ color: armed ? "var(--accent)" : "var(--color-faint)" }}
      >
        {Math.round(value * 100)}
      </span>

      <div className="mt-3 flex min-h-[90px] w-full min-w-0 flex-1 items-stretch justify-center gap-2">
        {/* Hueco del medidor, vacío: no hay nada que medir */}
        <div className="w-[4px] rounded-full bg-black/25" />

        <Slider.Root
          orientation="vertical"
          className="relative flex w-[22px] touch-none justify-center select-none"
          value={[Math.round(value * 100)]}
          max={100}
          step={1}
          onValueChange={([next]) =>
            onPreset({ volume: next / 100, muted: next === 0 })
          }
        >
          <Slider.Track className="relative h-full w-[5px] overflow-hidden rounded-full bg-black/40">
            <Slider.Range
              className="absolute w-full rounded-full"
              style={{
                background: armed
                  ? "color-mix(in srgb, var(--accent) 55%, transparent)"
                  : "rgba(255,255,255,0.10)",
              }}
            />
          </Slider.Track>

          <Slider.Thumb
            aria-label={`Volumen preparado de ${app.name}`}
            className="block h-[11px] w-[22px] rounded-[3px] border border-dashed
                       bg-[var(--color-surface-2)] outline-none
                       focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            style={{
              borderColor: armed ? "var(--accent)" : "var(--color-faint)",
            }}
          />
        </Slider.Root>
      </div>

      <div className="mt-4 flex h-6 items-center">
        {armed ? (
          <button
            onClick={() => onPreset(null)}
            title="Quitar el volumen preparado"
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-medium"
            style={{
              background: "color-mix(in srgb, var(--accent) 18%, transparent)",
              color: "var(--accent)",
            }}
          >
            <Check size={9} strokeWidth={3} />
            listo
          </button>
        ) : (
          <button
            onClick={onForget}
            title={`Olvidar ${app.name}`}
            className="flex h-6 w-6 items-center justify-center rounded-md
                       text-[var(--color-faint)] opacity-0 transition
                       hover:bg-white/5 hover:text-[var(--color-text)]
                       group-hover:opacity-100"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="mt-3 opacity-45">
        <AppIcon
          name={app.name}
          exe={app.exe}
          isSystem={false}
          icon={icon}
        />
      </div>

      <span
        className="mt-2 w-full truncate text-center text-[10.5px] font-medium text-[var(--color-faint)]"
        title={app.path || app.exe}
      >
        {app.name}
      </span>
    </div>
  );
}
