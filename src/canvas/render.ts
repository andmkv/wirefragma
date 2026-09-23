/**
 * Canvas 2D renderer for the wireframe document.
 *
 * Ported from NEVERCAT's `canvas/renderer.ts` in spirit: it draws a projection of the model
 * through the single `ViewTransform`, owns no editable state, and draws editor chrome
 * (selection outline + handles) separately from the document so a selected object is never
 * covered by its own controls.
 *
 * All geometry comes from `geometry.ts`, so what is drawn and what is hit-tested cannot drift.
 */

import type { WireframeElement, WireframeProject } from "../model/project";
import { contentSizeOf, elementsInDrawOrder, textStyleOf } from "../model/project";
import {
  HANDLE_SIZE_PX,
  elementGeometry,
  isElementLocked,
  isElementVisible,
  type ResizeEdge
} from "./geometry";
import {
  deviceMatrix,
  worldRectToScreen,
  type Rect,
  type ViewTransform
} from "./transform";

export const COLORS = {
  ink: "#1f2429",
  line: "#4d5761",
  soft: "#98a2b3",
  panel: "#f4f5f7",
  panelAlt: "#eceef2",
  surface: "#ffffff",
  accent: "#2f6fed",
  grid: "#e7e9ee",
  hairline: "#e3e6ea",
  locked: "#9aa3af"
};

export const FONT_FAMILY =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/**
 * Emoji/system-symbol fallback for Icon and Image labels. The glyphs come from the platform,
 * never from bundled artwork, so `🚀` and `🐱` render in colour without a dependency.
 */
export const EMOJI_FONT_FAMILY =
  "'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', 'EmojiOne Color', " +
  FONT_FAMILY;

/** Preview of the element being dragged/resized (never written to the model mid-gesture). */
export interface PreviewOverride {
  elementId: string;
  bounds: Rect;
}

export interface SceneInput {
  project: WireframeProject;
  transform: ViewTransform;
  dpr: number;
  showGrid: boolean;
  gridSize: number;
  selectedIds: string[];
  primarySelectedId: string | null;
  /** Per-element position overrides while dragging/resizing. */
  preview: PreviewOverride[] | null;
  /** Rubber-band rectangle in world coordinates while marquee-selecting. */
  marquee: Rect | null;
  activeEdge: ResizeEdge | null;
}

interface DrawContext {
  ctx: CanvasRenderingContext2D;
  /** One screen pixel expressed in world units. */
  px: number;
}

/* ------------------------------------------------------------------ helpers */

function worldFont(size: number, weight = 400, italic = false, family = FONT_FAMILY): string {
  return `${italic ? "italic " : ""}${weight} ${size}px ${family}`;
}

interface RectStyle {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  radius?: number;
  dash?: number[];
}

function drawRect(c: DrawContext, rect: Rect, style: RectStyle = {}): void {
  const { ctx, px } = c;
  ctx.beginPath();
  const radius = Math.max(0, style.radius ?? 0);
  if (radius > 0 && typeof ctx.roundRect === "function") {
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  } else {
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
  }
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (style.stroke) {
    ctx.setLineDash((style.dash ?? []).map((value) => value * px));
    ctx.lineWidth = (style.lineWidth ?? 1) * px;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawLine(c: DrawContext, x1: number, y1: number, x2: number, y2: number, color: string, width = 1): void {
  const { ctx, px } = c;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width * px;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function ellipse(c: DrawContext, cx: number, cy: number, r: number, style: { fill?: string; stroke?: string; lineWidth?: number }): void {
  const { ctx, px } = c;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.5, r), 0, Math.PI * 2);
  if (style.fill) {
    ctx.fillStyle = style.fill;
    ctx.fill();
  }
  if (style.stroke) {
    ctx.lineWidth = (style.lineWidth ?? 1) * px;
    ctx.strokeStyle = style.stroke;
    ctx.stroke();
  }
}

/* ------------------------------------------------------- unicode-safe truncation */

interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}

type SegmenterCtor = new (
  locales?: string | string[],
  options?: { granularity: "grapheme" }
) => GraphemeSegmenter;

