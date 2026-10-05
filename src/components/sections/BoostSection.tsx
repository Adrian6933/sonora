import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, RotateCcw } from "lucide-react";

import type { AppGroup } from "../../lib/group";
import type { BoostInfo } from "../../lib/ipc";
import { AppIcon } from "../mixer/AppIcon";

/** El mismo tope que aplica el motor (src-tauri/src/audio/boost.rs). */
const MAX = 4;

/** A partir de aqui avisamos de que puede empezar a sonar aplastado. */
const AVISO = 2.5;

type Props = {
  groups: AppGroup[];
  icons: Record<string, string>;
  boosts: BoostInfo[];
  /** Por que no se pudo amplificar, indexado por PID */
  errores: Record<number, string>;
  onBoost: (pid: number, gain: number) => void;
  onClear: () => void;
};

/**
 * Subir una aplicacion por encima del 100% que permite Windows.
 *
 * Va en su propio apartado y no en el mezclador a proposito: no es el mismo
 * mando. El mezclador reparte el volumen que hay; esto fabrica volumen que
 * Windows no da, con su coste, y conviene que se vea que es otra cosa.
 */
export function BoostSection({
  groups,
  icons,
  boosts,
  errores,
  onBoost,
  onClear,
}: Props) {
  // Amplificables: lo que esta sonando, mas lo que ya este amplificado aunque
  // ahora mismo calle, para no perder el mando de vista a mitad de cancion.
  const amplificados = new Set(boosts.map((boost) => boost.pid));
  const lista = groups.filter(
    (group) =>
      !group.isSystem &&
      (group.active || group.pids.some((pid) => amplificados.has(pid)))
  );

  const activos = boosts.length;

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-4">
      <div className="surface rounded-[18px] border border-[var(--color-line)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-text)]">
          Más volumen del que deja Windows
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[12px] leading-relaxed text-[var(--color-muted)]">
          Windows no deja pasar del 100% en ninguna aplicación. Sonora lo
          consigue reproduciendo esa aplicación por su cuenta, ya amplificada.
          Mientras esté encendido, su volumen en el mezclador de Windows deja de
          mandar: el que manda es este.
        </p>

        {activos > 0 && (
          <button
            onClick={onClear}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[10px] border
                       border-[var(--color-line)] px-3 py-1.5 text-[11px]
                       text-[var(--color-muted)] transition-colors
                       hover:text-[var(--color-text)]"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Quitar la amplificación de {activos === 1 ? "la aplicación" : "todas"}
          </button>
        )}
      </div>

      {lista.length === 0 ? (
        <p className="px-1 py-8 text-center text-[12px] text-[var(--color-faint)]">
          Aquí aparecerán las aplicaciones que estén sonando.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {lista.map((group) => (
            <Fila
              key={group.key}
              group={group}
              icon={icons[group.path]}
              boost={boosts.find((b) => group.pids.includes(b.pid))}
              error={group.pids.map((pid) => errores[pid]).find(Boolean)}
              onBoost={onBoost}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Fila({
  group,
  icon,
  boost,
  error,
  onBoost,
}: {
  group: AppGroup;
  icon?: string;
  boost?: BoostInfo;
  error?: string;
  onBoost: (pid: number, gain: number) => void;
}) {
  // Una aplicacion puede tener varias sesiones; amplificamos la que suena.
  const pid = boost?.pid ?? group.pids[0];
  const gain = boost?.gain ?? 1;
  const encendido = gain > 1;

  return (
    <div
      className="surface rounded-[14px] border p-4 transition-colors"
      style={{
        borderColor: error
          ? "color-mix(in srgb, #fb923c 50%, transparent)"
          : encendido
            ? "color-mix(in srgb, var(--accent) 45%, transparent)"
            : "var(--color-line)",
      }}
    >
      <div className="flex items-center gap-3">
        <AppIcon
          name={group.name}
          exe={group.exe}
          isSystem={group.isSystem}
          icon={icon}
          size={32}
        />

        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-[var(--color-text)]">
            {group.name}
          </div>
          <div className="text-[10px] text-[var(--color-faint)]">
            {error
              ? "no se puede amplificar"
              : encendido
                ? "amplificada por Sonora"
                : "volumen normal"}
          </div>
        </div>

        <div
          className="tabular text-[20px] font-semibold"
          style={{ color: encendido ? "var(--accent)" : "var(--color-faint)" }}
        >
          {Math.round(gain * 100)}%
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <span className="tabular w-9 text-[10px] text-[var(--color-faint)]">
          100%
        </span>

        <input
          type="range"
          min={1}
          max={MAX}
          step={0.1}
          value={gain}
          onChange={(e) => onBoost(pid, Number(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full
                     bg-black/45 accent-[var(--accent)]"
        />

        <span className="tabular w-9 text-right text-[10px] text-[var(--color-faint)]">
          {MAX * 100}%
        </span>
      </div>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed"
           style={{ color: "#fb923c" }}>
          <AlertTriangle size={12} strokeWidth={2} className="mt-[1px] shrink-0" />
          <span>{limpiaError(error)}</span>
        </p>
      )}

      <AnimatePresence>
        {encendido && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex items-center gap-3">
              <Medidor nivel={boost?.level ?? 0} gain={gain} />
            </div>

            <VolumenInternoBajo
              nombre={group.name}
              genera={group.peak}
              sale={boost?.level ?? 0}
            />

            {gain >= AVISO && (
              <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-[var(--color-faint)]">
                <AlertTriangle size={11} strokeWidth={2} className="mt-[1px] shrink-0" />
                <span>
                  A partir de aquí, en los momentos fuertes ya no queda sitio
                  para subir más y el sonido se aplasta en vez de sonar más
                  alto. Se nota sobre todo en la música.
                </span>
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Quita el envoltorio tecnico que Windows le pone a sus errores.
 *
 * Lo que llega es del estilo "... (0x80004005)", y ese numero no le dice nada a
 * nadie: lo unico util es la frase.
 */
function limpiaError(bruto: string): string {
  return bruto
    .replace(/^Error:\s*/i, "")
    .replace(/\s*\(0x[0-9a-f]+\)\s*$/i, "")
    .trim();
}

/**
 * Medidor de lo que esta entrando, con la marca de donde empieza a aplastarse.
 *
 * La marca es lo util: enseña, para la ganancia puesta ahora mismo, a partir de
 * que nivel de la aplicacion deja de haber margen.
 */
function Medidor({ nivel, gain }: { nivel: number; gain: number }) {
  // La rodilla del limitador esta en 0.85 de la salida; hacia atras, eso es el
  // nivel de entrada que ya la alcanza.
  const margen = Math.min(1, 0.85 / gain);
  const aplastando = nivel > margen;

  return (
    <div className="flex-1">
      <div className="relative h-1.5 overflow-hidden rounded-full bg-black/45">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: aplastando ? "var(--color-warn, #fb923c)" : "var(--accent)",
          }}
          animate={{ width: `${Math.min(100, nivel * 100)}%` }}
          transition={{ duration: 0.08 }}
        />
        <span
          className="absolute top-0 h-full w-[2px] bg-[var(--color-text)] opacity-50"
          style={{ left: `${margen * 100}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-[var(--color-faint)]">
        {aplastando
          ? "ahora mismo no queda margen: baja un poco"
          : "hay margen de sobra"}
      </div>
    </div>
  );
}

/**
 * Maximo reciente de un valor que cambia muchas veces por segundo.
 *
 * Los picos de audio suben y bajan sin parar; comparar dos lecturas sueltas
 * daria avisos que aparecen y desaparecen. Se guarda el mas alto de los
 * ultimos segundos, dejandolo caer despacio.
 */
function useMaximoReciente(valor: number, caidaPorSegundo = 0.15) {
  const maximo = useRef(0);
  const ultimo = useRef(performance.now());
  const [visto, setVisto] = useState(0);

  useEffect(() => {
    const ahora = performance.now();
    const segundos = (ahora - ultimo.current) / 1000;
    ultimo.current = ahora;
    maximo.current = Math.max(valor, maximo.current - caidaPorSegundo * segundos);
    setVisto(maximo.current);
  }, [valor, caidaPorSegundo]);

  return visto;
}

/**
 * Avisa cuando la aplicacion se esta bajando el volumen a si misma.
 *
 * Es lo que le pasaba a Spotify: su barra de volumen estaba a un tercio, y
 * Spotify aplica esa barra DESPUES de lo que marca su medidor. Resultado:
 * generaba musica a 0,44 y por los altavoces salia 0,013, treinta y cinco veces
 * menos, con Windows y Sonora diciendo 100%. Amplificar ahi es poner un parche;
 * subir la barra de la propia aplicacion da mucho mas volumen y sin aplastar.
 *
 * Solo se puede ver mientras se amplifica, porque es la captura la que dice lo
 * que sale de verdad.
 */
function VolumenInternoBajo({
  nombre,
  genera,
  sale,
}: {
  nombre: string;
  genera: number;
  sale: number;
}) {
  const generaMax = useMaximoReciente(genera);
  const saleMax = useMaximoReciente(sale);

  // Hace falta que la aplicacion este sonando de verdad, y que salga menos de
  // la cuarta parte de lo que genera: por debajo de eso no es un matiz, es una
  // barra de volumen bajada.
  const bajo = generaMax > 0.1 && saleMax < generaMax * 0.25;
  if (!bajo) return null;

  const veces = Math.round(generaMax / Math.max(saleMax, 0.001));

  return (
    <p className="mt-2.5 rounded-[10px] bg-[var(--color-surface-2)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--color-muted)]">
      <span className="font-medium text-[var(--color-text)]">
        {nombre} tiene su propio volumen bajo.
      </span>{" "}
      Genera el sonido unas {veces} veces más fuerte de lo que deja salir.
      Sube la barra de volumen dentro de {nombre}: te dará más volumen que
      amplificar, y sin aplastar el sonido.
    </p>
  );
}
