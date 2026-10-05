/**
 * Canvas-edge resize maths (1.3.5). Pure functions: the DOM wiring lives in `components/CanvasEditor.tsx`.
 *
 * Dragging a canvas edge changes `project.canvas.width` / `height` only — elements are never moved,
 * scaled or deleted, and zoom is divided out by the caller before these functions see a delta.
 */

export type CanvasResizeEdge = "right" | "bottom" | "bottom-right";

export const CANVAS_RESIZE_EDGES: CanvasResizeEdge[] = ["right", "bottom", "bottom-right"];

export interface CanvasSize {
  width: number;
  height: number;
}

export interface CanvasResizeOptions {
  /** Snap the dragged edge to the grid (the toolbar "Snap" toggle). */
  snap: boolean;
  gridSize: number;
  min: number;
  max: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * New canvas size for a drag of `edge` by a world-space delta (`screen delta / zoom`).
 *
 * The *edge position* is snapped (so the resulting size lands on the grid when the start size
 * already did, exactly like an element resize), and the result is clamped to the canvas limits.
 * The un-dragged axes keep their start size.
 */
export function canvasSizeFromDrag(
  start: CanvasSize,
  delta: { dx: number; dy: number },
  edge: CanvasResizeEdge,
  options: CanvasResizeOptions
): CanvasSize {
  const snap = (value: number) =>
    options.snap ? Math.round(value / options.gridSize) * options.gridSize : Math.round(value);
  const width =
    edge === "bottom" ? start.width : clamp(snap(start.width + delta.dx), options.min, options.max);
  const height =
    edge === "right" ? start.height : clamp(snap(start.height + delta.dy), options.min, options.max);
  return { width, height };
}

/**
 * How many elements end up completely outside a canvas of this size.
 *
 * "Completely outside" means the element's bounds do not touch the canvas rectangle at all, so an
 * element that merely hangs over an edge is not reported. Nothing is ever deleted — the editor
 * shows this count in a non-blocking toast so the user can decide.
 */
export function elementsOutsideCanvas(
  elements: readonly { x: number; y: number; width: number; height: number }[],
  width: number,
  height: number
): number {
  return elements.filter(
    (element) =>
      element.x + element.width <= 0 ||
      element.x >= width ||
      element.y + element.height <= 0 ||
      element.y >= height
  ).length;
}
