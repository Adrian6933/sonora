import { getCurrentWindow } from "@tauri-apps/api/window";

import { iconComponent } from "../lib/icons";
import type { Mode } from "../lib/modes";

type Props = {
  /** Modo activo, si hay alguno */
  mode?: Mode;
  maximized: boolean;
};

/**
 * Barra de titulo propia.
 *
 * La ventana va sin decoracion nativa para poder tener esquinas redondeadas y
 * el color de la aplicacion, pero los botones respetan la metrica de Windows
 * (46x32, la X en rojo al pasar por encima) para que se sienta como cualquier
 * otra aplicacion del sistema y no como una web metida en una ventana.
 *
 * `data-tauri-drag-region` es lo que permite arrastrarla; Windows ademas espera
 * que el doble clic ahi maximice.
 */
export function TitleBar({ mode, maximized }: Props) {
  // Fuera de Tauri (el banco de pruebas de diseno) no hay ventana que controlar.
  // Devolver null en vez de reventar permite ver la barra en el navegador.
  const appWindow = (() => {
    try {
      return getCurrentWindow();
    } catch {
      return null;
    }
  })();

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={() => appWindow?.toggleMaximize()}
      className="flex h-8 shrink-0 items-center justify-between pl-6"
    >
      <div data-tauri-drag-region className="flex items-center gap-2.5">
        <span
          data-tauri-drag-region
          className="text-[11px] font-semibold tracking-[0.12em] text-[var(--color-muted)]"
        >
          SONORA
        </span>

        {mode && (() => {
          const Icon = iconComponent(mode.icon);
          return (
          <span
            className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{
              background: `color-mix(in srgb, ${mode.accent} 16%, transparent)`,
              color: mode.accent,
            }}
          >
            <Icon size={11} strokeWidth={2.2} />
            {mode.name}
          </span>
          );
        })()}
      </div>

      <div className="flex h-full">
        <CaptionButton
          label="Minimizar"
          onClick={() => appWindow?.minimize()}
          path="M 0,5 H 10"
        />
        <CaptionButton
          label={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => appWindow?.toggleMaximize()}
          path={
            maximized
              ? // Dos rectangulos superpuestos: el icono de "restaurar"
                "M 2,0 H 10 V 8 H 8 M 0,2 H 8 V 10 H 0 Z"
              : "M 0,0 H 10 V 10 H 0 Z"
          }
        />
        <CaptionButton
          label="Cerrar"
          onClick={() => appWindow?.close()}
          title="Sonora sigue en la bandeja del sistema"
          path="M 0,0 L 10,10 M 10,0 L 0,10"
          danger
        />
      </div>
    </div>
  );
}

function CaptionButton({
  label,
  title,
  onClick,
  path,
  danger,
}: {
  label: string;
  title?: string;
  onClick: () => void;
  path: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={title ?? label}
      className={`group flex h-full w-[46px] items-center justify-center
                  text-[var(--color-muted)] transition-colors
                  ${danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-white/10 hover:text-[var(--color-text)]"}`}
    >
      <svg width="10" height="10" viewBox="-0.5 -0.5 11 11" fill="none">
        <path d={path} stroke="currentColor" strokeWidth="1" />
      </svg>
    </button>
  );
}
