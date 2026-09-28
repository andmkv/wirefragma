import {
  DIAGRAM_TYPE_LABEL,
  bezierSamples,
  connectorEnds,
  isBoxObject,
  objectLabel,
  rectContainsPoint,
  type DiagramBox,
  type DiagramData,
  type DiagramObject,
  type DiagramPoint,
  type DiagramRect
} from "../model/diagram";

/**
 * Text renderings of a Canvas scene for the LLM-facing export:
 *  - an ASCII sketch (nested into the main ASCII wireframe, and standalone in the element section);
 *  - a numbered primitive list with exact scene coordinates;
 *  - deterministic spatial relationships between the labelled shapes.
 *
 * Pure and deterministic, like the main ASCII renderer. None of this is ever parsed back: the
 * canonical scene lives in the `ui-project` block.
 */

/* ------------------------------------------------------------------ ASCII */

type Cell = [number, number];

class SceneGrid {
  readonly cells: string[][];
  readonly occupied: boolean[][];

  constructor(
    readonly cols: number,
    readonly rows: number
  ) {
    this.cells = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
    this.occupied = Array.from({ length: rows }, () => new Array<boolean>(cols).fill(false));
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** Shapes claim their cells, so connectors route around them instead of erasing borders. */
  claim(x: number, y: number, char: string): void {
    if (!this.inBounds(x, y)) return;
    this.cells[y][x] = char;
    this.occupied[y][x] = true;
  }

  put(x: number, y: number, text: string, claim = true): void {
    Array.from(text).forEach((char, index) => {
      if (claim) this.claim(x + index, y, char);
      else if (this.isFree(x + index, y)) this.cells[y][x + index] = char;
    });
  }

  isFree(x: number, y: number): boolean {
    return this.inBounds(x, y) && !this.occupied[y][x] && this.cells[y][x] === " ";
  }

  lines(): string[] {
    return this.cells.map((row) => row.join(""));
  }
}

function clip(text: string, max: number): string {
  if (max <= 0) return "";
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max === 1) return "…";
  return `${chars.slice(0, max - 1).join("")}…`;
}

function length(text: string): number {
  return Array.from(text).length;
}

interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function toCells(rect: DiagramRect, sx: number, sy: number, grid: SceneGrid): CellRect {
  const x = Math.max(0, Math.min(grid.cols - 1, Math.round(rect.x * sx)));
  const y = Math.max(0, Math.min(grid.rows - 1, Math.round(rect.y * sy)));
  const right = Math.max(x, Math.min(grid.cols - 1, Math.round((rect.x + rect.width) * sx) - 1));
  const bottom = Math.max(y, Math.min(grid.rows - 1, Math.round((rect.y + rect.height) * sy) - 1));
  return { x, y, w: right - x + 1, h: bottom - y + 1 };
}

function drawFrame(grid: SceneGrid, r: CellRect, corners: [string, string, string, string]): void {
  const [tl, tr, bl, br] = corners;
  grid.claim(r.x, r.y, tl);
  grid.claim(r.x + r.w - 1, r.y, tr);
  grid.claim(r.x, r.y + r.h - 1, bl);
  grid.claim(r.x + r.w - 1, r.y + r.h - 1, br);
  for (let i = 1; i < r.w - 1; i += 1) {
    grid.claim(r.x + i, r.y, "─");
    grid.claim(r.x + i, r.y + r.h - 1, "─");
  }
  for (let j = 1; j < r.h - 1; j += 1) {
    grid.claim(r.x, r.y + j, "│");
    grid.claim(r.x + r.w - 1, r.y + j, "│");
    for (let i = 1; i < r.w - 1; i += 1) grid.claim(r.x + i, r.y + j, " ");
  }
}

function centered(grid: SceneGrid, r: CellRect, text: string, width: number): void {
  const content = clip(text, width);
  if (!content) return;
  const row = r.y + Math.floor((r.h - 1) / 2);
  grid.put(r.x + Math.max(0, Math.floor((r.w - length(content)) / 2)), row, content);
}

