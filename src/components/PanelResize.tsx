import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

function readNumber(key: string): number | null {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * A panel width remembered per browser. Stored in localStorage (view state, never in the
 * document), so it also survives the editor being re-mounted when another wireframe opens.
 */
export function usePanelWidth(key: string, initial: number, min: number, max: number) {
  const clampWidth = useCallback((value: number) => Math.round(Math.min(max, Math.max(min, value))), [max, min]);
  const [width, setWidthState] = useState(() => clampWidth(readNumber(key) ?? initial));
  const setWidth = useCallback(
    (value: number) => {
      const next = clampWidth(value);
      setWidthState(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        /* convenience only */
      }
    },
    [clampWidth, key]
  );
  return { width, setWidth, reset: () => setWidth(initial), min, max };
}

/** A persisted boolean (collapsed / open) with the same storage rules. */
export function usePanelFlag(key: string, initial: boolean): [boolean, (value: boolean | ((current: boolean) => boolean)) => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === "1";
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: boolean | ((current: boolean) => boolean)) =>
      setValue((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        try {
          window.localStorage.setItem(key, resolved ? "1" : "0");
        } catch {
          /* convenience only */
        }
        return resolved;
      }),
    [key]
  );
  return [value, update];
}

interface PanelResizeHandleProps {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
  label: string;
}

/**
 * Drag handle on a panel's right edge. Pointer-captured drag; double-click restores the default;
 * arrow keys resize by 16 px for keyboard users.
 */
export function PanelResizeHandle({ width, min, max, onResize, onReset, label }: PanelResizeHandleProps) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    start.current = { x: event.clientX, width };
    setActive(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-resizing-panel");
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onResize(start.current.width + event.clientX - start.current.x);
  };
  const stop = () => {
    start.current = null;
    setActive(false);
    document.body.classList.remove("is-resizing-panel");
  };

  return (
    <div
      className={active ? "panel-resize active" : "panel-resize"}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onDoubleClick={onReset}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width - 16);
        else if (event.key === "ArrowRight") onResize(width + 16);
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
    />
  );
}
