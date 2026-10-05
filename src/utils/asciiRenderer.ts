import { exportedElementsInDrawOrder, type WireframeElement, type WireframeProject } from "../model/project";
import { chartMaxAbsValue, isSingleSeriesKind, normalizeChartData } from "../model/chart";
import { renderDiagramAsciiLines } from "./diagramText";

/**
 * Deterministic ASCII rendering of a wireframe.
 *
 * Pure functions only: the same project always produces byte-identical output.
 * The goal is spatial communication for an LLM, not pixel fidelity.
 */

export interface AsciiDimensions {
  cols: number;
  rows: number;
}

export const ASCII_WIDE: AsciiDimensions = { cols: 80, rows: 30 };
export const ASCII_NARROW: AsciiDimensions = { cols: 50, rows: 35 };

export function getAsciiDimensions(canvas: { width: number; height: number }): AsciiDimensions {
  const ratio = canvas.height > 0 ? canvas.width / canvas.height : 1;
  return ratio >= 1.2 ? ASCII_WIDE : ASCII_NARROW;
}

class Grid {
  readonly cols: number;
  readonly rows: number;
  private readonly cells: string[][];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  set(x: number, y: number, char: string): void {
    if (!this.inBounds(x, y)) return;
    this.cells[y][x] = char;
  }

  /** Write a string left to right, silently clipping at the grid edge. */
  put(x: number, y: number, text: string): void {
    const chars = Array.from(text);
    for (let i = 0; i < chars.length; i += 1) {
      this.set(x + i, y, chars[i]);
    }
  }

  get(x: number, y: number): string {
    return this.inBounds(x, y) ? this.cells[y][x] : " ";
  }

