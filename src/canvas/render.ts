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
import { bezierPoint, isBoxObject, objectLabel, type DiagramData, type DiagramObject } from "../model/diagram";
import {
  isSingleSeriesKind,
  normalizeChartData,
  type ChartData,
  type ChartSeries
} from "../model/chart";
import { hasDrawingDescription, type DrawingData } from "../model/drawing";
import {
  HANDLE_SIZE_PX,
  SCENE_TITLE_HEIGHT,
  elementGeometry,
  isElementLocked,
  isElementVisible,
  sceneViewport,
  warningBadgeRect,
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
      drawText(c, splitGraphemes(label || "AB").slice(0, 3).join(""), bounds, {
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

    case "diagram": {
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 3 });
      const data = element.diagram;
      const title = label.trim();
      if (showLabel && title) {
        drawText(c, title, { x: x + 6, y: y + 3, width: Math.max(0, width - 12), height: 14 }, { size: 11, weight: 600, color: COLORS.soft });
      }
      if (!data || data.objects.length === 0) {
        drawText(c, "Canvas — double-click to edit", bounds, { size: 12, align: "center", color: COLORS.soft });
        return;
      }
      drawNestedScene(c, bounds, data, title ? SCENE_TITLE_HEIGHT : 0, (inner) => drawDiagramScene(inner.ctx, data, inner.px));
      return;
    }

    case "drawing": {
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line });
      const data = element.drawing;
      if (!data || data.strokes.length === 0) {
        drawText(c, "Drawing — double-click to draw", bounds, { size: 12, align: "center", color: COLORS.soft });
        return;
      }
      drawNestedScene(c, bounds, data, 0, (inner) => drawDrawingScene(inner.ctx, data));
      return;
    }

    case "chart": {
      // Flat wireframe styling: the chart is drawn flat inside the element, with a hairline frame.
      drawRect(c, bounds, { fill: COLORS.surface, stroke: COLORS.line, radius: 3 });
      const data = normalizeChartData(element.chart);
      drawChartScene(c.ctx, data, { width, height }, c.px);
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

/** Draw a Canvas/Drawing scene fitted into `bounds`, clipped to the element. */
function drawNestedScene(
  c: DrawContext,
  bounds: Rect,
  scene: { width: number; height: number },
  reservedTop: number,
  paint: (inner: DrawContext) => void
): void {
  const { ctx } = c;
  const viewport = sceneViewport(bounds, scene, reservedTop);
  ctx.save();
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.clip();
  ctx.translate(viewport.x, viewport.y);
  ctx.scale(viewport.scale, viewport.scale);
  paint({ ctx, px: c.px / viewport.scale });
  ctx.restore();
}

/* ------------------------------------------------------------- scene art */

/** Label size inside a Canvas scene, in scene units. */
const SCENE_LABEL_SIZE = 14;
const ARROW_HEAD = 12;

function sceneLabel(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, maxWidth: number, size: number, backdrop: boolean): void {
  if (!text) return;
  ctx.font = worldFont(size, 400);
  const content = fitText(ctx, text, Math.max(size, maxWidth));
  if (!content) return;
  if (backdrop) {
    const width = ctx.measureText(content).width + 6;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(cx - width / 2, cy - size * 0.7, width, size * 1.4);
  }
  ctx.fillStyle = COLORS.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(content, cx, cy);
}

function arrowHead(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(to.x - ARROW_HEAD * Math.cos(angle - 0.4), to.y - ARROW_HEAD * Math.sin(angle - 0.4));
  ctx.lineTo(to.x - ARROW_HEAD * Math.cos(angle + 0.4), to.y - ARROW_HEAD * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fillStyle = COLORS.ink;
  ctx.fill();
}

function drawDiagramObject(ctx: CanvasRenderingContext2D, object: DiagramObject, px: number): void {
  const label = objectLabel(object);
  ctx.lineWidth = Math.max(1.5, px);
  ctx.strokeStyle = COLORS.ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (isBoxObject(object)) {
    const { x, y, width, height } = object;
    if (object.type === "text") {
      const lines = (object.label ?? "").split("\n");
      const size = Math.max(6, Math.min(18, (height / Math.max(1, lines.length)) * 0.75));
      ctx.font = worldFont(size, 400);
      ctx.fillStyle = COLORS.ink;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      const lineHeight = height / Math.max(1, lines.length);
      lines.forEach((line, index) => {
        const content = fitText(ctx, line, width);
        if (content) ctx.fillText(content, x, y + lineHeight * (index + 0.5));
      });
      return;
    }
    ctx.beginPath();
    if (object.type === "rectangle") ctx.rect(x, y, width, height);
    else ctx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.surface;
    ctx.fill();
    ctx.stroke();
    const size = Math.max(6, Math.min(SCENE_LABEL_SIZE, height * 0.5));
    sceneLabel(ctx, label, x + width / 2, y + height / 2, width * (object.type === "ellipse" ? 0.75 : 0.9), size, false);
    return;
  }

  if (object.type === "bezier") {
    ctx.beginPath();
    ctx.moveTo(object.start.x, object.start.y);
    ctx.bezierCurveTo(object.control1.x, object.control1.y, object.control2.x, object.control2.y, object.end.x, object.end.y);
    ctx.stroke();
    const middle = bezierPoint(object, 0.5);
    sceneLabel(ctx, label, middle.x, middle.y - SCENE_LABEL_SIZE * 0.8, 200, 12, true);
    return;
  }

  const from = { x: object.x1, y: object.y1 };
  const to = { x: object.x2, y: object.y2 };
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  if (object.type === "arrow") arrowHead(ctx, from, to);
  sceneLabel(ctx, label, (from.x + to.x) / 2, (from.y + to.y) / 2 - SCENE_LABEL_SIZE * 0.8, 200, 12, true);
}

/**
 * Paint a Canvas scene in SCENE coordinates (the caller sets the transform). `px` is one screen
 * pixel in scene units. Shared by the wireframe renderer and the Canvas popup editor, so the
 * thumbnail on the wireframe is the real scene, not a placeholder.
 */
export function drawDiagramScene(ctx: CanvasRenderingContext2D, data: DiagramData, px: number): void {
  for (const object of data.objects) drawDiagramObject(ctx, object, px);
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

/** Paint a Drawing's strokes in DRAWING coordinates (shared by the renderer and the popup). */
export function drawDrawingScene(ctx: CanvasRenderingContext2D, data: DrawingData): void {
  ctx.strokeStyle = COLORS.ink;
  ctx.fillStyle = COLORS.ink;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of data.strokes) {
    const [first, ...rest] = stroke.points;
    if (!first) continue;
    if (rest.length === 0) {
      ctx.beginPath();
      ctx.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(first.x, first.y);
    for (const point of rest) ctx.lineTo(point.x, point.y);
    ctx.lineWidth = stroke.width;
    ctx.stroke();
  }
  ctx.lineCap = "butt";
  ctx.lineJoin = "miter";
}

/* ------------------------------------------------------------------- chart art */

/**
 * Monochrome-friendly palette of the Chart element: an accent for the first series and readable
 * greys for the rest. Flat fills and outlines only — no gradients, no shadows.
 */
const CHART_COLORS = ["#2f6fed", "#5b6470", "#98a2b3", "#8b5cf6", "#0f766e", "#b45309", "#be123c", "#4d5761"];

const CHART_GRID_LINES = 4;
/** Value labels are only drawn when they can actually be read. */
const CHART_VALUE_FONT = 10;
const CHART_LABEL_FONT = 10;
/** Below this many world units a chart falls back to axes + labels only. */
const CHART_MIN_PLOT_UNITS = 24;
/** Below this plot height/width value labels are skipped. */
const CHART_VALUE_MIN_PLOT = 90;

interface ChartRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ChartParts {
  plot: ChartRect;
  zero: { x: number; y: number };
  extent: { positive: number; negative: number };
}

function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/** Compact axis/value label: 1500 -> 1.5k, 2400000 -> 2.4M. */
export function formatChartAxisValue(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(value * 100) / 100}`;
}

function chartTextWidth(ctx: CanvasRenderingContext2D, text: string, size: number, weight = 400): number {
  ctx.font = worldFont(size, weight);
  return ctx.measureText(text).width;
}

function chartLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  size = CHART_LABEL_FONT,
  color = COLORS.line
): void {
  if (!text || maxWidth <= 6) return;
  ctx.font = worldFont(size, 400);
  const content = fitText(ctx, text, maxWidth);
  if (!content) return;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(content, cx, cy);
}

function chartValueLabel(
  ctx: CanvasRenderingContext2D,
  value: number,
  cx: number,
  cy: number,
  maxWidth: number,
  color = COLORS.line
): void {
  if (maxWidth <= 14) return;
  ctx.font = worldFont(CHART_VALUE_FONT, 500);
  const content = fitText(ctx, formatChartAxisValue(value), maxWidth);
  if (!content) return;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(content, cx, cy);
}

/** True when the series has at least one value to draw. */
function chartSeriesHasData(series: ChartSeries): boolean {
  return series.values.some((value) => value !== null && value !== 0);
}

/**
 * Legend strip. Vertical (one swatch + name per line) when `vertical`, else a wrapped row.
 * Returns the height it consumed, so the plot can be placed under it.
 */
function drawChartLegend(
  ctx: CanvasRenderingContext2D,
  series: ChartSeries[],
  area: ChartRect,
  vertical: boolean,
  size: number
): number {
  if (series.length === 0) return 0;
  const rowHeight = size + 4;
  const swatch = Math.max(6, Math.round(size * 0.7));

  if (vertical) {
    series.forEach((entry, index) => {
      const y = area.y + index * rowHeight;
      if (y + rowHeight > area.y + area.height) return;
      ctx.fillStyle = chartColor(index);
      ctx.fillRect(area.x, y + 1, swatch, swatch);
      chartLabel(ctx, `${entry.name}`, area.x + swatch + 4 + (area.width - swatch - 8) / 2, y + rowHeight / 2 - 1, area.width - swatch - 8, size, COLORS.ink);
    });
    return Math.min(series.length, Math.floor(area.height / rowHeight)) * rowHeight;
  }

  let cursor = area.x;
  let rows = 1;
  for (const [index, entry] of series.entries()) {
    const width = swatch + 4 + chartTextWidth(ctx, entry.name, size) + 10;
    if (cursor + width > area.x + area.width && cursor > area.x) {
      rows += 1;
      cursor = area.x;
      if (area.y + rows * rowHeight > area.y + area.height) break;
    }
    const y = area.y + (rows - 1) * rowHeight;
    ctx.fillStyle = chartColor(index);
    ctx.fillRect(cursor, y + 1, swatch, swatch);
    chartLabel(ctx, entry.name, cursor + swatch + 4 + (width - swatch - 14) / 2, y + rowHeight / 2 - 1, width - swatch - 14, size, COLORS.ink);
    cursor += width;
  }
  return rows * rowHeight;
}

/**
 * Where the plot sits inside the chart box, which value maps to which pixel, and the zero line.
 *
 * `showValueAxis` reserves a gutter for the value labels; `showCategoryLabels` reserves one for the
 * category names. Everything is derived from the box, so the chart is correct at any element size
 * and at any zoom (the renderer draws in world units).
 */
function chartParts(
  ctx: CanvasRenderingContext2D,
  box: ChartRect,
  extent: { positive: number; negative: number },
  showValueAxis: boolean,
  showCategoryLabels: boolean,
  horizontal: boolean
): ChartParts {
  const pad = 10;
  const span = extent.positive + extent.negative || 1;

  const valueGutter = showValueAxis
    ? Math.min(
        46,
        Math.max(18, chartTextWidth(ctx, formatChartAxisValue(extent.positive), CHART_VALUE_FONT) + 10)
      )
    : 0;
  const categoryGutter = showCategoryLabels
    ? Math.min(
        46,
        Math.max(12, Math.ceil(chartTextWidth(ctx, "Ww", CHART_LABEL_FONT)) + 6)
      )
    : 0;

  const inner: ChartRect = {
    x: box.x + pad,
    y: box.y + pad,
    width: Math.max(1, box.width - pad * 2),
    height: Math.max(1, box.height - pad * 2)
  };

  const plot: ChartRect = horizontal
    ? {
        x: inner.x + valueGutter,
        y: inner.y,
        width: Math.max(1, inner.width - valueGutter),
        height: Math.max(1, inner.height - categoryGutter)
      }
    : {
        x: inner.x + categoryGutter,
        y: inner.y,
        width: Math.max(1, inner.width - categoryGutter),
        height: Math.max(1, inner.height - valueGutter)
      };

  const positiveShare = plot.height * (extent.positive / span);
  return {
    plot,
    zero: horizontal
      ? { x: plot.x + plot.width * (extent.positive / span), y: plot.y }
      : { x: plot.x, y: plot.y + positiveShare },
    extent
  };
}

/** Light gridlines + value axis + category labels + the zero line. */
function drawChartAxes(
  ctx: CanvasRenderingContext2D,
  data: ChartData,
  box: ChartRect,
  parts: ChartParts,
  horizontal: boolean
): void {
  const { plot, extent, zero } = parts;
  const span = extent.positive + extent.negative || 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = COLORS.hairline;
  ctx.beginPath();
  for (let step = 0; step <= CHART_GRID_LINES; step += 1) {
    const ratio = step / CHART_GRID_LINES;
    if (horizontal) {
      const x = plot.x + plot.width * ratio;
      ctx.moveTo(x, plot.y);
      ctx.lineTo(x, plot.y + plot.height);
    } else {
      const y = plot.y + plot.height * ratio;
      ctx.moveTo(plot.x, y);
      ctx.lineTo(plot.x + plot.width, y);
    }
  }
  ctx.stroke();

  // Value labels on the value axis (skipped on a tiny box: they would be noise, not information).
  ctx.font = worldFont(CHART_VALUE_FONT, 500);
  ctx.fillStyle = COLORS.soft;
  ctx.textBaseline = "middle";
  for (let step = 0; step <= CHART_GRID_LINES; step += 1) {
    const ratio = step / CHART_GRID_LINES;
    if (horizontal) {
      const value = extent.negative - ratio * span;
      const x = plot.x + plot.width * ratio;
      if (plot.width < 40) break;
      ctx.textAlign = "center";
      const content = fitText(ctx, formatChartAxisValue(value), 44);
      if (content) ctx.fillText(content, x, plot.y + plot.height + 9);
    } else {
      const value = extent.positive - ratio * span;
      const y = plot.y + plot.height * ratio;
      if (plot.height < 40) break;
      ctx.textAlign = "right";
      const content = fitText(ctx, formatChartAxisValue(value), Math.max(12, plot.x - box.x - 4));
      if (content) ctx.fillText(content, plot.x - 4, y);
    }
  }

  // The zero line is drawn on top of the gridlines, and is always visible.
  ctx.strokeStyle = COLORS.line;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(zero.x, plot.y);
    ctx.lineTo(zero.x, plot.y + plot.height);
  } else {
    ctx.moveTo(plot.x, zero.y);
    ctx.lineTo(plot.x + plot.width, zero.y);
  }
  ctx.stroke();

  // Category labels, centered on the band they describe.
  const categories = data.categories;
  if (categories.length === 0) return;
  if (horizontal) {
    if (plot.height < 22) return;
    const band = plot.height / categories.length;
    categories.forEach((category, index) => {
      chartLabel(
        ctx,
        category,
        plot.x + plot.width / 2,
        plot.y + band * (index + 0.5),
        plot.width,
        CHART_LABEL_FONT,
        COLORS.ink
      );
    });
  } else {
    if (plot.width < 24) return;
    const band = plot.width / categories.length;
    categories.forEach((category, index) => {
      chartLabel(
        ctx,
        category,
        plot.x + band * (index + 0.5),
        plot.y + plot.height + 10,
        Math.max(8, band - 2),
        CHART_LABEL_FONT,
        COLORS.ink
      );
    });
  }
}

function fillChartSegment(ctx: CanvasRenderingContext2D, rect: ChartRect, color: string, radius = 0): void {
  if (rect.width <= 0 || rect.height <= 0) return;
  ctx.beginPath();
  if (radius > 0 && typeof ctx.roundRect === "function") ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
  else ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = color;
  ctx.fill();
}

/* ---- bar kinds ------------------------------------------------------------------- */

function drawChartBar(
  ctx: CanvasRenderingContext2D,
  data: ChartData,
  parts: ChartParts,
  options: { horizontal: boolean; stacked: boolean; showValues: boolean }
): void {
  const { plot, zero, extent } = parts;
  const span = extent.positive + extent.negative || 1;
  const categories = data.categories;
  if (categories.length === 0) return;
  const series = data.series;
  const band = options.horizontal ? plot.height / categories.length : plot.width / categories.length;
  const thickness = Math.max(2, Math.min(options.stacked ? 26 : 34, band * 0.66));
  const valueRoom = options.showValues && (options.horizontal ? plot.width >= CHART_VALUE_MIN_PLOT : plot.height >= CHART_VALUE_MIN_PLOT);

  categories.forEach((_, categoryIndex) => {
    const center = (options.horizontal ? plot.y : plot.x) + band * (categoryIndex + 0.5);
    if (options.stacked) {
      let positive = 0;
      let negative = 0;
      series.forEach((entry, seriesIndex) => {
        const value = entry.values[categoryIndex];
        if (value === null) return;
        const from = value >= 0 ? positive : negative;
        const to = from + value;
        if (value >= 0) positive = to;
        else negative = to;
        const start = options.horizontal
          ? zero.x + (from / span) * plot.width
          : zero.y - (from / span) * plot.height;
        const end = options.horizontal ? zero.x + (to / span) * plot.width : zero.y - (to / span) * plot.height;
        const rect: ChartRect = options.horizontal
          ? { x: Math.min(start, end), y: center - thickness / 2, width: Math.abs(end - start), height: thickness }
          : { x: center - thickness / 2, y: Math.min(start, end), width: thickness, height: Math.abs(end - start) };
        fillChartSegment(ctx, rect, chartColor(seriesIndex));
      });
      if (valueRoom && series.length > 0) {
        const total = positive + negative;
        if (total !== 0) {
          if (options.horizontal) {
            const x = zero.x + (total / span) * plot.width;
            chartValueLabel(ctx, total, (zero.x + x) / 2, center, Math.abs(x - zero.x), COLORS.ink);
          } else {
            const y = zero.y - (total / span) * plot.height;
            chartValueLabel(ctx, total, center, (zero.y + y) / 2, thickness, COLORS.ink);
          }
        }
      }
      return;
    }

    const slot = thickness / Math.max(1, series.length);
    series.forEach((entry, seriesIndex) => {
      const value = entry.values[categoryIndex];
      if (value === null) return;
      const offset = (seriesIndex - (series.length - 1) / 2) * slot;
      const base = center + offset;
      if (options.horizontal) {
        const end = zero.x + (value / span) * plot.width;
        fillChartSegment(
          ctx,
          { x: Math.min(zero.x, end), y: base - slot / 2, width: Math.abs(end - zero.x), height: Math.max(1, slot - 2) },
          chartColor(seriesIndex)
        );
        if (valueRoom) chartValueLabel(ctx, value, (zero.x + end) / 2, base, Math.abs(end - zero.x) + 10);
      } else {
        const end = zero.y - (value / span) * plot.height;
        fillChartSegment(
          ctx,
          { x: base - slot / 2, y: Math.min(zero.y, end), width: Math.max(1, slot - 2), height: Math.abs(end - zero.y) },
          chartColor(seriesIndex)
        );
        if (valueRoom) chartValueLabel(ctx, value, base, (zero.y + end) / 2, Math.max(14, slot));
      }
    });
  });
}

/* ---- line / area ----------------------------------------------------------------- */

function drawChartLine(
  ctx: CanvasRenderingContext2D,
  data: ChartData,
  parts: ChartParts,
  options: { area: boolean; showValues: boolean }
): void {
  const { plot, zero, extent } = parts;
  const span = extent.positive + extent.negative || 1;
  const categories = data.categories;
  if (categories.length === 0) return;
  const band = plot.width / categories.length;
  const pointX = (index: number) => plot.x + band * (index + 0.5);
  const pointY = (value: number) => zero.y - (value / span) * plot.height;
  const showValues = options.showValues && plot.height >= CHART_VALUE_MIN_PLOT;

  data.series.forEach((entry, seriesIndex) => {
    const color = chartColor(seriesIndex);
    // A segment is broken by a `null`: a gap is information, not a zero.
    let run: { x: number; y: number; value: number }[] = [];
    const flush = () => {
      if (run.length > 1) {
        ctx.beginPath();
        ctx.moveTo(run[0].x, run[0].y);
        for (const point of run.slice(1)) ctx.lineTo(point.x, point.y);
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.stroke();
        if (options.area) {
          ctx.beginPath();
          ctx.moveTo(run[0].x, zero.y);
          for (const point of run) ctx.lineTo(point.x, point.y);
          ctx.lineTo(run[run.length - 1].x, zero.y);
          ctx.closePath();
          ctx.fillStyle = `${color}26`;
          ctx.fill();
        }
      }
      if (run.length === 1) {
        ctx.beginPath();
        ctx.arc(run[0].x, run[0].y, 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
      run = [];
    };
    entry.values.forEach((value, index) => {
      if (value === null) {
        flush();
        return;
      }
      run.push({ x: pointX(index), y: pointY(value), value });
    });
    flush();

    if (showValues) {
      entry.values.forEach((value, index) => {
        if (value === null) return;
        chartValueLabel(ctx, value, pointX(index), pointY(value) - 8, Math.max(16, band - 2), COLORS.line);
      });
    }
  });
}

/* ---- pie / donut ----------------------------------------------------------------- */

function drawChartPie(
  ctx: CanvasRenderingContext2D,
  data: ChartData,
  box: ChartRect,
  donut: boolean,
  showValues: boolean
): void {
  const categories = data.categories;
  const series = data.series[0];
  if (!series || categories.length === 0) return;

  // Negative values have no meaning in a pie: they are treated as gaps.
  const values = series.values.map((value) => (value !== null && value > 0 ? value : 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;

  const radius = Math.max(4, Math.min(box.width, box.height) / 2 - 12);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  let angle = -Math.PI / 2;

  values.forEach((value, index) => {
    if (value <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle, angle + sweep);
    ctx.closePath();
    ctx.fillStyle = chartColor(index);
    ctx.fill();
    if (categories.length <= 8 && radius > 26) {
      const middle = angle + sweep / 2;
      const share = Math.round((value / total) * 100);
      const labelRadius = donut ? radius * 0.78 : radius * 0.62;
      chartLabel(
        ctx,
        showValues ? `${categories[index]} ${share}%` : `${share}%`,
        cx + Math.cos(middle) * labelRadius,
        cy + Math.sin(middle) * labelRadius,
        Math.max(12, radius * 0.9),
        CHART_VALUE_FONT,
        COLORS.surface
      );
    }
    angle += sweep;
  });

  if (donut) {
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(2, radius * 0.55), 0, Math.PI * 2);
    ctx.fillStyle = COLORS.surface;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = COLORS.hairline;
    ctx.stroke();
  }
}

/**
 * Paint a Chart's data inside a box whose top-left corner is the current transform's origin, in
 * WORLD units (`px` is one screen pixel in world units, exactly like the element renderer).
 *
 * Shared by the wireframe renderer and the Chart popup preview, so the thumbnail on the wireframe
 * is the real chart. The element's id/selection/zoom never reach this function, and everything it
 * draws is clipped to the box.
 */
export function drawChartScene(
  ctx: CanvasRenderingContext2D,
  value: ChartData,
  size: { width: number; height: number },
  px: number
): void {
  const data = normalizeChartData(value);
  const box: ChartRect = { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, size.height) };
  if (box.width < 8 || box.height < 8) return;

  const frame = Math.max(1, px);
  ctx.save();
  // Nothing may be painted outside the element, however tight the box or extreme the zoom.
  ctx.beginPath();
  ctx.rect(box.x + frame / 2, box.y + frame / 2, Math.max(0, box.width - frame), Math.max(0, box.height - frame));
  ctx.clip();

  const pad = 10;
  const single = isSingleSeriesKind(data.kind);
  const series = single ? data.series.slice(0, 1) : data.series;
  const options = data.options ?? {};
  const horizontal = !single && data.kind !== "line" && data.kind !== "area" && options.horizontal === true;
  const extent = chartExtent(data, data.kind === "stackedBar");

  let cursorY = box.y + pad;
  if (data.title) {
    chartLabel(
      ctx,
      data.title,
      box.x + box.width / 2,
      cursorY + 7,
      Math.max(0, box.width - pad * 2),
      11,
      COLORS.ink
    );
    cursorY += 17;
  }

  const body: ChartRect = {
    x: box.x,
    y: cursorY,
    width: box.width,
    height: Math.max(1, box.y + box.height - pad - cursorY)
  };

  if (single) {
    if (series.length === 0 || data.categories.length === 0) {
      chartLabel(ctx, "—", box.x + box.width / 2, box.y + box.height / 2, box.width - 20, 12, COLORS.soft);
      ctx.restore();
      return;
    }
    const legendHeight = options.legend ? drawChartLegend(ctx, series, { ...body, height: body.height }, false, CHART_LABEL_FONT) + 2 : 0;
    const pieBox: ChartRect = {
      x: body.x + pad,
      y: body.y + legendHeight,
      width: Math.max(1, body.width - pad * 2),
      height: Math.max(1, body.height - legendHeight)
    };
    drawChartPie(ctx, data, pieBox, data.kind === "donut", options.showValues === true);
    ctx.restore();
    return;
  }

  // A vertical legend only makes sense next to vertical bars; everywhere else it is a top strip.
  const legendVertical = horizontal;
  const legendWidth = legendVertical ? Math.min(96, Math.max(0, body.width * 0.3)) : 0;
  const legendHeight = !legendVertical && options.legend
    ? drawChartLegend(ctx, series, { x: body.x + pad, y: body.y, width: Math.max(1, body.width - pad * 2), height: body.height }, false, CHART_LABEL_FONT) + 2
    : 0;

  const parts = chartParts(
    ctx,
    {
      x: body.x,
      y: body.y + legendHeight,
      width: body.width - legendWidth,
      height: Math.max(1, body.height - legendHeight)
    },
    extent,
    true,
    true,
    horizontal
  );

  const hasData = series.some(chartSeriesHasData);
  const tooSmall = parts.plot.width < CHART_MIN_PLOT_UNITS || parts.plot.height < CHART_MIN_PLOT_UNITS;
  if (!hasData || tooSmall) {
    // Too small (or empty) to say anything: axes and labels only, still recognisably a chart.
    drawChartAxes(ctx, data, body, parts, horizontal);
  } else if (data.kind === "line" || data.kind === "area") {
    drawChartAxes(ctx, data, body, parts, false);
    drawChartLine(ctx, data, parts, { area: data.kind === "area", showValues: options.showValues === true });
  } else {
    drawChartAxes(ctx, data, body, parts, horizontal);
    drawChartBar(ctx, data, parts, {
      horizontal,
      stacked: data.kind === "stackedBar",
      showValues: options.showValues === true
    });
  }

  if (legendVertical && options.legend) {
    drawChartLegend(
      ctx,
      series,
      { x: body.x + body.width - legendWidth, y: body.y + 2, width: legendWidth, height: Math.max(1, body.height - 4) },
      true,
      CHART_LABEL_FONT
    );
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.restore();
}

/**
 * The smallest interval that contains every drawn value: how far above and below zero the chart
 * has to reach. Stacked bars use the per-category total, everything else the values themselves.
 */
export function chartExtent(data: ChartData, stacked: boolean): { positive: number; negative: number } {
  const series = isSingleSeriesKind(data.kind) ? data.series.slice(0, 1) : data.series;
  let positive = 0;
  let negative = 0;
  if (stacked) {
    data.categories.forEach((_, index) => {
      let up = 0;
      let down = 0;
      for (const entry of series) {
        const value = entry.values[index];
        if (value === null) continue;
        if (value >= 0) up += value;
        else down += value;
      }
      positive = Math.max(positive, up);
      negative = Math.min(negative, down);
    });
  } else {
    for (const entry of series) {
      for (const value of entry.values) {
        if (value === null) continue;
        if (value >= 0) positive = Math.max(positive, value);
        else negative = Math.min(negative, value);
      }
    }
  }
  // A flat zero chart (`0, 0, 0`) still needs a scale; an all-gap chart keeps a nominal one.
  if (positive === 0 && negative === 0) positive = 1;
  return { positive, negative };
}

/** Amber "⚠" badge: this Drawing has no LLM description and is left out of the export. */
function drawWarningBadge(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const { x, y, width, height } = rect;
  ctx.beginPath();
  ctx.moveTo(x + width / 2, y);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.closePath();
  ctx.fillStyle = "#f59e0b";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "#b45309";
  ctx.stroke();
  ctx.fillStyle = "#1f2429";
  ctx.font = worldFont(Math.max(7, height * 0.62), 700);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("!", x + width / 2, y + height * 0.62);
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

  // Drawings without an LLM description carry a constant-size warning badge (screen space).
  for (const element of elementsInDrawOrder(project)) {
    if (element.type !== "drawing" || hasDrawingDescription(element.drawing)) continue;
    if (!isElementVisible(project, element)) continue;
    const bounds = previewById.get(element.id) ?? { x: element.x, y: element.y, width: element.width, height: element.height };
    drawWarningBadge(ctx, warningBadgeRect(bounds, transform));
  }

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
    // Mid-gesture the handles follow the previewed bounds, exactly like the outline does.
    const previewBounds = previewById.get(primaryElement.id);
    const handleSource = previewBounds ? { ...primaryElement, ...previewBounds } : primaryElement;
    drawHandles(c, activeEdge, elementGeometry(handleSource, transform).resizeHandles);
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
