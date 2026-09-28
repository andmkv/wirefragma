/**
 * Canvas element ("diagram" internally, "Canvas" in the UI) — a small structured scene.
 *
 * Unlike a Drawing, Wirefragma knows exactly what a Canvas contains: a short list of primitive
 * shapes (rectangle, ellipse, line, arrow, bezier, text) with optional labels. That is what makes
 * it fully LLM-readable without vision — nested ASCII, a primitive list and deterministic
 * relationships are all derived from this data.
 *
 * Internal objects are NOT wireframe elements: they never appear in the Layers panel, and they
 * live in the scene's own logical coordinate space (`width` × `height`). Resizing the Canvas
 * element on the wireframe only changes how the scene is fitted, never the stored coordinates.
 *
 * This module is the ONE geometry + hit test for scene objects; the Canvas popup editor, the
 * renderer and the exporters all read it. Pure data + pure helpers only (no DOM, no canvas).
 */

import { normalizeSceneSize, roundCoord } from "./drawing";

export const DIAGRAM_OBJECT_TYPES = ["rectangle", "ellipse", "line", "arrow", "bezier", "text"] as const;
export type DiagramObjectType = (typeof DIAGRAM_OBJECT_TYPES)[number];

export interface DiagramPoint {
  x: number;
  y: number;
}

interface DiagramObjectBase {
  id: string;
  /** Optional semantic label (for `text` it is the text itself). */
  label?: string;
}

export interface DiagramBox extends DiagramObjectBase {
  type: "rectangle" | "ellipse" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagramSegment extends DiagramObjectBase {
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DiagramBezier extends DiagramObjectBase {
  type: "bezier";
  start: DiagramPoint;
  control1: DiagramPoint;
  control2: DiagramPoint;
  end: DiagramPoint;
}

export type DiagramObject = DiagramBox | DiagramSegment | DiagramBezier;

export interface DiagramData {
  width: number;
  height: number;
  /** Optional LLM description of the whole scene. */
  description?: string;
  /** Back-to-front paint order (creation order unless reordered). */
  objects: DiagramObject[];
}

export interface DiagramRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_DIAGRAM_SIZE = { width: 600, height: 400 };
export const MIN_DIAGRAM_OBJECT_SIZE = 4;

export const DIAGRAM_TYPE_LABEL: Record<DiagramObjectType, string> = {
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  bezier: "Bezier",
  text: "Text"
};

const ID_PREFIX: Record<DiagramObjectType, string> = {
  rectangle: "rect",
  ellipse: "ellipse",
  line: "line",
  arrow: "arrow",
  bezier: "curve",
  text: "text"
};

export function createDiagramData(size = DEFAULT_DIAGRAM_SIZE): DiagramData {
  return { width: size.width, height: size.height, objects: [] };
}

export function isBoxObject(object: DiagramObject): object is DiagramBox {
  return object.type === "rectangle" || object.type === "ellipse" || object.type === "text";
}

/** `rect1`, `rect2`, … unique inside one scene. */
export function nextDiagramObjectId(data: DiagramData, type: DiagramObjectType): string {
  const taken = new Set(data.objects.map((object) => object.id));
  let counter = 1;
  while (taken.has(`${ID_PREFIX[type]}${counter}`)) counter += 1;
  return `${ID_PREFIX[type]}${counter}`;
}

export function objectLabel(object: DiagramObject): string {
  return (object.label ?? "").replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ normalization */

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function point(value: unknown): DiagramPoint | null {
  if (value === null || typeof value !== "object") return null;
  const x = finite((value as Record<string, unknown>).x);
  const y = finite((value as Record<string, unknown>).y);
  return x === null || y === null ? null : { x: roundCoord(x), y: roundCoord(y) };
}

function normalizeObject(value: unknown): DiagramObject | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = raw.type;
  const id = typeof raw.id === "string" ? raw.id.trim() : "";
  const label = typeof raw.label === "string" ? raw.label.replace(/\r\n?/g, "\n") : "";
  const withLabel = <T extends DiagramObject>(object: T): T => {
    if (label.trim()) object.label = label;
    return object;
  };

  if (type === "rectangle" || type === "ellipse" || type === "text") {
    const x = finite(raw.x);
    const y = finite(raw.y);
    if (x === null || y === null) return null;
    return withLabel<DiagramBox>({
      id,
      type,
      x: roundCoord(x),
      y: roundCoord(y),
      width: Math.max(MIN_DIAGRAM_OBJECT_SIZE, roundCoord(finite(raw.width) ?? 100)),
      height: Math.max(MIN_DIAGRAM_OBJECT_SIZE, roundCoord(finite(raw.height) ?? (type === "text" ? 24 : 60)))
    });
  }
  if (type === "line" || type === "arrow") {
    const x1 = finite(raw.x1);
    const y1 = finite(raw.y1);
    const x2 = finite(raw.x2);
    const y2 = finite(raw.y2);
    if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
    return withLabel<DiagramSegment>({
      id,
      type,
      x1: roundCoord(x1),
      y1: roundCoord(y1),
      x2: roundCoord(x2),
      y2: roundCoord(y2)
    });
  }
  if (type === "bezier") {
    const start = point(raw.start);
    const end = point(raw.end);
    if (!start || !end) return null;
    // Missing controls degrade to a straight curve rather than dropping the object.
    const control1 = point(raw.control1) ?? { ...start };
    const control2 = point(raw.control2) ?? { ...end };
    return withLabel<DiagramBezier>({ id, type, start, control1, control2, end });
  }
  return null;
}

/** Validate + repair scene data from untrusted input. Never throws; unknown objects are dropped. */
export function normalizeDiagramData(value: unknown): DiagramData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return createDiagramData();
  const raw = value as Record<string, unknown>;
  const data: DiagramData = { ...normalizeSceneSize(raw, DEFAULT_DIAGRAM_SIZE), objects: [] };
  if (Array.isArray(raw.objects)) {
    for (const rawObject of raw.objects) {
      const object = normalizeObject(rawObject);
      if (!object) continue;
      if (!object.id || data.objects.some((existing) => existing.id === object.id)) {
        object.id = nextDiagramObjectId(data, object.type);
      }
      data.objects.push(object);
    }
  }
  const description = typeof raw.description === "string" ? raw.description.replace(/\r\n?/g, "\n") : "";
  if (description.trim()) data.description = description;
  return data;
}

/* ------------------------------------------------------------------ geometry */

export function bezierPoint(curve: DiagramBezier, t: number): DiagramPoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * curve.start.x + b * curve.control1.x + c * curve.control2.x + d * curve.end.x,
    y: a * curve.start.y + b * curve.control1.y + c * curve.control2.y + d * curve.end.y
  };
}

