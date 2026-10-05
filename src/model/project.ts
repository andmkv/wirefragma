/**
 * Core serializable data model of the editor.
 *
 * Nothing in here may hold renderer objects, DOM nodes or class instances:
 * a WireframeProject must survive JSON.stringify / JSON.parse unchanged.
 *
 * Structure (version 2): Project → Layer → Elements.
 *
 * Ordering rules (one rule, used everywhere):
 *  - `layers[0]` is the FRONT-most layer (top of the Layers panel);
 *    the last layer in the array is drawn first (furthest back).
 *  - `elements` is a single flat array holding the GLOBAL draw order, back to front.
 *    Elements of the same layer keep their relative array order, so the effective
 *    paint order is a stable partition of that array by layer.
 *  - `zIndex` mirrors an element's position inside its own layer (0 = back of layer).
 *
 * Hierarchy (optional `parentId`, Unity-style nesting):
 *  - an element may live inside another element of the SAME layer; the child inherits the
 *    parent's layer, visibility and locking, and is always drawn in front of its parent;
 *  - the flat `elements` array is kept in canonical TREE order: every element is immediately
 *    followed by its whole subtree, and siblings keep their relative array order. Because
 *    subtrees are contiguous, the per-layer array order is still THE paint order and every
 *    ordering helper above keeps working unchanged. `canonicalizeTree` enforces this and is
 *    applied by `reindexLayers`, which every structural transform funnels through.
 */

import { findCanvasPreset, type CanvasPresetId } from "./canvasPresets";
import { normalizeDiagramData, type DiagramData } from "./diagram";
import { hasDrawingDescription, normalizeDrawingData, type DrawingData } from "./drawing";

export const ELEMENT_TYPES = [
  "container",
  "text",
  "button",
  "input",
  "textarea",
  "checkbox",
  "radio",
  "toggle",
  "dropdown",
  "slider",
  "progress",
  "iconButton",
  "tabs",
  "list",
  "table",
  "image",
  "icon",
  "avatar",
  "badge",
  "divider",
  "toolbar",
  "sidebar",
  "bottomNav",
  "dialog",
  "diagram",
  "drawing"
] as const;

export type ElementType = (typeof ELEMENT_TYPES)[number];

export const CANVAS_MODES = ["desktop", "mobile", "mobileLandscape", "custom"] as const;
export type CanvasMode = (typeof CANVAS_MODES)[number];

export interface WireframeLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface WireframeElement {
  id: string;
  type: ElementType;

  /** Semantic name, e.g. `saveButton`. */
  name: string;
  /** Visible text drawn in the wireframe. */
  label: string;
  /** Free-form note for humans/LLMs. */
  note: string;

  x: number;
  y: number;
  width: number;
  height: number;

  layerId: string;

  /**
   * Id of the element this one is nested in (same layer), or absent for a layer root.
   * Optional: documents written before nesting existed simply have no parents.
   */
  parentId?: string;

  visible: boolean;
  locked: boolean;

  /** Order inside the element's own layer (0 = furthest back in that layer). */
  zIndex: number;

  /** Multi-line content used by list / tabs / sidebar. */
  items?: string[];

  /** Column headers used by `table`. Cells stay in `items` as "a | b | c" rows. */
  columns?: string[];

  /** Typography for `text` elements. Optional: older projects simply have no style. */
  textStyle?: TextStyle;

  /** Rendered size of an `icon` / `image` symbol or emoji label, in logical px. */
  contentSize?: number;

  /** Scene of a `diagram` (shown as "Canvas" in the UI): structured shapes in their own space. */
  diagram?: DiagramData;

  /** Freehand strokes + LLM description of a `drawing`. */
  drawing?: DrawingData;
}

export type TextAlign = "left" | "center" | "right";

export interface TextStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: TextAlign;
}

export const DEFAULT_TEXT_STYLE: Required<TextStyle> = {
  fontSize: 16,
  bold: false,
  italic: false,
  underline: false,
  align: "left"
};

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 96;
export const DEFAULT_ICON_CONTENT_SIZE = 24;
export const DEFAULT_IMAGE_CONTENT_SIZE = 48;
export const MIN_CONTENT_SIZE = 8;
export const MAX_CONTENT_SIZE = 256;