  lines(): string[] {
    return this.cells.map((row) => row.join("").replace(/\s+$/, ""));
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function clip(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max === 1) return "…";
  return `${chars.slice(0, max - 1).join("")}…`;
}

function padRight(text: string, width: number, fill = " "): string {
  const chars = Array.from(text);
  if (chars.length >= width) return chars.slice(0, width).join("");
  return text + fill.repeat(width - chars.length);
}

function toRect(element: WireframeElement, sx: number, sy: number, grid: Grid): Rect {
  const x = Math.max(0, Math.min(grid.cols - 1, Math.round(element.x * sx)));
  const y = Math.max(0, Math.min(grid.rows - 1, Math.round(element.y * sy)));
  const w = Math.max(1, Math.min(grid.cols - x, Math.round(element.width * sx)));
  const h = Math.max(1, Math.min(grid.rows - y, Math.round(element.height * sy)));
  return { x, y, w, h };
}

function drawBox(grid: Grid, rect: Rect): void {
  const { x, y, w, h } = rect;
  if (h <= 1) {
    for (let i = 0; i < w; i += 1) grid.set(x + i, y, "─");
    return;
  }
  if (w <= 1) {
    for (let j = 0; j < h; j += 1) grid.set(x, y + j, "│");
    return;
  }

  grid.set(x, y, "┌");
  grid.set(x + w - 1, y, "┐");
  grid.set(x, y + h - 1, "└");
  grid.set(x + w - 1, y + h - 1, "┘");
  for (let i = 1; i < w - 1; i += 1) {
    grid.set(x + i, y, "─");
    grid.set(x + i, y + h - 1, "─");
  }
  for (let j = 1; j < h - 1; j += 1) {
    grid.set(x, y + j, "│");
    grid.set(x + w - 1, y + j, "│");
  }
}

function middleRow(rect: Rect): number {
  return rect.y + Math.floor((rect.h - 1) / 2);
}

function drawButton(grid: Grid, rect: Rect, label: string): void {
  // Prefer the whole caption: "[ Cancel ]", then "[Cancel]", and only then a clipped "[Can…]".
  const caption = (label || "Button").replace(/\s+/g, " ").trim();
  const padded = `[ ${caption} ]`;
  const tight = `[${caption}]`;
  const rendered =
    Array.from(padded).length <= rect.w
      ? padded
      : Array.from(tight).length <= rect.w
        ? tight
        : `[${clip(caption, Math.max(1, rect.w - 2))}]`;
  const offset = Math.max(0, Math.floor((rect.w - Array.from(rendered).length) / 2));
  grid.put(rect.x + offset, middleRow(rect), rendered);
}

function drawInput(grid: Grid, rect: Rect, label: string): void {
  const w = rect.w;
  if (w < 5) {
    grid.put(rect.x, middleRow(rect), clip(`[${label || "Input"}]`, w));
    return;
  }
  const inner = w - 4;
  const text = clip(label || "Input", inner);
  const box = `[ ${padRight(text, inner, "_")} ]`;
  grid.put(rect.x, middleRow(rect), clip(box, w));
}

function drawCheckbox(grid: Grid, rect: Rect, label: string): void {
  const box = `[x] ${label || "Checkbox"}`;
  grid.put(rect.x, middleRow(rect), clip(box, rect.w));
}

function drawToggle(grid: Grid, rect: Rect, label: string): void {
  // A shorter switch leaves room for the caption on narrow toggles.
  const knob = Array.from(label).length + 6 <= rect.w ? "[●──]" : "[●]";
  const knobWidth = Array.from(knob).length;
  const row = middleRow(rect);
  if (rect.w < knobWidth + 1) {
    grid.put(rect.x, row, clip(label || "Toggle", rect.w));
    return;
  }
  const text = clip(label, rect.w - knobWidth - 1);
  if (text) grid.put(rect.x, row, text);
  grid.put(rect.x + rect.w - knobWidth, row, knob);
}

function drawDropdown(grid: Grid, rect: Rect, label: string): void {
  const w = rect.w;
  const row = middleRow(rect);
  if (w < 7) {
    grid.put(rect.x, row, clip(`[${label || "Select"}]`, w));
    return;
  }
  const inner = w - 2;
  const text = clip(label || "Select", Math.max(1, inner - 4));
  const gap = Math.max(1, inner - Array.from(text).length - 3);
  const box = `[ ${text}${" ".repeat(gap)}▾ ]`;
  grid.put(rect.x, row, clip(box, w));
}

function drawTabs(grid: Grid, rect: Rect, items: string[]): void {
  const tabs = items.length > 0 ? items : ["Tab 1", "Tab 2"];
  const row = rect.h >= 3 ? rect.y + 1 : rect.y;
  if (rect.h >= 3) drawBox(grid, rect);

  const perTab = Math.max(4, Math.floor(rect.w / tabs.length));
  let cursor = rect.x;
  for (let i = 0; i < tabs.length; i += 1) {
    const isLast = i === tabs.length - 1;
    const width = isLast ? rect.x + rect.w - cursor : perTab;
    if (width <= 0) break;

    for (let k = 0; k < width; k += 1) grid.set(cursor + k, row, "─");
    if (i > 0) grid.set(cursor, row, "┬");
    const label = clip(tabs[i], Math.max(0, width - 2));
    const offset = Math.max(0, Math.floor((width - Array.from(label).length) / 2));
    if (label) grid.put(cursor + offset, row, label);

    cursor += width;
  }
}

function drawList(grid: Grid, rect: Rect, items: string[]): void {
  drawBox(grid, rect);
  if (rect.w < 4 || rect.h < 3 || items.length === 0) return;

  const inner = rect.w - 3;
  const available = rect.h - 2;
  const rows = Math.min(items.length, available);
  const step = Math.max(1, Math.floor(available / Math.max(1, items.length)));

  for (let i = 0; i < rows; i += 1) {
    const y = rect.y + 1 + i * step;
    if (y > rect.y + rect.h - 2) break;
    grid.put(rect.x + 2, y, clip(items[i], Math.max(1, inner)));

    if (step >= 2 && i < rows - 1) {
      const dividerY = y + step - 1;
      if (dividerY < rect.y + rect.h - 1) {
        for (let x = rect.x + 1; x < rect.x + rect.w - 1; x += 1) grid.set(x, dividerY, "─");
      }
    }
  }
}

function drawImage(grid: Grid, rect: Rect, label: string): void {
  drawBox(grid, rect);
  const ix = rect.x + 1;
  const iy = rect.y + 1;
  const iw = rect.w - 2;
  const ih = rect.h - 2;

  if (iw >= 3 && ih >= 2) {
    for (let j = 0; j < ih; j += 1) {
      for (let i = 0; i < iw; i += 1) {
        const nx = iw > 1 ? i / (iw - 1) : 0.5;
        const ny = ih > 1 ? j / (ih - 1) : 0.5;
        if (Math.abs(nx - ny) < 0.34) grid.set(ix + i, iy + j, "\\");
        else if (Math.abs(nx + ny - 1) < 0.34) grid.set(ix + i, iy + j, "/");
      }
    }
  }

  const text = clip(label, Math.max(1, iw - 2));
  if (text && ih >= 1 && Array.from(text).length <= iw) {
    const row = iy + Math.floor((ih - 1) / 2);
    grid.put(ix + Math.floor((iw - Array.from(text).length) / 2), row, text);
  }
}

function drawDivider(grid: Grid, rect: Rect): void {
  const row = middleRow(rect);
  for (let i = 0; i < rect.w; i += 1) grid.set(rect.x + i, row, "─");
}

/** The label is a small title on the top border ("┌─Contact us───┐"), as on the canvas. */
function drawContainer(grid: Grid, rect: Rect, label: string): void {
  drawBox(grid, rect);
  const text = clip(label.replace(/\s+/g, " ").trim(), Math.max(0, rect.w - 4));
  if (text && rect.w >= 6) grid.put(rect.x + 2, rect.y, text);
}

function drawToolbar(grid: Grid, rect: Rect, label: string): void {
  drawBox(grid, rect);
  const row = middleRow(rect);
  const text = clip(label, Math.max(0, rect.w - 4));
  if (text) grid.put(rect.x + 2, row, text);
}

function drawSidebar(grid: Grid, rect: Rect, element: WireframeElement): void {
  drawBox(grid, rect);
  if (rect.w < 5 || rect.h < 3) return;

  const row = rect.y + 1;
  const text = clip(element.label, Math.max(1, rect.w - 3));
  if (text) grid.put(rect.x + 2, row, text);

  const items = element.items ?? [];
  for (let i = 0; i < items.length; i += 1) {
    const y = row + 1 + i;
    if (y > rect.y + rect.h - 2) break;
    grid.put(rect.x + 2, y, clip(`• ${items[i]}`, Math.max(1, rect.w - 3)));
  }
}

function drawText(grid: Grid, rect: Rect, label: string): void {
  const lines = label.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const y = rect.y + i;
    if (y >= grid.rows) break;
    grid.put(rect.x, y, clip(lines[i], rect.w));
  }
}

