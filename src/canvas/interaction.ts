/**
 * THE pointer interaction state machine.
 *
 * Ported from NEVERCAT's `canvas/tools.ts`: gestures never write to the document directly.
 * They keep a snapshot of every affected element at pointerdown, compute a preview from the
 * *original* snapshot on every move (never an accumulated delta), draw that preview through the
 * renderer without touching React, and emit exactly ONE commit on pointerup.
 *
 * Four gestures exist:
 *   • move     — drag the whole selection; snapping is measured from the grabbed (primary) object
 *   • resize   — single-object resize from a handle
 *   • marquee  — drag on empty canvas to select by rectangle
 *   • none
 */

import { findElement, withDescendants, type WireframeProject } from "../model/project";
import {
  EMPTY_SELECTION,
  marqueeSelection,
  movableSelection,
  selectionEquals,
  selectionOf,
  singleSelection,
  toggleInSelection,
  unionSelection,
  withPrimary,
  type SelectionState
} from "../model/selection";
import { type ResizeEdge } from "./geometry";
import { hitTestProject, type HitTarget } from "./hitTest";
import { screenPxToWorld, screenToWorld, type Point, type Rect, type ViewTransform } from "./transform";

export interface InteractionState {
  project: WireframeProject;
  transform: ViewTransform;
  selection: SelectionState;
  snapEnabled: boolean;
  gridSize: number;
  minSize: number;
  /** Finger / stylus pointer: the shared hit test uses a larger handle tolerance (D3). */
  coarsePointer?: boolean;
}

export interface MoveStart {
  elementId: string;
  bounds: Rect;
}

export interface MovedBounds {
  elementId: string;
  bounds: Rect;
}

/** What the renderer draws on top of the committed document during a gesture. */
export interface InteractionPreview {
  /** Per-element position overrides (drag / resize). */
  moves: MovedBounds[];
  /** Rubber-band rectangle in world coordinates, or null. */
  marquee: Rect | null;
}

export const EMPTY_PREVIEW: InteractionPreview = { moves: [], marquee: null };

export interface InteractionCallbacks {
  /** Selection changed from a canvas gesture (click, toggle, marquee). */
  select(selection: SelectionState): void;
  /** A document-changing gesture (drag or resize) is about to start — open one history step. */
  beginEdit(): void;
  /** The gesture finished (committed, unchanged or cancelled) — close the history step. */
  endEdit(): void;
  /** Commit a finished drag: one entry per moved element, applied as a single history step. */
  commitMove(moves: { elementId: string; x: number; y: number }[]): void;
  /** Commit a finished resize (world rect). */
  commitResize(elementId: string, bounds: Rect): void;
  /** Redraw now — the gesture produced a new preview. */
  requestRender(): void;
  /** Cursor feedback while hovering. */
  setCursor(cursor: string): void;
}

type Gesture =
  | { kind: "none" }
  | {
      kind: "move";
      pointerId: number;
      elementId: string;
      startWorld: Point;
      starts: MoveStart[];
    }
  | {
      kind: "resize";
      pointerId: number;
      elementId: string;
      edge: ResizeEdge;
      startWorld: Point;
      startBounds: Rect;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startWorld: Point;
      additive: boolean;
      baseIds: string[];
    };

/** A pointer that travels less than this (screen px) is a click, not a marquee drag. */
export const MARQUEE_CLICK_PX = 4;

export function snapValue(value: number, enabled: boolean, gridSize: number): number {
  return enabled ? Math.round(value / gridSize) * gridSize : Math.round(value);
}

/**
 * Resize from a snapshot: only the dragged edges move, the opposite edge is preserved, and
 * snapping applies to the moved edges only.
 */