/** Style with defaults applied — the single place text defaults live. */
export function textStyleOf(element: WireframeElement): Required<TextStyle> {
  const style = element.textStyle ?? {};
  return {
    fontSize: clamp(Math.round(style.fontSize ?? DEFAULT_TEXT_STYLE.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE),
    bold: style.bold === true,
    italic: style.italic === true,
    underline: style.underline === true,
    align: style.align === "center" || style.align === "right" ? style.align : "left"
  };
}

/** Content size for icon/image symbols, with per-type defaults. */
export function contentSizeOf(element: WireframeElement): number {
  const fallback = element.type === "image" ? DEFAULT_IMAGE_CONTENT_SIZE : DEFAULT_ICON_CONTENT_SIZE;
  const value = element.contentSize ?? fallback;
  return clamp(Math.round(value), MIN_CONTENT_SIZE, MAX_CONTENT_SIZE);
}

/**
 * Fold a typography change into an element's stored style.
 *
 * The result stays minimal: a value equal to the default is not written at all, so an element
 * that never had its type styled still serializes exactly as it did before this field existed.
 */
export function mergeTextStyle(element: WireframeElement, patch: TextStyle): TextStyle | undefined {
  const next = { ...textStyleOf(element), ...patch };
  next.fontSize = clamp(Math.round(Number.isFinite(next.fontSize) ? next.fontSize : DEFAULT_TEXT_STYLE.fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE);
  const stored: TextStyle = {};
  if (next.fontSize !== DEFAULT_TEXT_STYLE.fontSize) stored.fontSize = next.fontSize;
  if (next.bold) stored.bold = true;
  if (next.italic) stored.italic = true;
  if (next.underline) stored.underline = true;
  if (next.align !== DEFAULT_TEXT_STYLE.align) stored.align = next.align;
  return Object.keys(stored).length > 0 ? stored : undefined;
}

export interface WireframeProject {
  version: 2;
  title: string;
  canvas: {
    mode: CanvasMode;
    width: number;
    height: number;
    /**
     * Optional device-preset id from `model/canvasPresets.ts` (`mode` is then `custom`).
     * Additive: documents written before it exists simply have none, and an unknown id is dropped
     * by `normalizeProject`. Never changes how the canvas is drawn.
     */
    preset?: CanvasPresetId;
  };
  layers: WireframeLayer[];
  elements: WireframeElement[];
}

export const PROJECT_VERSION = 2;
export const LEGACY_PROJECT_VERSION = 1;
export const DEFAULT_LAYER_NAME = "Default";

export const MIN_CANVAS_SIZE = 120;
export const MAX_CANVAS_SIZE = 6000;
export const MIN_ELEMENT_SIZE = 8;

/** Human readable label for an element type, used by the palette and exports. */
export const ELEMENT_TYPE_LABEL: Record<ElementType, string> = {
  container: "Container",
  text: "Text",
  button: "Button",
  input: "Input",
  textarea: "Textarea",
  checkbox: "Checkbox",
  radio: "Radio",
  toggle: "Toggle",
  dropdown: "Dropdown",
  slider: "Slider",
  progress: "Progress",
  iconButton: "Icon Button",
  tabs: "Tabs",
  list: "List",
  table: "Table",
  image: "Image",
  icon: "Icon",
  avatar: "Avatar",
  badge: "Badge / Chip",
  divider: "Divider",
  toolbar: "Toolbar",
  sidebar: "Sidebar",
  bottomNav: "Bottom Navigation",
  dialog: "Dialog",
  diagram: "Canvas",
  drawing: "Drawing"
};

export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectValidationError";
  }
}

export function isElementType(value: unknown): value is ElementType {
  return typeof value === "string" && (ELEMENT_TYPES as readonly string[]).includes(value);
}

export function isCanvasMode(value: unknown): value is CanvasMode {
  return typeof value === "string" && (CANVAS_MODES as readonly string[]).includes(value);
}

let idCounter = 0;

export function createId(prefix = "el"): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (random) return `${prefix}_${random.slice(0, 8)}`;
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function cloneProject(project: WireframeProject): WireframeProject {
  return JSON.parse(JSON.stringify(project)) as WireframeProject;
}

export function projectsEqual(a: WireframeProject, b: WireframeProject): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeItems(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\r\n?/g, "\n"))
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : undefined;
}

function normalizeColumns(value: unknown): string[] | undefined {
  return normalizeItems(value);
}

function normalizeTextStyle(value: unknown): TextStyle | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const style: TextStyle = {};
  const fontSize = asNumber(raw.fontSize, NaN);
  if (Number.isFinite(fontSize)) {
    style.fontSize = clamp(Math.round(fontSize), MIN_FONT_SIZE, MAX_FONT_SIZE);
  }
  if (raw.bold === true) style.bold = true;
  if (raw.italic === true) style.italic = true;
  if (raw.underline === true) style.underline = true;
  if (raw.align === "center" || raw.align === "right" || raw.align === "left") style.align = raw.align;
  return Object.keys(style).length > 0 ? style : undefined;
}

function normalizeContentSize(value: unknown): number | undefined {
  const size = asNumber(value, NaN);
  if (!Number.isFinite(size)) return undefined;
  return clamp(Math.round(size), MIN_CONTENT_SIZE, MAX_CONTENT_SIZE);
}

/** Best-effort guess when an imported project does not state its canvas mode. */
function inferCanvasMode(width: number, height: number): CanvasMode {
  if (width <= 480 && height > width) return "mobile";
  if (width > height && width <= 950 && width / height >= 1.6) return "mobileLandscape";
  if (width >= 1000 && width > height) return "desktop";
  return "custom";
}