function drawBoxObject(grid: SceneGrid, object: DiagramBox, sx: number, sy: number): void {
  const r = toCells(object, sx, sy, grid);
  const label = objectLabel(object);
  if (object.type === "text") {
    const lines = (object.label ?? "").split("\n");
    lines.forEach((line, index) => {
      if (r.y + index < grid.rows) grid.put(r.x, r.y + index, clip(line.trim(), grid.cols - r.x));
    });
    return;
  }
  if (object.type === "rectangle") {
    if (r.w >= 3 && r.h >= 3) {
      drawFrame(grid, r, ["┌", "┐", "└", "┘"]);
      centered(grid, r, label, r.w - 2);
    } else {
      centered(grid, r, `[${clip(label, Math.max(1, r.w - 2))}]`, Math.max(r.w, 3));
    }
    return;
  }
  // Ellipse: rounded frame when there is room, `( label )` otherwise.
  if (r.w >= 4 && r.h >= 3) {
    drawFrame(grid, r, ["╭", "╮", "╰", "╯"]);
    centered(grid, r, label, r.w - 2);
  } else {
    const inner = clip(label, Math.max(1, r.w - 4));
    centered(grid, r, inner ? `( ${inner} )` : "()", Math.max(r.w, 3));
  }
}

/** Cells visited by a straight run between two continuous points (Bresenham in cell space). */
function rasterize(a: DiagramPoint, b: DiagramPoint, sx: number, sy: number, grid: SceneGrid): Cell[] {
  const clampX = (value: number) => Math.max(0, Math.min(grid.cols - 1, value));
  const clampY = (value: number) => Math.max(0, Math.min(grid.rows - 1, value));
  let x0 = clampX(Math.floor(a.x * sx));
  let y0 = clampY(Math.floor(a.y * sy));
  const x1 = clampX(Math.floor(b.x * sx));
  const y1 = clampY(Math.floor(b.y * sy));
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const stepX = x0 < x1 ? 1 : -1;
  const stepY = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  const cells: Cell[] = [];
  for (;;) {
    cells.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x0 += stepX;
    }
    if (e2 <= dx) {
      error += dx;
      y0 += stepY;
    }
  }
  return cells;
}

function pathCells(points: DiagramPoint[], sx: number, sy: number, grid: SceneGrid): Cell[] {
  const cells: Cell[] = [];
  for (let index = 1; index < points.length; index += 1) {
    for (const cell of rasterize(points[index - 1], points[index], sx, sy, grid)) {
      const last = cells[cells.length - 1];
      if (!last || last[0] !== cell[0] || last[1] !== cell[1]) cells.push(cell);
    }
  }
  return cells;
}

function stepChar(dx: number, dy: number): string {
  if (dy === 0) return "─";
  if (dx === 0) return "│";
  return (dx > 0) === (dy > 0) ? "\\" : "/";
}

function headChar(dx: number, dy: number): string {
  // Cells are about twice as tall as wide, so one row counts as two columns.
  if (Math.abs(dx) >= Math.abs(dy) * 2) return dx >= 0 ? ">" : "<";
  return dy >= 0 ? "v" : "^";
}

function drawConnector(grid: SceneGrid, object: DiagramObject, sx: number, sy: number): void {
  const points =
    object.type === "bezier"
      ? bezierSamples(object, 24)
      : object.type === "line" || object.type === "arrow"
        ? [
            { x: object.x1, y: object.y1 },
            { x: object.x2, y: object.y2 }
          ]
        : [];
  const cells = pathCells(points, sx, sy, grid);
  if (cells.length === 0) return;

  const free: number[] = [];
  cells.forEach(([x, y], index) => {
    if (grid.occupied[y][x]) return;
    const next = cells[index + 1] ?? cells[index];
    const previous = cells[index - 1] ?? cells[index];
    const char = stepChar(next[0] - previous[0], next[1] - previous[1]);
    grid.cells[y][x] = char === "─" && grid.cells[y][x] === "│" ? "┼" : char;
    free.push(index);
  });
  if (free.length === 0) return;

  if (object.type === "arrow") {
    const lastIndex = free[free.length - 1];
    const [hx, hy] = cells[lastIndex];
    const from = cells[Math.max(0, lastIndex - 2)];
    const dx = hx - from[0] || cells[cells.length - 1][0] - cells[0][0];
    const dy = hy - from[1] || cells[cells.length - 1][1] - cells[0][1];
    grid.cells[hy][hx] = headChar(dx, dy);
  }

  const label = objectLabel(object);
  if (!label) return;
  const [mx, my] = cells[free[Math.floor(free.length / 2)]];
  const text = clip(label, 24);
  const horizontal = Math.abs(cells[cells.length - 1][0] - cells[0][0]) >= Math.abs(cells[cells.length - 1][1] - cells[0][1]) * 2;
  if (horizontal) grid.put(Math.max(0, mx - Math.floor(length(text) / 2)), my - 1, text, false);
  else grid.put(mx + 2, my, text, false);
}

