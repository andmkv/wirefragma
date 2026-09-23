import { visibleElementsInDrawOrder, type WireframeElement, type WireframeProject } from "../model/project";

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

function drawCentered(grid: Grid, rect: Rect, text: string, row: number, limit: number): void {
  const clipped = clip(text, limit);
  if (!clipped) return;
  const offset = Math.max(0, Math.floor((rect.w - Array.from(clipped).length) / 2));
  grid.put(rect.x + offset, row, clipped);
}

function drawButton(grid: Grid, rect: Rect, label: string): void {
  const inner = Math.max(1, rect.w - 4);
  const text = clip(label || "Button", inner);
  const box = `[ ${text} ]`;
  const rendered = Array.from(box).length <= rect.w ? box : `[${clip(label, Math.max(1, rect.w - 2))}]`;
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
  const knob = "[●──]";
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

function drawContainer(grid: Grid, rect: Rect, label: string): void {
  drawBox(grid, rect);
  if (label && Array.from(label).length <= rect.w - 4) {
    drawCentered(grid, rect, label, middleRow(rect), rect.w - 4);
  }
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
  for (const element of visibleElementsInDrawOrder(project)) {
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