let cachedSegmenter: GraphemeSegmenter | null | undefined;

/** `Intl.Segmenter` when the runtime has it; otherwise code points via `Array.from`. */
function graphemeSegmenter(): GraphemeSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  const ctor = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (typeof ctor !== "function") {
    cachedSegmenter = null;
    return cachedSegmenter;
  }
  try {
    cachedSegmenter = new ctor(undefined, { granularity: "grapheme" });
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/**
 * Split text into user-perceived characters, so truncation can never cut a surrogate pair, a
 * combining mark, a ZWJ sequence (`👨‍👩‍👧`) or a regional-indicator flag (`🇸🇮`) in half.
 */
export function splitGraphemes(text: string): string[] {
  const segmenter = graphemeSegmenter();
  if (!segmenter) return Array.from(text);
  const parts: string[] = [];
  for (const part of segmenter.segment(text)) parts.push(part.segment);
  return parts;
}

/**
 * Truncate to fit a width, appending an ellipsis. Always removes whole grapheme clusters, so the
 * result stays well-formed Unicode: `🚀` clipped in a narrow box becomes `…`, never a lone
 * surrogate rendered as U+FFFD.
 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  const clusters = splitGraphemes(text);
  for (let keep = clusters.length - 1; keep >= 1; keep -= 1) {
    const candidate = `${clusters.slice(0, keep).join("")}…`;
    if (ctx.measureText(candidate).width <= maxWidth) return candidate;
  }
  // Nothing but the ellipsis fits (a single symbol wider than the box, or an extreme zoom-out).
  return "…";
}

interface TextStyle {
  size?: number;
  weight?: number;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  ellipsis?: boolean;
  fontFamily?: string;
}

function drawText(c: DrawContext, text: string, rect: Rect, style: TextStyle = {}): void {
  if (!text) return;
  const { ctx, px } = c;
  const size = style.size ?? 13;
  ctx.font = worldFont(size, style.weight ?? 400, style.italic === true, style.fontFamily);
  ctx.fillStyle = style.color ?? COLORS.ink;
  ctx.textBaseline = "middle";
  const content = style.ellipsis === false ? text : fitText(ctx, text, rect.width);
  if (!content) return;
  ctx.textAlign = style.align ?? "left";
  const x =
    style.align === "center"
      ? rect.x + rect.width / 2
      : style.align === "right"
        ? rect.x + rect.width
        : rect.x;
  const y =
    style.valign === "top"
      ? rect.y + size * 0.65
      : style.valign === "bottom"
        ? rect.y + rect.height - size * 0.65
        : rect.y + rect.height / 2;
  ctx.fillText(content, x, y);

  if (style.underline) {
    const textWidth = ctx.measureText(content).width;
    const underlineX =
      style.align === "center"
        ? x - textWidth / 2
        : style.align === "right"
          ? x - textWidth
          : x;
    ctx.beginPath();
    ctx.moveTo(underlineX, y + size * 0.38);
    ctx.lineTo(underlineX + textWidth, y + size * 0.38);
    ctx.lineWidth = Math.max(size / 16, px);
    ctx.strokeStyle = style.color ?? COLORS.ink;
    ctx.stroke();
  }
}

/* --------------------------------------------------------------- element art */

function drawElement(c: DrawContext, element: WireframeElement, bounds: Rect, showLabel: boolean): void {
  const { x, y, width, height } = bounds;
  const label = element.label ?? "";
  const items = element.items ?? [];
  const columns = element.columns ?? [];

  switch (element.type) {
    case "container":
      drawRect(c, bounds, { fill: "rgba(255,255,255,0.55)", stroke: COLORS.line, dash: [6, 4] });
      if (showLabel && label) {
        drawText(c, label, { x: x + 6, y: y + 4, width: Math.max(0, width - 12), height: 14 }, { size: 11, color: COLORS.soft });
      }
      return;

    case "toolbar":
      drawRect(c, bounds, { fill: COLORS.panel, stroke: COLORS.line });
      drawText(c, label, { x: x + 12, y, width: Math.max(0, width - 24), height }, { size: 15, weight: 600 });
      return;

    case "sidebar": {
      drawRect(c, bounds, { fill: "#fbfbfc", stroke: COLORS.line });
      drawText(c, label, { x: x + 14, y: y + 12, width: Math.max(0, width - 28), height: 18 }, { size: 12, weight: 600, color: COLORS.soft });
      const rowHeight = 28;
      const top = y + 42;
      items.forEach((item, index) => {
        const rowY = top + index * rowHeight;
        if (rowY + rowHeight > y + height) return;
        if (index === 0) {
          drawRect(c, { x: x + 6, y: rowY - 4, width: Math.max(0, width - 12), height: rowHeight }, { fill: COLORS.panelAlt, radius: 4 });
        }
        drawText(c, item, { x: x + 16, y: rowY, width: Math.max(0, width - 30), height: 20 }, { size: 14, color: index === 0 ? COLORS.ink : "#5b6470" });
      });
      return;
    }

    case "bottomNav": {
      const entries = items.length ? items : ["Home", "Search", "Profile"];
      drawRect(c, bounds, { fill: COLORS.panel, stroke: COLORS.line });
      const segment = width / entries.length;
      entries.forEach((item, index) => {
        const cellX = x + index * segment;
        const circleY = y + height * 0.28;
        ellipse(c, cellX + segment / 2, circleY, Math.max(3, Math.min(7, height * 0.12)), {
          fill: index === 0 ? COLORS.line : COLORS.soft
        });
        drawText(c, item, { x: cellX, y: y + height * 0.34, width: segment, height: height * 0.6 }, {
          size: 11,
          align: "center",
          color: index === 0 ? COLORS.ink : "#6b7280"
        });
        if (index === 0) drawLine(c, cellX + segment * 0.2, y, cellX + segment * 0.8, y, COLORS.ink, 2);
      });
      return;
    }

    case "dialog":
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 6 });
      drawText(c, label || "Dialog", { x: x + 14, y: y + 12, width: Math.max(0, width - 28), height: 20 }, { size: 13, weight: 600 });
      drawLine(c, x, y + 40, x + width, y + 40, COLORS.hairline, 1);
      return;

    case "text": {
      // The element's own width is the alignment area; the style carries size/weight/style/align.
      const style = textStyleOf(element);
      drawText(c, label, bounds, {
        size: style.fontSize,
        weight: style.bold ? 700 : 400,
        italic: style.italic,
        underline: style.underline,
        align: style.align
      });
      return;
    }

    case "image": {
      drawRect(c, bounds, { fill: "#fafbfc", stroke: COLORS.line });
      const symbol = label.trim();
      if (symbol) {
        // A labelled Image is a picture placeholder: the label (usually an emoji) IS the artwork.
        // Symbols are drawn at their configured content size and are never ellipsised — a clipped
        // emoji would be worse than one that overflows its box.
        drawText(c, symbol, bounds, {
          size: contentSizeOf(element),
          align: "center",
          fontFamily: EMOJI_FONT_FAMILY,
          ellipsis: false
        });
      } else {
        drawLine(c, x, y, x + width, y + height, COLORS.soft, 1);
        drawLine(c, x + width, y, x, y + height, COLORS.soft, 1);
      }
      return;
    }

    case "icon":
      // The label (emoji or symbol) is centred at exactly the element's content size.
      drawText(c, label || "★", bounds, {
        size: contentSizeOf(element),
        align: "center",
        fontFamily: EMOJI_FONT_FAMILY,
        ellipsis: false
      });
      return;

    case "avatar":
      ellipse(c, x + width / 2, y + height / 2, Math.min(width, height) / 2, { fill: COLORS.panelAlt, stroke: COLORS.line });
      drawText(c, (label || "AB").slice(0, 3), bounds, {
        size: Math.max(10, Math.min(Math.min(width, height) * 0.42, 20)),
        align: "center"
      });
      return;

    case "badge":
      drawRect(c, bounds, { fill: COLORS.panelAlt, stroke: COLORS.line, radius: height / 2 });
      drawText(c, label || "Badge", { x: x + 8, y, width: Math.max(0, width - 16), height }, { size: 12, align: "center" });
      return;

    case "list": {
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line });
      const rowHeight = 32;
      const rows = Math.max(0, Math.floor(height / rowHeight));
      items.slice(0, rows).forEach((item, index) => {
        const rowY = y + index * rowHeight;
        if (index > 0) drawLine(c, x + 1, rowY, x + width - 1, rowY, COLORS.hairline, 1);
        drawText(c, item, { x: x + 12, y: rowY, width: Math.max(0, width - 24), height: rowHeight }, { size: 13 });
      });
      return;
    }

    case "table": {
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line });
      const headerHeight = 28;
      const rowHeight = 28;
      const cellCount = Math.max(1, columns.length);
      const cellWidth = width / cellCount;
      drawRect(c, { x, y, width, height: Math.min(headerHeight, height) }, { fill: COLORS.panelAlt });
      columns.slice(0, cellCount).forEach((column, index) => {
        drawText(c, column, { x: x + index * cellWidth + 10, y, width: Math.max(0, cellWidth - 16), height: headerHeight }, { size: 12, weight: 600 });
        if (index > 0) drawLine(c, x + index * cellWidth, y, x + index * cellWidth, y + height, COLORS.hairline, 1);
      });
      drawLine(c, x, y + headerHeight, x + width, y + headerHeight, COLORS.line, 1);
      const rows = Math.max(0, Math.floor((height - headerHeight) / rowHeight));
      items.slice(0, rows).forEach((row, rowIndex) => {
        const rowY = y + headerHeight + rowIndex * rowHeight;
        if (rowIndex > 0) drawLine(c, x, rowY, x + width, rowY, COLORS.hairline, 1);
        const cells = row.split("|").map((cell) => cell.trim());
        cells.slice(0, cellCount).forEach((cell, cellIndex) => {
          drawText(c, cell, { x: x + cellIndex * cellWidth + 10, y: rowY, width: Math.max(0, cellWidth - 16), height: rowHeight }, { size: 12 });
        });
      });
      return;
    }

    case "tabs": {
      const tabs = items.length ? items : ["Tab 1", "Tab 2"];
      const segment = width / tabs.length;
      tabs.forEach((tab, index) => {
        drawRect(c, { x: x + index * segment, y, width: segment, height }, {
          fill: index === 0 ? COLORS.surface : COLORS.panel,
          stroke: COLORS.line
        });
        drawText(c, tab, { x: x + index * segment, y, width: segment, height }, {
          size: 13,
          align: "center",
          color: index === 0 ? COLORS.ink : "#6b7280"
        });
        if (index === 0 && height >= 8) {
          drawRect(c, { x: x + 2, y: y + height - 3, width: Math.max(0, segment - 4), height: 2 }, { fill: COLORS.ink });
        }
      });
      return;
    }

    case "divider":
      drawLine(c, x, y + height / 2, x + width, y + height / 2, COLORS.line, 1);
      return;

    case "button":
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 4 });
      drawText(c, label || "Button", bounds, { size: 14, align: "center" });
      return;

    case "iconButton":
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 6 });
      drawText(c, label || "+", bounds, {
        size: Math.max(11, Math.min(18, Math.min(width, height) * 0.5)),
        align: "center"
      });
      return;

    case "input":
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 4 });
      drawText(c, label || "Input", { x: x + 12, y, width: Math.max(0, width - 20), height }, { size: 14, color: COLORS.soft });
      return;

    case "textarea":
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 4 });
      drawText(c, label || "Textarea", { x: x + 12, y: y + 8, width: Math.max(0, width - 24), height: 18 }, { size: 13, color: COLORS.soft });
      return;

    case "dropdown":
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 4 });
      drawText(c, label || "Select", { x: x + 12, y, width: Math.max(0, width - 44), height }, { size: 14 });
      ctx_triangle(c, x + width - 24, y + height / 2 - 3, x + width - 12, y + height / 2 - 3, x + width - 18, y + height / 2 + 3);
      return;

    case "checkbox":
      drawRect(c, { x, y: y + Math.max(0, (height - 16) / 2), width: 16, height: 16 }, { fill: COLORS.surface, stroke: COLORS.line, radius: 3 });
      drawPolyline(c, [
        [x + 3.5, y + Math.max(0, (height - 16) / 2) + 8.5],
        [x + 7, y + Math.max(0, (height - 16) / 2) + 12],
        [x + 12.5, y + Math.max(0, (height - 16) / 2) + 3.5]
      ], COLORS.ink, 1.6);
      drawText(c, label || "Checkbox", { x: x + 24, y, width: Math.max(0, width - 24), height }, { size: 14 });
      return;

    case "radio":
      ellipse(c, x + 8, y + height / 2, 7, { fill: COLORS.surface, stroke: COLORS.line });
      ellipse(c, x + 8, y + height / 2, 3, { fill: COLORS.line });
      drawText(c, label || "Radio", { x: x + 24, y, width: Math.max(0, width - 24), height }, { size: 14 });
      return;

    case "toggle": {
      const trackHeight = Math.max(14, Math.min(20, height));
      const trackWidth = trackHeight * 1.9;
      const trackX = x + Math.max(0, width - trackWidth);
      const trackY = y + (height - trackHeight) / 2;
      drawText(c, label || "Toggle", { x, y, width: Math.max(0, width - trackWidth - 8), height }, { size: 14 });
      drawRect(c, { x: trackX, y: trackY, width: trackWidth, height: trackHeight }, {
        fill: COLORS.panelAlt,
        stroke: COLORS.line,
        radius: trackHeight / 2
      });
      ellipse(c, trackX + trackWidth - trackHeight / 2, trackY + trackHeight / 2, trackHeight / 2 - 2, {
        fill: COLORS.surface,
        stroke: COLORS.line
      });
      return;
    }

    case "slider": {
      const hasLabel = label.trim() !== "";
      const trackY = hasLabel ? y + height * 0.68 : y + height / 2;
      const trackX = x + 2;
      const trackWidth = Math.max(4, width - 4);
      const thumbX = trackX + trackWidth * 0.6;
      if (hasLabel) {
        drawText(c, label, { x, y, width, height: Math.max(10, height * 0.5) }, { size: 12 });
      }
      drawLine(c, trackX, trackY, trackX + trackWidth, trackY, COLORS.line, 2);
      drawLine(c, trackX, trackY, thumbX, trackY, COLORS.ink, 2);
      ellipse(c, thumbX, trackY, 6, { fill: COLORS.surface, stroke: COLORS.ink, lineWidth: 1.5 });
      return;
    }

    case "progress": {
      const barHeight = Math.max(6, Math.min(height, 12));
      const barY = y + (height - barHeight) / 2;
      drawRect(c, { x, y: barY, width, height: barHeight }, { fill: COLORS.panelAlt, stroke: COLORS.line, radius: barHeight / 2 });
      drawRect(c, { x, y: barY, width: Math.max(barHeight, width * 0.6), height: barHeight }, { fill: COLORS.soft, radius: barHeight / 2 });
      return;
    }

    default:
      drawRect(c, bounds, { stroke: COLORS.line });
  }
}

