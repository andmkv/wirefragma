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
 */

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
  "dialog"
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
  dialog: "Dialog"
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

/** Recompute `zIndex` so it mirrors each element's position inside its own layer. */
export function reindexLayers(project: WireframeProject): WireframeProject {
  const counters = new Map<string, number>();
  const elements = project.elements.map((element) => {
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

    return normalized;
  });

  return reindexLayers({
    version: PROJECT_VERSION,
    title: asString(source.title, "Untitled").trim() || "Untitled",
    canvas: {
      mode,
      width: clamp(Math.round(width), MIN_CANVAS_SIZE, MAX_CANVAS_SIZE),
      height: clamp(Math.round(height), MIN_CANVAS_SIZE, MAX_CANVAS_SIZE)
    },
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

export function effectiveVisible(project: WireframeProject, element: WireframeElement): boolean {
  const layer = findLayer(project, element.layerId);
  return element.visible && (layer ? layer.visible : true);
}

export function effectiveLocked(project: WireframeProject, element: WireframeElement): boolean {
  const layer = findLayer(project, element.layerId);
  return element.locked || (layer ? layer.locked : false);
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
  return project.elements.find((element) => element.id === id) ?? null;
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

export function removeElement(project: WireframeProject, id: string): WireframeProject {
  const elements = project.elements.filter((element) => element.id !== id);
  if (elements.length === project.elements.length) return project;
  return reindexLayers({ ...project, elements });
}

export function duplicateElement(
  project: WireframeProject,
  id: string
): { project: WireframeProject; newId: string | null } {
  const index = project.elements.findIndex((element) => element.id === id);
  if (index === -1) return { project, newId: null };

  const source = project.elements[index];
  const copy: WireframeElement = {
    ...source,
    id: createId(source.type),
    name: uniqueName(project, source.name),
    x: source.x + 16,
    y: source.y + 16,
    items: source.items ? [...source.items] : undefined
  };

  const elements = [...project.elements];
  elements.splice(index + 1, 0, copy);
  return { project: reindexLayers({ ...project, elements }), newId: copy.id };
}

/**
 * Duplicate a whole selection in one pass: every copy keeps its type, content, style and layer,
 * the set keeps its relative positions, and the copies are offset by 16 world units.
 */
export function duplicateElements(
  project: WireframeProject,
  ids: string[]
): { project: WireframeProject; newIds: string[] } {
  const wanted = new Set(ids);
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

  const siblings = project.elements.filter((candidate) => candidate.layerId === element.layerId);
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

  const moved: WireframeElement = { ...element, layerId: targetLayerId };
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
