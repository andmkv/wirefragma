import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { useT } from "../i18n";
import { isEditingTextInput } from "../utils/keyboard";

/**
 * Shared frame of the Canvas and Drawing popups.
 *
 * A popup edits a DRAFT copy of the scene with its own small undo stack; nothing reaches the
 * document until Done, which commits the whole editing session as ONE history step. Close (×,
 * Escape, backdrop) discards the draft — after a confirmation when something changed.
 */

interface SceneHistory<T> {
  present: T;
  /** Record a new state. Consecutive changes with the same `coalesceKey` share one undo step. */
  push: (next: T, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
}

export function useSceneHistory<T>(initial: T): SceneHistory<T> {
  const [state, setState] = useState<{ past: T[]; present: T; future: T[]; key: string | null }>({
    past: [],
    present: initial,
    future: [],
    key: null
  });

  const push = useCallback((next: T, coalesceKey?: string) => {
    setState((current) => {
      if (next === current.present) return current;
      if (coalesceKey && coalesceKey === current.key) {
        return { ...current, present: next, future: [] };
      }
      return { past: [...current.past, current.present], present: next, future: [], key: coalesceKey ?? null };
    });
  }, []);

  const undo = useCallback(() => {
    setState((current) => {
      if (current.past.length === 0) return current;
      return {
        past: current.past.slice(0, -1),
        present: current.past[current.past.length - 1],
        future: [current.present, ...current.future],
        key: null
      };
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      if (current.future.length === 0) return current;
      return { past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1), key: null };
    });
  }, []);

  return {
    present: state.present,
    push,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    dirty: state.present !== initial
  };
}

/** CSS size of the stage and the scene scale that fits the scene into it. */
export function useStageFit(scene: { width: number; height: number }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ width: 800, height: 520 });

  useLayoutEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setArea({ width: Math.max(120, rect.width - 24), height: Math.max(120, rect.height - 24) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const scale = Math.max(0.05, Math.min(area.width / scene.width, area.height / scene.height));
  return { stageRef, scale, cssWidth: Math.round(scene.width * scale), cssHeight: Math.round(scene.height * scale) };
}

/** Size the backing store for DPR and return a context in CSS-pixel units, cleared to white. */
export function prepareStageContext(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D | null {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(cssWidth * dpr));
  const height = Math.max(1, Math.round(cssHeight * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  return ctx;
}

interface SceneModalProps {
  title: string;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDone: () => void;
  onCancel: () => void;
  /** Tool buttons, rendered left of Undo/Redo. */
  tools: ReactNode;
  /** Extra toolbar actions, rendered after Undo/Redo (Clear, …). */
  actions?: ReactNode;
  hint: string;
  stageRef: RefObject<HTMLDivElement>;
  children: ReactNode;
  /** Optional strip under the stage (the selected shape's properties). */
  footer?: ReactNode;
  /** Keys the concrete editor handles itself (Delete in the Canvas editor). */
  onKeyDown?: (event: KeyboardEvent) => void;
}

export function SceneModal({
  title,
  dirty,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDone,
  onCancel,
  tools,
  actions,
  hint,
  stageRef,
  children,
  footer,
  onKeyDown
}: SceneModalProps) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true);
    else onCancel();
  }, [dirty, onCancel]);

  const latest = useRef({ requestClose, onUndo, onRedo, onKeyDown, confirming });
  latest.current = { requestClose, onUndo, onRedo, onKeyDown, confirming };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const current = latest.current;
      if (event.key === "Escape") {
        event.preventDefault();
        if (current.confirming) setConfirming(false);
        else current.requestClose();
        return;
      }
      if (isEditingTextInput(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) current.onRedo();
        else current.onUndo();
        return;
      }
      if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        current.onRedo();
        return;
      }
      current.onKeyDown?.(event);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <div className="modal scene-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <div className="scene-header-actions">
            {confirming ? (
              <>
                <span className="scene-confirm">{t("scene.discardQuestion")}</span>
                <button type="button" onClick={() => setConfirming(false)}>
                  {t("scene.keepEditing")}
                </button>
                <button type="button" className="danger-solid" onClick={onCancel}>
                  {t("scene.discard")}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="primary" onClick={onDone}>
                  {t("scene.done")}
                </button>
                <button type="button" className="icon-button" onClick={requestClose} aria-label={t("common.close")}>
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
        <div className="scene-toolbar" role="toolbar">
          {tools}
          <span className="scene-toolbar-sep" />
          <button type="button" onClick={onUndo} disabled={!canUndo} title={`${t("scene.undo")} (Cmd/Ctrl+Z)`}>
            {t("scene.undo")}
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo} title={`${t("scene.redo")} (Cmd/Ctrl+Shift+Z)`}>
            {t("scene.redo")}
          </button>
          {actions}
        </div>
        <div className="scene-stage" ref={stageRef}>
          {children}
        </div>
        {footer}
        <p className="scene-hint">{hint}</p>
      </div>
    </div>
  );
}