function drawCenteredText(grid: Grid, rect: Rect, text: string): void {
  const clipped = clip(text, rect.w);
  const offset = Math.max(0, Math.floor((rect.w - Array.from(clipped).length) / 2));
  grid.put(rect.x + offset, middleRow(rect), clipped);
}

function drawTextarea(grid: Grid, rect: Rect, label: string): void {
  drawBox(grid, rect);
  if (rect.w < 4 || rect.h < 2) return;

  const inner = Math.max(1, rect.w - 4);
  const firstLine = label.split("\n")[0] ?? "";
  const text = `${clip(firstLine, Math.max(1, inner - 1))}`;
  grid.put(rect.x + 2, rect.y + 1, text);
  if (text && Array.from(text).length < inner) {
    grid.put(rect.x + 2 + Array.from(text).length, rect.y + 1, "_".repeat(inner - Array.from(text).length));
  }
}

function drawRadio(grid: Grid, rect: Rect, label: string): void {
  grid.put(rect.x, middleRow(rect), clip(`( ) ${label || "Radio"}`, rect.w));
}

function drawSlider(grid: Grid, rect: Rect, label: string): void {
  const row = middleRow(rect);
  const track = Math.max(4, rect.w);
  const thumb = Math.max(1, Math.floor(track * 0.6));
  const width = Math.max(0, track - Array.from(label).length - 1);

  if (label && rect.w > Array.from(label).length + 6) {
    grid.put(rect.x, row, clip(`${label} `, Math.max(0, rect.w)));
    const start = rect.x + Array.from(label).length + 1;
    for (let i = 0; i < width; i += 1) grid.set(start + i, row, "─");
    grid.set(start + Math.min(width - 1, thumb), row, "●");
    return;
  }

  for (let i = 0; i < rect.w; i += 1) grid.set(rect.x + i, row, "─");
  grid.set(rect.x + Math.min(rect.w - 1, thumb), row, "●");
}

function drawProgress(grid: Grid, rect: Rect): void {
  const filled = Math.max(1, Math.round(rect.w * 0.6));
  let line = "[";
  for (let i = 0; i < Math.max(1, rect.w - 2); i += 1) line += i < filled ? "█" : "░";
  line += "]";
  grid.put(rect.x, middleRow(rect), clip(line, Math.max(rect.w, 3)));
}

function drawTable(grid: Grid, rect: Rect, columns: string[], rows: string[]): void {
  drawBox(grid, rect);
  if (rect.w < 6 || rect.h < 3) return;

  const columnCount = Math.max(1, columns.length);
  const inner = rect.w - 2;
  const columnWidth = Math.max(3, Math.floor(inner / columnCount));

  const writeRow = (cells: string[], y: number) => {
    for (let index = 0; index < columnCount; index += 1) {
      const start = rect.x + 1 + index * columnWidth;
      const width = index === columnCount - 1 ? rect.x + rect.w - 1 - start : columnWidth;
      if (width <= 0) continue;
      const cell = clip(cells[index] ?? "", Math.max(0, width - 1));
      if (cell) grid.put(start + 1, y, cell);
      if (index > 0) {
        for (let j = 0; j < rect.h - 2; j += 1) grid.set(start, rect.y + 1 + j, "│");
      }
    }
  };

  const headerY = rect.y + 1;
  writeRow(columns, headerY);

  if (rect.h >= 4) {
    for (let x = rect.x + 1; x < rect.x + rect.w - 1; x += 1) grid.set(x, headerY + 1, "─");
    for (let index = 1; index < columnCount; index += 1) {
      grid.set(rect.x + 1 + index * columnWidth, headerY + 1, "┼");
    }
  }

  const availableRows = Math.max(0, Math.floor((rect.h - 3) / 1));
  rows.slice(0, Math.max(0, rect.h - 3)).forEach((row, index) => {
    if (index >= availableRows) return;
    const y = headerY + 2 + index;
    if (y > rect.y + rect.h - 2) return;
    writeRow(row.split("|").map((cell) => cell.trim()), y);
  });
}

