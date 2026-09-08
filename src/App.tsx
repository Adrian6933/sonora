import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";

import { Rail, type Section } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { ModeEditor } from "./components/modes/ModeEditor";
import { MixerSection } from "./components/sections/MixerSection";
import { ModesSection } from "./components/sections/ModesSection";
import { SettingsSection } from "./components/sections/SettingsSection";
import { useApplyMode } from "./hooks/useApplyMode";
import { useAutomation } from "./hooks/useAutomation";
import { useDevices } from "./hooks/useDevices";
import { useDuckingGain } from "./hooks/useDucking";
import { prettyAccel, useHotkeys } from "./hooks/useHotkeys";
import { useIcons } from "./hooks/useIcons";
import { useMaximized } from "./hooks/useMaximized";
import { useSessions } from "./hooks/useSessions";
import { ipc } from "./lib/ipc";
import { DEFAULT_DUCKING, newMode, type Mode } from "./lib/modes";
import { useModes } from "./store/modes";

const TITLES: Record<Section, string> = {
  mixer: "Mezclador",
  modes: "Modos",
  settings: "Ajustes",
};


export default function App() {
  const { groups, master, error, setVolume, toggleMute, setMasterVolume } =
    useSessions();
  const icons = useIcons(groups.map((group) => group.path));
  const { devices, current: currentDevice } = useDevices();

  const {
    modes,
    activeModeId,
    cycleHotkey,
    hydrated,
    hydrate,
    setActive,
    setCycleHotkey,
    upsert,
    remove,
    replaceAll,
    resetHotkey,
    setResetHotkey,
  } = useModes();

  const maximized = useMaximized();
  const [section, setSection] = useState<Section>("mixer");
  const [editing, setEditing] = useState<Mode | null>(null);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const applyMode = useApplyMode(groups, { setVolume, toggleMute });
  const duckingGain = useDuckingGain();

  function activate(mode: Mode) {
    setActive(mode.id);
    applyMode(mode);
    void ipc.setDucking(mode.ducking).catch(() => {});

    // Sin esto los atajos globales son de fe: con el juego delante no habria
    // ninguna senal de que el modo ha cambiado.
    void ipc
      .flashHud({ name: mode.name, icon: mode.icon, accent: mode.accent })
      .catch((problem) => console.error("[hud] fallo el aviso:", problem));
  }

  // Al arrancar restauramos el ducking del modo que quedo activo, pero NO sus
  // volumenes: reordenar el mezclador solo por abrir la aplicacion seria una
  // sorpresa desagradable.
  useEffect(() => {
    if (!hydrated) return;

    const mode = useModes.getState().modes.find((m) => m.id === activeModeId);
    void ipc.setDucking(mode?.ducking ?? DEFAULT_DUCKING).catch(() => {});
  }, [hydrated, activeModeId]);

  /** Sin modo: se quedan los volumenes como esten, pero se apaga el ducking. */
  function clearMode() {
    setActive(null);
    void ipc.setDucking(DEFAULT_DUCKING).catch(() => {});
  }

  /**
   * Vuelta a la normalidad: todo al 100%, sin silencios, sin modo y sin ducking.
   *
   * Apagar el ducking no es opcional: si siguiera activo volveria a bajarlo
   * todo al primer sonido y el boton pareceria roto.
   */
  function resetEverything() {
    for (const group of groups) {
      setVolume(group.pids, 1);
      if (group.muted) toggleMute(group.pids, false);
    }

    clearMode();
    void ipc
      .flashHud({ name: "Todo al 100%", icon: "🔊", accent: "#38bdf8" })
      .catch(() => {});
  }

  useAutomation(modes, activeModeId, activate, clearMode);

  // Los atajos globales entregan un id, no el objeto: el modo pudo cambiar
  // desde que se registro el atajo.
  const failedHotkeys = useHotkeys(
    modes,
    (id) => {
      const mode = useModes.getState().modes.find((m) => m.id === id);
      if (mode) activate(mode);
    },
    [
      {
        accel: cycleHotkey,
        run: () => {
          const all = useModes.getState().modes;
          if (!all.length) return;

          const index = all.findIndex(
            (mode) => mode.id === useModes.getState().activeModeId
          );
          // Si no hay ninguno activo, -1 + 1 = 0: empieza por el primero.
          activate(all[(index + 1) % all.length]);
        },
      },
      { accel: resetHotkey, run: resetEverything },
    ]
  );

  // El acento del modo activo tine la aplicacion entera.
  const activeMode = modes.find((mode) => mode.id === activeModeId);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--accent",
      activeMode?.accent ?? "#38bdf8"
    );
  }, [activeMode?.accent]);

  return (
    <div
      className={`accent-glow relative flex h-full flex-col overflow-hidden bg-[var(--color-base)] ${
        maximized ? "" : "rounded-[14px] border border-[var(--color-line)]"
      }`}
    >
      <TitleBar mode={activeMode} maximized={maximized} />

      <div className="flex min-h-0 flex-1">
        <Rail active={section} onChange={setSection} />

        <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative z-[1] px-6 pb-4 pt-3">
          <h1 className="text-[21px] font-semibold leading-none tracking-[-0.025em]">
            {TITLES[section]}
          </h1>
        </div>

        {failedHotkeys.length > 0 && (
          <div className="relative z-[1] mx-7 mb-3 flex items-start gap-2 rounded-[12px] border border-[#78350f] bg-[#451a03] px-3 py-2.5 text-[10px] leading-relaxed text-[#fcd34d]">
            <AlertTriangle size={12} className="mt-px shrink-0" />
            <span>
              No se pudieron registrar{" "}
              {failedHotkeys.map((f) => prettyAccel(f.hotkey)).join(", ")}.
              Normalmente es que otro programa ya los usa: prueba otra
              combinación.
              <span className="mt-1 block opacity-60">
                {failedHotkeys[0].message}
              </span>
            </span>
          </div>
        )}

        {error && (
          <div className="relative z-[1] mx-7 mb-3 rounded-[12px] border border-[#7f1d1d] bg-[#450a0a] px-3 py-2.5 text-[11px] text-[#fca5a5]">
            {error}
          </div>
        )}

        <div className="relative z-[1] min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
          >
            {section === "mixer" && (
              <MixerSection
                groups={groups}
                icons={icons}
                master={master}
                device={currentDevice}
                duckingGain={duckingGain}
                onMaster={setMasterVolume}
                onVolume={setVolume}
                onToggleMute={toggleMute}
                onReset={resetEverything}
                resetHotkey={resetHotkey}
                modeActive={Boolean(activeMode)}
              />
            )}

            {section === "modes" && (
              <ModesSection
                modes={modes}
                activeId={activeModeId}
                onActivate={activate}
                onEdit={setEditing}
                onCreate={() => setEditing(newMode())}
              />
            )}

            {section === "settings" && (
              <SettingsSection
                modes={modes}
                cycleHotkey={cycleHotkey}
                onCycleHotkey={setCycleHotkey}
                resetHotkey={resetHotkey}
                onResetHotkey={setResetHotkey}
                onImport={replaceAll}
              />
            )}
          </motion.div>
        </div>
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <ModeEditor
            mode={editing}
            groups={groups}
            devices={devices}
            canDelete={modes.some((mode) => mode.id === editing.id)}
            onSave={upsert}
            onDelete={remove}
            onClose={() => setEditing(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
