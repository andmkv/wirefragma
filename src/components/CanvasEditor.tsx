import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MIN_ELEMENT_SIZE, effectiveLocked, findElement, type WireframeElement, type WireframeProject } from "../model/project";
import { hasDrawingDescription } from "../model/drawing";
import type { SelectionState } from "../model/selection";
import { WARNING_BADGE_PX, visibleGeometries, warningBadgeRect, type ResizeEdge } from "../canvas/geometry";
import { hitTestProject } from "../canvas/hitTest";
import { CanvasInteraction, type InteractionState } from "../canvas/interaction";
import { renderScene, type PreviewOverride } from "../canvas/render";
import { createTransform, rectContains, screenToWorld, worldRectToScreen, type Point, type Rect, type ViewTransform } from "../canvas/transform";
import { useT } from "../i18n";
import { fitScale, scaleForMode, zoomFromWheel, type ZoomMode } from "../utils/zoom";
import { isEditingTextInput } from "../utils/keyboard";

interface CanvasEditorProps {
  project: WireframeProject;
  selection: SelectionState;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  zoomMode: ZoomMode;
  manualScale: number;
  onSelect: (selection: SelectionState) => void;
  /** Commit a finished drag of the whole selection as one edit. */
  onMove: (moves: { elementId: string; x: number; y: number }[]) => void;
  /** Commit a finished single-object resize. */
  onResize: (elementId: string, bounds: Rect) => void;
  onBeginInteraction: () => void;
  onEndInteraction: () => void;
  /** Effective scale + the automatic fit scale, so the toolbar can show the zoom level. */
  onScaleChange: (scale: number, fit: number) => void;
  /** The user pinch/wheel-zoomed; the editor switches to manual zoom. */
  onUserZoom: (scale: number) => void;
  /** Open the scene popup of a Canvas / Drawing element (double-click or the hover pencil). */
  onEditScene: (elementId: string) => void;
}

const isSceneElement = (element: WireframeElement | null | undefined): element is WireframeElement =>
  !!element && (element.type === "diagram" || element.type === "drawing");

/** Pencil button size and inset from the element's top-right corner, in CSS px. */
const PENCIL_PX = 22;
const PENCIL_INSET_PX = 6;
/** Below this on-screen width/height the pencil is not shown (double-click still works). */
const PENCIL_MIN_ELEMENT_PX = 44;

interface PendingZoom {
  pointerX: number;
  pointerY: number;
  contentX: number;
  contentY: number;
}

/**
 * The canvas host.
 *
 * Rendering, hit testing, selection, dragging and resizing all live in `src/canvas/*` and are
 * driven by ONE view transform and ONE geometry model. This component only wires the engine to
 * React (project in, commits out), owns the scrollable viewport, and forwards zoom gestures.
 * Gestures repaint through the renderer directly, so pointermove never re-renders React.
 */