/**
 * The scene as `rows` lines of exactly `cols` characters. Shapes are drawn first (in object
 * order) and connectors afterwards, routed through free cells so arrows end next to a border
 * instead of erasing it.
 */
export function renderDiagramAsciiLines(data: DiagramData, cols: number, rows: number): string[] {
  const grid = new SceneGrid(Math.max(1, cols), Math.max(1, rows));
  const sx = grid.cols / Math.max(1, data.width);
  const sy = grid.rows / Math.max(1, data.height);
  for (const object of data.objects) if (isBoxObject(object)) drawBoxObject(grid, object, sx, sy);
  for (const object of data.objects) if (!isBoxObject(object)) drawConnector(grid, object, sx, sy);
  return grid.lines();
}

/** Standalone sketch for the element section: 60 columns, height from the scene's aspect. */
export function renderDiagramAscii(data: DiagramData, cols = 60): string {
  const rows = Math.max(6, Math.min(30, Math.round((cols * data.height) / Math.max(1, data.width) / 2)));
  const lines = renderDiagramAsciiLines(data, cols, rows).map((line) => line.replace(/\s+$/, ""));
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  while (lines.length > 0 && lines[0] === "") lines.shift();
  return lines.length > 0 ? lines.join("\n") : "(empty)";
}

/* ------------------------------------------------------------------ primitive list */

const r = (value: number) => Math.round(value);
const pointText = (p: DiagramPoint) => `(${r(p.x)},${r(p.y)})`;

/** Numbered list of every primitive, with exact scene coordinates. */
export function diagramContents(data: DiagramData): string[] {
  const lines: string[] = [];
  data.objects.forEach((object, index) => {
    lines.push(`${index + 1}. ${DIAGRAM_TYPE_LABEL[object.type]} \`${object.id}\``);
    const indent = "   ";
    const label = objectLabel(object);
    if (object.type === "text") {
      const text = (object.label ?? "").split("\n").map((line) => line.trim()).filter(Boolean).join(" / ");
      if (text) lines.push(`${indent}Text: ${text}`);
    } else if (label) {
      lines.push(`${indent}Label: ${label}`);
    }
    if (isBoxObject(object)) {
      lines.push(`${indent}Bounds: x=${r(object.x)}, y=${r(object.y)}, width=${r(object.width)}, height=${r(object.height)}`);
    } else if (object.type === "bezier") {
      lines.push(`${indent}Start: ${pointText(object.start)}`);
      lines.push(`${indent}Control 1: ${pointText(object.control1)}`);
      lines.push(`${indent}Control 2: ${pointText(object.control2)}`);
      lines.push(`${indent}End: ${pointText(object.end)}`);
    } else {
      lines.push(`${indent}From: ${pointText({ x: object.x1, y: object.y1 })}`);
      lines.push(`${indent}To: ${pointText({ x: object.x2, y: object.y2 })}`);
    }
  });
  return lines;
}

/* ------------------------------------------------------------------ relationships */

/** How a shape is referred to in prose: its label, or its type and id. */
export function shapeReference(object: DiagramObject): string {
  const label = objectLabel(object);
  return label ? `"${label}"` : `${DIAGRAM_TYPE_LABEL[object.type]} \`${object.id}\``;
}

/** Scene units within which two centres count as aligned, and endpoints as attached. */
const ALIGN_TOLERANCE = 4;
const ATTACH_TOLERANCE = 8;

const center = (rect: DiagramRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const area = (rect: DiagramRect) => rect.width * rect.height;

function rangesOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1;
}

function contains(outer: DiagramRect, inner: DiagramRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height &&
    area(inner) < area(outer)
  );
}