function ctx_triangle(c: DrawContext, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
  const { ctx } = c;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fillStyle = COLORS.line;
  ctx.fill();
}

function drawPolyline(c: DrawContext, points: [number, number][], color: string, width: number): void {
  const { ctx, px } = c;
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.lineWidth = width * px;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

/* ------------------------------------------------------------------- scene */

function drawGrid(c: DrawContext, canvasSize: { width: number; height: number }, step: number): void {
  const { ctx, px } = c;
  ctx.beginPath();
  for (let x = 0; x <= canvasSize.width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvasSize.height);
  }
  for (let y = 0; y <= canvasSize.height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(canvasSize.width, y);
  }
  ctx.lineWidth = 1 * px;
  ctx.strokeStyle = COLORS.grid;
  ctx.stroke();
}

function drawHandles(
  c: DrawContext,
  activeEdge: ResizeEdge | null,
  handles: { edge: ResizeEdge; screen: { x: number; y: number } }[]
): void {
  const { ctx } = c;
  const size = HANDLE_SIZE_PX;
  for (const handle of handles) {
    const hx = handle.screen.x;
    const hy = handle.screen.y;
    ctx.fillStyle = COLORS.surface;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(hx - size / 2, hy - size / 2, size, size);
    ctx.fill();
    ctx.stroke();
    if (handle.edge === activeEdge) {
      ctx.fillStyle = COLORS.accent;
      ctx.fill();
    }
  }
}

