import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { drawDrawingScene } from "../canvas/render";
import { useT } from "../i18n";
import {
  DEFAULT_DRAWING_PEN_WIDTH,
  DRAWING_PEN_WIDTHS,
  eraseAt,
  hasDrawingDescription,
  roundCoord,
  type DrawingData,
  type DrawingPoint
} from "../model/drawing";
import { SceneModal, prepareStageContext, useSceneHistory, useStageFit } from "./SceneEditorShell";

type Tool = "pen" | "eraser";

/** Eraser reach in CSS pixels (converted to drawing units at the current fit). */
const ERASER_RADIUS_PX = 10;
/** Skip points closer than this (CSS px) to the previous one: smaller JSON, same look. */
const MIN_POINT_DISTANCE_PX = 1.5;

interface DrawingEditorProps {
  name: string;
  initial: DrawingData;
  onDone: (data: DrawingData) => void;
  onCancel: () => void;
}

/**
 * The Drawing popup: freehand strokes stored as vectors (never a bitmap), a stroke-level eraser,
 * three pen widths, undo/redo and Clear. Everything is a draft until Done, which the host commits
 * as one history step. The LLM description lives here too, because without it the Drawing is
 * left out of the LLM export.
 */
export function DrawingEditor({ name, initial, onDone, onCancel }: DrawingEditorProps) {
  const t = useT();
  const history = useSceneHistory<DrawingData>(initial);
  const data = history.present;
  const [tool, setTool] = useState<Tool>("pen");
  const [penWidth, setPenWidth] = useState<number>(DEFAULT_DRAWING_PEN_WIDTH);
  const { stageRef, scale, cssWidth, cssHeight } = useStageFit(data);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** The stroke being drawn (not in history until the pointer is released). */
  const liveRef = useRef<DrawingPoint[] | null>(null);
  const eraseRef = useRef<{ key: string } | null>(null);
  const gesture = useRef(0);

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareStageContext(canvas, cssWidth, cssHeight);
    if (!ctx) return;
    ctx.save();
    ctx.scale(scale, scale);
    const live = liveRef.current;
    drawDrawingScene(ctx, live ? { ...data, strokes: [...data.strokes, { points: live, width: penWidth }] } : data);
    ctx.restore();
  };

  useEffect(paint);

  const toScene = (event: ReactPointerEvent<HTMLCanvasElement>): DrawingPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: roundCoord(Math.min(data.width, Math.max(0, (event.clientX - rect.left) / scale))),
      y: roundCoord(Math.min(data.height, Math.max(0, (event.clientY - rect.top) / scale)))
    };
  };

  const erase = (point: DrawingPoint) => {
    const key = eraseRef.current?.key;
    const next = eraseAt(history.present, point, ERASER_RADIUS_PX / scale);
    if (next !== history.present) history.push(next, key);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toScene(event);
    if (tool === "pen") {
      liveRef.current = [point];
      paint();
    } else {
      gesture.current += 1;
      // One eraser drag = one undo step, however many strokes it removes.
      eraseRef.current = { key: `erase-${gesture.current}` };
      erase(point);
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = toScene(event);
    if (liveRef.current) {
      const last = liveRef.current[liveRef.current.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) * scale < MIN_POINT_DISTANCE_PX) return;
      liveRef.current.push(point);
      paint();
    } else if (eraseRef.current) {
      erase(point);
    }
  };

  const finish = () => {
    const live = liveRef.current;
    liveRef.current = null;
    eraseRef.current = null;
    if (live) history.push({ ...history.present, strokes: [...history.present.strokes, { points: live, width: penWidth }] });
  };

  const describe = (description: string) =>
    history.push({ ...data, description: description === "" ? undefined : description }, "description");

  return (
    <SceneModal
      title={`${t("type.drawing")}: ${name}`}
      dirty={history.dirty}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      onUndo={history.undo}
      onRedo={history.redo}
      onDone={() => onDone(data)}
      onCancel={onCancel}
      hint={t("scene.drawingHint")}
      stageRef={stageRef}
      tools={
        <>
          <button type="button" className={tool === "pen" ? "active" : undefined} aria-pressed={tool === "pen"} onClick={() => setTool("pen")}>
            ✎ {t("scene.pen")}
          </button>
          <button type="button" className={tool === "eraser" ? "active" : undefined} aria-pressed={tool === "eraser"} onClick={() => setTool("eraser")}>
            ⌫ {t("scene.eraser")}
          </button>
          <span className="scene-toolbar-sep" />
          {DRAWING_PEN_WIDTHS.map((width, index) => {
            const label = t(index === 0 ? "scene.thin" : index === 1 ? "scene.medium" : "scene.thick");
            return (
              <button
                key={width}
                type="button"
                className={`pen-width${penWidth === width ? " active" : ""}`}
                aria-pressed={penWidth === width}
                title={label}
                aria-label={label}
                onClick={() => {
                  setPenWidth(width);
                  setTool("pen");
                }}
              >
                <span style={{ height: width, width: 18 }} />
              </button>
            );
          })}
        </>
      }
      actions={
        <button type="button" onClick={() => history.push({ ...data, strokes: [] })} disabled={data.strokes.length === 0}>
          {t("scene.clear")}
        </button>
      }
      footer={
        <div className="scene-footer">
          <label className="field">
            <span className="field-label">{t("scene.description")}</span>
            <textarea
              rows={2}
              value={data.description ?? ""}
              placeholder={t("scene.drawingDescriptionPlaceholder")}
              onChange={(event) => describe(event.target.value)}
            />
          </label>
          {!hasDrawingDescription(data) ? <p className="scene-warning">⚠ {t("scene.drawingWarning")}</p> : null}
        </div>
      }
    >
      <canvas
        ref={canvasRef}
        className={`scene-canvas tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
      />
    </SceneModal>
  );
}
