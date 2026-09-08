import { load, type Store } from "@tauri-apps/plugin-store";
import { create } from "zustand";

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
  /** false hasta que se ha leido el disco: evita pisar lo guardado */
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setActive: (id: string | null) => void;
  setCycleHotkey: (accel: string) => void;
  setResetHotkey: (accel: string) => void;
  upsert: (mode: Mode) => void;
  remove: (id: string) => void;
  replaceAll: (modes: Mode[]) => void;
};

export const useModes = create<ModesState>((set, get) => {
  /** Escribe el estado actual a disco. */
  async function persist() {
    const { modes, activeModeId, cycleHotkey, resetHotkey } = get();
    const handle = await file();
    await handle.set(KEY_MODES, modes);
    await handle.set(KEY_ACTIVE, activeModeId);
    await handle.set(KEY_CYCLE, cycleHotkey);
    await handle.set(KEY_RESET, resetHotkey);
    await handle.save();
  }

  return {
    modes: DEFAULT_MODES,
    activeModeId: null,
    cycleHotkey: CYCLE_HOTKEY,
    resetHotkey: RESET_HOTKEY,
    hydrated: false,

    hydrate: async () => {
      try {
        const handle = await file();
        const saved = await handle.get<Mode[]>(KEY_MODES);
        const active = await handle.get<string | null>(KEY_ACTIVE);
        const cycle = await handle.get<string>(KEY_CYCLE);
        const reset = await handle.get<string>(KEY_RESET);

        set({
          // `normalize` rellena los campos que no existian cuando se guardo:
          // un modo de una version anterior no trae `ducking`, y mandarselo
          // undefined a Rust reventaria la deserializacion.
          modes: saved?.length ? saved.map(normalize) : DEFAULT_MODES,
          activeModeId: active ?? null,
          cycleHotkey: cycle || CYCLE_HOTKEY,
          resetHotkey: reset || RESET_HOTKEY,
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

    /** Usado al importar un juego de modos completo. */
    replaceAll: (modes) => {
      set({ modes: modes.map(normalize), activeModeId: null });
      void persist();
    },

    upsert: (mode) => {
      set((state) => {
        const index = state.modes.findIndex((m) => m.id === mode.id);
        if (index === -1) return { modes: [...state.modes, mode] };

        const modes = [...state.modes];
        modes[index] = mode;
        return { modes };
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
