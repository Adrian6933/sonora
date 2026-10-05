import { load, type Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";

import type { AppGroup } from "../lib/group";
import { remember, type KnownApp, type Preset } from "../lib/known";

import {
  CYCLE_HOTKEY,
  DEFAULT_MODES,
  normalize,
  RESET_HOTKEY,
  type Mode,
} from "../lib/modes";

const FILE = "sonora.json";
const KEY_MODES = "modes";
const KEY_ACTIVE = "activeModeId";
const KEY_CYCLE = "cycleHotkey";
const KEY_RESET = "resetHotkey";
const KEY_KNOWN = "knownApps";
const KEY_PRESETS = "presets";

let store: Store | null = null;

async function file(): Promise<Store> {
  // `load` crea el fichero si no existe. Vive en %APPDATA%/com.sonora.app/.
  store ??= await load(FILE, { autoSave: false });
  return store;
}

type ModesState = {
  modes: Mode[];
  activeModeId: string | null;
  /** Atajo global para pasar al siguiente modo */
  cycleHotkey: string;
  /** Atajo para devolver todo al 100% */
  resetHotkey: string;
  /** Aplicaciones que han usado el audio alguna vez */
  knownApps: KnownApp[];
  /** Volumen preparado por aplicacion, se aplica cuando vuelve a sonar */
  presets: Record<string, Preset>;
  /** false hasta que se ha leido el disco: evita pisar lo guardado */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setActive: (id: string | null) => void;
  setCycleHotkey: (accel: string) => void;
  setResetHotkey: (accel: string) => void;
  /** Apunta las aplicaciones que suenan ahora en el registro */
  observe: (groups: AppGroup[]) => void;
  setPreset: (key: string, preset: Preset | null) => void;
  forgetApp: (key: string) => void;
  upsert: (mode: Mode) => void;
  remove: (id: string) => void;
  replaceAll: (modes: Mode[]) => void;
};

export const useModes = create<ModesState>((set, get) => {
  /** Escribe el estado actual a disco. */
  async function persist() {
    const { modes, activeModeId, cycleHotkey, resetHotkey, knownApps, presets } =
      get();
    const handle = await file();
    await handle.set(KEY_MODES, modes);
    await handle.set(KEY_ACTIVE, activeModeId);
    await handle.set(KEY_CYCLE, cycleHotkey);
    await handle.set(KEY_RESET, resetHotkey);
    await handle.set(KEY_KNOWN, knownApps);
    await handle.set(KEY_PRESETS, presets);
    await handle.save();
  }

  return {
    modes: DEFAULT_MODES,
    activeModeId: null,
    cycleHotkey: CYCLE_HOTKEY,
    resetHotkey: RESET_HOTKEY,
    knownApps: [],
    presets: {},
    hydrated: false,

    hydrate: async () => {
      try {
        const handle = await file();
        const saved = await handle.get<Mode[]>(KEY_MODES);
        const active = await handle.get<string | null>(KEY_ACTIVE);
        const cycle = await handle.get<string>(KEY_CYCLE);
        const reset = await handle.get<string>(KEY_RESET);
        const known = await handle.get<KnownApp[]>(KEY_KNOWN);
        const presets = await handle.get<Record<string, Preset>>(KEY_PRESETS);

        set({
          // `normalize` rellena los campos que no existian cuando se guardo:
          // un modo de una version anterior no trae `ducking`, y mandarselo
          // undefined a Rust reventaria la deserializacion.
          modes: saved?.length ? saved.map(normalize) : DEFAULT_MODES,
          activeModeId: active ?? null,
          cycleHotkey: cycle || CYCLE_HOTKEY,
          resetHotkey: reset || RESET_HOTKEY,
          knownApps: known ?? [],
          presets: presets ?? {},
          hydrated: true,
        });
      } catch {
        // Primer arranque, o fichero corrupto: seguimos con los de fabrica.
        set({ hydrated: true });
      }
    },

    setActive: (id) => {
      set({ activeModeId: id });
      void persist();
    },

    setCycleHotkey: (accel) => {
      set({ cycleHotkey: accel });
      void persist();
    },

    setResetHotkey: (accel) => {
      set({ resetHotkey: accel });
      void persist();
    },

    observe: (groups) => {
      const { list, changed } = remember(get().knownApps, groups);
      set({ knownApps: list });
      // Esto corre 20 veces por segundo: solo escribimos a disco cuando de
      // verdad aparece una aplicacion nueva, no en cada refresco.
      if (changed) void persist();
    },

    setPreset: (key, preset) => {
      set((state) => {
        const presets = { ...state.presets };
        if (preset) presets[key] = preset;
        else delete presets[key];
        return { presets };
      });
      void persist();
    },

    forgetApp: (key) => {
      set((state) => {
        const presets = { ...state.presets };
        delete presets[key];
        return {
          knownApps: state.knownApps.filter((app) => app.key !== key),
          presets,
        };
      });
      void persist();
    },

    /** Usado al importar un juego de modos completo. */
    replaceAll: (modes) => {
      set({ modes: modes.map(normalize), activeModeId: null });
      void persist();
    },

    upsert: (mode) => {
      set((state) => {
        const index = state.modes.findIndex((m) => m.id === mode.id);
        const modes =
          index === -1
            ? [...state.modes, mode]
            : state.modes.map((m, i) => (i === index ? mode : m));

        // "Al abrir Sonora" solo puede tenerlo uno. Marcarlo en un modo se lo
        // quita al anterior, que es lo que espera cualquiera al activarlo.
        if (!mode.autoActivate.onStartup) return { modes };

        return {
          modes: modes.map((m) =>
            m.id === mode.id
              ? m
              : { ...m, autoActivate: { ...m.autoActivate, onStartup: false } }
          ),
        };
      });
      void persist();
    },

    remove: (id) => {
      set((state) => ({
        modes: state.modes.filter((m) => m.id !== id),
        activeModeId: state.activeModeId === id ? null : state.activeModeId,
      }));
      void persist();
    },
  };
});
