import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";

import { Rail, type Section } from "./components/Rail";
import { TitleBar } from "./components/TitleBar";
import { ModeEditor } from "./components/modes/ModeEditor";
import { HomeSection } from "./components/sections/HomeSection";
import {
  MixerSection,
  type MixerTab,
} from "./components/sections/MixerSection";
import { BoostSection } from "./components/sections/BoostSection";
import { ModesSection } from "./components/sections/ModesSection";
import { SettingsSection } from "./components/sections/SettingsSection";
import { useApplyMode } from "./hooks/useApplyMode";
import { useAutomation } from "./hooks/useAutomation";
import { useBoosts } from "./hooks/useBoosts";
import { useDevices } from "./hooks/useDevices";
import { useDuckingGain, useEspejos } from "./hooks/useDucking";
import { prettyAccel, useHotkeys } from "./hooks/useHotkeys";
import { useIcons } from "./hooks/useIcons";
import { useMaximized } from "./hooks/useMaximized";
import { useSessions } from "./hooks/useSessions";
import { ipc, onTrayMode, onTrayReset } from "./lib/ipc";
import { newMode, type Mode } from "./lib/modes";
import { useModes } from "./store/modes";

const TITLES: Record<Section, string> = {
  home: "Inicio",
  mixer: "Mezclador",
  modes: "Modos",
  boost: "Amplificar",
  settings: "Ajustes",
};


export default function App() {
  const { groups, master, error, setVolume, toggleMute, setMasterVolume } =
    useSessions();
  const icons = useIcons([
    ...groups.map((group) => group.path),
    ...useModes.getState().knownApps.map((app) => app.path),
  ]);
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
    knownApps,
    presets,
    observe,
    setPreset,
    forgetApp,
  } = useModes();

  const maximized = useMaximized();
  const [section, setSection] = useState<Section>("home");
  const [mixerTab, setMixerTab] = useState<MixerTab>("sonando");
  const [editing, setEditing] = useState<Mode | null>(null);

  // Los medidores de amplificacion van a diez por segundo; solo se pagan
  // mientras su pantalla esta a la vista.
  const { boosts, errores: erroresBoost, setBoost, clearBoosts } =
    useBoosts(section === "boost");

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const applyMode = useApplyMode(groups, { setVolume, toggleMute });
  const duckingGain = useDuckingGain();
  const espejos = useEspejos();

  function activate(mode: Mode) {
    setActive(mode.id);
    applyMode(mode);
    void ipc.setDucking(mode.duckingRules).catch(() => {});

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
    void ipc.setDucking(mode?.duckingRules ?? []).catch(() => {});
  }, [hydrated, activeModeId]);

  // El modo de arranque, si alguno lo tiene marcado.
  //
  // Solo se aplica una vez y solo si no venias con otro puesto: si elegiste un
  // modo antes de cerrar, se respeta esa eleccion.
  const arranqueHecho = useRef(false);
  useEffect(() => {
    if (!hydrated || arranqueHecho.current) return;
    arranqueHecho.current = true;

    if (activeModeId) return;
    const inicial = useModes
      .getState()
      .modes.find((m) => m.autoActivate.onStartup);
    if (inicial) activate(inicial);
    // Solo al hidratar; las dependencias reales ya estan cubiertas por la
    // bandera de una sola vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);

  // La bandeja enseña los modos y el activo marcado. Solo se reenvia cuando
  // cambia algo que se ve en el menu, no en cada render.
  const firmaBandeja = modes.map((m) => `${m.id}:${m.name}`).join("|");
  useEffect(() => {
    if (!hydrated) return;
    void ipc
      .setTrayModes(
        modes.map((m) => ({ id: m.id, name: m.name })),
        activeModeId
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, firmaBandeja, activeModeId]);

  // Y lo que se elige en la bandeja llega aqui, que es quien sabe aplicarlo.
  // Refs para que el listener, registrado una vez, no mire un estado viejo.
  const desdeBandeja = useRef({ activate, clearMode: () => clearMode(), resetEverything });
  desdeBandeja.current = { activate, clearMode: () => clearMode(), resetEverything };
  useEffect(() => {
    const quitar: Array<() => void> = [];
    let vivo = true;

    void onTrayMode((id) => {
      const acciones = desdeBandeja.current;
      if (id === null) return acciones.clearMode();
      const modo = useModes.getState().modes.find((m) => m.id === id);
      if (modo) acciones.activate(modo);
    }).then((fn) => (vivo ? quitar.push(fn) : fn()));

    void onTrayReset(() => desdeBandeja.current.resetEverything()).then((fn) =>
      vivo ? quitar.push(fn) : fn()
    );

    return () => {
      vivo = false;
      quitar.forEach((fn) => fn());
    };
  }, []);

  /** Sin modo: se quedan los volumenes como esten, pero se apaga el ducking. */
  function clearMode() {
    setActive(null);
    void ipc.setDucking([]).catch(() => {});
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

  // Apuntar en el registro lo que suena, para la pestana "Todas".
  useEffect(() => {
    if (groups.length) observe(groups);
  }, [groups, observe]);

  /**
   * Aplica el volumen preparado en cuanto una aplicacion vuelve a sonar.
   *
   * Solo al APARECER, nunca de forma continua: si no, no podrias mover su
   * slider —lo devolveria al valor preparado al instante siguiente.
   */
  const seenKeys = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!hydrated) return;

    const current = new Set(groups.map((group) => group.key));
    const { presets: saved } = useModes.getState();

    for (const group of groups) {
      if (seenKeys.current.has(group.key)) continue;

      const preset = saved[group.key];
      if (preset) {
        setVolume(group.pids, preset.volume);
        if (preset.muted !== group.muted) toggleMute(group.pids, preset.muted);
      }
    }

    seenKeys.current = current;
  }, [groups, hydrated, setVolume, toggleMute]);

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
        <div className="relative z-[1] px-4 pb-4 pt-3 sm:px-6">
          <h1 className="text-[21px] font-semibold leading-none tracking-[-0.025em]">
            {TITLES[section]}
          </h1>
        </div>

        {failedHotkeys.length > 0 && (
          <div className="relative z-[1] mx-4 mb-3 flex items-start gap-2 rounded-[12px] sm:mx-6 border border-[#78350f] bg-[#451a03] px-3 py-2.5 text-[10px] leading-relaxed text-[#fcd34d]">
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
          <div className="relative z-[1] mx-4 mb-3 rounded-[12px] border border-[#7f1d1d] sm:mx-6 bg-[#450a0a] px-3 py-2.5 text-[11px] text-[#fca5a5]">
            {error}
          </div>
        )}

        <div className="relative z-[1] flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-6 pt-2 sm:px-6">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18 }}
            className="flex min-h-0 flex-1 flex-col"
          >
            {section === "home" && (
              <HomeSection
                modes={modes}
                activeMode={activeMode}
                groups={groups}
                icons={icons}
                master={master}
                device={currentDevice}
                duckingGain={duckingGain}
                espejos={espejos}
                resetHotkey={resetHotkey}
                onActivate={activate}
                onMaster={setMasterVolume}
                onVolume={setVolume}
                onToggleMute={toggleMute}
                onReset={resetEverything}
              />
            )}

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
                knownApps={knownApps}
                presets={presets}
                onPreset={setPreset}
                onForget={forgetApp}
                tab={mixerTab}
                onTab={setMixerTab}
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

            {section === "boost" && (
              <BoostSection
                groups={groups}
                icons={icons}
                boosts={boosts}
                errores={erroresBoost}
                onBoost={setBoost}
                onClear={clearBoosts}
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
            knownApps={knownApps}
            icons={icons}
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