export function createLayer(name = DEFAULT_LAYER_NAME, overrides: Partial<WireframeLayer> = {}): WireframeLayer {
  return {
    id: overrides.id ?? createId("layer"),
    name,
    visible: overrides.visible ?? true,
    locked: overrides.locked ?? false
  };
}

/**
 * Enforce the hierarchy invariants on a flat element array:
 *  - `parentId` must point at another existing element; dangling, self and cyclic links are
 *    dropped (the element becomes a layer root);
 *  - a child always lives in its root ancestor's layer;
 *  - the array is reordered so each element is directly followed by its subtree (pre-order),
 *    roots and siblings keeping their relative array order.
 *
 * Returns the SAME array when nothing had to change, so callers can detect no-ops cheaply.
 */
export function canonicalizeTree(elements: WireframeElement[]): WireframeElement[] {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const hasParents = elements.some((element) => element.parentId !== undefined);
  if (!hasParents) return elements;

  // 1. Valid parent links (no dangling ids, no self links, no cycles).
  const parentOfId = new Map<string, string>();
  for (const element of elements) {
    const parentId = element.parentId;
    if (parentId !== undefined && parentId !== element.id && byId.has(parentId)) {
      parentOfId.set(element.id, parentId);
    }
  }
  for (const element of elements) {
    const seen = new Set<string>([element.id]);
    let cursor = parentOfId.get(element.id);
    while (cursor !== undefined) {
      if (seen.has(cursor)) {
        parentOfId.delete(element.id);
        break;
      }
      seen.add(cursor);
      cursor = parentOfId.get(cursor);
    }
  }

  const rootOf = (id: string): string => {
    let cursor = id;
    let parent = parentOfId.get(cursor);
    while (parent !== undefined) {
      cursor = parent;
      parent = parentOfId.get(cursor);
    }
    return cursor;
  };

  // 2. Repair fields (parentId, inherited layer) without touching unchanged elements.
  const repaired = elements.map((element) => {
    const parentId = parentOfId.get(element.id);
    const layerId = parentId === undefined ? element.layerId : byId.get(rootOf(element.id))!.layerId;
    if (element.parentId === parentId && element.layerId === layerId) return element;
    const next: WireframeElement = { ...element, layerId };
    if (parentId === undefined) delete next.parentId;
    else next.parentId = parentId;
    return next;
  });

  // 3. Pre-order: each element followed by its subtree.
  const children = new Map<string | undefined, WireframeElement[]>();
  for (const element of repaired) {
    const key = element.parentId;
    const list = children.get(key);
    if (list) list.push(element);
    else children.set(key, [element]);
  }
  const ordered: WireframeElement[] = [];
  const visit = (element: WireframeElement) => {
    ordered.push(element);
    for (const child of children.get(element.id) ?? []) visit(child);
  };
  for (const root of children.get(undefined) ?? []) visit(root);

  const changed = ordered.some((element, index) => element !== elements[index]);
  return changed ? ordered : elements;
}

/**
 * Recompute `zIndex` so it mirrors each element's position inside its own layer (after putting
 * the array into canonical tree order, see `canonicalizeTree`).
 */
export function reindexLayers(project: WireframeProject): WireframeProject {
  const counters = new Map<string, number>();
  const canonical = canonicalizeTree(project.elements);
  const elements = canonical.map((element) => {
    const index = counters.get(element.layerId) ?? 0;
    counters.set(element.layerId, index + 1);
    return element.zIndex === index ? element : { ...element, zIndex: index };
  });
  const changed = elements.some((element, index) => element !== project.elements[index]);
  return changed ? { ...project, elements } : project;
}

function normalizeLayers(value: unknown): WireframeLayer[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const layers: WireframeLayer[] = [];

  value.forEach((rawLayer, index) => {
    if (rawLayer === null || typeof rawLayer !== "object" || Array.isArray(rawLayer)) {
      throw new ProjectValidationError(`Layer #${index + 1} must be an object.`);
    }
    const layer = rawLayer as Record<string, unknown>;

    let id = asString(layer.id).trim();
    if (!id || seen.has(id)) id = createId("layer");
    seen.add(id);

    layers.push({
      id,
      name: asString(layer.name).trim() || `Layer ${index + 1}`,
      visible: layer.visible !== false,
      locked: layer.locked === true
    });
  });

  return layers;
}

/**
 * Validate + repair arbitrary input (imported Markdown, JSON export, localStorage)
 * into a usable project.
 *
 * Version 1 projects (no layers, no visibility/locking) migrate to version 2: every
 * element moves into a single "Default" layer and becomes visible + unlocked.
 */