/** The curve as a polyline (used for bounds, hit testing and the ASCII sketch). */
export function bezierSamples(curve: DiagramBezier, segments = 32): DiagramPoint[] {
  const points: DiagramPoint[] = [];
  for (let index = 0; index <= segments; index += 1) points.push(bezierPoint(curve, index / segments));
  return points;
}

/** Start and end of a connector (line, arrow, bezier); null for boxes. */
export function connectorEnds(object: DiagramObject): { start: DiagramPoint; end: DiagramPoint } | null {
  if (object.type === "line" || object.type === "arrow") {
    return { start: { x: object.x1, y: object.y1 }, end: { x: object.x2, y: object.y2 } };
  }
  if (object.type === "bezier") return { start: object.start, end: object.end };
  return null;
}

function rectOfPoints(points: DiagramPoint[]): DiagramRect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Axis-aligned bounds of one object in scene coordinates. */
export function diagramObjectBounds(object: DiagramObject): DiagramRect {
  if (isBoxObject(object)) return { x: object.x, y: object.y, width: object.width, height: object.height };
  if (object.type === "bezier") return rectOfPoints(bezierSamples(object));
  return rectOfPoints([
    { x: object.x1, y: object.y1 },
    { x: object.x2, y: object.y2 }
  ]);
}

function distanceToSegment(p: DiagramPoint, a: DiagramPoint, b: DiagramPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function distanceToPolyline(p: DiagramPoint, points: DiagramPoint[]): number {
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, distanceToSegment(p, points[index - 1], points[index]));
  }
  return best;
}

