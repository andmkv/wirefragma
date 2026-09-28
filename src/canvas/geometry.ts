/**
 * THE geometry model: one derivation from a WireframeElement to everything the editor needs.
 *
 * The renderer draws `bounds`, hit testing tests `hitRegions`, and the selection overlay draws
 * `resizeHandles` -- all from this single function, so rendering and interaction can never
 * disagree about where an element is (exactly the bug that motivated this subsystem).
 */

import { hitRectsFor, isBorderOnlyHit } from "../model/hitAreas";
import type { ElementType, WireframeElement, WireframeProject } from "../model/project";
import { effectiveLocked, effectiveVisible, elementsInDrawOrder } from "../model/project";
import type { Point, Rect, ViewTransform } from "./transform";
import { worldRectToScreen, worldToScreen } from "./transform";

export type ResizeEdge =
  | "left"
  | "right"
  | "top"
  | "bottom"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export const RESIZE_EDGES: ResizeEdge[] = [
  "top-left",
  "top",
  "top-right",
  "right",
  "bottom-right",
  "bottom",
  "bottom-left",
  "left"
];

/** Below this on-screen size an axis is too thin for its handles to be usable. */
export const MIN_AXIS_HANDLE_PX = 12;

/**
 * Which handles an element may offer, in the spirit of NEVERCAT's per-axis manipulation
 * capabilities: never draw (or hit-test) a handle that would swallow the element's own body.
 * A thin divider keeps its two end handles; a small button keeps its left/right handles until
 * it is zoomed in enough for the full set.
 */
export function resizeEdgesFor(screenWidth: number, screenHeight: number): ResizeEdge[] {
  const thinX = screenWidth < MIN_AXIS_HANDLE_PX;
  const thinY = screenHeight < MIN_AXIS_HANDLE_PX;
  if (thinX && thinY) return [];
  if (thinY) return ["left", "right"];
  if (thinX) return ["top", "bottom"];
  return RESIZE_EDGES;
}

/**
 * The handles one element actually offers.
 *
 * Border-only elements (Containers) are the exception: their hit area IS the border, so an
 * edge handle sitting on the border would swallow the only place the object can be grabbed.
 * A Container therefore resizes from its four corners and drags from the rest of its border
 * (and from its title label). Everything else keeps the full per-axis set.
 */
export function resizeEdgesForElement(element: WireframeElement, transform: ViewTransform): ResizeEdge[] {
  const edges = resizeEdgesFor(element.width * transform.scale, element.height * transform.scale);
  if (!isBorderOnlyHit(element.type)) return edges;
  return edges.filter((edge) => edge.includes("-"));
}

/** Visual size of a resize handle, in CSS pixels (never scaled with zoom). */
export const HANDLE_SIZE_PX = 9;
/** Grab tolerance around a handle, in CSS pixels. */
export const HANDLE_HIT_PX = 11;

/**
 * Grab tolerance for handles, in CSS pixels, never larger than ~a third of the element's
 * smaller on-screen dimension. Handles keep their fixed 9 px appearance at any zoom, but a
 * small element must stay draggable by its body instead of being swallowed by its own handles.
 */
export function handleHitTolerancePx(screenWidth: number, screenHeight: number): number {
  const smaller = Math.max(1, Math.min(screenWidth, screenHeight));
  return Math.max(2, Math.min(HANDLE_HIT_PX, smaller * 0.35));
}

export interface HandleGeometry {
  elementId: string;
  edge: ResizeEdge;
  /** Handle centre in world coordinates. */
  world: Point;
  /** Handle centre in canvas-local CSS pixels. */
  screen: Point;
  cursor: string;
}

export interface ElementGeometry {
  elementId: string;
  type: ElementType;
  /** Full element bounds in world coordinates. */
  bounds: Rect;
  /** Semantic selectable geometry in world coordinates. */
  hitRegions: Rect[];
  /** Handle anchors in world + screen space. */
  resizeHandles: HandleGeometry[];
}

const CURSORS: Record<ResizeEdge, string> = {
  left: "ew-resize",
  right: "ew-resize",
  top: "ns-resize",
  bottom: "ns-resize",
  "top-left": "nwse-resize",
  "top-right": "nesw-resize",
  "bottom-left": "nesw-resize",
  "bottom-right": "nwse-resize"
};

