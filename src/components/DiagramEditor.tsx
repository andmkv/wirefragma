import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { drawDiagramScene } from "../canvas/render";
import { useT } from "../i18n";
import {
  createDiagramObject,
  diagramHandles,
  diagramObjectBounds,
  hitDiagramHandle,
  hitDiagramObject,
  moveDiagramHandle,
  reorderDiagramObject,
  translateDiagramObject,
  type DiagramData,
  type DiagramHandleId,
  type DiagramObject,
  type DiagramObjectType,
  type DiagramPoint
} from "../model/diagram";
import { EmojiTextField } from "./EmojiTextField";
import { SceneModal, prepareStageContext, useSceneHistory, useStageFit } from "./SceneEditorShell";

type Tool = "select" | DiagramObjectType;

/** Every scene object type plus Select (a missing type would fail `TOOL_GLYPH`'s Record type). */
const TOOLS: Tool[] = ["select", "line", "arrow", "rectangle", "ellipse", "bezier", "text"];
const TOOL_GLYPH: Record<Tool, string> = { select: "↖", line: "╱", arrow: "→", rectangle: "▭", ellipse: "◯", bezier: "∿", text: "T" };
/** Hit tolerance and handle size in CSS pixels (converted to scene units at the current fit). */
const HIT_PX = 6;
const HANDLE_PX = 8;
/** A create-drag shorter than this (CSS px) is a click: the shape gets a default size. */
const CLICK_PX = 4;
const DEFAULT_SPAN: Record<DiagramObjectType, DiagramPoint> = {
  rectangle: { x: 120, y: 70 },
  ellipse: { x: 100, y: 70 },
  text: { x: 120, y: 24 },
  line: { x: 120, y: 0 },
  arrow: { x: 120, y: 0 },
  bezier: { x: 140, y: 0 }
};

type Gesture =
  | { kind: "create"; type: DiagramObjectType; start: DiagramPoint; current: DiagramPoint }
  | { kind: "move"; id: string; start: DiagramPoint; snapshot: DiagramObject; key: string }
  | { kind: "handle"; id: string; handle: DiagramHandleId; snapshot: DiagramObject; key: string };

interface DiagramEditorProps {
  name: string;
  initial: DiagramData;
  onDone: (data: DiagramData) => void;
  onCancel: () => void;
}

/**
 * The Canvas popup: a deliberately small structured-diagram editor. Shapes live in the scene's own
 * coordinate space; geometry, hit testing, handles and edits all come from `model/diagram.ts` (the
 * one implementation shared with the renderer and the exporters). Draft until Done → one history
 * step on the wireframe.
 */
