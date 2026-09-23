import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MIN_ELEMENT_SIZE, findElement, type WireframeProject } from "../model/project";
import type { SelectionState } from "../model/selection";
import { INPUT_DEBUG_ENABLED } from "../buildIdentity";
import { visibleGeometries, type ResizeEdge } from "../canvas/geometry";
import { hitTestProject } from "../canvas/hitTest";
import { CanvasInteraction, type InteractionState } from "../canvas/interaction";
import { renderScene, type PreviewOverride } from "../canvas/render";
import { createTransform, type Point, type Rect, type ViewTransform } from "../canvas/transform";
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
}

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
  onUserZoom
}: CanvasEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const interactionRef = useRef<CanvasInteraction | null>(null);
  const pendingZoomRef = useRef<PendingZoom | null>(null);
  const [viewport, setViewport] = useState({ width: 960, height: 640 });
  const [dpr, setDpr] = useState(() =>
    typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1)
  );

  const { width: canvasWidth, height: canvasHeight } = project.canvas;
  const automaticScale = useMemo(
    () => fitScale(viewport, { width: canvasWidth, height: canvasHeight }),
    [viewport, canvasWidth, canvasHeight]
  );
  const scale = scaleForMode(zoomMode, manualScale, automaticScale);
  const transform = useMemo(() => createTransform(scale, 0, 0), [scale]);

  // Latest values for the imperative renderer/interaction (no re-render per pointermove).
  const latest = useRef({ project, selection, showGrid, gridSize, transform, snapToGrid, dpr });
  latest.current = { project, selection, showGrid, gridSize, transform, snapToGrid, dpr };
  const callbacks = useRef({ onSelect, onMove, onResize, onBeginInteraction, onEndInteraction });
  callbacks.current = { onSelect, onMove, onResize, onBeginInteraction, onEndInteraction };

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
  }, [canvasWidth, canvasHeight, dpr, gridSize, project, render, scale, selection, snapToGrid, transform]);

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
    if (!import.meta.env.DEV && !INPUT_DEBUG_ENABLED) return;
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
      </div>
    </div>
  );
}