function drawBottomNav(grid: Grid, rect: Rect, items: string[]): void {
  drawBox(grid, rect);
  if (rect.w < 4) return;

  const entries = items.length > 0 ? items : ["Home", "Search", "Profile"];
  const inner = rect.w - 2;
  const segment = Math.max(3, Math.floor(inner / entries.length));
  const row = rect.h >= 3 ? rect.y + 1 : middleRow(rect);

  entries.forEach((item, index) => {
    const start = rect.x + 1 + index * segment;
    const width = index === entries.length - 1 ? rect.x + rect.w - 1 - start : segment;
    if (width <= 1) return;
    const label = clip(item, Math.max(1, width - 1));
    const offset = Math.max(0, Math.floor((width - Array.from(label).length) / 2));
    grid.put(start + offset, row, label);
  });
}

function drawDialog(grid: Grid, rect: Rect, label: string): void {
  drawBox(grid, rect);
  if (rect.w < 5) return;

  const title = clip(label || "Dialog", Math.max(1, rect.w - 6));
  grid.put(rect.x + 2, rect.y + 1, title);
  if (rect.h >= 3) {
    for (let x = rect.x + 1; x < rect.x + rect.w - 1; x += 1) grid.set(x, rect.y + 2, "─");
  }
}

/** Clear the box interior: a nested scene is opaque, like the element on the canvas. */
function clearInterior(grid: Grid, rect: Rect): void {
  for (let j = 1; j < rect.h - 1; j += 1) {
    for (let i = 1; i < rect.w - 1; i += 1) grid.set(rect.x + i, rect.y + j, " ");
  }
}

/** Canvas: a titled box with the scene rendered INTO it (nested ASCII). */
function drawDiagram(grid: Grid, rect: Rect, element: WireframeElement): void {
  drawBox(grid, rect);
  if (rect.w < 4 || rect.h < 2) return;
  clearInterior(grid, rect);
  const title = element.label.trim() ? `Canvas: ${element.label.replace(/\s+/g, " ").trim()}` : "Canvas";
  const titleRow = rect.h >= 3 ? rect.y + 1 : rect.y;
  grid.put(rect.x + 2, titleRow, clip(title, rect.w - 4));
  const inner = { x: rect.x + 2, y: rect.y + 2, w: rect.w - 4, h: rect.h - 3 };
  if (!element.diagram || element.diagram.objects.length === 0 || inner.w < 3 || inner.h < 1) return;
  renderDiagramAsciiLines(element.diagram, inner.w, inner.h).forEach((line, row) => {
    grid.put(inner.x, inner.y + row, line);
  });
}