export function renderScene(
  canvas: HTMLCanvasElement,
  input: SceneInput
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { project, transform, dpr, preview, activeEdge } = input;
  const { width: canvasWidth, height: canvasHeight } = project.canvas;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = COLORS.surface;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const matrix = deviceMatrix(transform, dpr);
  ctx.setTransform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);

  const c: DrawContext = { ctx, px: 1 / transform.scale };
  if (input.showGrid) drawGrid(c, { width: canvasWidth, height: canvasHeight }, input.gridSize);

  // Document content, back to front. The preview override is the only mid-gesture difference.
  const previewById = new Map((preview ?? []).map((override) => [override.elementId, override.bounds]));
  const selected = new Set(input.selectedIds);
  const selectedBounds = new Map<string, Rect>();
  for (const element of elementsInDrawOrder(project)) {
    if (!isElementVisible(project, element)) continue;
    const bounds: Rect =
      previewById.get(element.id) ?? { x: element.x, y: element.y, width: element.width, height: element.height };
    drawElement(c, element, bounds, true);
    if (selected.has(element.id)) selectedBounds.set(element.id, bounds);
  }

  // Editor chrome in screen space so outlines and handles keep a constant size.
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const multiple = input.selectedIds.length > 1;
  for (const [elementId, bounds] of selectedBounds) {
    const element = project.elements.find((candidate) => candidate.id === elementId);
    const locked = element ? isElementLocked(project, element) : false;
    const rectScreen = worldRectToScreen(transform, bounds);
    // A multi-selection outlines every member; the box around the whole set comes next.
    ctx.setLineDash(locked || multiple ? [4, 3] : []);
    ctx.lineWidth = 1;
    ctx.strokeStyle = locked ? COLORS.locked : COLORS.accent;
    ctx.strokeRect(rectScreen.x, rectScreen.y, rectScreen.width, rectScreen.height);
    ctx.setLineDash([]);
  }

  if (multiple && selectedBounds.size > 1) {
    const union = unionRect([...selectedBounds.values()]);
    const unionScreen = worldRectToScreen(transform, union);
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.accent;
    ctx.strokeRect(unionScreen.x - 1, unionScreen.y - 1, unionScreen.width + 2, unionScreen.height + 2);
    ctx.setLineDash([]);
  }

  // Handles exist for exactly one selected, unlocked object — the SAME geometry the hit test
  // uses, so a handle is never drawn where it cannot be grabbed (and vice versa).
  const primaryElement =
    !multiple && input.primarySelectedId
      ? project.elements.find((candidate) => candidate.id === input.primarySelectedId)
      : undefined;
  const primaryLocked = primaryElement ? isElementLocked(project, primaryElement) : false;
  if (primaryElement && !primaryLocked) {
    drawHandles(c, activeEdge, elementGeometry(primaryElement, transform).resizeHandles);
  }

  if (input.marquee) {
    drawMarquee(c, worldRectToScreen(transform, input.marquee));
  }

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function unionRect(rects: Rect[]): Rect {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Translucent light-blue fill with a thin blue border — the marquee rubber band. */
function drawMarquee(c: DrawContext, rect: Rect): void {
  const { ctx } = c;
  ctx.fillStyle = "rgba(47, 111, 237, 0.14)";
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(47, 111, 237, 0.85)";
  ctx.strokeRect(Math.round(rect.x) + 0.5, Math.round(rect.y) + 0.5, Math.round(rect.width), Math.round(rect.height));
}
