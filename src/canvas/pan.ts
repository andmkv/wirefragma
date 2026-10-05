/**
 * View-only panning / pinch maths for the scrollable canvas viewport.
 *
 * Panning never touches the document, the transformer or the hit test: it only moves the
 * `scrollLeft` / `scrollTop` of `.canvas-viewport` (the element the canvas frame lives in).
 * Everything arithmetic lives here so it can be unit-tested without a DOM; the wiring lives in
 * `components/CanvasEditor.tsx`.
 *
 * The one rule that shapes the maths: **the content follows the pointer**. Dragging the canvas
 * to the right shows content further to the left, i.e. the scroll offset *decreases*.
 */

export interface ScrollPosition {
  left: number;
  top: number;
}

export interface PanDelta {
  dx: number;
  dy: number;
}

export interface TouchPoint {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Apply a pointer delta to a scroll offset.
 *
 * Callers pass the *previous* scroll position and the delta since the previous move, which keeps
 * the gesture correct even when the browser clamps the scroll at the content edges (a
 * start-to-current calculation would drift there).
 */
export function panScroll(start: ScrollPosition, delta: PanDelta): ScrollPosition {
  return { left: start.left - delta.dx, top: start.top - delta.dy };
}

/** Centre of one or more touch points; `{x: 0, y: 0}` when there are none. */
export function touchCentroid(points: TouchPoint[]): TouchPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Distance between the first two touch points (0 when fewer than two are given). */
export function touchDistance(points: TouchPoint[]): number {
  if (points.length < 2) return 0;
  const [a, b] = points;
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Scale for a two-finger pinch, measured against the distance captured at gesture start, then
 * clamped to the editor's zoom range. A degenerate start distance keeps the scale unchanged
 * instead of dividing by zero.
 */
export function pinchScale(
  startScale: number,
  startDistance: number,
  currentDistance: number,
  minScale: number,
  maxScale: number
): number {
  if (!(startDistance > 0) || !Number.isFinite(currentDistance)) return clamp(startScale, minScale, maxScale);
  return clamp(startScale * (currentDistance / startDistance), minScale, maxScale);
}

/**
 * Where a content point must be scrolled to so that it sits under `pointer` at `scale`.
 * `canvasLeft` / `canvasTop` are the canvas' current viewport position (from
 * `getBoundingClientRect`); the result is the desired `scrollLeft` / `scrollTop` of the viewport.
 */
export function anchorScrollFor(
  pointer: TouchPoint,
  content: TouchPoint,
  scale: number,
  canvasLeft: number,
  canvasTop: number,
  scroll: ScrollPosition
): ScrollPosition {
  return {
    left: scroll.left + (pointer.x - content.x * scale - canvasLeft),
    top: scroll.top + (pointer.y - content.y * scale - canvasTop)
  };
}