export function normalizeProject(raw: unknown): WireframeProject {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ProjectValidationError("Project data must be a JSON object.");
  }

  const source = raw as Record<string, unknown>;
  const version = source.version === undefined ? LEGACY_PROJECT_VERSION : source.version;
  if (version !== LEGACY_PROJECT_VERSION && version !== PROJECT_VERSION) {
    throw new ProjectValidationError(
      `Unsupported project version: ${String(source.version)} (supported: ${LEGACY_PROJECT_VERSION}, ${PROJECT_VERSION}).`
    );
  }

  if (typeof source.canvas !== "undefined" && (source.canvas === null || typeof source.canvas !== "object")) {
    throw new ProjectValidationError("Project canvas must be an object.");
  }
  const rawCanvas = (source.canvas ?? {}) as Record<string, unknown>;

  const width = asNumber(rawCanvas.width, NaN);
  const height = asNumber(rawCanvas.height, NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new ProjectValidationError("Canvas width and height must be numbers.");
  }
  if (width < MIN_CANVAS_SIZE || height < MIN_CANVAS_SIZE) {
    throw new ProjectValidationError(
      `Canvas size must be at least ${MIN_CANVAS_SIZE}×${MIN_CANVAS_SIZE} px (got ${width}×${height}).`
    );
  }

  const mode = isCanvasMode(rawCanvas.mode) ? rawCanvas.mode : inferCanvasMode(width, height);

  if (!Array.isArray(source.elements)) {
    throw new ProjectValidationError("Project elements must be an array.");
  }

  const layers = normalizeLayers(source.layers);
  if (layers.length === 0) layers.push(createLayer(DEFAULT_LAYER_NAME));
  const layerIds = new Set(layers.map((layer) => layer.id));
  const fallbackLayerId = layers[layers.length - 1].id;

  const seenIds = new Set<string>();
  const elements: WireframeElement[] = source.elements.map((rawElement, index) => {
    if (rawElement === null || typeof rawElement !== "object" || Array.isArray(rawElement)) {
      throw new ProjectValidationError(`Element #${index + 1} must be an object.`);
    }
    const element = rawElement as Record<string, unknown>;

    if (!isElementType(element.type)) {
      throw new ProjectValidationError(
        `Element #${index + 1} has an unsupported type: ${JSON.stringify(element.type)}.`
      );
    }

    let id = asString(element.id).trim();
    if (!id || seenIds.has(id)) id = createId(element.type);
    seenIds.add(id);

    const layerId = asString(element.layerId);

    const normalized: WireframeElement = {
      id,
      type: element.type,
      name: asString(element.name, element.type),
      label: asString(element.label),
      note: asString(element.note),
      x: asNumber(element.x, 0),
      y: asNumber(element.y, 0),
      width: Math.max(MIN_ELEMENT_SIZE, asNumber(element.width, 100)),
      height: Math.max(MIN_ELEMENT_SIZE, asNumber(element.height, 40)),
      layerId: layerIds.has(layerId) ? layerId : fallbackLayerId,
      visible: element.visible !== false,
      locked: element.locked === true,
      zIndex: asNumber(element.zIndex, index)
    };

    const items = normalizeItems(element.items);
    if (items) normalized.items = items;

    const columns = normalizeColumns(element.columns);
    if (columns) normalized.columns = columns;

    const textStyle = normalizeTextStyle(element.textStyle);
    if (textStyle) normalized.textStyle = textStyle;

    const contentSize = normalizeContentSize(element.contentSize);
    if (contentSize !== undefined) normalized.contentSize = contentSize;

    // Scene data belongs to its own type only; a missing scene is recreated empty.
    if (element.type === "diagram") normalized.diagram = normalizeDiagramData(element.diagram);
    if (element.type === "drawing") normalized.drawing = normalizeDrawingData(element.drawing);

    // Validated against the final id set by `canonicalizeTree` (via `reindexLayers`) below.
    const parentId = asString(element.parentId).trim();
    if (parentId) normalized.parentId = parentId;

    return normalized;
  });

  const canvas: WireframeProject["canvas"] = {
    mode,
    width: clamp(Math.round(width), MIN_CANVAS_SIZE, MAX_CANVAS_SIZE),
    height: clamp(Math.round(height), MIN_CANVAS_SIZE, MAX_CANVAS_SIZE)
  };
  // The device preset is additive and cosmetic: an unknown id is dropped, and so is one whose
  // dimensions disagree with the stored size (otherwise the export would describe the wrong thing).
  const preset = findCanvasPreset(rawCanvas.preset);
  if (preset && preset.width === canvas.width && preset.height === canvas.height) {
    canvas.preset = preset.id;
  }

  return reindexLayers({
    version: PROJECT_VERSION,
    title: asString(source.title, "Untitled").trim() || "Untitled",
    canvas,
    layers,
    elements
  });
}

/* ------------------------------------------------------------------ *
 * Layer / element queries
 * ------------------------------------------------------------------ */

export function findLayer(project: WireframeProject, id: string | null): WireframeLayer | null {
  if (!id) return null;
  return project.layers.find((layer) => layer.id === id) ?? null;
}

export function layerName(project: WireframeProject, layerId: string): string {
  return findLayer(project, layerId)?.name ?? "Unknown layer";
}

const elementIndexCache = new WeakMap<WireframeElement[], Map<string, WireframeElement>>();

