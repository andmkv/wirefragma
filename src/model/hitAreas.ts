import type { ElementType, WireframeElement } from "./project";

/**
 * Semantic hit areas.
 *
 * Elements are not uniformly a rectangle: a Container's empty interior must let clicks
 * through to whatever is behind it (or to its own children in front), and a Divider is a
 * line rather than a box. Everything else uses its visible bounds.
 *
 * All rectangles are in element-local logical coordinates.
 */

export interface HitRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Forgiving, screen-pixel sized border band for structural elements. */
export const CONTAINER_BORDER_HIT_PX = 9;
export const DIVIDER_HIT_PX = 14;

export function isBorderOnlyHit(type: ElementType): boolean {
  return type === "container";
}

function clampBand(value: number, limit: number): number {
  return Math.max(1, Math.min(value, Math.max(1, limit)));
}

export function hitRectsFor(element: WireframeElement, scale: number): HitRect[] {
  const safeScale = scale > 0 ? scale : 1;
  const width = Math.max(1, element.width);
  const height = Math.max(1, element.height);

  if (element.type === "container") {
    const band = clampBand(CONTAINER_BORDER_HIT_PX / safeScale, Math.min(width, height) / 2);
    const rects: HitRect[] = [
      { x: 0, y: 0, width, height: Math.min(band, height) },
      { x: 0, y: Math.max(0, height - band), width, height: Math.min(band, height) },
      { x: 0, y: 0, width: Math.min(band, width), height },
      { x: Math.max(0, width - band), y: 0, width: Math.min(band, width), height }
    ];

    // A labelled container is also selectable through its label.
    const label = (element.label ?? "").trim();
    if (label) {
      const labelWidth = Math.min(width, Math.max(24, label.length * 7 + 16));
      const labelHeight = clampBand(20 / safeScale, height);
      rects.push({ x: 0, y: 0, width: labelWidth, height: labelHeight });
    }
    return rects;
  }

  if (element.type === "divider") {
    const band = Math.max(height, DIVIDER_HIT_PX / safeScale);
    return [{ x: 0, y: (height - band) / 2, width, height: band }];
  }

  return [{ x: 0, y: 0, width, height }];
}

/** Point-in-hit-area test used by tests and by the self-test harness. */
export function hitsAt(rects: HitRect[], x: number, y: number): boolean {
  return rects.some(
    (rect) =>
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
  );
}

/** Does a point in canvas coordinates land inside this element's selectable geometry? */
export function pointHitsElement(
  element: WireframeElement,
  scale: number,
  canvasX: number,
  canvasY: number
): boolean {
  return hitsAt(hitRectsFor(element, scale), canvasX - element.x, canvasY - element.y);
}

/**
 * The element a canvas click should select: the front-most (top of the draw order) unlocked,
 * visible element whose *semantic* hit area contains the point.
 */
export function topmostHit(
  elementsBackToFront: WireframeElement[],
  scale: number,
  canvasX: number,
  canvasY: number,
  isSelectable: (element: WireframeElement) => boolean = () => true
): WireframeElement | null {
  for (let index = elementsBackToFront.length - 1; index >= 0; index -= 1) {
    const element = elementsBackToFront[index];
    if (!isSelectable(element)) continue;
    if (pointHitsElement(element, scale, canvasX, canvasY)) return element;
  }
  return null;
}