export function CanvasEditor({
  project,
  selection,
  showGrid,
  snapToGrid,
  gridSize,
  zoomMode,
  manualScale,
  onSelect,
  onMove,
  onResize,
  onBeginInteraction,
  onEndInteraction,
  onScaleChange,
  onUserZoom,
  onEditScene
}: CanvasEditorProps) {
  const t = useT();
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const pendingZoomRef = useRef<PendingZoom | null>(null);
  const [viewport, setViewport] = useState({ width: 960, height: 640 });
  const [deviceDpr, setDpr] = useState(() =>
    typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1)
  );

  const { width: canvasWidth, height: canvasHeight } = project.canvas;
  const automaticScale = useMemo(
    () => fitScale(viewport, { width: canvasWidth, height: canvasHeight }),
    [viewport, canvasWidth, canvasHeight]
  );
  const scale = scaleForMode(zoomMode, manualScale, automaticScale);
  // Browsers refuse (blank canvas / OOM) backing stores beyond ~16k px per side or ~16.7M px of
  // area, e.g. a 6000×6000 canvas at 200% on a 2× display. Lower the effective DPR instead.
  const dpr = useMemo(
    () => cappedDpr(deviceDpr, canvasWidth * scale, canvasHeight * scale),
    [canvasHeight, canvasWidth, deviceDpr, scale]
  );
  const transform = useMemo(() => createTransform(scale, 0, 0), [scale]);

  // Latest values for the imperative renderer/interaction (no re-render per pointermove).
  const latest = useRef({ project, selection, showGrid, gridSize, transform, snapToGrid, dpr });
  latest.current = { project, selection, showGrid, gridSize, transform, snapToGrid, dpr };
  const callbacks = useRef({ onSelect, onMove, onResize, onBeginInteraction, onEndInteraction, onEditScene });
  callbacks.current = { onSelect, onMove, onResize, onBeginInteraction, onEndInteraction, onEditScene };

  /**
   * Hover state for the scene affordances, updated only when it changes (not per pointermove):
   * the Canvas/Drawing under the pointer (pencil) and the Drawing whose warning badge is hovered.
   */
  const [hover, setHover] = useState<{ sceneId: string | null; badgeId: string | null }>({ sceneId: null, badgeId: null });
  const [pointerDown, setPointerDown] = useState(false);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const current = latest.current;
    renderScene(canvas, {
      project: current.project,
      transform: current.transform,
      dpr: current.dpr,
      showGrid: current.showGrid,
      gridSize: current.gridSize,
      selectedIds: current.selection.ids,
      primarySelectedId: current.selection.primary,
      preview: interactionRef.current?.getPreview()?.moves ?? null,
      marquee: interactionRef.current?.getPreview()?.marquee ?? null,
      activeEdge: interactionRef.current?.getActiveEdge() ?? null
    });
  }, []);

  /* ------------------------------------------------------------- viewport */

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setViewport({ width: Math.max(200, rect.width), height: Math.max(200, rect.height) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () =>
      setDpr(Math.max(1, window.devicePixelRatio || 1));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    onScaleChange(scale, automaticScale);
  }, [automaticScale, onScaleChange, scale]);

  /* --------------------------------------------------------------- engine */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const state = (): InteractionState => ({
      project: latest.current.project,
      transform: latest.current.transform,
      selection: latest.current.selection,
      snapEnabled: latest.current.snapToGrid,
      gridSize: latest.current.gridSize,
      minSize: MIN_ELEMENT_SIZE
    });

    const interaction = new CanvasInteraction(canvas, state(), {
      select: (next) => callbacks.current.onSelect(next),
      // One gesture = one history step: the engine opens the transaction when a drag/resize
      // actually starts and closes it when the pointer is released.
      beginEdit: () => callbacks.current.onBeginInteraction(),
      endEdit: () => callbacks.current.onEndInteraction(),
      commitMove: (moves) => {
        callbacks.current.onMove(moves);
      },
      commitResize: (elementId, bounds) => {
        callbacks.current.onResize(elementId, bounds);
      },
      requestRender: render,
      setCursor: (cursor) => {
        canvas.style.cursor = cursor;
      }
    });
    interactionRef.current = interaction;
    render();
    return () => {
      interaction.detach();
      interactionRef.current = null;
    };
  }, [render]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (isEditingTextInput(event.target)) return;
      interactionRef.current?.cancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /* ------------------------------------------- Canvas / Drawing affordances */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const targetAt = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const current = latest.current;
      const world = screenToWorld(current.transform, screen.x, screen.y);
      const hit = hitTestProject(world, current.project, current.transform, {
        handleElementId: current.selection.ids.length === 1 ? current.selection.primary : null
      });
      const element = hit.kind === "element" || hit.kind === "handle" ? findElement(current.project, hit.elementId) : undefined;
      return { screen, element: isSceneElement(element) ? element : undefined };
    };
    const onMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      const { screen, element } = targetAt(event);
      let badgeId: string | null = null;
      if (element?.type === "drawing" && !hasDrawingDescription(element.drawing)) {
        const badge = warningBadgeRect(element, latest.current.transform);
        if (rectContains(badge, screen.x, screen.y)) badgeId = element.id;
      }
      const sceneId = element?.id ?? null;
      setHover((current) => (current.sceneId === sceneId && current.badgeId === badgeId ? current : { sceneId, badgeId }));
    };
    const onLeave = () => setHover((current) => (current.sceneId || current.badgeId ? { sceneId: null, badgeId: null } : current));
    const onDown = () => setPointerDown(true);
    const onUp = () => setPointerDown(false);
    const onDoubleClick = (event: MouseEvent) => {
      const { element } = targetAt(event);
      if (element && !effectiveLocked(latest.current.project, element)) callbacks.current.onEditScene(element.id);
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    canvas.addEventListener("dblclick", onDoubleClick);
    return () => {
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  // The pencil belongs to the hovered scene element, or else the single selected one.
  const pencilElement = (() => {
    if (pointerDown) return undefined;
    const id = hover.sceneId ?? (selection.ids.length === 1 ? selection.primary : null);
    const element = id ? findElement(project, id) : undefined;
    if (!isSceneElement(element) || effectiveLocked(project, element)) return undefined;
    const screen = worldRectToScreen(transform, element);
    if (screen.width < PENCIL_MIN_ELEMENT_PX || screen.height < PENCIL_MIN_ELEMENT_PX) return undefined;
    const badgeShift = element.type === "drawing" && !hasDrawingDescription(element.drawing) ? WARNING_BADGE_PX + 6 : 0;
    return { element, left: screen.x + screen.width - PENCIL_INSET_PX - PENCIL_PX - badgeShift, top: screen.y + PENCIL_INSET_PX };
  })();
  const badgeElement = hover.badgeId && !pointerDown ? findElement(project, hover.badgeId) : undefined;
  const badgeRect = badgeElement ? warningBadgeRect(badgeElement, transform) : null;

  /* ---------------------------------------------- canvas size + repaint */

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const cssWidth = Math.max(1, Math.round(canvasWidth * scale));
    const cssHeight = Math.max(1, Math.round(canvasHeight * scale));
    const deviceWidth = Math.max(1, Math.round(cssWidth * dpr));
    const deviceHeight = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth;
      canvas.height = deviceHeight;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    interactionRef.current?.setState({
      project,
      transform,
      selection,
      snapEnabled: snapToGrid,
      gridSize,
      minSize: MIN_ELEMENT_SIZE
    });
    render();
    // showGrid is read by render() through `latest`; it must still trigger a repaint on toggle.
  }, [canvasWidth, canvasHeight, dpr, gridSize, project, render, scale, selection, showGrid, snapToGrid, transform]);

  /* ------------------------------------------------------- zoom anchoring */

  useLayoutEffect(() => {
    const pending = pendingZoomRef.current;
    const scroll = scrollRef.current;
    const canvas = canvasRef.current;
    if (!pending || !scroll || !canvas) return;
    pendingZoomRef.current = null;
    const rect = canvas.getBoundingClientRect();
    const desiredLeft = pending.pointerX - pending.contentX * scale;
    const desiredTop = pending.pointerY - pending.contentY * scale;
    scroll.scrollLeft += desiredLeft - rect.left;
    scroll.scrollTop += desiredTop - rect.top;
  }, [scale]);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const handleWheel = (event: WheelEvent) => {
      // Chromium/macOS trackpad pinch arrives as a wheel event with ctrlKey = true.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const next = zoomFromWheel(scale, event.deltaY);
      if (next === scale) return;
      const canvas = canvasRef.current;
      if (canvas) {
        const rect = canvas.getBoundingClientRect();
        pendingZoomRef.current = {
          pointerX: event.clientX,
          pointerY: event.clientY,
          contentX: (event.clientX - rect.left) / scale,
          contentY: (event.clientY - rect.top) / scale
        };
      }
      onUserZoom(next);
    };
    node.addEventListener("wheel", handleWheel, { passive: false });
    return () => node.removeEventListener("wheel", handleWheel);
  }, [onUserZoom, scale]);

  /* ------------------------------------------------------- dev diagnostics */

  useEffect(() => {
    // Invisible JS diagnostics (no UI): available to the dev self-test harness and to
    // `?inputdebug=1`. The visible banner is gated separately in App.tsx.
    if (!import.meta.env.DEV) return;
    const devWindow = window as unknown as {
      __wirefragmaCanvas?: {
        transform: () => ViewTransform;
        hitTest: (world: Point) => string;
        hitTarget: (world: Point) => { kind: string; name: string | null; edge?: string };
        geometries: () => { name: string; type: string; bounds: Rect; hitRegions: Rect[] }[];
        preview: () => PreviewOverride[];
        marquee: () => Rect | null;
        selection: () => string[];
        edges: () => ResizeEdge[];
        elementNames: () => string[];
      };
    };
    const nameOf = (elementId: string): string =>
      findElement(latest.current.project, elementId)?.name ?? elementId;

    devWindow.__wirefragmaCanvas = {
      transform: () => latest.current.transform,
      hitTest: (world) => {
        const current = latest.current;
        const target = hitTestProject(world, current.project, current.transform, {
          handleElementId: current.selection.ids.length === 1 ? current.selection.primary : null
        });
        if (target.kind === "element" || target.kind === "handle") {
          return `${target.kind}:${nameOf(target.elementId)}`;
        }
        return "none";
      },
      hitTarget: (world) => {
        const current = latest.current;
        const target = hitTestProject(world, current.project, current.transform, {
          handleElementId: current.selection.ids.length === 1 ? current.selection.primary : null
        });
        if (target.kind === "element") return { kind: "element", name: nameOf(target.elementId) };
        if (target.kind === "handle") {
          return { kind: "handle", name: nameOf(target.elementId), edge: target.edge };
        }
        return { kind: "none", name: null };
      },
      geometries: () =>
        visibleGeometries(latest.current.project, latest.current.transform).map((geometry) => ({
          name: nameOf(geometry.elementId),
          type: geometry.type,
          bounds: geometry.bounds,
          hitRegions: geometry.hitRegions
        })),
      elementNames: () =>
        visibleGeometries(latest.current.project, latest.current.transform).map((geometry) =>
          nameOf(geometry.elementId)
        ),
      preview: () => interactionRef.current?.getPreview()?.moves ?? [],
      marquee: () => interactionRef.current?.getPreview()?.marquee ?? null,
      selection: () => latest.current.selection.ids.map(nameOf),
      edges: () =>
        interactionRef.current?.getActiveEdge()
          ? [interactionRef.current.getActiveEdge() as ResizeEdge]
          : []
    };
    return () => {
      delete devWindow.__wirefragmaCanvas;
    };
  }, []);

  return (
    <div className="canvas-viewport" ref={scrollRef}>
      <div
        className="canvas-frame"
        style={{ width: Math.round(canvasWidth * scale), height: Math.round(canvasHeight * scale) }}
      >
        <canvas ref={canvasRef} className="canvas-surface" />
        {pencilElement ? (
          <button
            type="button"
            className="scene-edit-button"
            style={{ left: pencilElement.left, top: pencilElement.top, width: PENCIL_PX, height: PENCIL_PX }}
            title={t(pencilElement.element.type === "diagram" ? "scene.editCanvas" : "scene.editDrawing")}
            aria-label={t(pencilElement.element.type === "diagram" ? "scene.editCanvas" : "scene.editDrawing")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onEditScene(pencilElement.element.id)}
          >
            ✎
          </button>
        ) : null}
        {badgeRect ? (
          <div className="scene-warning-tooltip" role="tooltip" style={{ left: badgeRect.x + badgeRect.width, top: badgeRect.y + badgeRect.height + 6 }}>
            {t("scene.drawingWarning")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Largest backing store side / area the canvas may use (conservative cross-browser limits). */
export const MAX_CANVAS_BACKING_SIDE = 16384;
export const MAX_CANVAS_BACKING_AREA = 16_777_216;

/** DPR reduced (never below a fraction of 1) so the backing store stays inside browser limits. */
export function cappedDpr(dpr: number, cssWidth: number, cssHeight: number): number {
  const width = Math.max(1, cssWidth);
  const height = Math.max(1, cssHeight);
  const bySide = MAX_CANVAS_BACKING_SIDE / Math.max(width, height);
  const byArea = Math.sqrt(MAX_CANVAS_BACKING_AREA / (width * height));
  return Math.max(0.1, Math.min(dpr, bySide, byArea));
}