export function DiagramEditor({ name, initial, onDone, onCancel }: DiagramEditorProps) {
  const t = useT();
  const history = useSceneHistory<DiagramData>(initial);
  const data = history.present;
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { stageRef, scale, cssWidth, cssHeight } = useStageFit(data);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const gestureCount = useRef(0);
  const labelRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const selected = data.objects.find((object) => object.id === selectedId) ?? null;
  const px = 1 / scale;

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareStageContext(canvas, cssWidth, cssHeight);
    if (!ctx) return;
    ctx.save();
    ctx.scale(scale, scale);
    const gesture = gestureRef.current;
    const preview =
      gesture?.kind === "create" ? { ...data, objects: [...data.objects, createDiagramObject(data, gesture.type, gesture.start, gesture.current)] } : data;
    drawDiagramScene(ctx, preview, px);
    ctx.restore();

    if (selected) {
      // Selection chrome in screen pixels: dashed bounds + the object's own handles.
      const b = diagramObjectBounds(selected);
      ctx.save();
      ctx.strokeStyle = "#2f6fed";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(b.x * scale - 3, b.y * scale - 3, b.width * scale + 6, b.height * scale + 6);
      ctx.setLineDash([]);
      if (selected.type === "bezier") {
        ctx.strokeStyle = "rgba(47,111,237,0.5)";
        ctx.beginPath();
        ctx.moveTo(selected.start.x * scale, selected.start.y * scale);
        ctx.lineTo(selected.control1.x * scale, selected.control1.y * scale);
        ctx.moveTo(selected.end.x * scale, selected.end.y * scale);
        ctx.lineTo(selected.control2.x * scale, selected.control2.y * scale);
        ctx.stroke();
      }
      for (const handle of diagramHandles(selected)) {
        const control = handle.id === "control1" || handle.id === "control2";
        ctx.fillStyle = control ? "#2f6fed" : "#ffffff";
        ctx.strokeStyle = "#2f6fed";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (control) ctx.arc(handle.x * scale, handle.y * scale, HANDLE_PX / 2, 0, Math.PI * 2);
        else ctx.rect(handle.x * scale - HANDLE_PX / 2, handle.y * scale - HANDLE_PX / 2, HANDLE_PX, HANDLE_PX);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  };

  useEffect(paint);

  const toScene = (event: ReactPointerEvent<HTMLCanvasElement>): DiagramPoint => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(data.width, Math.max(0, (event.clientX - rect.left) / scale)),
      y: Math.min(data.height, Math.max(0, (event.clientY - rect.top) / scale))
    };
  };

  const replaceObject = (object: DiagramObject, key?: string) =>
    history.push({ ...history.present, objects: history.present.objects.map((item) => (item.id === object.id ? object : item)) }, key);

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toScene(event);
    gestureCount.current += 1;
    const key = `gesture-${gestureCount.current}`;
    if (tool !== "select") {
      gestureRef.current = { kind: "create", type: tool, start: point, current: point };
      paint();
      return;
    }
    if (selected) {
      const handle = hitDiagramHandle(selected, point, (HANDLE_PX / 2 + 2) * px);
      if (handle) {
        gestureRef.current = { kind: "handle", id: selected.id, handle, snapshot: selected, key };
        return;
      }
    }
    const hit = hitDiagramObject(data, point, HIT_PX * px);
    setSelectedId(hit?.id ?? null);
    if (hit) gestureRef.current = { kind: "move", id: hit.id, start: point, snapshot: hit, key };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = toScene(event);
    if (gesture.kind === "create") {
      gesture.current = point;
      paint();
    } else if (gesture.kind === "move") {
      // Always from the pointerdown snapshot: the drag never accumulates rounding.
      replaceObject(translateDiagramObject(gesture.snapshot, point.x - gesture.start.x, point.y - gesture.start.y), gesture.key);
    } else {
      replaceObject(moveDiagramHandle(gesture.snapshot, gesture.handle, point), gesture.key);
    }
  };

  const finish = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.kind !== "create") return;
    let end = gesture.current;
    if (Math.hypot(end.x - gesture.start.x, end.y - gesture.start.y) * scale < CLICK_PX) {
      const span = DEFAULT_SPAN[gesture.type];
      end = { x: Math.min(data.width, gesture.start.x + span.x), y: Math.min(data.height, gesture.start.y + span.y) };
    }
    const current = history.present;
    const object = createDiagramObject(current, gesture.type, gesture.start, end);
    history.push({ ...current, objects: [...current.objects, object] });
    setSelectedId(object.id);
    setTool("select");
    // New text is named right away.
    if (object.type === "text") window.setTimeout(() => labelRef.current?.select(), 0);
  };

  const remove = () => {
    if (!selected) return;
    history.push({ ...data, objects: data.objects.filter((object) => object.id !== selected.id) });
    setSelectedId(null);
  };

  const setLabel = (label: string) => {
    if (!selected) return;
    const next = { ...selected } as DiagramObject;
    if (label === "" && selected.type !== "text") delete next.label;
    else next.label = label;
    replaceObject(next, `label-${selected.id}`);
  };

  return (
    <SceneModal
      title={t("scene.canvasTitle", { name })}
      dirty={history.dirty}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      onUndo={history.undo}
      onRedo={history.redo}
      onDone={() => onDone(data)}
      onCancel={onCancel}
      hint={t("scene.diagramHint")}
      stageRef={stageRef}
      onKeyDown={(event) => {
        if ((event.key === "Delete" || event.key === "Backspace") && selected) {
          event.preventDefault();
          remove();
        }
      }}
      tools={TOOLS.map((item) => (
        <button
          key={item}
          type="button"
          className={tool === item ? "active" : undefined}
          aria-pressed={tool === item}
          onClick={() => setTool(item)}
          title={t(`scene.tool.${item}`)}
        >
          <span aria-hidden="true">{TOOL_GLYPH[item]}</span> {t(`scene.tool.${item}`)}
        </button>
      ))}
      footer={
        <div className="scene-footer">
          {selected ? (
            <div className="scene-selection">
              {selected.type !== "text" ? <span className="scene-selection-type">{t(`scene.tool.${selected.type}`)}</span> : null}
              <label className="field">
                <span className="field-label">{selected.type === "text" ? t("scene.text") : t("scene.label")}</span>
                <EmojiTextField
                  multiline={selected.type === "text"}
                  rows={2}
                  inputRef={labelRef}
                  ariaLabel={selected.type === "text" ? t("scene.text") : t("scene.label")}
                  value={selected.label ?? ""}
                  onChange={setLabel}
                />
              </label>
              <button type="button" onClick={() => history.push(reorderDiagramObject(data, selected.id, 1))} title={t("scene.forward")}>
                ↑ {t("scene.forward")}
              </button>
              <button type="button" onClick={() => history.push(reorderDiagramObject(data, selected.id, -1))} title={t("scene.backward")}>
                ↓ {t("scene.backward")}
              </button>
              <button type="button" className="danger" onClick={remove}>
                {t("common.delete")}
              </button>
            </div>
          ) : null}
          <label className="field">
            <span className="field-label">{t("scene.descriptionOptional")}</span>
            <EmojiTextField
              multiline
              rows={2}
              value={data.description ?? ""}
              placeholder={t("scene.diagramDescriptionPlaceholder")}
              onChange={(value) =>
                history.push({ ...data, description: value === "" ? undefined : value }, "description")
              }
            />
          </label>
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