export function rectContainsPoint(rect: DiagramRect, p: DiagramPoint, tolerance = 0): boolean {
  return (
    p.x >= rect.x - tolerance &&
    p.x <= rect.x + rect.width + tolerance &&
    p.y >= rect.y - tolerance &&
    p.y <= rect.y + rect.height + tolerance
  );
}

/** Does the point land on the object's stroke/outline (or a text box)? */
function hitsOutline(object: DiagramObject, p: DiagramPoint, tolerance: number): boolean {
  switch (object.type) {
    case "text":
      return rectContainsPoint(object, p, tolerance);
    case "rectangle": {
      if (!rectContainsPoint(object, p, tolerance)) return false;
      const inner = {
        x: object.x + tolerance,
        y: object.y + tolerance,
        width: object.width - tolerance * 2,
        height: object.height - tolerance * 2
      };
      return inner.width <= 0 || inner.height <= 0 || !rectContainsPoint(inner, p);
    }
    case "ellipse": {
      const rx = object.width / 2;
      const ry = object.height / 2;
      const nx = (p.x - (object.x + rx)) / Math.max(rx, 0.001);
      const ny = (p.y - (object.y + ry)) / Math.max(ry, 0.001);
      return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= tolerance;
    }
    case "line":
    case "arrow":
      return distanceToSegment(p, { x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }) <= tolerance;
    case "bezier":
      return distanceToPolyline(p, bezierSamples(object)) <= tolerance;
  }
}

function hitsInterior(object: DiagramObject, p: DiagramPoint): boolean {
  if (object.type === "rectangle") return rectContainsPoint(object, p);
  if (object.type === "ellipse") {
    const rx = object.width / 2;
    const ry = object.height / 2;
    const nx = (p.x - (object.x + rx)) / Math.max(rx, 0.001);
    const ny = (p.y - (object.y + ry)) / Math.max(ry, 0.001);
    return nx * nx + ny * ny <= 1;
  }
  return false;
}

/**
 * The object a click at `p` selects, front-most first. Outlines, connectors and text win over
 * shape interiors, so a big rectangle drawn last never swallows the small shapes inside it.
 */
export function hitDiagramObject(data: DiagramData, p: DiagramPoint, tolerance: number): DiagramObject | null {
  for (let index = data.objects.length - 1; index >= 0; index -= 1) {
    if (hitsOutline(data.objects[index], p, tolerance)) return data.objects[index];
  }
  for (let index = data.objects.length - 1; index >= 0; index -= 1) {
    if (hitsInterior(data.objects[index], p)) return data.objects[index];
  }
  return null;
}

/* ------------------------------------------------------------------ handles + edits */

export type DiagramHandleId = "nw" | "ne" | "sw" | "se" | "start" | "end" | "control1" | "control2";

export interface DiagramHandle {
  id: DiagramHandleId;
  x: number;
  y: number;
}

/** The editable points of an object — drawn and grabbed from this one list. */
export function diagramHandles(object: DiagramObject): DiagramHandle[] {
  if (isBoxObject(object)) {
    const right = object.x + object.width;
    const bottom = object.y + object.height;
    return [
      { id: "nw", x: object.x, y: object.y },
      { id: "ne", x: right, y: object.y },
      { id: "sw", x: object.x, y: bottom },
      { id: "se", x: right, y: bottom }
    ];
  }
  if (object.type === "bezier") {
    return [
      { id: "start", ...object.start },
      { id: "control1", ...object.control1 },
      { id: "control2", ...object.control2 },
      { id: "end", ...object.end }
    ];
  }
  return [
    { id: "start", x: object.x1, y: object.y1 },
    { id: "end", x: object.x2, y: object.y2 }
  ];
}

export function hitDiagramHandle(object: DiagramObject, p: DiagramPoint, tolerance: number): DiagramHandleId | null {
  // Last handle first: a bezier's end handle wins over a control handle sitting on top of it.
  const handles = diagramHandles(object);
  for (let index = handles.length - 1; index >= 0; index -= 1) {
    const handle = handles[index];
    if (Math.abs(handle.x - p.x) <= tolerance && Math.abs(handle.y - p.y) <= tolerance) return handle.id;
  }
  return null;
}