/** Word-wrap to `width` columns (hard-breaking words that are longer than a line). */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word;
    while (Array.from(rest).length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(Array.from(rest).slice(0, width).join(""));
      rest = Array.from(rest).slice(width).join("");
    }
    if (!rest) continue;
    const candidate = current ? `${current} ${rest}` : rest;
    if (Array.from(candidate).length > width) {
      lines.push(current);
      current = rest;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Drawing: never an attempt to turn freehand into ASCII (that would suggest Wirefragma
 * understands the sketch) — a box with "Drawing" and the human-written description.
 */
function drawDrawing(grid: Grid, rect: Rect, element: WireframeElement): void {
  drawBox(grid, rect);
  if (rect.w < 4 || rect.h < 2) return;
  clearInterior(grid, rect);
  const titleRow = rect.h >= 3 ? rect.y + 1 : rect.y;
  grid.put(rect.x + 2, titleRow, clip("Drawing", rect.w - 4));
  const available = rect.y + rect.h - 1 - (titleRow + 1);
  const lines = wrap(element.drawing?.description ?? "", Math.max(1, rect.w - 4));
  lines.slice(0, Math.max(0, available)).forEach((line, index, shown) => {
    const text = index === shown.length - 1 && shown.length < lines.length ? clip(`${line}…`, rect.w - 4) : line;
    grid.put(rect.x + 2, titleRow + 1 + index, text);
  });
}

/** Compact value label for the ASCII sketch: 1500 -> 1.5k. */
function asciiValue(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(value * 100) / 100}`;
}

/** Rows a chart may use (heading included), so a tall box does not become a wall of glyphs. */
const CHART_MAX_ROWS = 14;
/** Below this inner width a chart has nowhere to grow; it falls back to a plain box. */
const CHART_MIN_INNER_WIDTH = 14;

/** One fill glyph per series (and per pie slice): distinguishable in plain text, no colours needed. */
const SERIES_GLYPHS = ["█", "▓", "▒", "░", "▚", "▞", "▪", "▫"];
/** One point glyph per series for line / area charts. */
const POINT_GLYPHS = ["●", "○", "◆", "◇", "■", "□", "▲", "△"];
/** Partial block heights (eighths), used for the top of a single-series column. */
const EIGHTHS = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

type ChartSketchData = ReturnType<typeof normalizeChartData>;

const CHART_KIND_NAME: Record<string, string> = {
  bar: "Bar chart",
  stackedBar: "Stacked bars",
  line: "Line chart",
  area: "Area chart",
  pie: "Pie chart",
  donut: "Donut chart"
};

/** The header line of a chart box: what it is, then its title. */
function chartHeading(element: WireframeElement, data: ChartSketchData): string {
  const title = (data.title ?? "").trim() || element.label.trim();
  const kind = CHART_KIND_NAME[data.kind] ?? "Chart";
  return title ? `${kind}: ${title.replace(/\s+/g, " ")}` : kind;
}

/** Sketch values are never negative: a wireframe sketch shows magnitude, the table shows the sign. */
function sketchValue(value: number | null | undefined): number {
  return value === null || value === undefined || !Number.isFinite(value) ? 0 : Math.max(0, value);
}

/** Horizontal bars, one category per row (also the fallback when columns do not fit). */
function drawChartBars(grid: Grid, data: ChartSketchData, inner: Rect, firstRow: number, rows: number): void {
  const values = data.categories.map((_, index) => {
    let sum = 0;
    let seen = false;
    for (const series of data.series) {
      const value = series.values[index];
      if (value === null || value === undefined) continue;
      sum += Math.abs(value);
      seen = true;
    }
    return seen ? sum : null;
  });
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  const valueWidth = Math.min(7, Math.max(4, ...values.map((value) => (value === null ? 1 : asciiValue(value).length))));
  // `label` + ` ` + value + ` ` + bar
  const labelWidth = Math.max(0, inner.w - valueWidth - 3);
  const barSpace = Math.max(1, inner.w - labelWidth - valueWidth - 2);
  if (labelWidth < 3) return;

  for (let index = 0; index < Math.min(rows, data.categories.length); index += 1) {
    const value = values[index];
    const y = firstRow + index;
    const barWidth = Math.max(value === null ? 0 : 1, Math.round(((value ?? 0) / max) * barSpace));
    const bar = value === null ? "" : "█".repeat(barWidth);
    const prefix = `${clip(data.categories[index] || `#${index + 1}`, labelWidth)} `;
    const number = value === null ? "—" : asciiValue(value);
    grid.put(inner.x, y, clip(`${prefix}${padRight(number, valueWidth)} ${bar}`, inner.w));
  }
}

/** Shared geometry of the vertical charts: an axis on the left, category labels underneath. */
interface PlotArea {
  /** x of the vertical axis. */
  axisX: number;
  /** First plot column (right of the axis) and its width. */
  x0: number;
  width: number;
  /** Rows of the plot, from `top` down to the row above the horizontal axis. */
  top: number;
  height: number;
  axisRow: number;
  labelRow: number;
}

/** Minimum rows for a vertical chart: 2 plot rows + axis + labels. */
const CHART_MIN_PLOT_ROWS = 2;

function plotArea(inner: Rect, firstRow: number, rows: number): PlotArea | null {
  const height = rows - 2;
  if (height < CHART_MIN_PLOT_ROWS || inner.w < 6) return null;
  return {
    axisX: inner.x,
    x0: inner.x + 1,
    width: inner.w - 1,
    top: firstRow,
    height,
    axisRow: firstRow + height,
    labelRow: firstRow + height + 1
  };
}

function drawPlotFrame(grid: Grid, plot: PlotArea): void {
  for (let row = plot.top; row < plot.axisRow; row += 1) grid.set(plot.axisX, row, "│");
  grid.set(plot.axisX, plot.axisRow, "└");
  for (let col = 0; col < plot.width; col += 1) grid.set(plot.x0 + col, plot.axisRow, "─");
}

/** Category labels under the axis, one slot each; a slot too narrow for text is left blank. */
function drawCategoryLabels(grid: Grid, plot: PlotArea, categories: string[], shown: number): void {
  const slot = plot.width / shown;
  if (slot < 2) return;
  for (let index = 0; index < shown; index += 1) {
    const start = plot.x0 + Math.round(index * slot);
    const end = plot.x0 + Math.round((index + 1) * slot);
    const room = Math.max(1, end - start - (slot >= 4 ? 1 : 0));
    grid.put(start, plot.labelRow, clip(categories[index] || `#${index + 1}`, room));
  }
}

/**
 * Vertical columns: grouped (one column per series) or stacked (series piled up). A single series
 * gets smooth tops from the eighth-block glyphs; several series are told apart by their fill glyph.
 */