/** id -> element lookup for one `elements` array (memoized; arrays are never mutated). */
export function elementIndex(project: WireframeProject): Map<string, WireframeElement> {
  let index = elementIndexCache.get(project.elements);
  if (!index) {
    index = new Map(project.elements.map((element) => [element.id, element]));
    elementIndexCache.set(project.elements, index);
  }
  return index;
}

/** The element's parent, or null for a layer root. */
export function parentOf(project: WireframeProject, element: WireframeElement): WireframeElement | null {
  if (element.parentId === undefined) return null;
  return elementIndex(project).get(element.parentId) ?? null;
}

/** Ancestors from the direct parent up to the layer root. */
export function ancestorsOf(project: WireframeProject, element: WireframeElement): WireframeElement[] {
  const result: WireframeElement[] = [];
  const seen = new Set<string>([element.id]);
  let cursor = parentOf(project, element);
  while (cursor && !seen.has(cursor.id)) {
    result.push(cursor);
    seen.add(cursor.id);
    cursor = parentOf(project, cursor);
  }
  return result;
}

/** Nesting depth: 0 for a layer root. */
export function elementDepth(project: WireframeProject, element: WireframeElement): number {
  return ancestorsOf(project, element).length;
}

/** True when `candidateId` is `ancestorId` itself or lives anywhere inside it. */
export function isInSubtree(project: WireframeProject, candidateId: string, ancestorId: string): boolean {
  if (candidateId === ancestorId) return true;
  const candidate = elementIndex(project).get(candidateId);
  if (!candidate) return false;
  return ancestorsOf(project, candidate).some((ancestor) => ancestor.id === ancestorId);
}

/** Every descendant id of `id` (not including `id`), in array (= paint) order. */
export function descendantIds(project: WireframeProject, id: string): string[] {
  const result: string[] = [];
  const inside = new Set<string>([id]);
  for (const element of project.elements) {
    if (element.parentId !== undefined && inside.has(element.parentId) && !inside.has(element.id)) {
      inside.add(element.id);
      result.push(element.id);
    }
  }
  return result;
}

/**
 * `ids` plus all of their descendants, deduplicated, in array order. This is the set a
 * structural action (move, delete, duplicate, copy) really affects.
 */
export function withDescendants(project: WireframeProject, ids: string[]): string[] {
  const wanted = new Set(ids);
  const result: string[] = [];
  for (const element of project.elements) {
    if (wanted.has(element.id) || (element.parentId !== undefined && wanted.has(element.parentId))) {
      wanted.add(element.id);
      result.push(element.id);
    }
  }
  return result;
}

/** Drop ids whose ancestor is also in the list (the ancestor already covers them). */
export function topmostIds(project: WireframeProject, ids: string[]): string[] {
  const wanted = new Set(ids);
  return ids.filter((id) => {
    const element = elementIndex(project).get(id);
    return !!element && !ancestorsOf(project, element).some((ancestor) => wanted.has(ancestor.id));
  });
}

/** Direct children of `parentId` (null = layer roots) inside a layer, in array order. */
export function childrenOf(
  project: WireframeProject,
  layerId: string,
  parentId: string | null,
  options: { frontFirst?: boolean } = {}
): WireframeElement[] {
  const children = project.elements.filter(
    (element) => element.layerId === layerId && (element.parentId ?? null) === parentId
  );
  return options.frontFirst ? children.reverse() : children;
}

/** Visible only when the element, every ancestor and the layer are visible. */
export function effectiveVisible(project: WireframeProject, element: WireframeElement): boolean {
  if (!element.visible) return false;
  if (ancestorsOf(project, element).some((ancestor) => !ancestor.visible)) return false;
  const layer = findLayer(project, element.layerId);
  return layer ? layer.visible : true;
}

/** Locked when the element, any ancestor or the layer is locked. */
export function effectiveLocked(project: WireframeProject, element: WireframeElement): boolean {
  if (element.locked) return true;
  if (ancestorsOf(project, element).some((ancestor) => ancestor.locked)) return true;
  const layer = findLayer(project, element.layerId);
  return layer ? layer.locked : false;
}

/** Elements ordered back → front, honouring layer stacking and per-layer order. */
export function elementsInDrawOrder(project: WireframeProject): WireframeElement[] {
  const backToFront = [...project.layers].reverse();
  const result: WireframeElement[] = [];
  const known = new Set(project.layers.map((layer) => layer.id));

  // Defensive: elements pointing at a layer that no longer exists stay at the very back.
  for (const element of project.elements) {
    if (!known.has(element.layerId)) result.push(element);
  }
  for (const layer of backToFront) {
    for (const element of project.elements) {
      if (element.layerId === layer.id) result.push(element);
    }
  }
  return result;
}

export function visibleElementsInDrawOrder(project: WireframeProject): WireframeElement[] {
  return elementsInDrawOrder(project).filter((element) => effectiveVisible(project, element));
}

/**
 * A Drawing without an LLM description is left out of every LLM-facing section (ASCII, UI
 * Elements, Spatial Summary): Wirefragma cannot say what the sketch means. Its strokes still
 * travel in the canonical `ui-project` block so nothing is lost on re-import.
 */
