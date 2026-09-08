import { useEffect, useState } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  Check,
  ClipboardPaste,
  Copy,
  Keyboard,
  Power,
  RotateCcw,
  Share2,
} from "lucide-react";

import { HotkeyRecorder } from "../modes/HotkeyRecorder";
import { normalize, type Mode } from "../../lib/modes";

type Props = {
  modes: Mode[];
  cycleHotkey: string;
  onCycleHotkey: (accel: string) => void;
  resetHotkey: string;
  onResetHotkey: (accel: string) => void;
  onImport: (modes: Mode[]) => void;
};

export function SettingsSection({
  modes,
  cycleHotkey,
  onCycleHotkey,
  resetHotkey,
  onResetHotkey,
  onImport,
}: Props) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    isAutostartEnabled()
      .then(setAutostart)
      .catch(() => setAutostart(false));
  }, []);

  function say(message: string) {
    setFlash(message);
    setTimeout(() => setFlash(null), 3000);
  }

  async function toggleAutostart(next: boolean) {
    try {
      if (next) await enableAutostart();
      else await disableAutostart();
      setAutostart(next);
      say(next ? "Sonora arrancará con Windows" : "Ya no arrancará con Windows");
    } catch (error) {
      say(String(error));
    }
  }

  async function exportModes() {
    try {
      await writeText(JSON.stringify(modes, null, 2));
      say(`${modes.length} modos copiados al portapapeles`);
    } catch (error) {
      say(String(error));
    }
  }

  async function importModes() {
    try {
      const text = await readText();
      const parsed: unknown = JSON.parse(text ?? "");

      // Lo que hay en el portapapeles puede ser cualquier cosa: comprobamos la
      // forma antes de tocar la configuracion del usuario.
      if (!Array.isArray(parsed) || parsed.length === 0) {
        say("El portapapeles no tiene una lista de modos");
        return;
      }
      const valid = parsed.every(
        (item) =>
          item &&
          typeof item === "object" &&
          typeof (item as Mode).id === "string" &&
          typeof (item as Mode).name === "string"
      );
      if (!valid) {
        say("El portapapeles no tiene modos de Sonora");
        return;
      }

      onImport((parsed as Mode[]).map(normalize));
      say(`${parsed.length} modos importados`);
    } catch {
      say("El portapapeles no contiene JSON válido");
    }
  }

  return (
    <div className="max-w-[620px] space-y-3">
      <Card icon={<Power size={15} />} title="Arranque">
        <label className="flex cursor-pointer items-start gap-2.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
          <input
            type="checkbox"
            checked={autostart ?? false}
            disabled={autostart === null}
            onChange={(e) => toggleAutostart(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            Arrancar con Windows
            <span className="mt-0.5 block text-[10px] text-[var(--color-faint)]">
              Se abre directamente en la bandeja del sistema, sin ventana. Es lo
              que quieres si Sonora tiene que estar lista cuando entres a jugar.
            </span>
          </span>
        </label>
      </Card>

      <Card icon={<Keyboard size={15} />} title="Atajo para pasar al siguiente modo">
        <HotkeyRecorder
          value={cycleHotkey}
          onChange={(accel) => onCycleHotkey(accel ?? "")}
        />
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
          Los atajos de cada modo se configuran dentro del modo. Ctrl+Alt+Tab no
          vale: Windows se lo queda para la vista de tareas.
        </p>
      </Card>

      <Card icon={<RotateCcw size={15} />} title="Atajo para volver al 100%">
        <HotkeyRecorder
          value={resetHotkey}
          onChange={(accel) => onResetHotkey(accel ?? "")}
        />
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
          Pone todas las aplicaciones al 100%, quita los silencios y desactiva el
          modo y la prioridad de voz. Es el botón de pánico: sirve sin salir del
          juego.
        </p>
      </Card>

      <Card icon={<Share2 size={15} />} title="Compartir modos">
        <div className="flex gap-2">
          <Action onClick={exportModes} icon={<Copy size={12} />}>
            Copiar mis modos
          </Action>
          <Action onClick={importModes} icon={<ClipboardPaste size={12} />}>
            Pegar modos
          </Action>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-faint)]">
          Copia tus {modes.length} modos como JSON al portapapeles para
          pasárselos a alguien por Discord. Pegar <strong>sustituye</strong> todos
          los tuyos.
        </p>
      </Card>

      {flash && (
        <div
          className="flex items-center gap-2 rounded-[12px] px-3 py-2.5 text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--accent) 12%, transparent)",
            color: "var(--accent)",
          }}
        >
          <Check size={12} />
          {flash}
        </div>
      )}

      <p className="pt-1 text-[10px] text-[var(--color-faint)]">
        Sonora 0.1.0 · sin cuenta, sin nube, sin telemetría. Todo se guarda en
        %APPDATA%/com.sonora.app.
      </p>
    </div>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-[9px]"
          style={{
            background: "color-mix(in srgb, var(--accent) 14%, transparent)",
            color: "var(--accent)",
          }}
        >
          {icon}
        </span>
        <span className="text-[12px] font-medium">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Action({
  onClick,
  icon,
  children,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-1 items-center justify-center gap-1.5 rounded-[10px] border
                 border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2
                 text-[11px] text-[var(--color-muted)]
                 hover:border-[var(--accent)] hover:text-[var(--color-text)]"
    >
      {icon}
      {children}
    </button>
  );
}