function drawChartColumns(
  grid: Grid,
  data: ChartSketchData,
  inner: Rect,
  firstRow: number,
  rows: number,
  stacked: boolean
): boolean {
  const plot = plotArea(inner, firstRow, rows);
  if (!plot) return false;
  const seriesCount = Math.min(data.series.length, SERIES_GLYPHS.length);
  const perColumn = stacked ? 1 : seriesCount;
  const slotMin = perColumn + 1 > 2 ? perColumn : 2;
  const shown = Math.min(data.categories.length, Math.floor(plot.width / slotMin));
  if (shown < 1) return false;
  const slot = Math.floor(plot.width / shown);
  const gap = slot > perColumn ? 1 : 0;
  const barWidth = Math.max(1, Math.min(3, Math.floor((slot - gap) / perColumn)));
  const group = barWidth * perColumn;
  const offset = Math.floor((slot - group) / 2);

  const totals = data.categories.slice(0, shown).map((_, index) =>
    data.series.slice(0, seriesCount).reduce((sum, series) => sum + sketchValue(series.values[index]), 0)
  );
  const peak = stacked
    ? Math.max(0, ...totals)
    : Math.max(0, ...data.series.slice(0, seriesCount).flatMap((series) => series.values.slice(0, shown).map(sketchValue)));
  if (peak <= 0) return false;

  drawPlotFrame(grid, plot);
  const bottom = plot.axisRow - 1;
  for (let index = 0; index < shown; index += 1) {
    const base = plot.x0 + index * slot + offset;
    if (stacked) {
      let cumulative = 0;
      let previousRows = 0;
      for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
        const value = sketchValue(data.series[seriesIndex].values[index]);
        cumulative += value;
        const upTo = Math.round((cumulative / peak) * plot.height);
        const fillTo = value > 0 ? Math.max(upTo, previousRows + 1) : previousRows;
        for (let level = previousRows; level < Math.min(fillTo, plot.height); level += 1) {
          for (let col = 0; col < barWidth; col += 1) grid.set(base + col, bottom - level, SERIES_GLYPHS[seriesIndex]);
        }
        previousRows = Math.min(fillTo, plot.height);
      }
      continue;
    }
    for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
      const value = sketchValue(data.series[seriesIndex].values[index]);
      const x = base + seriesIndex * barWidth;
      if (seriesCount === 1) {
        const eighths = Math.round((value / peak) * plot.height * 8);
        const full = Math.floor(eighths / 8);
        for (let level = 0; level < full; level += 1) {
          for (let col = 0; col < barWidth; col += 1) grid.set(x + col, bottom - level, "█");
        }
        const remainder = eighths % 8;
        if (remainder > 0 && full < plot.height) {
          for (let col = 0; col < barWidth; col += 1) grid.set(x + col, bottom - full, EIGHTHS[remainder]);
        }
      } else {
        const height = value > 0 ? Math.max(1, Math.round((value / peak) * plot.height)) : 0;
        for (let level = 0; level < height; level += 1) {
          for (let col = 0; col < barWidth; col += 1) grid.set(x + col, bottom - level, SERIES_GLYPHS[seriesIndex]);
        }
      }
    }
  }
  drawCategoryLabels(grid, plot, data.categories, shown);
  return true;
}

/** Line / area: points joined by dots over the same axes; an area also shades under its first series. */
function drawChartLines(
  grid: Grid,
  data: ChartSketchData,
  inner: Rect,
  firstRow: number,
  rows: number,
  area: boolean
): boolean {
  const plot = plotArea(inner, firstRow, rows);
  if (!plot) return false;
  const shown = Math.min(data.categories.length, plot.width);
  if (shown < 1) return false;
  const seriesCount = Math.min(data.series.length, POINT_GLYPHS.length);
  const peak = Math.max(
    0,
    ...data.series.slice(0, seriesCount).flatMap((series) => series.values.slice(0, shown).map(sketchValue))
  );
  if (peak <= 0) return false;

  drawPlotFrame(grid, plot);
  const slot = plot.width / shown;
  const bottom = plot.axisRow - 1;
  const columnOf = (index: number) => plot.x0 + Math.min(plot.width - 1, Math.floor((index + 0.5) * slot));
  const rowOf = (value: number) => bottom - Math.round((value / peak) * (plot.height - 1));

  for (let seriesIndex = 0; seriesIndex < seriesCount; seriesIndex += 1) {
    const points: { x: number; y: number }[] = [];
    for (let index = 0; index < shown; index += 1) {
      const raw = data.series[seriesIndex].values[index];
      if (raw === null || raw === undefined) {
        points.push({ x: -1, y: -1 });
        continue;
      }
      points.push({ x: columnOf(index), y: rowOf(sketchValue(raw)) });
    }
    // Segments between neighbouring points (a gap in the data breaks the line).
    for (let index = 0; index + 1 < points.length; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (from.x < 0 || to.x < 0) continue;
      for (let x = from.x + 1; x < to.x; x += 1) {
        const ratio = (x - from.x) / (to.x - from.x);
        const y = Math.round(from.y + (to.y - from.y) * ratio);
        if (area && seriesIndex === 0) {
          for (let fill = y + 1; fill <= bottom; fill += 1) grid.set(x, fill, "░");
        }
        grid.set(x, y, "·");
      }
    }
    for (const point of points) {
      if (point.x < 0) continue;
      if (area && seriesIndex === 0) {
        for (let fill = point.y + 1; fill <= bottom; fill += 1) grid.set(point.x, fill, "░");
      }
      grid.set(point.x, point.y, POINT_GLYPHS[seriesIndex]);
    }
  }
  drawCategoryLabels(grid, plot, data.categories, shown);
  return true;
}

