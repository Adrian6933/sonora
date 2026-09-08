import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";

import { accelFromEvent, prettyAccel } from "../../hooks/useHotkeys";

type Props = {
  value: string | null;
  onChange: (accel: string | null) => void;
};

export function HotkeyRecorder({ value, onChange }: Props) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;

    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setRecording(false);
        return;
      }

      const accel = accelFromEvent(event);
      // Mientras solo haya modificadores pulsados seguimos escuchando.
      if (!accel) return;

      onChange(accel);
      setRecording(false);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setRecording((r) => !r)}
        className="flex flex-1 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]"
        style={{
          borderColor: recording ? "var(--accent)" : "var(--color-line)",
          background: "var(--color-surface-2)",
          color: recording ? "var(--accent)" : "var(--color-text)",
        }}
      >
        <Keyboard size={12} />
        {recording ? (
          <span className="animate-pulse">Pulsa la combinacion…</span>
        ) : value ? (
          <span className="tabular">{prettyAccel(value)}</span>
        ) : (
          <span className="text-[var(--color-faint)]">Sin atajo</span>
        )}
      </button>

      {value && !recording && (
        <button
          onClick={() => onChange(null)}
          aria-label="Quitar atajo"
          className="flex h-7 w-7 items-center justify-center rounded-lg
                     text-[var(--color-faint)] hover:bg-[var(--color-line)]
                     hover:text-[var(--color-text)]"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
