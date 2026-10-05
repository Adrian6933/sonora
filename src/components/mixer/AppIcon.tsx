import { Volume2 } from "lucide-react";

/**
 * Icono real del .exe cuando se ha podido extraer. Si no (procesos protegidos,
 * o mientras llega), cae en un placeholder con la inicial sobre un color
 * derivado del ejecutable, así que cada app tiene siempre el mismo color.
 */
function hue(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

type Props = {
  name: string;
  exe: string;
  isSystem: boolean;
  dimmed?: boolean;
  /** data URI del icono real, si se pudo extraer */
  icon?: string;
  /** Lado del cuadrado en píxeles */
  size?: number;
};

export function AppIcon({
  name,
  exe,
  isSystem,
  dimmed,
  icon,
  size = 36,
}: Props) {
  const h = hue(exe || name);
  // El contenedor es el mismo con icono real o sin él: si no, las aplicaciones
  // sin icono desalinean visualmente la lista.
  const box = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.3),
    opacity: dimmed ? 0.45 : 1,
  } as const;

  if (icon) {
    return (
      <div
        className="flex shrink-0 items-center justify-center bg-white/[0.04]
                   shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        style={box}
      >
        <img
          src={icon}
          alt=""
          draggable={false}
          className="object-contain"
          style={{ width: Math.round(size * 0.62), height: Math.round(size * 0.62) }}
        />
      </div>
    );
  }

  return (
    <div
      className="flex shrink-0 items-center justify-center font-semibold
                 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
      style={{
        ...box,
        background: `hsl(${h} 38% 20%)`,
        color: `hsl(${h} 65% 74%)`,
        fontSize: Math.round(size * 0.4),
      }}
    >
      {isSystem ? (
        <Volume2 size={Math.round(size * 0.46)} strokeWidth={2} />
      ) : (
        (name[0] ?? "?").toUpperCase()
      )}
    </div>
  );
}
