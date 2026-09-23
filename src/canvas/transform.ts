/**
 * THE world <-> screen conversion layer (the one place coordinates change meaning).
 *
 * Ported from NEVERCAT's `core/viewport.ts`: one explicit transform used by rendering, hit
 * testing, handles, dragging and resizing. Wirefragma keeps its own axis convention --
 * logical/project coordinates are already Y-down, so there is no axis flip anywhere.
 *
 *   world  = logical project units from the document model (WireframeElement.x/y/width/height)
 *   screen = CSS pixels inside the canvas element
 *   device = screen * devicePixelRatio (the canvas backing store)
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewTransform {
  /** CSS pixels per logical unit. */
  scale: number;
  /** Screen position (CSS px, canvas-local) of world (0,0). */
  originX: number;
  originY: number;
}

export function createTransform(scale: number, originX = 0, originY = 0): ViewTransform {
  return { scale: scale > 0 ? scale : 1, originX, originY };
}

export function worldToScreen(t: ViewTransform, x: number, y: number): Point {
  return { x: t.originX + x * t.scale, y: t.originY + y * t.scale };
}

export function screenToWorld(t: ViewTransform, x: number, y: number): Point {
  return { x: (x - t.originX) / t.scale, y: (y - t.originY) / t.scale };
}

export function worldRectToScreen(t: ViewTransform, rect: Rect): Rect {
  return {
    x: t.originX + rect.x * t.scale,
    y: t.originY + rect.y * t.scale,
    width: rect.width * t.scale,
    height: rect.height * t.scale
  };
}

/** Screen size of a world size (used for overlay/handle geometry). */
export function worldSizeToScreen(t: ViewTransform, size: Size): Size {
  return { width: size.width * t.scale, height: size.height * t.scale };
}

/** Screen pixels expressed in world units -- the tolerance conversion handles rely on. */
export function screenPxToWorld(t: ViewTransform, px: number): number {
  return px / t.scale;
}

/** Canvas 2D transform matrix for drawing directly in world coordinates. */
export function deviceMatrix(
  t: ViewTransform,
  dpr: number
): [number, number, number, number, number, number] {
  const s = t.scale * dpr;
  return [s, 0, 0, s, t.originX * dpr, t.originY * dpr];
}

export function rectContains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

export function round(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const result = Math.round(value * factor) / factor;
  return Object.is(result, -0) ? 0 : result;
}
