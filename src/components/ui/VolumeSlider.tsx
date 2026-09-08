import * as Slider from "@radix-ui/react-slider";

type Props = {
  value: number;
  onChange: (value: number) => void;
  /** Nivel en vivo 0..1. Se pinta DENTRO de la barra, no debajo. */
  peak?: number;
  disabled?: boolean;
  /** Atenua el color cuando la aplicacion esta silenciada */
  dimmed?: boolean;
};

/**
 * Control de volumen con el medidor integrado.
 *
 * Antes eran dos barras apiladas —volumen y nivel— y se leian como lo mismo,
 * duplicando el ruido visual. Ahora el nivel late DENTRO del carril, detras del
 * relleno: se ve que la aplicacion suena sin robarle protagonismo al control.
 *
 * El relleno es neutro a proposito. Con el color del modo en cada barra la
 * pantalla entera se tine y pierde jerarquia; el acento se guarda para el
 * medidor y para los estados activos.
 */
export function VolumeSlider({
  value,
  onChange,
  peak = 0,
  disabled,
  dimmed,
}: Props) {
  const level = Math.min(1, Math.max(0, peak));
  const clipping = level > 0.85;

  return (
    <Slider.Root
      className="group/slider relative flex h-5 w-full touch-none items-center select-none"
      value={[Math.round(value * 100)]}
      max={100}
      step={1}
      disabled={disabled}
      onValueChange={([next]) => onChange(next / 100)}
    >
      <Slider.Track className="relative h-[6px] w-full grow overflow-hidden rounded-full bg-black/35 shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]">
        {/* Nivel en vivo, por debajo del relleno */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${level * 100}%`,
            background: clipping ? "#f59e0b" : "var(--accent)",
            opacity: dimmed ? 0 : 0.55,
            transition: "width 90ms linear, background-color 200ms linear",
          }}
        />

        <Slider.Range
          className="absolute h-full rounded-full"
          style={{
            background: dimmed
              ? "color-mix(in srgb, var(--color-faint) 70%, transparent)"
              : "linear-gradient(180deg, #ffffff, #ccd2de)",
            // Translucido a proposito: asi el nivel que late por debajo se ve
            // tenir el relleno. Opaco, una aplicacion al 100% no mostraria
            // ninguna senal de estar sonando.
            opacity: dimmed ? 1 : 0.8,
          }}
        />
      </Slider.Track>

      <Slider.Thumb
        aria-label="Volumen"
        className="block h-[14px] w-[14px] rounded-full bg-white
                   shadow-[0_1px_3px_rgba(0,0,0,0.7),0_0_0_1px_rgba(0,0,0,0.25)]
                   outline-none transition-transform duration-150
                   hover:scale-110 focus-visible:scale-110
                   focus-visible:ring-2 focus-visible:ring-[var(--accent)]
                   data-[disabled]:opacity-40"
      />
    </Slider.Root>
  );
}
