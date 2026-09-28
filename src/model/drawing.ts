/**
 * Drawing — a freehand sketch element.
 *
 * Wirefragma knows which lines the user drew but not what they mean, so the LLM-facing export
 * carries only the human-written `description`; the strokes are stored (losslessly, as vectors,
 * never as a bitmap) purely so the project can be re-opened and edited after a round trip.
 *
 * Stroke points live in the drawing's own logical space (`width` × `height`), independent of the
 * element's bounds on the wireframe: resizing the element only changes how the scene is fitted.
 *
 * Pure data + pure helpers only (no DOM, no canvas).
 */

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  points: DrawingPoint[];
  /** Pen width in drawing units. */
  width: number;
}

export interface DrawingData {
  width: number;
  height: number;
  strokes: DrawingStroke[];
  /** Semantic stand-in for the sketch; without it the Drawing is left out of the LLM sections. */
  description?: string;
}

/** Pen widths offered by the drawing popup (thin / medium / thick). */
export const DRAWING_PEN_WIDTHS = [2, 4, 8] as const;
export const DEFAULT_DRAWING_PEN_WIDTH = 4;
export const DEFAULT_DRAWING_SIZE = { width: 480, height: 360 };
export const MIN_SCENE_SIZE = 40;
export const MAX_SCENE_SIZE = 4000;
const MAX_PEN_WIDTH = 64;

export function createDrawingData(size = DEFAULT_DRAWING_SIZE): DrawingData {
  return { width: size.width, height: size.height, strokes: [] };
}

/** True when the Drawing has an LLM description, i.e. it takes part in the LLM-facing export. */
export function hasDrawingDescription(data: DrawingData | undefined): boolean {
  return (data?.description ?? "").trim() !== "";
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to 0.1 units: plenty for a sketch and keeps the JSON compact. */
export function roundCoord(value: number): number {
  return Math.round(value * 10) / 10;
}

export function normalizeSceneSize(raw: Record<string, unknown>, fallback: { width: number; height: number }) {
  const width = finite(raw.width) ?? fallback.width;
  const height = finite(raw.height) ?? fallback.height;
  return {
    width: clamp(Math.round(width), MIN_SCENE_SIZE, MAX_SCENE_SIZE),
    height: clamp(Math.round(height), MIN_SCENE_SIZE, MAX_SCENE_SIZE)
  };
}

/** Validate + repair drawing data from untrusted input. Never throws. */
export function normalizeDrawingData(value: unknown): DrawingData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return createDrawingData();
  const raw = value as Record<string, unknown>;
  const size = normalizeSceneSize(raw, DEFAULT_DRAWING_SIZE);
  const strokes: DrawingStroke[] = [];
  if (Array.isArray(raw.strokes)) {
    for (const rawStroke of raw.strokes) {
      if (rawStroke === null || typeof rawStroke !== "object") continue;
      const stroke = rawStroke as Record<string, unknown>;
      if (!Array.isArray(stroke.points)) continue;
      const points: DrawingPoint[] = [];
      for (const rawPoint of stroke.points) {
        if (rawPoint === null || typeof rawPoint !== "object") continue;
        const x = finite((rawPoint as Record<string, unknown>).x);
        const y = finite((rawPoint as Record<string, unknown>).y);
        if (x !== null && y !== null) points.push({ x: roundCoord(x), y: roundCoord(y) });
      }
      if (points.length === 0) continue;
      const width = clamp(finite(stroke.width) ?? DEFAULT_DRAWING_PEN_WIDTH, 0.5, MAX_PEN_WIDTH);
      strokes.push({ points, width });
    }
  }
  const data: DrawingData = { ...size, strokes };
  const description = typeof raw.description === "string" ? raw.description.replace(/\r\n?/g, "\n") : "";
  if (description.trim()) data.description = description;
  return data;
}

function distanceToSegment(p: DrawingPoint, a: DrawingPoint, b: DrawingPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Does an eraser of `radius` at `point` touch this stroke? (Stroke-level eraser.) */
export function strokeHitsPoint(stroke: DrawingStroke, point: DrawingPoint, radius: number): boolean {
  const reach = radius + stroke.width / 2;
  if (stroke.points.length === 1) return Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y) <= reach;
  for (let index = 1; index < stroke.points.length; index += 1) {
    if (distanceToSegment(point, stroke.points[index - 1], stroke.points[index]) <= reach) return true;
  }
  return false;
}

/** The drawing without every stroke the eraser touches. Same object when nothing was erased. */
export function eraseAt(data: DrawingData, point: DrawingPoint, radius: number): DrawingData {
  const strokes = data.strokes.filter((stroke) => !strokeHitsPoint(stroke, point, radius));
  return strokes.length === data.strokes.length ? data : { ...data, strokes };
}
