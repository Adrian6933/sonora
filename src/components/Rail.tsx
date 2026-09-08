import { motion } from "motion/react";
import { SlidersHorizontal, Sparkles, Volume2 } from "lucide-react";

export type Section = "mixer" | "modes" | "settings";

const ITEMS: Array<{
  id: Section;
  label: string;
  Icon: typeof Volume2;
}> = [
  { id: "mixer", label: "Mezclador", Icon: Volume2 },
  { id: "modes", label: "Modos", Icon: Sparkles },
  { id: "settings", label: "Ajustes", Icon: SlidersHorizontal },
];

type Props = {
  active: Section;
  onChange: (section: Section) => void;
};

/**
 * Barra lateral de navegacion.
 *
 * Icono grande con la etiqueta debajo, y una barra de acento a la izquierda del
 * elemento activo: es la forma que tienen las suites de periféricos y se lee de
 * un vistazo sin necesidad de leer el texto.
 */
export function Rail({ active, onChange }: Props) {
  return (
    <nav className="flex w-[76px] shrink-0 flex-col items-center gap-0.5 border-r border-[var(--color-line)] bg-[var(--color-rail)] pt-2">
      {ITEMS.map(({ id, label, Icon }) => {
        const selected = id === active;

        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            aria-current={selected}
            className="relative flex w-[64px] flex-col items-center gap-1.5 rounded-[12px] py-3
                       transition-colors hover:text-[var(--color-muted)]"
            style={{
              background: selected
                ? "color-mix(in srgb, var(--accent) 10%, transparent)"
                : "transparent",
              color: selected ? "var(--accent)" : "var(--color-faint)",
            }}
          >
            {selected && (
              <motion.span
                layoutId="rail-marker"
                transition={{ type: "spring", stiffness: 500, damping: 38 }}
                className="absolute -left-[6px] top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full"
                style={{ background: "var(--accent)" }}
              />
            )}

            <Icon size={18} strokeWidth={1.8} />
            <span className="text-[9px] font-medium tracking-[0.02em]">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