/** One legend line (`█ Revenue ▒ Costs`), clipped to the box. */
function chartLegendText(data: ChartSketchData, glyphs: string[], width: number): string {
  const parts = data.series.slice(0, glyphs.length).map((series, index) => `${glyphs[index]} ${series.name || `Series ${index + 1}`}`);
  return clip(parts.join("  "), width);
}

/**
 * Pie / donut: a disc whose cells carry the slice glyph (the character cell is twice as tall as it
 * is wide, so the horizontal radius is doubled), with the legend and percentages to its right.
 * Returns false when the box has no room for a disc; the caller then prints the plain slice list.
 */
function drawChartDisc(
  grid: Grid,
  data: ChartSketchData,
  inner: Rect,
  firstRow: number,
  rows: number,
  donut: boolean
): boolean {
  const values = data.categories.map((_, index) => sketchValue(data.series[0]?.values[index]));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return false;
  let diameter = Math.min(rows, 9);
  if (diameter % 2 === 0) diameter -= 1;
  if (diameter < 5) return false;
  const radiusY = diameter / 2;
  const radiusX = radiusY * 2;
  const discWidth = diameter * 2 + 1;
  const legendWidth = inner.w - discWidth - 2;
  if (legendWidth < 8) return false;

  const centreX = inner.x + Math.floor(discWidth / 2);
  const centreY = firstRow + Math.floor(diameter / 2);
  const slices = Math.min(values.length, SERIES_GLYPHS.length);
  const bounds: number[] = [];
  let running = 0;
  for (let index = 0; index < slices; index += 1) {
    running += values[index];
    bounds.push(running / total);
  }
  for (let dy = -Math.floor(diameter / 2); dy <= Math.floor(diameter / 2); dy += 1) {
    for (let dx = -Math.floor(discWidth / 2); dx <= Math.floor(discWidth / 2); dx += 1) {
      const nx = dx / radiusX;
      const ny = dy / radiusY;
      const distance = nx * nx + ny * ny;
      if (distance > 1) continue;
      if (donut && distance < 0.2) continue;
      // Clockwise from 12 o'clock.
      let angle = Math.atan2(dx / 2, -dy);
      if (angle < 0) angle += Math.PI * 2;
      const fraction = angle / (Math.PI * 2);
      let slice = bounds.findIndex((bound) => fraction < bound);
      if (slice < 0) slice = slices - 1;
      grid.set(centreX + dx, centreY + dy, SERIES_GLYPHS[slice]);
    }
  }

  const legendX = inner.x + discWidth + 2;
  const legendRows = Math.min(rows, slices);
  for (let index = 0; index < legendRows; index += 1) {
    const percent = `${Math.round((values[index] / total) * 100)}%`;
    const label = clip(data.categories[index] || `#${index + 1}`, Math.max(1, legendWidth - 2 - percent.length - 1));
    grid.put(legendX, firstRow + index, clip(`${SERIES_GLYPHS[index]} ${label} ${percent}`, legendWidth));
  }
  return true;
}

/** The plain slice list: the honest text form of a share when there is no room for a disc. */
function drawChartShares(grid: Grid, data: ChartSketchData, inner: Rect, firstRow: number, rows: number): void {
  const values = data.categories.map((_, index) => sketchValue(data.series[0]?.values[index]));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return;

  for (let index = 0; index < Math.min(rows, data.categories.length); index += 1) {
    const percent = `${Math.round((values[index] / total) * 100)}%`;
    const glyph = SERIES_GLYPHS[index % SERIES_GLYPHS.length];
    const width = Math.max(1, inner.w - 4 - percent.length);
    const label = clip(data.categories[index] || `#${index + 1}`, width);
    grid.put(inner.x, firstRow + index, clip(`${glyph} ${label} ${percent}`, inner.w));
  }
}

/**
 * Chart: a titled box holding a sketch you can tell apart by kind —
 * vertical columns (bar), stacked columns, a dotted line over axes (line), the same shaded (area),
 * a filled disc with its legend (pie) or a ring (donut). Horizontal bars are used when the data asks
 * for them and as the fallback when the columns do not fit; a plain frame when even that does not.
 * The numbers are in the Markdown table and the `ui-project` block, never only here.
 */
