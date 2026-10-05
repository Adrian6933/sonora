import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { ipc } from "../../lib/ipc";
import type { KnownApp } from "../../lib/known";

type Props = {
  /** Ejecutables ya elegidos, tal cual se guardan */
  elegidos: string[];
  /** Aplicaciones que Sonora ha visto alguna vez, aunque ahora esten cerradas */
  knownApps: KnownApp[];
  accent: string;
  onChange: (elegidos: string[]) => void;
};

/**
 * Elegir programas de una lista en vez de escribir su nombre.
 *
 * Escribir "VALORANT.exe" de memoria y con la extension exacta es justo lo que
 * nadie deberia tener que hacer para configurar nada. Aqui salen los programas
 * abiertos ahora mismo y los que Sonora ha visto antes, con un buscador porque
 * un equipo normal tiene cien procesos abiertos.
 */
export function AppPicker({ elegidos, knownApps, accent, onChange }: Props) {
  const [abiertas, setAbiertas] = useState<string[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    ipc
      .listOpenApps()
      .then((lista) => vivo && setAbiertas(lista))
      .catch(() => {})
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, []);

  // Los abiertos primero, que es lo que casi siempre se busca, y despues el
  // resto de conocidos sin repetir.
  const candidatos = useMemo(() => {
    const vistos = new Set(abiertas.map((n) => n.toLowerCase()));
    const conocidos = knownApps
      .map((app) => app.exe)
      .filter((exe) => exe && !vistos.has(exe.toLowerCase()));

    return [
      ...abiertas.map((exe) => ({ exe, abierto: true })),
      ...conocidos.map((exe) => ({ exe, abierto: false })),
    ];
  }, [abiertas, knownApps]);

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? candidatos.filter((c) => c.exe.toLowerCase().includes(q))
      : candidatos;
    return base.slice(0, 60);
  }, [candidatos, busqueda]);

  const alterna = (exe: string) => {
    const ya = elegidos.some((e) => e.toLowerCase() === exe.toLowerCase());
    onChange(
      ya
        ? elegidos.filter((e) => e.toLowerCase() !== exe.toLowerCase())
        : [...elegidos, exe]
    );
  };

  return (
    <div>
      {elegidos.length > 0 && (
        <div className="mb-2.5 flex flex-wrap gap-1.5">
          {elegidos.map((exe) => (
            <span
              key={exe}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px]"
              style={{
                background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                color: accent,
              }}
            >
              {exe}
              <button
                onClick={() => alterna(exe)}
                aria-label={`Quitar ${exe}`}
                className="opacity-70 hover:opacity-100"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative mb-1.5">
        <Search
          size={12}
          className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2
                     text-[var(--color-faint)]"
        />
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar un programa"
          className="w-full rounded-[10px] border border-[var(--color-line)]
                     bg-[var(--color-surface-2)] py-2 pl-7 pr-2.5 text-[12px]
                     outline-none focus:border-[var(--accent)]"
        />
      </div>

      <div className="max-h-[168px] overflow-y-auto rounded-[10px] bg-[var(--color-surface)] p-1">
        {cargando && (
          <p className="px-2 py-3 text-center text-[11px] text-[var(--color-faint)]">
            Mirando qué tienes abierto...
          </p>
        )}

        {!cargando && filtrados.length === 0 && (
          <p className="px-2 py-3 text-center text-[11px] text-[var(--color-faint)]">
            Nada que coincida.
          </p>
        )}

        {filtrados.map(({ exe, abierto }) => {
          const marcado = elegidos.some(
            (e) => e.toLowerCase() === exe.toLowerCase()
          );

          return (
            <button
              key={exe}
              onClick={() => alterna(exe)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left
                         text-[12px] transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ color: marcado ? accent : "var(--color-text)" }}
            >
              <span
                className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border"
                style={{
                  borderColor: marcado ? accent : "var(--color-line)",
                  background: marcado ? accent : "transparent",
                }}
              >
                {marcado && (
                  <svg viewBox="0 0 10 10" className="h-2 w-2" fill="none">
                    <path
                      d="M1.5 5.2L4 7.5L8.5 2.5"
                      stroke="black"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>

              <span className="truncate">{exe.replace(/\.exe$/i, "")}</span>

              {abierto && (
                <span className="ml-auto shrink-0 text-[9px] text-[var(--color-faint)]">
                  abierto
                </span>
              )}
            </button>
          );
        })}
      </div>

      <details className="mt-2">
        <summary className="cursor-pointer text-[10px] text-[var(--color-faint)]">
          El programa no está en la lista
        </summary>
        <input
          placeholder="Escribe su nombre y pulsa Enter: VALORANT.exe"
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            const valor = event.currentTarget.value.trim();
            if (!valor) return;
            if (!elegidos.some((e) => e.toLowerCase() === valor.toLowerCase())) {
              onChange([...elegidos, valor]);
            }
            event.currentTarget.value = "";
          }}
          className="mt-1.5 w-full rounded-[10px] border border-[var(--color-line)]
                     bg-[var(--color-surface-2)] px-2.5 py-2 text-[12px]
                     outline-none focus:border-[var(--accent)]"
        />
        <p className="mt-1 text-[10px] leading-relaxed text-[var(--color-faint)]">
          Tiene que ser el nombre tal cual sale en el Administrador de tareas.
          Solo hace falta si el juego está cerrado y Sonora no lo ha visto nunca.
        </p>
      </details>
    </div>
  );
}