export function resizeBounds(
  edge: ResizeEdge,
  start: Rect,
  world: Point,
  options: { snapEnabled: boolean; gridSize: number; minSize: number }
): Rect {
  const snap = (value: number) => snapValue(value, options.snapEnabled, options.gridSize);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (edge.includes("left")) left = snap(world.x);
  if (edge.includes("right")) right = snap(world.x);
  if (edge.includes("top")) top = snap(world.y);
  if (edge.includes("bottom")) bottom = snap(world.y);

  const min = options.minSize;
  if (right - left < min) {
    if (edge.includes("left")) left = right - min;
    else right = left + min;
  }
  if (bottom - top < min) {
    if (edge.includes("top")) top = bottom - min;
    else bottom = top + min;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Drag maths: the delta is measured from the *snapshot* taken at pointerdown (never accumulated
 * across moves), and the resulting position snaps to the grid so a dragged element lands on the
 * grid exactly like a resized edge does.
 */
export function moveBounds(
  start: Rect,
  delta: Point,
  options: { snapEnabled: boolean; gridSize: number }
): Rect {
  return {
    x: snapValue(start.x + delta.x, options.snapEnabled, options.gridSize),
    y: snapValue(start.y + delta.y, options.snapEnabled, options.gridSize),
    width: start.width,
    height: start.height
  };
}

/**
 * Multi-object drag: the primary (grabbed) object defines the single snapped delta; every other
 * selected object keeps its exact relative offset, so the group moves as one rigid body.
 */
export function moveSelectionFromSnapshot(
  starts: MoveStart[],
  primaryId: string,
  delta: Point,
  options: { snapEnabled: boolean; gridSize: number }
): MovedBounds[] {
  if (starts.length === 0) return [];
  const primary = starts.find((start) => start.elementId === primaryId) ?? starts[0];
  const snapped = moveBounds(primary.bounds, delta, options);
  const dx = snapped.x - primary.bounds.x;
  const dy = snapped.y - primary.bounds.y;
  return starts.map((start) => ({
    elementId: start.elementId,
    bounds: {
      x: Math.round(start.bounds.x + dx),
      y: Math.round(start.bounds.y + dy),
      width: start.bounds.width,
      height: start.bounds.height
    }
  }));
}

/** Normalise two world points into a positive-size rectangle. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y)
  };
}

export class CanvasInteraction {
  private state: InteractionState;
  private gesture: Gesture = { kind: "none" };
  private preview: InteractionPreview | null = null;
  private hoverCursor = "default";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    state: InteractionState,
    private readonly callbacks: InteractionCallbacks
  ) {
    this.state = state;
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointercancel", this.onPointerUp);
    canvas.addEventListener("lostpointercapture", this.onLostPointerCapture);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
    canvas.addEventListener("contextmenu", this.onContextMenu);
    // A gesture must survive the pointer leaving the canvas (and losing capture): the window
    // listeners are the fallback that always deliver the terminating event.
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerUp);
  }

  setState(state: InteractionState): void {
    this.state = state;
  }

  getPreview(): InteractionPreview | null {
    return this.preview;
  }

  getActiveEdge(): ResizeEdge | null {
    return this.gesture.kind === "resize" ? this.gesture.edge : null;
  }

  getCursor(): string {
    return this.hoverCursor;
  }

  isGesturing(): boolean {
    return this.gesture.kind !== "none";
  }

  /**
   * Which gesture is running. `none` also covers "no document change": a marquee only changes the
   * selection, so the viewport's two-finger pan may cancel it (and must never cancel a move or a
   * resize, whose history transaction would be orphaned).
   */
  getGestureKind(): Gesture["kind"] {
    return this.gesture.kind;
  }

  /** Escape / external cancel: drop the gesture without committing. */
  cancel(): void {
    if (this.gesture.kind === "none" && this.preview === null) return;
    const editing = this.gesture.kind === "move" || this.gesture.kind === "resize";
    this.gesture = { kind: "none" };
    this.preview = null;
    if (editing) this.callbacks.endEdit();
    this.callbacks.requestRender();
  }

  detach(): void {
    const { canvas } = this;
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointercancel", this.onPointerUp);
    canvas.removeEventListener("lostpointercapture", this.onLostPointerCapture);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    canvas.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerUp);
  }

  /* -------------------------------------------------------------- helpers */

  private worldAt(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return screenToWorld(this.state.transform, event.clientX - rect.left, event.clientY - rect.top);
  }

  private boundsOf(elementId: string): Rect | null {
    const element = findElement(this.state.project, elementId);
    if (!element) return null;
    return { x: element.x, y: element.y, width: element.width, height: element.height };
  }

  /** Pointer capture keeps the gesture alive outside the canvas; synthetic pointers may not support it. */
  private capture(pointerId: number): void {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      /* not capturable (synthetic event, or pointer already released) */
    }
  }

  /**
   * THE hit test — the same function the tests and the dev diagnostics call. Handles exist only
   * while exactly one object is selected, so a multi-selection drag can never be hijacked by an
   * individual handle.
   */
  private hit(world: Point): HitTarget {
    const { selection } = this.state;
    return hitTestProject(world, this.state.project, this.state.transform, {
      handleElementId: selection.ids.length === 1 ? selection.primary : null,
      coarsePointer: this.state.coarsePointer === true
    });
  }

  /**
   * The snapshot set for a drag: every selected element that may legally move (visible and
   * unlocked), plus everything nested inside those — a parent always carries its children.
   * Locked members of the selection itself stay exactly where they are.
   */
  private moveStarts(selection: SelectionState): MoveStart[] {
    const starts: MoveStart[] = [];
    const movable = movableSelection(this.state.project, selection.ids);
    for (const id of withDescendants(this.state.project, movable)) {
      const bounds = this.boundsOf(id);
      if (bounds) starts.push({ elementId: id, bounds });
    }
    return starts;
  }

  private isAdditive(event: PointerEvent): boolean {
    return event.shiftKey || event.metaKey || event.ctrlKey;
  }

  /* ------------------------------------------------------------- pointers */

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    // One gesture at a time: a second finger/pen must not replace a running gesture (that would
    // orphan its history transaction).
    if (this.gesture.kind !== "none") return;
    const world = this.worldAt(event);
    const target = this.hit(world);
    const selection = this.state.selection;

    if (target.kind === "handle") {
      const startBounds = this.boundsOf(target.elementId);
      if (!startBounds) return;
      this.callbacks.beginEdit();
      this.gesture = {
        kind: "resize",
        pointerId: event.pointerId,
        elementId: target.elementId,
        edge: target.edge,
        startWorld: world,
        startBounds
      };
      this.capture(event.pointerId);
      this.callbacks.setCursor(this.edgeCursor(target.edge));
      return;
    }

    if (target.kind === "element") {
      const additive = this.isAdditive(event);
      const next = additive
        ? toggleInSelection(selection, target.elementId)
        : selection.ids.includes(target.elementId)
          ? withPrimary(selection, target.elementId)
          : singleSelection(target.elementId);
      if (!selectionEquals(next, selection)) this.callbacks.select(next);

      this.callbacks.beginEdit();
      this.gesture = {
        kind: "move",
        pointerId: event.pointerId,
        elementId: target.elementId,
        startWorld: world,
        starts: this.moveStarts(next)
      };
      this.capture(event.pointerId);
      this.callbacks.setCursor("move");
      return;
    }

    // Empty canvas: begin a marquee. A pointerdown that never travels is a click, and a click
    // on empty canvas clears the selection (unless a modifier keeps it alive).
    this.gesture = {
      kind: "marquee",
      pointerId: event.pointerId,
      startWorld: world,
      additive: this.isAdditive(event),
      baseIds: selection.ids
    };
    this.capture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture.kind !== "none" && event.pointerId !== gesture.pointerId) return;
    const world = this.worldAt(event);

    if (gesture.kind === "move") {
      this.preview = {
        moves: moveSelectionFromSnapshot(
          gesture.starts,
          gesture.elementId,
          { x: world.x - gesture.startWorld.x, y: world.y - gesture.startWorld.y },
          { snapEnabled: this.state.snapEnabled, gridSize: this.state.gridSize }
        ),
        marquee: null
      };
      this.callbacks.requestRender();
      return;
    }

    if (gesture.kind === "resize") {
      this.preview = {
        moves: [
          {
            elementId: gesture.elementId,
            bounds: resizeBounds(gesture.edge, gesture.startBounds, world, {
              snapEnabled: this.state.snapEnabled,
              gridSize: this.state.gridSize,
              minSize: this.state.minSize
            })
          }
        ],
        marquee: null
      };
      this.callbacks.requestRender();
      return;
    }

    if (gesture.kind === "marquee") {
      this.preview = { moves: [], marquee: rectFromPoints(gesture.startWorld, world) };
      this.callbacks.requestRender();
      return;
    }

    // Hover feedback only; the document is untouched.
    const target = this.hit(world);
    const cursor =
      target.kind === "handle"
        ? this.edgeCursor(target.edge)
        : target.kind === "element"
          ? "move"
          : "default";
    if (cursor !== this.hoverCursor) {
      this.hoverCursor = cursor;
      this.callbacks.setCursor(cursor);
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture.kind === "none") return;
    if (event.pointerId !== gesture.pointerId) return;
    const preview = this.preview;
    this.gesture = { kind: "none" };
    this.preview = null;

    if (event.type === "pointercancel") {
      this.callbacks.endEdit();
      this.callbacks.requestRender();
      return;
    }

    if (gesture.kind === "marquee") {
      this.finishMarquee(gesture, preview?.marquee ?? null);
      // The rubber band is transient editor state, so clearing it must itself invalidate the
      // canvas. `select()` below is often a no-op (a marquee that matched nothing, or one whose
      // result equals the current selection), in which case React bails out and nothing else
      // would repaint — leaving the last drawn marquee frame on screen until some later action
      // happened to redraw.
      this.callbacks.requestRender();
      return;
    }

    if (gesture.kind === "move") {
      const moves = preview?.moves ?? [];
      const starts = new Map(gesture.starts.map((start) => [start.elementId, start.bounds]));
      const committed = moves
        .filter((move) => {
          const start = starts.get(move.elementId);
          return !!start && (start.x !== move.bounds.x || start.y !== move.bounds.y);
        })
        .map((move) => ({ elementId: move.elementId, x: move.bounds.x, y: move.bounds.y }));
      if (committed.length > 0) this.callbacks.commitMove(committed);
      else this.callbacks.requestRender();
      this.callbacks.endEdit();
      return;
    }

    const bounds = preview?.moves[0]?.bounds ?? gesture.startBounds;
    const changed =
      bounds.x !== gesture.startBounds.x ||
      bounds.y !== gesture.startBounds.y ||
      bounds.width !== gesture.startBounds.width ||
      bounds.height !== gesture.startBounds.height;
    if (changed) this.callbacks.commitResize(gesture.elementId, bounds);
    else this.callbacks.requestRender();
    this.callbacks.endEdit();
  };

  private finishMarquee(
    gesture: Extract<Gesture, { kind: "marquee" }>,
    marquee: Rect | null
  ): void {
    // Selection only: the caller repaints unconditionally once the gesture ends.
    const threshold = screenPxToWorld(this.state.transform, MARQUEE_CLICK_PX);
    const area = marquee ?? { x: 0, y: 0, width: 0, height: 0 };
    const isClick = area.width <= threshold && area.height <= threshold;

    if (isClick) {
      // Empty-canvas click: replace the selection with nothing, or keep it under a modifier.
      if (!gesture.additive && this.state.selection.ids.length > 0) {
        this.callbacks.select(EMPTY_SELECTION);
      }
      return;
    }

    const hits = marqueeSelection(this.state.project, area);
    const ids = gesture.additive ? unionSelection(gesture.baseIds, hits) : hits;
    this.callbacks.select(selectionOf(ids));
  }

  private onPointerLeave = (): void => {
    if (this.gesture.kind !== "none") return;
    if (this.hoverCursor !== "default") {
      this.hoverCursor = "default";
      this.callbacks.setCursor("default");
    }
  };

  /**
   * Losing pointer capture mid-gesture cancels it. The release that follows a normal pointerup
   * arrives when the gesture is already finished, so this is a no-op in the happy path.
   */
  private onLostPointerCapture = (): void => {
    if (this.gesture.kind === "none") return;
    this.cancel();
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private edgeCursor(edge: ResizeEdge): string {
    if (edge === "left" || edge === "right") return "ew-resize";
    if (edge === "top" || edge === "bottom") return "ns-resize";
    return edge === "top-left" || edge === "bottom-right" ? "nwse-resize" : "nesw-resize";
  }
}