export function isOmittedFromLlmExport(element: WireframeElement): boolean {
  return element.type === "drawing" && !hasDrawingDescription(element.drawing);
}

/** Visible elements that take part in the LLM-facing export, back → front. */
export function exportedElementsInDrawOrder(project: WireframeProject): WireframeElement[] {
  return visibleElementsInDrawOrder(project).filter((element) => !isOmittedFromLlmExport(element));
}

/** Elements of one layer. `frontFirst` matches the Layers panel convention. */
export function elementsOfLayer(
  project: WireframeProject,
  layerId: string,
  options: { frontFirst?: boolean } = {}
): WireframeElement[] {
  const elements = project.elements.filter((element) => element.layerId === layerId);
  return options.frontFirst ? elements.reverse() : elements;
}

export function findElement(project: WireframeProject, id: string | null): WireframeElement | null {
  if (!id) return null;
  return elementIndex(project).get(id) ?? null;
}

/* ------------------------------------------------------------------ *
 * Pure project transforms
 * ------------------------------------------------------------------ */

export function addElement(project: WireframeProject, element: WireframeElement): WireframeProject {
  return reindexLayers({ ...project, elements: [...project.elements, element] });
}

export function updateElement(
  project: WireframeProject,
  id: string,
  patch: Partial<Omit<WireframeElement, "id">>
): WireframeProject {
  let changed = false;
  const elements = project.elements.map((element) => {
    if (element.id !== id) return element;
    changed = true;
    return { ...element, ...patch, id: element.id };
  });
  return changed ? reindexLayers({ ...project, elements }) : project;
}

/** Remove an element together with everything nested inside it. */
export function removeElement(project: WireframeProject, id: string): WireframeProject {
  return removeElements(project, [id]);
}

/** Remove several elements (and their subtrees) in one pass. */
export function removeElements(project: WireframeProject, ids: string[]): WireframeProject {
  const doomed = new Set(withDescendants(project, ids));
  if (doomed.size === 0) return project;
  const elements = project.elements.filter((element) => !doomed.has(element.id));
  if (elements.length === project.elements.length) return project;
  return reindexLayers({ ...project, elements });
}

export function duplicateElement(
  project: WireframeProject,
  id: string
): { project: WireframeProject; newId: string | null } {
  const index = project.elements.findIndex((element) => element.id === id);
  if (index === -1) return { project, newId: null };

  // The copy takes the whole subtree along; the copied root stays a sibling of the source.
  const subtree = [project.elements[index].id, ...descendantIds(project, id)];
  const idMap = new Map(subtree.map((sourceId) => {
    const source = findElement(project, sourceId)!;
    return [sourceId, createId(source.type)] as const;
  }));

  let naming = project;
  const copies: WireframeElement[] = [];
  for (const sourceId of subtree) {
    const source = findElement(project, sourceId)!;
    const copy: WireframeElement = {
      ...cloneElement(source),
      id: idMap.get(sourceId)!,
      name: uniqueName(naming, source.name),
      x: source.x + 16,
      y: source.y + 16
    };
    if (source.parentId !== undefined && sourceId !== id) copy.parentId = idMap.get(source.parentId);
    copies.push(copy);
    naming = { ...naming, elements: [...naming.elements, copy] };
  }

  // Insert right after the source's subtree, i.e. directly in front of it.
  const lastIndex = Math.max(...subtree.map((sourceId) => project.elements.findIndex((e) => e.id === sourceId)));
  const elements = [...project.elements];
  elements.splice(lastIndex + 1, 0, ...copies);
  return { project: reindexLayers({ ...project, elements }), newId: copies[0].id };
}

/** Deep copy of one element's own arrays/objects (ids untouched). */
export function cloneElement(element: WireframeElement): WireframeElement {
  const copy: WireframeElement = { ...element };
  if (element.items) copy.items = [...element.items];
  if (element.columns) copy.columns = [...element.columns];
  if (element.textStyle) copy.textStyle = { ...element.textStyle };
  if (element.diagram) copy.diagram = JSON.parse(JSON.stringify(element.diagram)) as DiagramData;
  if (element.drawing) copy.drawing = JSON.parse(JSON.stringify(element.drawing)) as DrawingData;
  return copy;
}

/**
 * Duplicate a whole selection in one pass: every copy keeps its type, content, style and layer,
 * the set keeps its relative positions, and the copies are offset by 16 world units.
 */
export function duplicateElements(
  project: WireframeProject,
  ids: string[]
): { project: WireframeProject; newIds: string[] } {
  // A selected child of a selected parent is already copied with its parent.
  const wanted = new Set(topmostIds(project, ids));
  const sources = project.elements.filter((element) => wanted.has(element.id));
  if (sources.length === 0) return { project, newIds: [] };

  let next = project;
  const newIds: string[] = [];
  for (const source of sources) {
    const result = duplicateElement(next, source.id);
    if (!result.newId) continue;
    newIds.push(result.newId);
    next = result.project;
  }
  return { project: next, newIds };
}