/** The smallest shape an endpoint sits on (within a small tolerance), if any. */
function attachedShape(shapes: DiagramBox[], p: DiagramPoint): DiagramBox | null {
  let best: DiagramBox | null = null;
  for (const shape of shapes) {
    if (!rectContainsPoint(shape, p, ATTACH_TOLERANCE)) continue;
    if (!best || area(shape) < area(best)) best = shape;
  }
  return best;
}

function directionWord(from: DiagramPoint, to: DiagramPoint): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy) * 2) return dx >= 0 ? "rightward" : "leftward";
  if (Math.abs(dy) >= Math.abs(dx) * 2) return dy >= 0 ? "downward" : "upward";
  return `${dy >= 0 ? "down" : "up"}-${dx >= 0 ? "right" : "left"}`;
}

/**
 * Deterministic relationships between shapes (rectangles, ellipses, text): nearest neighbour
 * left/right and above/below, alignment, containment, overlap, and which shapes each connector
 * joins. Geometry only — no inference about meaning.
 */
export function diagramRelationships(data: DiagramData): string[] {
  const shapes = data.objects.filter(isBoxObject);
  const lines: string[] = [];

  for (const a of shapes) {
    // Nearest shape to the right sharing some vertical extent.
    const right = shapes
      .filter((b) => b !== a && b.x >= a.x + a.width - 1 && rangesOverlap(a.y, a.y + a.height, b.y, b.y + b.height))
      .sort((p, q) => p.x - q.x)[0];
    if (right) {
      const aligned = Math.abs(center(a).y - center(right).y) <= ALIGN_TOLERANCE ? ", aligned horizontally" : "";
      lines.push(`- ${shapeReference(a)} is left of ${shapeReference(right)}${aligned}.`);
    }
    const below = shapes
      .filter((b) => b !== a && b.y >= a.y + a.height - 1 && rangesOverlap(a.x, a.x + a.width, b.x, b.x + b.width))
      .sort((p, q) => p.y - q.y)[0];
    if (below) {
      const aligned = Math.abs(center(a).x - center(below).x) <= ALIGN_TOLERANCE ? ", aligned vertically" : "";
      lines.push(`- ${shapeReference(below)} is below ${shapeReference(a)}${aligned}.`);
    }
  }

  for (const inner of shapes) {
    const outer = shapes
      .filter((candidate) => candidate !== inner && candidate.type !== "text" && contains(candidate, inner))
      .sort((p, q) => area(p) - area(q))[0];
    if (outer) lines.push(`- ${shapeReference(outer)} contains ${shapeReference(inner)}.`);
  }

  shapes.forEach((a, index) => {
    for (const b of shapes.slice(index + 1)) {
      if (contains(a, b) || contains(b, a)) continue;
      const overlap =
        rangesOverlap(a.x, a.x + a.width, b.x, b.x + b.width) && rangesOverlap(a.y, a.y + a.height, b.y, b.y + b.height);
      if (overlap) lines.push(`- ${shapeReference(a)} overlaps ${shapeReference(b)}.`);
    }
  });

  for (const object of data.objects) {
    const ends = connectorEnds(object);
    if (!ends) continue;
    const from = attachedShape(shapes, ends.start);
    const to = attachedShape(shapes, ends.end);
    const label = objectLabel(object);
    const named = label ? ` "${label}"` : "";
    if (object.type === "arrow") {
      const noun = `${directionWord(ends.start, ends.end)} arrow${named}`;
      const article = /^[aeiou]/i.test(noun) ? "An" : "A";
      if (from && to && from !== to) lines.push(`- ${article} ${noun} connects ${shapeReference(from)} to ${shapeReference(to)}.`);
      else if (from) lines.push(`- ${article} ${noun} leads from ${shapeReference(from)} to ${pointText(ends.end)}.`);
      else if (to) lines.push(`- ${article} ${noun} points at ${shapeReference(to)} from ${pointText(ends.start)}.`);
      continue;
    }
    const noun = object.type === "bezier" ? `curve${named}` : `line${named}`;
    if (from && to && from !== to) lines.push(`- A ${noun} connects ${shapeReference(from)} and ${shapeReference(to)}.`);
    else if (from || to) lines.push(`- A ${noun} touches ${shapeReference((from ?? to)!)}.`);
  }

  return lines;
}

