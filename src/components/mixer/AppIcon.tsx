import { Volume2 } from "lucide-react";

/**
 * Icono real del .exe cuando se ha podido extraer. Si no (procesos protegidos,
 * o mientras llega), cae en un placeholder con la inicial sobre un color
 * derivado del ejecutable, asi que cada app tiene siempre el mismo color.
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
};

export function AppIcon({ name, exe, isSystem, dimmed, icon }: Props) {
  const h = hue(exe || name);

  // Mismo contenedor para el icono real y para la inicial: si no, las
  // aplicaciones sin icono desalinean visualmente la lista.
  if (icon) {
    return (
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px]
                   bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        style={{ opacity: dimmed ? 0.4 : 1 }}
      >
        <img
          src={icon}
          alt=""
          draggable={false}
          className="h-[22px] w-[22px] object-contain"
        />
      </div>
    );
  }

  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[14px] font-semibold
                 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
      style={{
        background: `hsl(${h} 38% 20%)`,
        color: `hsl(${h} 65% 74%)`,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {isSystem ? (
        <Volume2 size={16} strokeWidth={2} />
      ) : (
        (name[0] ?? "?").toUpperCase()
      )}
    </div>
  );
}