function drawChart(grid: Grid, rect: Rect, element: WireframeElement): void {
  drawBox(grid, rect);
  const inner = { x: rect.x + 2, y: rect.y + 1, w: rect.w - 4, h: rect.h - 2 };
  const data = normalizeChartData(element.chart);
  const heading = chartHeading(element, data);
  if (inner.w < CHART_MIN_INNER_WIDTH || inner.h < 1) {
    if (inner.w >= 4 && inner.h >= 1) grid.put(inner.x, inner.y, clip(heading, inner.w));
    return;
  }

  const peak = chartMaxAbsValue(data);
  const maxText = peak > 0 ? `max ${asciiValue(peak)}` : "";
  const maxFits = maxText !== "" && Array.from(heading).length + maxText.length + 2 <= inner.w;
  grid.put(inner.x, inner.y, clip(heading, inner.w));
  if (maxFits) grid.put(inner.x + inner.w - maxText.length, inner.y, maxText);

  let firstRow = inner.y + 1;
  let rows = Math.min(CHART_MAX_ROWS, inner.h) - 1;
  if (rows < 1 || data.categories.length === 0 || data.series.length === 0 || peak === 0) return;

  const single = isSingleSeriesKind(data.kind);
  // A legend line only when it pays for itself: several series and room to spare.
  if (!single && data.series.length > 1 && rows >= 6) {
    const glyphs = data.kind === "line" || data.kind === "area" ? POINT_GLYPHS : SERIES_GLYPHS;
    grid.put(inner.x, firstRow, chartLegendText(data, glyphs, inner.w));
    firstRow += 1;
    rows -= 1;
  }

  const horizontal = data.options?.horizontal === true && (data.kind === "bar" || data.kind === "stackedBar");
  let drawn = false;
  if (single) drawn = drawChartDisc(grid, data, inner, firstRow, rows, data.kind === "donut");
  else if (data.kind === "line" || data.kind === "area") drawn = drawChartLines(grid, data, inner, firstRow, rows, data.kind === "area");
  else if (!horizontal) drawn = drawChartColumns(grid, data, inner, firstRow, rows, data.kind === "stackedBar");
  if (drawn) return;

  if (single) drawChartShares(grid, data, inner, firstRow, rows);
  else drawChartBars(grid, data, inner, firstRow, rows);
}

function drawElement(grid: Grid, element: WireframeElement, rect: Rect): void {
  switch (element.type) {
    case "container":
      drawContainer(grid, rect, element.label);
      break;
    case "toolbar":
      drawToolbar(grid, rect, element.label);
      break;
    case "sidebar":
      drawSidebar(grid, rect, element);
      break;
    case "text":
      drawText(grid, rect, element.label || "Text");
      break;
    case "button":
      drawButton(grid, rect, element.label);
      break;
    case "input":
      drawInput(grid, rect, element.label);
      break;
    case "textarea":
      drawTextarea(grid, rect, element.label);
      break;
    case "checkbox":
      drawCheckbox(grid, rect, element.label);
      break;
    case "radio":
      drawRadio(grid, rect, element.label);
      break;
    case "toggle":
      drawToggle(grid, rect, element.label);
      break;
    case "dropdown":
      drawDropdown(grid, rect, element.label);
      break;
    case "slider":
      drawSlider(grid, rect, element.label);
      break;
    case "progress":
      drawProgress(grid, rect);
      break;
    case "iconButton":
      drawButton(grid, rect, element.label || "+");
      break;
    case "tabs":
      drawTabs(grid, rect, element.items ?? []);
      break;
    case "list":
      drawList(grid, rect, element.items ?? []);
      break;
    case "table":
      drawTable(grid, rect, element.columns ?? [], element.items ?? []);
      break;
    case "image":
      drawImage(grid, rect, element.label);
      break;
    case "icon":
      drawText(grid, rect, `[${element.label || "★"}]`);
      break;
    case "avatar":
      drawCenteredText(grid, rect, `(${element.label || "AB"})`);
      break;
    case "badge":
      drawCenteredText(grid, rect, `‹ ${element.label || "Badge"} ›`);
      break;
    case "divider":
      drawDivider(grid, rect);
      break;
    case "bottomNav":
      drawBottomNav(grid, rect, element.items ?? []);
      break;
    case "dialog":
      drawDialog(grid, rect, element.label);
      break;
    case "diagram":
      drawDiagram(grid, rect, element);
      break;
    case "drawing":
      drawDrawing(grid, rect, element);
      break;
    case "chart":
      drawChart(grid, rect, element);
      break;
    default:
      drawBox(grid, rect);
      break;
  }
}

export function renderAsciiLines(project: WireframeProject): string[] {
  const { cols, rows } = getAsciiDimensions(project.canvas);
  const grid = new Grid(cols, rows);

  const canvasWidth = project.canvas.width || 1;
  const canvasHeight = project.canvas.height || 1;
  const sx = cols / canvasWidth;
  const sy = rows / canvasHeight;

  // Only effective-visible elements are drawn, back to front following layer + element order.
  // Drawings without an LLM description are left out (see `isOmittedFromLlmExport`).
  for (const element of exportedElementsInDrawOrder(project)) {
    drawElement(grid, element, toRect(element, sx, sy, grid));
  }

  const lines = grid.lines();
  while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 1 && lines[0].trim() === "") return [""];
  return lines;
}

export function renderAscii(project: WireframeProject): string {
  return renderAsciiLines(project).join("\n");
}
