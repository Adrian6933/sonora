import { useEffect, useRef, useState } from "react";
import * as Slider from "@radix-ui/react-slider";

type Props = {
  /** Lo que reproducen DE VERDAD los disparadores de la regla, 0..1 */
  level: number;
  /**
   * Lo que marca el medidor de Windows para esas mismas aplicaciones. Si va
   * por encima de `level`, lo que sobra es reflejo del sonido de las demas.
   */
  reflejo: number;
  /** Nombre corto del disparador para la leyenda: "Discord" */
  nombre: string;
  /** Umbral actual, 0..1 */
  threshold: number;
  accent: string;
  onChange: (threshold: number) => void;
};

/**
 * Umbral de activación con medidor en vivo, al estilo de la sensibilidad de
 * entrada de Discord.
 *
 * Tiene dos barras a proposito. La de color es lo que la aplicacion reproduce
 * de verdad, y es la unica que cuenta para bajar la musica. La rayada y apagada
 * es el reflejo: lo que el medidor de Windows le atribuye a Discord cuando en
 * realidad es la musica de Spotify. Medido: en 91 de 121 muestras el medidor de
 * Discord solo reflejaba el sonido del ordenador. Enseñarlo por separado deja
 * claro por que la musica ya no baja sola.
 *
 * La escala NO es lineal: se usa la raíz cuadrada. Los picos de voz viven casi
 * todos entre 0 y 0.4, así que en una escala lineal toda la parte útil se
 * apelotonaría en el primer quinto de la barra y sería imposible afinar.
 */
export function ThresholdMeter({
  level,
  reflejo,
  nombre,
  threshold,
  accent,
  onChange,
}: Props) {
  const escala = (valor: number) => Math.sqrt(Math.min(1, Math.max(0, valor)));

  const posNivel = escala(level) * 100;
  const posReflejo = escala(Math.max(level, reflejo)) * 100;
  const posUmbral = escala(threshold) * 100;
  const activo = level >= threshold && level > 0.001;

  // La leyenda del reflejo solo aparece si ha habido reflejo hace poco. Si
  // parpadeara con cada muestra seria imposible leerla.
  const hayReflejo = useReciente(reflejo > level + 0.01, 2500);

  return (
    <div>
      <div className="relative">
        <div className="absolute inset-x-0 top-1/2 h-[10px] -translate-y-1/2 overflow-hidden rounded-full bg-black/45">
          {/* Reflejo: lo que marca Windows y no es sonido de la aplicacion */}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${posReflejo}%`,
              background:
                "repeating-linear-gradient(135deg, rgba(255,255,255,0.16) 0 3px, transparent 3px 6px)",
              transition: "width 80ms linear",
            }}
          />
          {/* Sonido real: el unico que cuenta */}
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${posNivel}%`,
              background: activo ? accent : "var(--color-muted)",
              opacity: activo ? 0.95 : 0.7,
              transition: "width 80ms linear, background-color 150ms linear",
            }}
          />
        </div>

        {/* Marca del umbral */}
        <Slider.Root
          className="relative flex h-6 w-full touch-none items-center select-none"
          value={[Math.round(posUmbral)]}
          max={100}
          step={1}
          onValueChange={([p]) => onChange((p / 100) ** 2)}
        >
          <Slider.Track className="relative h-[10px] w-full grow rounded-full bg-transparent" />
          <Slider.Thumb
            aria-label="Umbral de activación"
            className="block h-[18px] w-[8px] rounded-[3px] bg-white
                       shadow-[0_1px_4px_rgba(0,0,0,0.8)] outline-none
                       transition-transform hover:scale-y-110
                       focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </Slider.Root>
      </div>

      <div className="mt-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] leading-relaxed text-[var(--color-faint)]">
          Sube la marca hasta que solo la pase la voz, no el ruido de fondo.
        </span>
        <span
          className="tabular shrink-0 text-[11px] font-medium"
          style={{ color: activo ? accent : "var(--color-faint)" }}
        >
          {activo ? "activando" : "en silencio"}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[var(--color-faint)]">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-4 rounded-full"
            style={{ background: activo ? accent : "var(--color-muted)" }}
          />
          Lo que suena en {nombre || "la aplicación"}
        </span>

        {hayReflejo && (
          <span className="flex items-center gap-1.5">
            <span
              className="h-2 w-4 rounded-full"
              style={{
                background:
                  "repeating-linear-gradient(135deg, rgba(255,255,255,0.35) 0 2px, transparent 2px 4px)",
              }}
            />
            Reflejo de otras aplicaciones: no cuenta
          </span>
        )}
      </div>
    </div>
  );
}

/** `true` si la condicion se ha cumplido en los ultimos `ms` milisegundos. */
function useReciente(condicion: boolean, ms: number) {
  const ultima = useRef(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (condicion) {
      ultima.current = Date.now();
      setVisible(true);
      return;
    }
    const quedan = ms - (Date.now() - ultima.current);
    if (quedan <= 0) {
      setVisible(false);
      return;
    }
    const id = window.setTimeout(() => setVisible(false), quedan);
    return () => window.clearTimeout(id);
  }, [condicion, ms]);

  return visible;
}