/** Box from two corners, normalized and at least MIN_DIAGRAM_OBJECT_SIZE. */
export function boxFromCorners(a: DiagramPoint, b: DiagramPoint): DiagramRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x: roundCoord(x),
    y: roundCoord(y),
    width: roundCoord(Math.max(MIN_DIAGRAM_OBJECT_SIZE, Math.abs(a.x - b.x))),
    height: roundCoord(Math.max(MIN_DIAGRAM_OBJECT_SIZE, Math.abs(a.y - b.y)))
  };
}

/** The object with one handle moved to `p` (from the untouched pointerdown snapshot). */
export function moveDiagramHandle(object: DiagramObject, handle: DiagramHandleId, p: DiagramPoint): DiagramObject {
  const q = { x: roundCoord(p.x), y: roundCoord(p.y) };
  if (isBoxObject(object)) {
    const right = object.x + object.width;
    const bottom = object.y + object.height;
    const opposite: Record<string, DiagramPoint> = {
      nw: { x: right, y: bottom },
      ne: { x: object.x, y: bottom },
      sw: { x: right, y: object.y },
      se: { x: object.x, y: object.y }
    };
    const anchor = opposite[handle];
    return anchor ? { ...object, ...boxFromCorners(anchor, q) } : object;
  }
  if (object.type === "bezier") {
    if (handle === "start" || handle === "end" || handle === "control1" || handle === "control2") {
      return { ...object, [handle]: q };
    }
    return object;
  }
  if (handle === "start") return { ...object, x1: q.x, y1: q.y };
  if (handle === "end") return { ...object, x2: q.x, y2: q.y };
  return object;
}

export function translateDiagramObject(object: DiagramObject, dx: number, dy: number): DiagramObject {
  const shift = (p: DiagramPoint) => ({ x: roundCoord(p.x + dx), y: roundCoord(p.y + dy) });
  if (isBoxObject(object)) return { ...object, x: roundCoord(object.x + dx), y: roundCoord(object.y + dy) };
  if (object.type === "bezier") {
    return {
      ...object,
      start: shift(object.start),
      control1: shift(object.control1),
      control2: shift(object.control2),
      end: shift(object.end)
    };
  }
  return {
    ...object,
    x1: roundCoord(object.x1 + dx),
    y1: roundCoord(object.y1 + dy),
    x2: roundCoord(object.x2 + dx),
    y2: roundCoord(object.y2 + dy)
  };
}

/** A new object of `type` spanning the drag from `a` to `b` (scene coordinates). */
export function createDiagramObject(
  data: DiagramData,
  type: DiagramObjectType,
  a: DiagramPoint,
  b: DiagramPoint
): DiagramObject {
  const id = nextDiagramObjectId(data, type);
  const p = { x: roundCoord(a.x), y: roundCoord(a.y) };
  const q = { x: roundCoord(b.x), y: roundCoord(b.y) };
  if (type === "rectangle" || type === "ellipse" || type === "text") {
    return { id, type, ...boxFromCorners(p, q), ...(type === "text" ? { label: "Text" } : {}) };
  }
  if (type === "bezier") {
    // Default controls bow the curve sideways, so a fresh curve visibly is one.
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const bow = Math.max(24, Math.hypot(dx, dy) * 0.35);
    const length = Math.max(1, Math.hypot(dx, dy));
    const nx = (-dy / length) * bow;
    const ny = (dx / length) * bow;
    return {
      id,
      type,
      start: p,
      control1: { x: roundCoord(p.x + dx / 3 + nx), y: roundCoord(p.y + dy / 3 + ny) },
      control2: { x: roundCoord(p.x + (dx * 2) / 3 - nx), y: roundCoord(p.y + (dy * 2) / 3 - ny) },
      end: q
    };
  }
  return { id, type, x1: p.x, y1: p.y, x2: q.x, y2: q.y };
}

/** Swap an object one step forward (+1) or backward (-1) in the scene's paint order. */
export function reorderDiagramObject(data: DiagramData, id: string, direction: 1 | -1): DiagramData {
  const index = data.objects.findIndex((object) => object.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= data.objects.length) return data;
  const objects = [...data.objects];
  [objects[index], objects[target]] = [objects[target], objects[index]];
  return { ...data, objects };
}