export function uniqueName(project: WireframeProject, base: string): string {
  const stem = `${base}Copy`.replace(/\s+/g, "");
  const taken = new Set(project.elements.map((element) => element.name));
  if (!taken.has(stem)) return stem;
  let counter = 2;
  while (taken.has(`${stem}${counter}`)) counter += 1;
  return `${stem}${counter}`;
}

export function uniqueLayerName(project: WireframeProject, base = "Layer"): string {
  const taken = new Set(project.layers.map((layer) => layer.name));
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base} ${counter}`)) counter += 1;
  return `${base} ${counter}`;
}

/** Move an element one step forward/back inside its own layer. */
export function reorderElement(
  project: WireframeProject,
  id: string,
  direction: "forward" | "backward"
): WireframeProject {
  const element = findElement(project, id);
  if (!element) return project;

  // Siblings only: same layer AND same parent. Swapping the two entries is enough — the
  // canonical tree order then carries each one's subtree along.
  const siblings = childrenOf(project, element.layerId, element.parentId ?? null);
  const position = siblings.indexOf(element);
  const target = direction === "forward" ? position + 1 : position - 1;
  if (position === -1 || target < 0 || target >= siblings.length) return project;

  const other = siblings[target];
  const elements = project.elements.map((candidate) => {
    if (candidate.id === element.id) return other;
    if (candidate.id === other.id) return element;
    return candidate;
  });
  return reindexLayers({ ...project, elements });
}

function moveWithinArray(
  elements: WireframeElement[],
  elementId: string,
  insertAt: (rest: WireframeElement[]) => number
): WireframeElement[] {
  const element = elements.find((candidate) => candidate.id === elementId);
  if (!element) return elements;
  const rest = elements.filter((candidate) => candidate.id !== elementId);
  const index = clamp(insertAt(rest), 0, rest.length);
  rest.splice(index, 0, element);
  return rest;
}

/** Jump to the very front of the element's own layer. */
export function bringToFront(project: WireframeProject, id: string): WireframeProject {
  const element = findElement(project, id);
  if (!element) return project;
  const elements = moveWithinArray(project.elements, id, (rest) => {
    let last = -1;
    rest.forEach((candidate, index) => {
      if (candidate.layerId === element.layerId) last = index;
    });
    return last === -1 ? rest.length : last + 1;
  });
  return reindexLayers({ ...project, elements });
}

/** Push to the very back of the element's own layer. */
export function sendToBack(project: WireframeProject, id: string): WireframeProject {
  const element = findElement(project, id);
  if (!element) return project;
  const elements = moveWithinArray(project.elements, id, (rest) => {
    const first = rest.findIndex((candidate) => candidate.layerId === element.layerId);
    return first === -1 ? rest.length : first;
  });
  return reindexLayers({ ...project, elements });
}

/**
 * Move an element into `targetLayerId`, either directly above/below `targetElementId`
 * or on top of the target layer when no target element is given.
 */
export function moveElement(
  project: WireframeProject,
  elementId: string,
  targetLayerId: string,
  targetElementId: string | null = null,
  placeAbove = true
): WireframeProject {
  const element = findElement(project, elementId);
  if (!element || !findLayer(project, targetLayerId)) return project;
  const target = targetElementId ? findElement(project, targetElementId) : null;
  // An element can never be placed relative to something inside its own subtree.
  if (target && isInSubtree(project, target.id, elementId)) return project;

  // Next to a target = sibling of that target; without a target = a root of the layer.
  const moved: WireframeElement = { ...element, layerId: target ? target.layerId : targetLayerId };
  if (target?.parentId !== undefined) moved.parentId = target.parentId;
  else delete moved.parentId;
  const elements = moveWithinArray(
    project.elements.map((candidate) => (candidate.id === elementId ? moved : candidate)),
    elementId,
    (rest) => {
      if (targetElementId) {
        const index = rest.findIndex((candidate) => candidate.id === targetElementId);
        if (index !== -1) return placeAbove ? index + 1 : index;
      }
      let last = -1;
      rest.forEach((candidate, index) => {
        if (candidate.layerId === targetLayerId) last = index;
      });
      return last === -1 ? rest.length : last + 1;
    }
  );
  return reindexLayers({ ...project, elements });
}

/**
 * Nest `elementId` inside `parentId` (Unity-style): the element and its subtree move into the
 * parent's layer and become the parent's front-most child. World coordinates are untouched.
 * No-op when the parent is missing, is the element itself or lives inside the element.
 */
export function nestElement(project: WireframeProject, elementId: string, parentId: string): WireframeProject {
  const element = findElement(project, elementId);
  const parent = findElement(project, parentId);
  if (!element || !parent) return project;
  if (isInSubtree(project, parentId, elementId)) return project;
  if (element.parentId === parentId) return bringToFront(project, elementId);

  const moved: WireframeElement = { ...element, parentId, layerId: parent.layerId };
  // Last in the array = last among the new siblings = front-most child.
  const elements = [...project.elements.filter((candidate) => candidate.id !== elementId), moved];
  return reindexLayers({ ...project, elements });
}

/**
 * Nest several elements inside `parentId` in one pass (Layers multi-selection drop). Only the
 * topmost ids move (a selected child travels with its selected parent); ids that are the parent
 * itself or one of its ancestors are skipped. Their relative order is kept, all in front.
 */
export function nestElements(project: WireframeProject, ids: string[], parentId: string): WireframeProject {
  // Drop the parent and its ancestors first, so their selected descendants still move.
  const candidates = ids.filter((id) => !isInSubtree(project, parentId, id));
  const moving = new Set(topmostIds(project, candidates));
  let next = project;
  for (const element of project.elements) {
    if (moving.has(element.id)) next = nestElement(next, element.id, parentId);
  }
  return next;
}

/**
 * Move several elements next to a target (or onto a layer) in one pass, keeping their relative
 * back-to-front order. Ids inside another moved id's subtree, and the target itself, are skipped.
 */
export function moveElements(
  project: WireframeProject,
  ids: string[],
  targetLayerId: string,
  targetElementId: string | null = null,
  placeAbove = true
): WireframeProject {
  const ordered = project.elements
    .map((element) => element.id)
    .filter((id) => topmostIds(project, ids).includes(id) && id !== targetElementId);
  if (targetElementId && ordered.some((id) => isInSubtree(project, targetElementId, id))) return project;
  let next = project;
  // Placing in front of the target: insert back-most first, each one in front of the previous.
  // Placing behind: insert front-most first, each one behind the previous.
  const sequence = placeAbove ? ordered : [...ordered].reverse();
  let anchor = targetElementId;
  for (const id of sequence) {
    next = moveElement(next, id, targetLayerId, anchor, placeAbove);
    if (anchor) anchor = id;
  }
  return next;
}

/** Move an element out of its parent: it becomes a sibling directly in front of that parent. */
export function unnestElement(project: WireframeProject, elementId: string): WireframeProject {
  const element = findElement(project, elementId);
  const parent = element ? parentOf(project, element) : null;
  if (!element || !parent) return project;
  return moveElement(project, elementId, parent.layerId, parent.id, true);
}

/* ------------------------------------------------------------------ *
 * Layer transforms
 * ------------------------------------------------------------------ */

export function addLayer(
  project: WireframeProject,
  name?: string
): { project: WireframeProject; layer: WireframeLayer } {
  const layer = createLayer(name?.trim() || uniqueLayerName(project));
  // New layers go in front of everything else.
  return { project: { ...project, layers: [layer, ...project.layers] }, layer };
}

export function updateLayer(
  project: WireframeProject,
  id: string,
  patch: Partial<Omit<WireframeLayer, "id">>
): WireframeProject {
  let changed = false;
  const layers = project.layers.map((layer) => {
    if (layer.id !== id) return layer;
    changed = true;
    return { ...layer, ...patch, id: layer.id };
  });
  return changed ? { ...project, layers } : project;
}

/** Reorder a layer. `placeAbove` means closer to the front (top of the panel). */
export function moveLayer(
  project: WireframeProject,
  id: string,
  targetId: string,
  placeAbove: boolean
): WireframeProject {
  const index = project.layers.findIndex((layer) => layer.id === id);
  const targetIndex = project.layers.findIndex((layer) => layer.id === targetId);
  if (index === -1 || targetIndex === -1 || index === targetIndex) return project;

  const layers = [...project.layers];
  const [moved] = layers.splice(index, 1);
  const insertion = layers.findIndex((layer) => layer.id === targetId);
  layers.splice(placeAbove ? insertion : insertion + 1, 0, moved);
  return { ...project, layers };
}

export interface DeleteLayerResult {
  project: WireframeProject;
  /** Elements that were removed together with the layer. */
  removedElementIds: string[];
  /** A fresh `Default` layer was created because the last layer was deleted. */
  replacedWithDefault: boolean;
}

/**
 * Delete a layer together with every element inside it.
 *
 * The document always keeps at least one layer: deleting the last one leaves a fresh
 * empty `Default` layer behind so new elements always have a destination.
 */
export function deleteLayer(project: WireframeProject, layerId: string): DeleteLayerResult {
  const layer = findLayer(project, layerId);
  if (!layer) {
    return { project, removedElementIds: [], replacedWithDefault: false };
  }

  const removedElementIds = project.elements
    .filter((element) => element.layerId === layerId)
    .map((element) => element.id);
  const layers = project.layers.filter((candidate) => candidate.id !== layerId);
  const elements = project.elements.filter((element) => element.layerId !== layerId);
  const replacedWithDefault = layers.length === 0;
  if (replacedWithDefault) layers.push(createLayer(DEFAULT_LAYER_NAME));

  return {
    project: reindexLayers({ ...project, layers, elements }),
    removedElementIds,
    replacedWithDefault
  };
}
