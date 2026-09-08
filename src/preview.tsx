import { useState } from "react";
import ReactDOM from "react-dom/client";

import { Rail, type Section } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { MixerSection } from "./components/sections/MixerSection";
import { ModesSection } from "./components/sections/ModesSection";
import type { AppGroup } from "./lib/group";
import { DEFAULT_MODES } from "./lib/modes";
import "./styles.css";

/**
 * Banco de pruebas de diseno.
 *
 * La aplicacion de verdad es una ventana nativa que no se puede abrir en un
 * navegador ni capturar facilmente, asi que el diseno se estaba haciendo a
 * ciegas. Esta pagina monta los mismos componentes con datos inventados y se
 * abre en http://localhost:1420/preview.html: sirve para ver y ajustar la
 * estetica sin tocar la logica.
 *
 * No entra en la compilacion de la aplicacion: es una entrada aparte de Vite.
 */
const GROUPS: AppGroup[] = [
  {
    key: "discord.exe",
    name: "Discord",
    exe: "Discord.exe",
    path: "/discord.png",
    pids: [1008, 18604],
    volume: 1,
    muted: false,
    peak: 0.62,
    active: true,
    isSystem: false,
  },
  {
    key: "valorant.exe",
    name: "VALORANT",
    exe: "VALORANT.exe",
    path: "",
    pids: [4120],
    volume: 0.55,
    muted: false,
    peak: 0.38,
    active: true,
    isSystem: false,
  },
  {
    key: "spotify.exe",
    name: "Spotify",
    exe: "Spotify.exe",
    path: "",
    pids: [19400],
    volume: 0.15,
    muted: false,
    peak: 0.11,
    active: true,
    isSystem: false,
  },
  {
    key: "chrome.exe",
    name: "Chrome",
    exe: "chrome.exe",
    path: "/chrome.png",
    pids: [22228],
    volume: 0.3,
    muted: false,
    peak: 0,
    active: false,
    isSystem: false,
  },
  {
    key: "steam.exe",
    name: "Steam",
    exe: "Steam.exe",
    path: "/steam.png",
    pids: [27552, 25596],
    volume: 1,
    muted: true,
    peak: 0,
    active: false,
    isSystem: false,
  },
  {
    key: "system.exe",
    name: "Sonidos del sistema",
    exe: "System.exe",
    path: "",
    pids: [0],
    volume: 1,
    muted: false,
    peak: 0,
    active: false,
    isSystem: true,
  },
];

const ICONS: Record<string, string> = {
  "/discord.png": "/discord.png",
  "/chrome.png": "/chrome.png",
  "/steam.png": "/steam.png",
};

function Preview() {
  const [section, setSection] = useState<Section>("mixer");
  const [activeId, setActiveId] = useState<string | null>("competitive");

  const active = DEFAULT_MODES.find((mode) => mode.id === activeId);
  document.documentElement.style.setProperty(
    "--accent",
    active?.accent ?? "#38bdf8"
  );

  return (
    <div className="flex h-screen w-screen items-center justify-center p-8">
      {/* Mismo tamano que la ventana real, para juzgar proporciones */}
      <div className="h-[640px] w-[940px] overflow-hidden rounded-[14px] shadow-2xl">
        <div className="accent-glow relative flex h-full flex-col overflow-hidden rounded-[14px] border border-[var(--color-line)] bg-[var(--color-base)]">
          <TitleBar mode={active} maximized={false} />

          <div className="flex min-h-0 flex-1">
            <Rail active={section} onChange={setSection} />

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="relative z-[1] px-6 pb-4 pt-3">
                <h1 className="text-[21px] font-semibold leading-none tracking-[-0.025em]">
                  {section === "mixer"
                    ? "Mezclador"
                    : section === "modes"
                      ? "Modos"
                      : "Ajustes"}
                </h1>
              </div>

              <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                {section === "mixer" && (
                  <MixerSection
                    groups={GROUPS}
                    icons={ICONS}
                    master={0.82}
                    device={{
                      id: "d",
                      name: "Altavoces (2- Logitech G733 Gaming Headset)",
                      isDefault: true,
                    }}
                    duckingGain={0.4}
                    onMaster={() => {}}
                    onVolume={() => {}}
                    onToggleMute={() => {}}
                    onReset={() => {}}
                    resetHotkey="CommandOrControl+Alt+9"
                    modeActive
                  />
                )}

                {section === "modes" && (
                  <ModesSection
                    modes={DEFAULT_MODES}
                    activeId={activeId}
                    onActivate={(mode) => setActiveId(mode.id)}
                    onEdit={() => {}}
                    onCreate={() => {}}
                  />
                )}

                {section === "settings" && (
                  <p className="text-[12px] text-[var(--color-faint)]">
                    Los ajustes usan plugins de Tauri; no se pueden previsualizar
                    aquí.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <Preview />
);