export function elementBounds(element: WireframeElement): Rect {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

export function handleWorldPoint(bounds: Rect, edge: ResizeEdge): Point {
  const midX = bounds.x + bounds.width / 2;
  const midY = bounds.y + bounds.height / 2;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  switch (edge) {
    case "left":
      return { x: bounds.x, y: midY };
    case "right":
      return { x: right, y: midY };
    case "top":
      return { x: midX, y: bounds.y };
    case "bottom":
      return { x: midX, y: bottom };
    case "top-left":
      return { x: bounds.x, y: bounds.y };
    case "top-right":
      return { x: right, y: bounds.y };
    case "bottom-left":
      return { x: bounds.x, y: bottom };
    case "bottom-right":
      return { x: right, y: bottom };
    default:
      return { x: midX, y: midY };
  }
}

/** Interaction geometry for one element. `transform.scale` only affects semantic hit padding. */
export function elementGeometry(
  element: WireframeElement,
  transform: ViewTransform
): ElementGeometry {
  const bounds = elementBounds(element);
  const hitRegions = hitRectsFor(element, transform.scale).map((region) => ({
    x: element.x + region.x,
    y: element.y + region.y,
    width: region.width,
    height: region.height
  }));
  const resizeHandles = resizeEdgesForElement(element, transform).map((edge) => {
    const world = handleWorldPoint(bounds, edge);
    return {
      elementId: element.id,
      edge,
      world,
      screen: worldToScreen(transform, world.x, world.y),
      cursor: CURSORS[edge]
    };
  });

  return { elementId: element.id, type: element.type, bounds, hitRegions, resizeHandles };
}

/** Canvas-side name for the model rule (element + ancestors + layer), kept for the call sites. */
export function isElementVisible(project: WireframeProject, element: WireframeElement): boolean {
  return effectiveVisible(project, element);
}

/** Canvas-side name for the model rule (element + ancestors + layer), kept for the call sites. */
export function isElementLocked(project: WireframeProject, element: WireframeElement): boolean {
  return effectiveLocked(project, element);
}

/**
 * Back-to-front geometry for every rendered element (the order the canvas paints in).
 * Hit testing walks this same array from the end, so paint order and hit order cannot drift.
 */
export function visibleGeometries(
  project: WireframeProject,
  transform: ViewTransform
): ElementGeometry[] {
  return elementsInDrawOrder(project)
    .filter((element) => isElementVisible(project, element))
    .map((element) => elementGeometry(element, transform));
}

/* ------------------------------------------------------------ nested scenes */

/** Height reserved above a titled Canvas scene for its title, in world units. */
export const SCENE_TITLE_HEIGHT = 18;

export interface SceneViewport {
  /** World position of the scene's (0, 0). */
  x: number;
  y: number;
  /** World units per scene unit (uniform: the scene is fitted, never distorted). */
  scale: number;
}

/**
 * Where a Canvas/Drawing scene sits inside its element: fitted (contain) and centred in the
 * bounds, below an optional title band. The stored scene coordinates are never rewritten by an
 * element resize — only this mapping changes.
 */
export function sceneViewport(
  bounds: Rect,
  scene: { width: number; height: number },
  reservedTop = 0
): SceneViewport {
  const inset = 4;
  const areaWidth = Math.max(1, bounds.width - inset * 2);
  const areaHeight = Math.max(1, bounds.height - inset * 2 - reservedTop);
  const scale = Math.max(0.0001, Math.min(areaWidth / scene.width, areaHeight / scene.height));
  return {
    x: bounds.x + inset + (areaWidth - scene.width * scale) / 2,
    y: bounds.y + inset + reservedTop + (areaHeight - scene.height * scale) / 2,
    scale
  };
}

/** On-screen size of the "no LLM description" warning badge on a Drawing, in CSS pixels. */
export const WARNING_BADGE_PX = 16;
const WARNING_BADGE_INSET_PX = 6;

/**
 * Screen rect (canvas-local CSS px) of a Drawing's warning badge: top-right corner, inset so it
 * never sits under a resize handle. The renderer draws it and the hover tooltip tests it from
 * this one function.
 */
export function warningBadgeRect(bounds: Rect, transform: ViewTransform): Rect {
  const screen = worldRectToScreen(transform, bounds);
  const size = Math.min(WARNING_BADGE_PX, Math.max(8, Math.min(screen.width, screen.height) - WARNING_BADGE_INSET_PX * 2));
  return {
    x: screen.x + screen.width - size - WARNING_BADGE_INSET_PX,
    y: screen.y + WARNING_BADGE_INSET_PX,
    width: size,
    height: size
  };
}
