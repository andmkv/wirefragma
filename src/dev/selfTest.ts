/**
 * Development-only interaction harness.
 *
 * `?selftest=1` drives the editor with real DOM pointer events (the same events a user
 * produces) and writes a JSON report into a hidden `#selftest-report` element.
 * `?selftest=2` re-checks the state after a reload, `3` checks the legacy UI Sketch
 * storage migration and `4` checks a fresh first launch.
 *
 * Excluded from production builds (`import.meta.env.DEV`).
 */

import { topmostHit } from "../model/hitAreas";
import type { WireframeElement } from "../model/project";
import { LEGACY_STORAGE_KEY, STORAGE_KEY } from "../utils/storage";

interface StepResult {
  name: string;
  ok: boolean;
  info?: string;
}

const sleep = (ms = 60) => new Promise((resolve) => window.setTimeout(resolve, ms));
const snapped = (value: number) => Math.round(value / 8) * 8;

function q<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

function all<T extends Element>(selector: string): T[] {
  return Array.from(document.querySelectorAll<T>(selector));
}

function frameRect(): DOMRect {
  const frame = q<HTMLElement>(".canvas-frame");
  if (!frame) throw new Error("canvas frame not found");
  return frame.getBoundingClientRect();
}

function logicalSize(): { width: number; height: number } {
  const text = q(".canvas-status")?.textContent ?? "";
  const match = /(\d+)\s*×\s*(\d+)/.exec(text);
  if (!match) return { width: 1200, height: 800 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function scaleFactor(): number {
  return frameRect().width / logicalSize().width;
}

function toClient(x: number, y: number): [number, number] {
  const rect = frameRect();
  const scale = scaleFactor();
  return [rect.left + x * scale, rect.top + y * scale];
}

/** Make sure a logical canvas point is inside the visible scroll area before clicking it. */
function ensureVisible(logicalX: number, logicalY: number): void {
  const viewport = q<HTMLElement>(".canvas-viewport");
  if (!viewport) return;
  const scale = scaleFactor();
  const contentX = logicalX * scale;
  const contentY = logicalY * scale;
  viewport.scrollLeft = Math.max(0, contentX - viewport.clientWidth / 2);
  viewport.scrollTop = Math.max(0, contentY - viewport.clientHeight / 2);
}

/**
 * Dispatch a real PointerEvent (the input the canvas engine listens for) plus its mouse
 * counterpart, so both the engine and any browser-level default behaviour are exercised.
 */
function fireMouse(type: string, x: number, y: number, buttons: number): void {
  fireMouseWith(type, x, y, buttons, {});
}

function fireMouseWith(
  type: string,
  x: number,
  y: number,
  buttons: number,
  modifiers: { shiftKey?: boolean; metaKey?: boolean }
): void {
  const target = document.elementFromPoint(x, y) ?? document.body;
  const pointerType = type.replace("mouse", "pointer");
  if (pointerType !== type && typeof PointerEvent !== "undefined") {
    target.dispatchEvent(
      new PointerEvent(pointerType, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        shiftKey: modifiers.shiftKey === true,
        metaKey: modifiers.metaKey === true
      })
    );
  }
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 0,
      buttons,
      shiftKey: modifiers.shiftKey === true,
      metaKey: modifiers.metaKey === true
    })
  );
}

async function clickCanvas(logicalX: number, logicalY: number): Promise<void> {
  ensureVisible(logicalX, logicalY);
  await sleep(40);
  const [x, y] = toClient(logicalX, logicalY);
  fireMouse("mousemove", x, y, 0);
  fireMouse("mousedown", x, y, 1);
  await sleep(30);
  fireMouse("mouseup", x, y, 0);
  await sleep(90);
}

async function dragCanvas(
  from: [number, number],
  to: [number, number],
  steps = 6
): Promise<{ dx: number; dy: number }> {
  ensureVisible((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  await sleep(40);
  const [x1, y1] = toClient(from[0], from[1]).map(Math.round) as [number, number];
  const [x2, y2] = toClient(to[0], to[1]).map(Math.round) as [number, number];
  fireMouse("mousemove", x1, y1, 0);
  fireMouse("mousedown", x1, y1, 1);
  await sleep(20);
  for (let i = 1; i <= steps; i += 1) {
    fireMouse("mousemove", Math.round(x1 + ((x2 - x1) * i) / steps), Math.round(y1 + ((y2 - y1) * i) / steps), 1);
    await sleep(16);
  }
  fireMouse("mouseup", x2, y2, 0);
  await sleep(140);
  const scale = scaleFactor();
  return { dx: (x2 - x1) / scale, dy: (y2 - y1) / scale };
}

/** Click with a modifier held down (Shift/Cmd-click = toggle membership). */
async function modifierClickCanvas(logicalX: number, logicalY: number, modifier = true): Promise<void> {
  ensureVisible(logicalX, logicalY);
  await sleep(40);
  const [x, y] = toClient(logicalX, logicalY);
  fireMouseWith("mousemove", x, y, 0, { shiftKey: modifier });
  fireMouseWith("mousedown", x, y, 1, { shiftKey: modifier });
  await sleep(30);
  fireMouseWith("mouseup", x, y, 0, { shiftKey: modifier });
  await sleep(140);
}

/** Drag on empty canvas: the rubber-band selection gesture. */
async function marqueeCanvas(
  from: [number, number],
  to: [number, number],
  modifier = false,
  steps = 6
): Promise<void> {
  ensureVisible((from[0] + to[0]) / 2, (from[1] + to[1]) / 2);
  await sleep(40);
  const [x1, y1] = toClient(from[0], from[1]).map(Math.round) as [number, number];
  const [x2, y2] = toClient(to[0], to[1]).map(Math.round) as [number, number];
  fireMouseWith("mousemove", x1, y1, 0, { shiftKey: modifier });
  fireMouseWith("mousedown", x1, y1, 1, { shiftKey: modifier });
  await sleep(20);
  for (let i = 1; i <= steps; i += 1) {
    fireMouseWith(
      "mousemove",
      Math.round(x1 + ((x2 - x1) * i) / steps),
      Math.round(y1 + ((y2 - y1) * i) / steps),
      1,
      { shiftKey: modifier }
    );
    await sleep(16);
  }
  fireMouseWith("mouseup", x2, y2, 0, { shiftKey: modifier });
  await sleep(150);
}

/** Fire a global shortcut the way the browser does (the app listens on window). */
function keyboardShortcut(
  key: string,
  options: { meta?: boolean; shift?: boolean; target?: EventTarget } = {}
): void {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: options.meta ?? true,
    shiftKey: options.shift ?? false,
    bubbles: true,
    cancelable: true
  });
  (options.target ?? window).dispatchEvent(event);
}

/** Click a button by its tooltip, used by the typography controls. */
function clickByTitle(title: string): void {
  const button = all<HTMLButtonElement>("button").find(
    (candidate) => (candidate.getAttribute("title") ?? "").toLowerCase() === title.toLowerCase()
  );
  if (!button) throw new Error(`button with title "${title}" not found`);
  button.click();
}

function scrollCanvasTo(left: number, top: number): void {
  const viewport = q<HTMLElement>(".canvas-viewport");
  if (!viewport) return;
  viewport.scrollLeft = left;
  viewport.scrollTop = top;
}

function clickButton(label: string): boolean {
  const button = all<HTMLButtonElement>("button").find(
    (candidate) => (candidate.textContent ?? "").trim().toLowerCase() === label.toLowerCase()
  );
  if (!button) return false;
  button.click();
  return true;
}

function mustClickButton(label: string): void {
  if (!clickButton(label)) throw new Error(`button "${label}" not found`);
}

function clickPaletteItem(label: string): void {
  const item = all<HTMLButtonElement>(".palette-item").find((candidate) =>
    (candidate.textContent ?? "").includes(label)
  );
  if (!item) throw new Error(`palette item "${label}" not found`);
  item.click();
}

function paletteItems(): string[] {
  return all<HTMLElement>(".palette-item").map((item) => (item.textContent ?? "").trim());
}

function setFieldValue(field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(field, value);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function panelFields(): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const wrapper of all<HTMLElement>(".properties .field")) {
    const label = wrapper.querySelector(".field-label")?.textContent?.trim() ?? "";
    const input = wrapper.querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
    if (label) fields[label] = input?.value ?? "";
  }
  return fields;
}

function statusText(): string {
  return q(".canvas-status")?.textContent ?? "";
}

function selectedName(): string | null {
  const match = /selected:\s*([^\s·]+)/.exec(statusText());
  return match ? match[1] : null;
}

function elementCount(): number {
  // Read only the second status span: the first one ends with the canvas height, and the two
  // concatenate into a bogus number ("…× 800" + "6 elements").
  const match = /(\d+)\s*element/.exec(all<HTMLElement>(".canvas-status span")[1]?.textContent ?? "");
  return match ? Number(match[1]) : -1;
}

/** Rendered element bounds from the canvas engine (world coordinates). */
function geometryBounds(name: string): { x: number; y: number; width: number; height: number } | null {
  const dev = canvasDev();
  if (!dev) return null;
  return dev.geometries().find((geometry) => geometry.name === name)?.bounds ?? null;
}

/** Every selected element, by name, in selection order. */
function selectionNames(): string[] {
  return canvasDev()?.selection() ?? [];
}

/**
 * Bounding box of the pixels the canvas actually painted inside a world rectangle.
 * Used to prove that text alignment is really rendered, not just stored.
 */
function inkBoundsIn(box: { x: number; y: number; width: number; height: number }): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  pixels: number;
} | null {
  const canvas = q<HTMLCanvasElement>(".canvas-frame canvas");
  const transform = canvasDev()?.transform();
  if (!canvas || !transform) return null;
  const ctx = canvas.getContext("2d");
  const cssWidth = Number.parseFloat(canvas.style.width) || canvas.width;
  const dpr = canvas.width / cssWidth;

  const x0 = Math.max(0, Math.floor((transform.originX + box.x * transform.scale) * dpr));
  const y0 = Math.max(0, Math.floor((transform.originY + box.y * transform.scale) * dpr));
  const w = Math.min(canvas.width - x0, Math.ceil(box.width * transform.scale * dpr));
  const h = Math.min(canvas.height - y0, Math.ceil(box.height * transform.scale * dpr));
  if (!ctx || w <= 0 || h <= 0) return null;

  const data = ctx.getImageData(x0, y0, w, h).data;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let pixels = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const index = (y * w + x) * 4;
      // The grid (#e7e9ee) and the white surface stay above this threshold; text ink does not.
      if (data[index] >= 200 && data[index + 1] >= 200 && data[index + 2] >= 200) continue;
      pixels += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return pixels === 0 ? null : { minX, maxX, minY, maxY, width: w, height: h, pixels };
}

function zoomReadout(): string {
  return q(".zoom-readout")?.textContent?.trim() ?? "";
}

function setZoomPreset(scale: string): void {
  const select = q<HTMLSelectElement>(".zoom-select");
  if (!select) throw new Error("zoom select missing");
  setFieldValue(select, scale);
}

async function openExport(): Promise<string> {
  mustClickButton("Export");
  await sleep(200);
  return q<HTMLTextAreaElement>(".export-output")?.value ?? "";
}

function closeModal(): void {
  q<HTMLButtonElement>(".modal-header .icon-button")?.click();
}

function closeAnyModal(): void {
  closeModal();
}

async function importJson(json: string): Promise<void> {
  mustClickButton("Import");
  await sleep(140);
  const textarea = q<HTMLTextAreaElement>(".import-input");
  if (!textarea) throw new Error("import dialog did not open");
  setFieldValue(textarea, json);
  await sleep(60);
  const button = all<HTMLButtonElement>(".modal-actions button").find(
    (candidate) => (candidate.textContent ?? "").trim() === "Import"
  );
  button?.click();
  await sleep(250);
}

function layerNames(): string[] {
  return all<HTMLElement>(".layer-row").map((row) => row.querySelector(".layer-name")?.textContent?.trim() ?? "");
}

function elementRows(): HTMLElement[] {
  return all<HTMLElement>(".element-row");
}

function elementRowNames(): string[] {
  return elementRows().map((row) => row.querySelector(".element-name")?.textContent?.trim() ?? "?");
}

function layerRowFor(name: string): HTMLElement | null {
  return (
    all<HTMLElement>(".layer-row").find(
      (row) => (row.querySelector(".layer-name")?.textContent ?? "").trim() === name
    ) ?? null
  );
}

function exportJson(markdown: string): {
  title: string;
  canvas?: Record<string, unknown>;
  layers: { name: string }[];
  elements: (WireframeElement & { columns?: string[] })[];
} {
  const start = markdown.indexOf("```ui-project") + 13;
  return JSON.parse(markdown.slice(start, markdown.lastIndexOf("```")));
}

const LAYOUT_PROJECT = {
  version: 1,
  title: "Selection",
  canvas: { mode: "desktop", width: 1200, height: 800 },
  elements: [
    {
      id: "el_container",
      type: "container",
      name: "panelContainer",
      label: "Panel",
      note: "",
      x: 100,
      y: 100,
      width: 600,
      height: 400,
      zIndex: 0
    },
    {
      id: "el_text",
      type: "text",
      name: "heading",
      label: "Heading",
      note: "",
      x: 140,
      y: 140,
      width: 240,
      height: 30,
      zIndex: 1
    },
    {
      id: "el_button",
      type: "button",
      name: "saveButton",
      label: "Save",
      note: "",
      x: 140,
      y: 220,
      width: 140,
      height: 40,
      zIndex: 2
    },
    {
      id: "el_toggle",
      type: "toggle",
      name: "notificationsToggle",
      label: "Notifications",
      note: "",
      x: 140,
      y: 320,
      width: 220,
      height: 30,
      zIndex: 3
    },
    {
      id: "el_input",
      type: "input",
      name: "usernameInput",
      label: "Username",
      note: "",
      x: 140,
      y: 400,
      width: 300,
      height: 40,
      zIndex: 4
    }
  ]
};

const NEW_TYPE_LABELS = [
  "Bottom Navigation",
  "Dialog",
  "Icon",
  "Avatar",
  "Badge / Chip",
  "Table",
  "Textarea",
  "Radio",
  "Slider",
  "Progress",
  "Icon Button"
];

/** Six standalone objects for the multi-selection and clipboard passes. */
const SELECTION_PROJECT = {
  version: 2,
  title: "Multi selection",
  canvas: { mode: "desktop", width: 1200, height: 800 },
  layers: [{ id: "layer_default", name: "Default", visible: true, locked: false }],
  elements: [
    { id: "e_btn1", type: "button", name: "btn1", label: "One", note: "", x: 140, y: 140, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 0 },
    { id: "e_btn2", type: "button", name: "btn2", label: "Two", note: "", x: 300, y: 140, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 1 },
    { id: "e_btn3", type: "button", name: "btn3", label: "Three", note: "", x: 460, y: 140, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 2 },
    { id: "e_btn4", type: "button", name: "btn4", label: "Four", note: "", x: 140, y: 220, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 3 },
    { id: "e_btn5", type: "button", name: "btn5", label: "Five", note: "", x: 300, y: 220, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 4 },
    { id: "e_btn6", type: "button", name: "btn6", label: "Six", note: "", x: 460, y: 220, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 5 }
  ]
};

/** A structural Container with a Button sitting in its interior. */
const CONTAINER_PROJECT = {
  version: 2,
  title: "Container drag",
  canvas: { mode: "desktop", width: 1200, height: 800 },
  layers: [{ id: "layer_default", name: "Default", visible: true, locked: false }],
  elements: [
    { id: "e_container", type: "container", name: "panelContainer", label: "Panel", note: "", x: 100, y: 100, width: 500, height: 300, layerId: "layer_default", visible: true, locked: false, zIndex: 0 },
    { id: "e_button", type: "button", name: "saveButton", label: "Save", note: "", x: 340, y: 240, width: 120, height: 40, layerId: "layer_default", visible: true, locked: false, zIndex: 1 }
  ]
};

const EXPECTATION_KEY = "wirefragma.selftest.expected";
const HISTORY_KEY = "wirefragma.selftest.history";

interface CanvasDevApi {
  transform: () => { scale: number; originX: number; originY: number };
  hitTest: (world: { x: number; y: number }) => string;
  hitTarget: (world: { x: number; y: number }) => { kind: string; name: string | null; edge?: string };
  geometries: () => { name: string; type: string; bounds: { x: number; y: number; width: number; height: number } }[];
  elementNames: () => string[];
  preview: () => { elementId: string; bounds: { x: number; y: number; width: number; height: number } }[];
  marquee: () => { x: number; y: number; width: number; height: number } | null;
  /** Selected element names, in selection order. */
  selection: () => string[];
}

function canvasDev(): CanvasDevApi | null {
  return (
    (window as unknown as { __wirefragmaCanvas?: CanvasDevApi }).__wirefragmaCanvas ?? null
  );
}

/**
 * What the editor engine resolves at a logical canvas point — the SAME function the running
 * canvas uses for real pointer events (see src/canvas/hitTest.ts).
 */
function engineTarget(logicalX: number, logicalY: number): string {
  const dev = canvasDev();
  if (!dev) return "no-engine";
  return dev.hitTest({ x: logicalX, y: logicalY });
}

/** Rendered element names in paint order (back → front) — the canvas's own geometry. */
function renderOrder(): string {
  const dev = canvasDev();
  if (!dev) return "no-engine";
  return dev.elementNames().join(" → ");
}

async function setPanelFields(patch: Record<string, number>): Promise<void> {
  for (const [label, value] of Object.entries(patch)) {
    const field = all<HTMLElement>(".properties .field").find(
      (wrapper) => wrapper.querySelector(".field-label")?.textContent?.trim() === label
    );
    const input = field?.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error(`field ${label} not found`);
    setFieldValue(input, String(value));
    await sleep(90);
  }
}

async function startFromBlankProject(): Promise<void> {
  mustClickButton("New");
  await sleep(200);
  all<HTMLButtonElement>(".modal-actions button")
    .find((candidate) => (candidate.textContent ?? "").trim() === "New Project")
    ?.click();
  await sleep(320);
}

/** The layers column collapses on narrow windows; open it by its own state, not by row count. */
async function ensureLayersOpen(): Promise<void> {
  if (q(".panel.layers-column.collapsed")) {
    clickButton("Layers");
    await sleep(250);
  }
}

/** Mobile landscape screen that exercises every element introduced in this pass. */
const SHOWCASE_PROJECT = {
  version: 2,
  title: "Mobile landscape",
  canvas: { mode: "mobileLandscape", width: 844, height: 390 },
  layers: [
    { id: "layer_controls", name: "Controls", visible: true, locked: false },
    { id: "layer_content", name: "Content", visible: true, locked: false },
    { id: "layer_layout", name: "Layout", visible: true, locked: false }
  ],
  elements: [
    { id: "e_nav", type: "bottomNav", name: "bottomNav", label: "", note: "", x: 0, y: 326, width: 844, height: 64, layerId: "layer_layout", visible: true, locked: false, zIndex: 0, items: ["Home", "Search", "Profile"] },
    { id: "e_toolbar", type: "toolbar", name: "topToolbar", label: "Library", note: "", x: 0, y: 0, width: 844, height: 56, layerId: "layer_layout", visible: true, locked: false, zIndex: 1 },
    { id: "e_divider", type: "divider", name: "headerDivider", label: "", note: "", x: 0, y: 56, width: 844, height: 8, layerId: "layer_layout", visible: true, locked: false, zIndex: 2 },
    { id: "e_table", type: "table", name: "projectsTable", label: "", note: "", x: 24, y: 88, width: 480, height: 208, layerId: "layer_content", visible: true, locked: false, zIndex: 0, columns: ["Name", "Status", "Size"], items: ["Project A | Active | 24 GB", "Project B | Paused | 8 GB", "Project C | Active | 3 GB"] },
    { id: "e_avatar", type: "avatar", name: "userAvatar", label: "AB", note: "", x: 548, y: 88, width: 40, height: 40, layerId: "layer_content", visible: true, locked: false, zIndex: 1 },
    { id: "e_heading", type: "text", name: "projectsHeading", label: "Projects", note: "", x: 604, y: 96, width: 200, height: 24, layerId: "layer_content", visible: true, locked: false, zIndex: 2 },
    { id: "e_badge", type: "badge", name: "planBadge", label: "Team", note: "", x: 548, y: 148, width: 96, height: 28, layerId: "layer_content", visible: true, locked: false, zIndex: 3 },
    { id: "e_progress", type: "progress", name: "storageProgress", label: "", note: "", x: 548, y: 196, width: 240, height: 20, layerId: "layer_content", visible: true, locked: false, zIndex: 4 },
    { id: "e_slider", type: "slider", name: "zoomSlider", label: "Density", note: "", x: 548, y: 236, width: 220, height: 32, layerId: "layer_content", visible: true, locked: false, zIndex: 5 },
    { id: "e_textarea", type: "textarea", name: "notesTextarea", label: "Notes", note: "", x: 548, y: 276, width: 260, height: 40, layerId: "layer_controls", visible: true, locked: false, zIndex: 0 },
    { id: "e_iconButton", type: "iconButton", name: "addButton", label: "+", note: "", x: 792, y: 12, width: 36, height: 36, layerId: "layer_controls", visible: true, locked: false, zIndex: 1 },
    { id: "e_icon", type: "icon", name: "starIcon", label: "★", note: "", x: 748, y: 14, width: 32, height: 32, layerId: "layer_controls", visible: true, locked: false, zIndex: 2 }
  ]
};

export async function runSelfTest(pass = 1): Promise<void> {
  const results: StepResult[] = [];
  const check = async (name: string, fn: () => Promise<string | void> | string | void) => {
    try {
      const info = await fn();
      results.push({ name, ok: true, info: typeof info === "string" ? info : undefined });
    } catch (error) {
      results.push({ name, ok: false, info: (error as Error).message });
    }
  };
  const expect = (condition: boolean, message: string) => {
    if (!condition) throw new Error(message);
  };
  const report = () => {
    // Keep every pass in one place: passes navigate to the next one, which would otherwise
    // wipe the DOM report before it can be read.
    let history: { pass: number; results: StepResult[] }[] = [];
    try {
      // sessionStorage survives the reloads between passes and is not wiped when the
      // storage-migration pass clears localStorage.
      history = JSON.parse(window.sessionStorage.getItem(HISTORY_KEY) ?? "[]") as typeof history;
    } catch {
      history = [];
    }
    history = history.filter((entry) => entry.pass !== pass).concat([{ pass, results }]);
    window.sessionStorage.setItem(HISTORY_KEY, JSON.stringify(history));

    const element = document.createElement("pre");
    element.id = "selftest-report";
    element.textContent = JSON.stringify({ pass, results, history }, null, 1);
    element.style.position = "fixed";
    element.style.left = "-10000px";
    document.body.appendChild(element);

    // A readable on-screen copy: the hidden <pre> above stays the machine-readable record, this
    // panel is what a human (or a screen reader) checks after `?selftest=N`.
    const panel = document.createElement("div");
    panel.id = "selftest-panel";
    panel.style.position = "fixed";
    panel.style.left = "8px";
    panel.style.bottom = "8px";
    panel.style.maxWidth = "70vw";
    panel.style.maxHeight = "55vh";
    panel.style.overflow = "auto";
    panel.style.padding = "8px 10px";
    panel.style.background = "rgba(255,255,255,0.97)";
    panel.style.border = "1px solid #c7ccd4";
    panel.style.borderRadius = "6px";
    panel.style.boxShadow = "0 10px 24px rgba(15,23,42,0.18)";
    panel.style.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    panel.style.whiteSpace = "pre-wrap";
    panel.style.zIndex = "9999";

    const failed = results.filter((result) => !result.ok).length;
    const heading = document.createElement("div");
    heading.textContent = `SELFTEST pass ${pass}: ${results.length - failed}/${results.length} checks passed${
      failed ? ` — ${failed} FAILED` : ""
    }`;
    heading.style.fontWeight = "700";
    heading.style.marginBottom = "4px";
    heading.style.color = failed ? "#c0392b" : "#1f7a3d";
    panel.appendChild(heading);

    for (const result of results) {
      const line = document.createElement("div");
      line.textContent = `${result.ok ? "PASS" : "FAIL"} ${result.name}${result.info ? ` — ${result.info}` : ""}`;
      line.style.color = result.ok ? "#1f2429" : "#c0392b";
      panel.appendChild(line);
    }
    document.body.appendChild(panel);
  };

  for (let i = 0; i < 60 && !q(".canvas-frame canvas"); i += 1) await sleep(100);
  if (!q(".canvas-frame canvas")) {
    results.push({ name: "mount", ok: false, info: "canvas never appeared" });
    report();
    return;
  }

  /* ------------------------------------------------- pass 2: persistence */

  if (pass === 2) {
    await ensureLayersOpen();
    const expected = JSON.parse(
      window.localStorage.getItem(EXPECTATION_KEY) ??
        '{"hiddenNames":[],"lockedNames":[],"layers":[]}'
    ) as { hiddenNames: string[]; lockedNames: string[]; layers: string[] };

    await check("persistence: layers survive reload", () => {
      const names = layerNames();
      expect(names.length === expected.layers.length, `layers: ${names.join(",")}`);
      expect(names.join(" | ") === expected.layers.join(" | "), `order changed: ${names.join(" | ")}`);
      return names.join(" | ");
    });
    await check("persistence: hidden element stays hidden", () => {
      const hidden = all<HTMLElement>(".element-row.hidden-row").map(
        (row) => row.querySelector(".element-name")?.textContent ?? "?"
      );
      expect(hidden.length === expected.hiddenNames.length, `hidden: ${hidden.join(",")}`);
      expect(hidden.join(",") === expected.hiddenNames.join(","), `hidden names changed`);
      return hidden.join(",");
    });
    await check("persistence: locked element stays locked", () => {
      const locked = all<HTMLElement>(".element-row")
        .filter((row) => row.querySelector(".row-icon.on") !== null)
        .map((row) => row.querySelector(".element-name")?.textContent ?? "?");
      expect(locked.length > 0, "no locked element after reload");
      expect(locked.join(",") === expected.lockedNames.join(","), "locked names changed");
      return locked.join(",");
    });
    await check("persistence: zoom is view state only", async () => {
      const markdown = await openExport();
      const json = exportJson(markdown);
      const canvasKeys = Object.keys(json.canvas ?? {}).join(",");
      expect(canvasKeys === "mode,width,height", `canvas keys: ${canvasKeys}`);
      expect(!("zoom" in json), "zoom stored at project level");
      expect(
        json.elements.every((element) => !("zoom" in element) && !("scale" in element)),
        "zoom stored on an element"
      );
      expect(json.elements.length > 0, "no elements in source");
      closeModal();
      return `${json.elements.length} elements, no zoom data`;
    });
    await check("legacy storage: project written under the UI Sketch key loads", async () => {
      window.localStorage.setItem(
        LEGACY_STORAGE_KEY,
        JSON.stringify({
          version: 1,
          title: "Legacy Project",
          canvas: { mode: "mobile", width: 390, height: 844 },
          elements: [
            {
              id: "legacy_button",
              type: "button",
              name: "legacyButton",
              label: "Legacy",
              note: "",
              x: 20,
              y: 700,
              width: 120,
              height: 40,
              zIndex: 0
            }
          ]
        })
      );
      window.localStorage.removeItem(STORAGE_KEY);
      const url = new URL(window.location.href);
      url.searchParams.set("selftest", "3");
      window.location.replace(url.toString());
      return "wrote legacy key and reloading";
    });
    report();
    return;
  }

  /* -------------------------------------------- pass 3: legacy migration */

  if (pass === 3) {
    await ensureLayersOpen();
    await check("legacy migration: project restored from the old key", () => {
      expect(statusText().includes("Legacy Project"), `status: ${statusText()}`);
      expect(elementRowNames().includes("legacyButton"), `rows: ${elementRowNames().join(",")}`);
      return statusText();
    });
    await check("legacy migration: copied to the Wirefragma key", () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      expect(!!stored, "new key not written");
      expect(stored?.includes("Legacy Project") === true, "new key does not hold the migrated project");
      expect(window.localStorage.getItem(LEGACY_STORAGE_KEY) !== null, "legacy key was deleted");
      return "new key populated, legacy key kept";
    });
    await check("fresh start: clearing storage and reloading", async () => {
      window.localStorage.clear();
      const url = new URL(window.location.href);
      url.searchParams.set("selftest", "4");
      window.location.replace(url.toString());
      return "storage cleared";
    });
    report();
    return;
  }

  /* ------------------------------------------------- pass 4: fresh start */

  if (pass === 4) {
    await ensureLayersOpen();
    await check("fresh start opens a blank project", () => {
      expect(statusText().includes("0 elements"), `status: ${statusText()}`);
      expect(statusText().includes("Untitled"), `status: ${statusText()}`);
      expect(statusText().includes("1200 × 800"), `status: ${statusText()}`);
      expect(!selectedName(), "something is selected on a fresh launch");
      return statusText();
    });
    await check("fresh start has one empty Default layer", () => {
      const names = layerNames();
      expect(names.join(" | ") === "Default", `layers: ${names.join(" | ")}`);
      expect(elementRows().length === 0, `rows: ${elementRowNames().join(",")}`);
      return `${names[0]} with no elements`;
    });
    await check("fresh start draws only the empty canvas", () => {
      const dev = canvasDev();
      expect(!!dev, "canvas engine not attached");
      const names = dev!.elementNames();
      expect(names.length === 0, `canvas draws ${names.length} elements: ${names.join(",")}`);
      return "canvas empty";
    });
    await check("New creates the same blank project", async () => {
      clickPaletteItem("Button");
      await sleep(150);
      expect(elementRows().length === 1, "test element was not added");
      mustClickButton("New");
      await sleep(200);
      const confirm = all<HTMLButtonElement>(".modal-actions button").find(
        (candidate) => (candidate.textContent ?? "").trim() === "New Project"
      );
      confirm?.click();
      await sleep(300);
      expect(statusText().includes("0 elements"), `status after New: ${statusText()}`);
      expect(layerNames().join(" | ") === "Default", `layers: ${layerNames().join(" | ")}`);
      const markdown = await openExport();
      const json = exportJson(markdown);
      closeModal();
      expect(json.elements.length === 0, `New left ${json.elements.length} elements`);
      expect(json.layers.length === 1, `New left ${json.layers.length} layers`);
      expect(json.canvas?.width === 1200 && json.canvas?.height === 800, "New used a non-desktop canvas");
      return "New → Untitled, Default, 0 elements, 1200×800";
    });
    report();
    return;
  }

  if (pass === 5) {
    // Visual showcase of the new element types on a mobile landscape canvas.
    await check("showcase project renders all new types", async () => {
      await importJson(JSON.stringify(SHOWCASE_PROJECT));
      await sleep(300);
      expect(statusText().includes("844 × 390"), `status: ${statusText()}`);
      const markdown = await openExport();
      const json = exportJson(markdown);
      closeModal();
      expect(
        json.elements.length === SHOWCASE_PROJECT.elements.length,
        `exported ${json.elements.length} elements`
      );
      const types = json.elements.map((element) => element.type);
      expect(types.includes("table") && types.includes("dialog") === false, "unexpected types");
      return `${types.length} showcase elements: ${types.join(", ")}`;
    });
    report();
    return;
  }

  if (pass === 6) {
    await ensureLayersOpen();

    /**
     * The reported bug: a Button placed inside a structural surface must be selectable and
     * draggable directly on the canvas, at every zoom level, with snapping on and off.
     */
    const STRUCTURES: { label: string; name: string; box: Record<string, number>; bodyText?: string }[] = [
      { label: "Dialog", name: "dialog1", box: { X: 100, Y: 100, Width: 500, Height: 300 } },
      { label: "Container", name: "container1", box: { X: 100, Y: 100, Width: 500, Height: 300 } },
      { label: "Toolbar", name: "toolbar1", box: { X: 100, Y: 100, Width: 600, Height: 80 } },
      { label: "Sidebar", name: "sidebar1", box: { X: 100, Y: 100, Width: 240, Height: 420 } }
    ];

    const runCase = async (
      structure: (typeof STRUCTURES)[number],
      options: { zoom: string; snap: boolean }
    ) => {
      await startFromBlankProject();
      await ensureLayersOpen();
      if (!options.snap) {
        mustClickButton("Snap");
        await sleep(120);
      }
      setZoomPreset(options.zoom);
      await sleep(250);

      clickPaletteItem(structure.label);
      await sleep(200);
      await setPanelFields(structure.box);
      clickPaletteItem("Button");
      await sleep(200);
      // Place the button in the middle of the structural surface.
      const buttonX = structure.box.X + Math.round((structure.box.Width - 120) / 2);
      const buttonY = structure.box.Y + Math.round((structure.box.Height - 40) / 2);
      await setPanelFields({ X: buttonX, Y: buttonY, Width: 120, Height: 40 });
      const centreX = buttonX + 60;
      const centreY = buttonY + 20;

      const order = renderOrder();
      const target = engineTarget(centreX, centreY);
      await clickCanvas(30, 30);
      await clickCanvas(centreX, centreY);
      const selected = selectedName();

      const buttonBefore = panelFields();
      const structuralBefore = await (async () => {
        const index = elementRowNames().indexOf(structure.name);
        if (index < 0) return null;
        elementRows()[index].click();
        await sleep(150);
        const fields = panelFields();
        const index2 = elementRowNames().indexOf("button1");
        elementRows()[index2].click();
        await sleep(150);
        return `${fields["X"]},${fields["Y"]}`;
      })();

      await dragCanvas([centreX, centreY], [centreX + 80, centreY + 60]);
      const buttonAfter = panelFields();
      const structuralAfter = await (async () => {
        const index = elementRowNames().indexOf(structure.name);
        if (index < 0) return null;
        elementRows()[index].click();
        await sleep(150);
        const fields = panelFields();
        const index2 = elementRowNames().indexOf("button1");
        elementRows()[index2].click();
        await sleep(150);
        return `${fields["X"]},${fields["Y"]}`;
      })();

      // Selecting the structure again from its own surface (border / empty area).
      const surfacePoint: [number, number] = [structure.box.X + 8, structure.box.Y + structure.box.Height - 8];
      await clickCanvas(surfacePoint[0], surfacePoint[1]);
      const surface = selectedName();

      return {
        order,
        target,
        selected,
        moved: `${buttonBefore["X"]},${buttonBefore["Y"]} → ${buttonAfter["X"]},${buttonAfter["Y"]}`,
        movedOk:
          Number(buttonAfter["X"]) !== Number(buttonBefore["X"]) ||
          Number(buttonAfter["Y"]) !== Number(buttonBefore["Y"]),
        structuralStable: structuralBefore === structuralAfter,
        surface,
        rowOrderTop: elementRowNames()[0],
        structuralMeasured: structuralBefore !== null && structuralAfter !== null
      };
    };

    for (const structure of STRUCTURES) {
      await check(`${structure.label} + button: click, drag, resize matrix at fit zoom`, async () => {
        const result = await runCase(structure, { zoom: "fit", snap: true });
        const info = JSON.stringify(result);
        expect(result.selected === "button1", `click selected ${result.selected ?? "nothing"} | ${info}`);
        expect(result.movedOk, `button did not move | ${info}`);
        expect(result.structuralMeasured, `could not measure ${structure.name} | ${info}`);
        expect(result.structuralStable, `${structure.name} moved with the button | ${info}`);
        if (structure.label === "Container") {
          expect(result.surface === "container1", `border click selected ${result.surface ?? "nothing"}`);
        } else {
          expect(result.surface === structure.name, `surface click selected ${result.surface ?? "nothing"} | ${info}`);
        }
        return info;
      });
    }

    for (const zoom of ["0.5", "1", "1.5", "2"]) {
      await check(`dialog + button at ${Number(zoom) * 100}% zoom`, async () => {
        const result = await runCase(STRUCTURES[0], { zoom, snap: true });
        const info = JSON.stringify(result);
        expect(result.selected === "button1", `click selected ${result.selected ?? "nothing"} | ${info}`);
        expect(result.movedOk, `button did not move | ${info}`);
        expect(result.structuralStable, `dialog moved with the button | ${info}`);
        return info;
      });
    }

    await check("dialog + button with snap off", async () => {
      const result = await runCase(STRUCTURES[0], { zoom: "fit", snap: false });
      const info = JSON.stringify(result);
      expect(result.selected === "button1", `click selected ${result.selected ?? "nothing"} | ${info}`);
      expect(result.movedOk, `button did not move with snap off | ${info}`);
      mustClickButton("Snap"); // restore
      await sleep(120);
      return info;
    });

    await check("z-order stays consistent both ways", async () => {
      await startFromBlankProject();
      await ensureLayersOpen();
      setZoomPreset("fit");
      await sleep(200);
      clickPaletteItem("Dialog");
      await sleep(150);
      await setPanelFields({ X: 100, Y: 100, Width: 500, Height: 300 });
      clickPaletteItem("Button");
      await sleep(150);
      await setPanelFields({ X: 200, Y: 200, Width: 120, Height: 40 });

      await clickCanvas(260, 220);
      const buttonFirst = selectedName();
      const orderBefore = renderOrder();
      const topRowBefore = elementRowNames()[0];

      // Send the dialog to the front: it must now win the same click.
      const dialogIndex = elementRowNames().indexOf("dialog1");
      elementRows()[dialogIndex].click();
      await sleep(150);
      mustClickButton("Bring to front");
      await sleep(200);
      const orderAfter = renderOrder();
      const topRowAfter = elementRowNames()[0];
      await clickCanvas(260, 220);
      const dialogFirst = selectedName();

      expect(buttonFirst === "button1", `first click selected ${buttonFirst ?? "nothing"}`);
      expect(orderBefore === "dialog1 → button1", `render order: ${orderBefore}`);
      expect(orderAfter === "button1 → dialog1", `render order after bring-to-front: ${orderAfter}`);
      expect(topRowBefore === "button1" && topRowAfter === "dialog1", `layers rows: ${topRowBefore}/${topRowAfter}`);
      expect(dialogFirst === "dialog1", `dialog did not win after bring-to-front: ${dialogFirst ?? "nothing"}`);
      return `render ${orderBefore} → ${orderAfter}; layers top ${topRowBefore} → ${topRowAfter}; click winner ${buttonFirst} → ${dialogFirst}`;
    });

    report();
    return;
  }

  if (pass === 7) {
    /** Non-overlapping elements at the default fit zoom: can they be selected and moved? */
    const probeTypes: [string, string][] = [
      ["Button", "button1"],
      ["Tabs", "tabs1"],
      ["Progress", "progress1"],
      ["Divider", "divider1"],
      ["Badge / Chip", "badge1"],
      ["Icon Button", "iconButton1"]
    ];

    const panelGeometry = () => {
      const fields = panelFields();
      return {
        x: Number(fields["X"]),
        y: Number(fields["Y"]),
        width: Number(fields["Width"]),
        height: Number(fields["Height"])
      };
    };

    await startFromBlankProject();
    mustClickButton("Fit");
    await sleep(250);

    const rows: string[] = [];
    for (const [label, expectedName] of probeTypes) {
      clickPaletteItem(label);
      await sleep(200);
      const geometry = panelGeometry();
      const cx = geometry.x + geometry.width / 2;
      const cy = geometry.y + geometry.height / 2;
      const scale = scaleFactor();
      const cssWidth = Math.round(geometry.width * scale);
      const cssHeight = Math.round(geometry.height * scale);

      await clickCanvas(30, 30); // deselect on empty canvas first
      await clickCanvas(cx, cy);
      const selected = selectedName();
      const target = engineTarget(cx, cy);

      const before = panelGeometry();
      await dragCanvas([cx, cy], [cx + 48, cy + 32]);
      const after = panelGeometry();
      // Cross-check against the canonical document source, so a stale panel cannot hide a
      // real move (and a real move cannot be faked by the panel).
      const markdown = await openExport();
      closeModal();
      const exported = exportJson(markdown).elements.find(
        (candidate: { name: string }) => candidate.name === expectedName
      ) as { x: number; y: number } | undefined;
      const movedByPanel = after.x !== before.x || after.y !== before.y;
      const movedByDocument = !!exported && (exported.x !== before.x || exported.y !== before.y);
      const moved = movedByPanel || movedByDocument;

      rows.push(
        `${label} [${expectedName}] ${geometry.width}×${geometry.height} (${cssWidth}×${cssHeight} css): ` +
          `selected=${selected ?? "none"} target=${target} moved=${moved} ` +
          `( ${before.x},${before.y} → ${after.x},${after.y} ) doc=${exported?.x ?? "?"},${exported?.y ?? "?"} ` +
          `selectedAfterDrag=${selectedName() ?? "none"}`
      );
      // remove it so the next probe is isolated (and non-overlapping)
      mustClickButton("Delete");
      await sleep(150);
    }

    await check("non-overlapping elements at fit zoom (diagnostic)", () => rows.join("\n"));
    report();
    return;
  }

  if (pass === 8) {
    /** Report the engine's transform + what it resolves at the element centre per zoom level. */
    const measure = () => {
      const dev = canvasDev();
      const scale = scaleFactor();
      return {
        zoom: `${Math.round(scale * 100)}%`,
        transformScale: dev ? Number(dev.transform().scale.toFixed(3)) : null,
        dpr: window.devicePixelRatio,
        elements: dev ? dev.elementNames().length : null
      };
    };

    await startFromBlankProject();
    const lines: string[] = [];
    clickPaletteItem("Icon Button");
    await sleep(250);
    for (const preset of ["fit", "0.5", "1", "2"]) {
      setZoomPreset(preset);
      await sleep(300);
      const geometry = panelFields();
      const cx = Number(geometry["X"]) + Number(geometry["Width"]) / 2;
      const cy = Number(geometry["Y"]) + Number(geometry["Height"]) / 2;
      lines.push(
        `preset ${preset}: ${JSON.stringify(measure())} | centre target=${engineTarget(cx, cy)}`
      );
    }

    await check("canvas transform per zoom level (diagnostic)", () => lines.join("\n"));
    report();
    return;
  }

  if (pass === 9) {
    /** Visual state for the fixed case: a small Button selected inside a large Dialog. */
    await startFromBlankProject();
    setZoomPreset("fit");
    await sleep(250);
    clickPaletteItem("Dialog");
    await sleep(200);
    await setPanelFields({ X: 100, Y: 100, Width: 500, Height: 300 });
    clickPaletteItem("Button");
    await sleep(200);
    await setPanelFields({ X: 290, Y: 230, Width: 120, Height: 40 });
    await clickCanvas(350, 250);

    const selected = selectedName();

    await check("dialog with a selected button inside (visual)", () => {
      expect(selected === "button1", `selected ${selected ?? "nothing"}`);
      return `${selected} selected inside dialog1 at ${Math.round(scaleFactor() * 100)}% zoom`;
    });
    report();
    return;
  }

  /* ------------------------------------------------------------ pass 1 */

  /* ------------------------------- pass 10: multi-selection, clipboard, typing, logo */

  if (pass === 10) {
    await ensureLayersOpen();

    const boundsOf = (name: string) => {
      const bounds = geometryBounds(name);
      if (!bounds) throw new Error(`${name} is not on the canvas`);
      return bounds;
    };

    await check("marquee selects exactly the three swept objects", async () => {
      await importJson(JSON.stringify(SELECTION_PROJECT));
      await ensureLayersOpen();
      await marqueeCanvas([130, 130], [600, 200]);
      const names = selectionNames();
      expect(names.join(",") === "btn1,btn2,btn3", `marquee selected ${names.join(",") || "nothing"}`);
      expect(statusText().includes("3 selected"), `status: ${statusText()}`);
      const rows = all<HTMLElement>(".element-row.selected").length;
      expect(rows === 3, `layers panel highlights ${rows} rows`);
      return `${names.join(", ")} · ${rows} layer rows highlighted`;
    });

    await check("dragging one selected object moves the whole set as one rigid body", async () => {
      const before = ["btn1", "btn2", "btn3"].map(boundsOf);
      await dragCanvas([360, 160], [400, 200]); // grab btn2 (selected)
      const after = ["btn1", "btn2", "btn3"].map(boundsOf);
      const deltas = after.map((box, index) => [box.x - before[index].x, box.y - before[index].y]);
      const [dx, dy] = deltas[0];
      expect(dx !== 0 || dy !== 0, "nothing moved");
      expect(
        deltas.every((delta) => delta[0] === dx && delta[1] === dy),
        `members moved by different deltas: ${JSON.stringify(deltas)}`
      );
      expect(
        after[1].x - after[0].x === before[1].x - before[0].x &&
          after[2].x - after[1].x === before[2].x - before[1].x,
        "relative layout changed"
      );
      expect(selectionNames().length === 3, "the drag lost the multi-selection");
      return `all 3 moved by ${dx},${dy}`;
    });

    await check("one undo restores the whole multi-object drag", async () => {
      const before = ["btn1", "btn2", "btn3"].map(boundsOf);
      await dragCanvas([400, 200], [440, 260]);
      const moved = ["btn1", "btn2", "btn3"].map(boundsOf);
      expect(moved[0].x !== before[0].x, "the drag did not move anything");
      keyboardShortcut("z");
      await sleep(240);
      const restored = ["btn1", "btn2", "btn3"].map(boundsOf);
      expect(
        restored.every((box, index) => box.x === before[index].x && box.y === before[index].y),
        `undo failed: ${JSON.stringify(restored)} vs ${JSON.stringify(before)}`
      );
      return "one Cmd/Ctrl+Z restored all three";
    });

    await check("shift-click adds an object, shift-click again removes it", async () => {
      const four = boundsOf("btn4");
      await modifierClickCanvas(four.x + 20, four.y + 20);
      const added = selectionNames();
      expect(added.length === 4 && added.includes("btn4"), `shift-click gave ${added.join(",")}`);
      await modifierClickCanvas(four.x + 20, four.y + 20);
      const removed = selectionNames();
      expect(removed.length === 3 && !removed.includes("btn4"), `second shift-click gave ${removed.join(",")}`);
      return `4 → 3 objects selected`;
    });

    await check("copy and paste offset the copies, and repeated pastes keep cascading", async () => {
      await startFromBlankProject();
      await importJson(JSON.stringify(SELECTION_PROJECT));
      await ensureLayersOpen();
      const before = elementCount();
      await clickCanvas(200, 160); // select btn1
      expect(selectedName() === "btn1", `selected ${selectedName() ?? "nothing"}`);

      keyboardShortcut("c");
      keyboardShortcut("v");
      await sleep(260);
      expect(elementCount() === before + 1, `first paste gave ${elementCount()} elements`);
      const firstCopy = selectionNames();
      expect(firstCopy.length === 1, `paste did not select the copy: ${firstCopy.join(",")}`);
      const firstBounds = boundsOf(firstCopy[0]);
      const original = boundsOf("btn1");
      expect(
        firstBounds.x === original.x + 16 && firstBounds.y === original.y + 16,
        `first copy at ${firstBounds.x},${firstBounds.y}`
      );

      keyboardShortcut("v");
      await sleep(260);
      expect(elementCount() === before + 2, `second paste gave ${elementCount()} elements`);
      const secondBounds = boundsOf(selectionNames()[0]);
      expect(
        secondBounds.x === firstBounds.x + 16 && secondBounds.y === firstBounds.y + 16,
        `second copy at ${secondBounds.x},${secondBounds.y}`
      );
      return `-${original.x},${original.y} → +16 → +16`;
    });

    await check("shortcuts stay out of the way while typing in a text field", async () => {
      const count = elementCount();
      const selectionBefore = selectedName();
      const nameInput = q<HTMLInputElement>(".properties input[type='text']");
      expect(nameInput !== null, "no text field in the properties panel");
      nameInput!.focus();
      keyboardShortcut("v", { target: nameInput! });
      keyboardShortcut("d", { target: nameInput! });
      keyboardShortcut("Backspace", { target: nameInput! });
      await sleep(240);
      expect(elementCount() === count, `element count changed while typing: ${count} → ${elementCount()}`);
      expect(
        selectedName() === selectionBefore,
        `selection changed while typing: ${selectionBefore ?? "nothing"} → ${selectedName() ?? "nothing"}`
      );
      nameInput!.blur();
      return `Cmd+V, Cmd+D and Backspace ignored inside the field (${count} elements, ${selectionBefore ?? "nothing"} still selected)`;
    });

    await check("Cmd+D, Properties Duplicate and Layers Duplicate all copy the object", async () => {
      await clickCanvas(200, 160);
      const base = elementCount();
      keyboardShortcut("d");
      await sleep(250);
      expect(elementCount() === base + 1, `Cmd+D gave ${elementCount()} elements`);
      const keyboardCopy = selectionNames()[0];
      expect(keyboardCopy !== "btn1", "Cmd+D did not select the copy");

      mustClickButton("Duplicate");
      await sleep(250);
      expect(elementCount() === base + 2, `Properties Duplicate gave ${elementCount()} elements`);

      const sourceRow = all<HTMLElement>(".element-row").find(
        (row) => row.querySelector(".element-name")?.textContent?.trim() === "btn1"
      );
      expect(sourceRow !== null, "btn1 row not found");
      const duplicateButton = sourceRow!.querySelectorAll<HTMLButtonElement>(".row-icon")[2];
      expect(duplicateButton !== null, "no duplicate icon on the layer row");
      duplicateButton.click();
      await sleep(260);
      expect(elementCount() === base + 3, `Layers Duplicate gave ${elementCount()} elements`);

      const markdown = await openExport();
      closeModal();
      const json = exportJson(markdown) as unknown as {
        elements: { name: string; label: string; layerId: string }[];
      };
      const source = json.elements.find((element) => element.name === "btn1");
      const layerCopies = json.elements.filter((element) => element.name.startsWith("btn1Copy"));
      expect(layerCopies.length >= 3, `only ${layerCopies.length} copies exported`);
      expect(
        layerCopies.every((element) => element.layerId === source?.layerId),
        "a duplicate left its layer"
      );
      return `3 copies, all in ${source?.layerId}`;
    });

    await check("Container: child stays selectable, border drags the Container, interior passes through", async () => {
      await startFromBlankProject();
      await importJson(JSON.stringify(CONTAINER_PROJECT));
      await ensureLayersOpen();

      await clickCanvas(400, 260);
      expect(selectedName() === "saveButton", `interior click selected ${selectedName() ?? "nothing"}`);

      await clickCanvas(500, 103);
      expect(selectedName() === "panelContainer", `border click selected ${selectedName() ?? "nothing"}`);

      const before = boundsOf("panelContainer");
      const buttonBefore = boundsOf("saveButton");
      await dragCanvas([500, 103], [540, 143]);
      const after = boundsOf("panelContainer");
      const buttonAfter = boundsOf("saveButton");
      expect(after.x !== before.x || after.y !== before.y, "the Container did not move");
      expect(
        buttonAfter.x === buttonBefore.x && buttonAfter.y === buttonBefore.y,
        "the child Button moved with the Container"
      );

      await clickCanvas(300, 300); // empty interior, away from the border band and the button
      expect(selectedName() === null, `empty interior selected ${selectedName() ?? "nothing"}`);
      return `Container ${before.x},${before.y} → ${after.x},${after.y}, child stayed at ${buttonAfter.x},${buttonAfter.y}`;
    });

    await check("Text: 24px bold italic centered is rendered, exported and re-imported", async () => {
      await startFromBlankProject();
      clickPaletteItem("Text");
      await sleep(250);

      const sizeInput = q<HTMLInputElement>(".properties input[aria-label='Font size']");
      expect(sizeInput !== null, "no font size control");
      setFieldValue(sizeInput!, "24");
      await sleep(120);
      clickByTitle("bold");
      clickByTitle("italic");
      clickByTitle("Align center");
      await sleep(200);
      await setPanelFields({ Width: 640 });
      await sleep(200);

      const box = boundsOf(selectionNames()[0]);
      const ink = inkBoundsIn(box);
      expect(ink !== null, "no text ink on the canvas");
      const centreOffset = Math.abs((ink!.minX + ink!.maxX) / 2 - ink!.width / 2) / ink!.width;
      expect(centreOffset < 0.15, `centered text ink sits ${Math.round(centreOffset * 100)}% off centre`);

      clickByTitle("Align left");
      await sleep(220);
      const leftInk = inkBoundsIn(box);
      expect(leftInk !== null, "no text ink after switching to left");
      expect(leftInk!.minX <= leftInk!.width * 0.1, `left aligned ink starts at ${leftInk!.minX}`);
      clickByTitle("Align center");
      await sleep(220);

      const markdown = await openExport();
      closeModal();
      expect(markdown.includes("Typography:"), "no Typography section in the export");
      expect(markdown.includes("- Size: 24"), "font size missing from the export");
      expect(markdown.includes("- Weight: Bold"), "bold missing from the export");
      expect(markdown.includes("- Style: Italic"), "italic missing from the export");
      expect(markdown.includes("- Alignment: Center"), "alignment missing from the export");

      await startFromBlankProject();
      await importJson(markdown);
      await ensureLayersOpen();
      all<HTMLElement>(".element-row")[0]?.click();
      await sleep(220);
      const restoredSize = q<HTMLInputElement>(".properties input[aria-label='Font size']")?.value;
      const boldOn = q<HTMLButtonElement>(".properties button[title='bold']")?.classList.contains("active");
      const italicOn = q<HTMLButtonElement>(".properties button[title='italic']")?.classList.contains("active");
      const centerOn = q<HTMLButtonElement>(".properties button[title='Align center']")?.classList.contains("active");
      expect(restoredSize === "24", `restored size ${restoredSize}`);
      expect(boldOn === true && italicOn === true && centerOn === true, "style did not survive the export");
      return `centered ink off by ${Math.round(centreOffset * 100)}%, left ink at x=${leftInk!.minX}, round trip kept 24/B/I/Center`;
    });

    await check("Icon: emoji picker search, content size, Escape and click-outside", async () => {
      await startFromBlankProject();
      clickPaletteItem("Icon");
      await sleep(250);

      const opener = q<HTMLButtonElement>(".emoji-open");
      expect(opener !== null, "no emoji picker button");
      opener!.click();
      await sleep(200);
      expect(q(".emoji-picker") !== null, "picker did not open");

      const search = q<HTMLInputElement>(".emoji-picker input[type='search']");
      expect(search !== null, "no search field in the picker");
      setFieldValue(search!, "rocket");
      await sleep(200);
      const cell = q<HTMLButtonElement>(".emoji-cell[title='rocket']");
      expect(cell !== null, "🚀 not found by search");
      cell!.click();
      await sleep(200);
      expect(panelFields()["Label"] === "🚀", `label is ${panelFields()["Label"]}`);
      expect(q(".emoji-picker") !== null, "picker closed as soon as an emoji was picked");

      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await sleep(200);
      expect(q(".emoji-picker") === null, "Escape did not close the picker");

      await setPanelFields({ "Content size (px)": 48 });
      await sleep(200);
      const markdown = await openExport();
      closeModal();
      expect(markdown.includes("Label: 🚀"), "emoji label missing from the export");
      expect(markdown.includes("Content size: 48px"), "content size missing from the export");

      await startFromBlankProject();
      await importJson(markdown);
      await ensureLayersOpen();
      all<HTMLElement>(".element-row")[0]?.click();
      await sleep(220);
      expect(panelFields()["Label"] === "🚀", "emoji did not survive the round trip");
      expect(panelFields()["Content size (px)"] === "48", "content size did not survive the round trip");
      return "🚀 at 48px, searchable, Escape closes, survives export/import";
    });

    await check("Image: emoji label replaces the crossed placeholder, click-outside closes the picker", async () => {
      await startFromBlankProject();
      clickPaletteItem("Image");
      await sleep(250);
      expect(panelFields()["Label"] === "", `a fresh Image should have no label (got "${panelFields()["Label"]}")`);
      const emptyInk = inkBoundsIn(boundsOf("image1"));
      expect(emptyInk !== null, "the Image placeholder did not draw");

      q<HTMLButtonElement>(".emoji-open")!.click();
      await sleep(200);
      const search = q<HTMLInputElement>(".emoji-picker input[type='search']");
      setFieldValue(search!, "cat");
      await sleep(200);
      const cell = all<HTMLButtonElement>(".emoji-cell").find(
        (candidate) => (candidate.getAttribute("title") ?? "").includes("cat")
      );
      expect(cell !== undefined, "🐱 not found by search");
      cell!.click();
      await sleep(200);
      expect(panelFields()["Label"].includes("🐱"), `label is ${panelFields()["Label"]}`);

      await clickCanvas(900, 700); // click outside the picker
      await sleep(200);
      expect(q(".emoji-picker") === null, "clicking outside did not close the picker");

      const row = all<HTMLElement>(".element-row").find(
        (candidate) => candidate.querySelector(".element-name")?.textContent?.trim() === "image1"
      );
      expect(row !== undefined, "image1 row not found");
      row!.click();
      await sleep(220);
      await setPanelFields({ "Content size (px)": 72 });
      await sleep(200);

      const markdown = await openExport();
      closeModal();
      expect(markdown.includes("Content size: 72px"), "content size missing from the export");
      const json = exportJson(markdown) as unknown as {
        elements: { label: string; contentSize?: number }[];
      };
      expect(
        json.elements.some((element) => element.label.includes("🐱") && element.contentSize === 72),
        "emoji image not exported"
      );
      return "🐱 at 72px, placeholder replaced, click-outside closes";
    });

    await check("header uses the Wirefragma logo asset", async () => {
      const logo = q<HTMLImageElement>("img.brand-mark");
      expect(logo !== null, "the header still has no logo image");
      const src = logo!.getAttribute("src") ?? "";
      expect(src.includes("wf_logo_w_white.png"), `src is ${src}`);
      for (let i = 0; i < 30 && logo!.naturalWidth === 0; i += 1) await sleep(100);
      expect(logo!.naturalWidth > 0, "the logo image failed to load");
      const rect = logo!.getBoundingClientRect();
      expect(rect.width >= 26 && rect.width <= 34, `logo width is ${Math.round(rect.width)}px`);
      expect(Math.abs(rect.width - rect.height) <= 2, "the logo aspect ratio is not preserved");
      return `${src} → ${logo!.naturalWidth}×${logo!.naturalHeight}, rendered ${Math.round(rect.width)}px`;
    });

    report();
    return;
  }

  /** The layers column auto-collapses on narrow windows; open it for the panel checks. */
  const openLayersPanel = async () => {
    await ensureLayersOpen();
  };
  await openLayersPanel();

  await check("import v1 project migrates to a Default layer", async () => {
    await openLayersPanel();
    await importJson(JSON.stringify(LAYOUT_PROJECT));
    await openLayersPanel();
    const names = layerNames();
    expect(names.length === 1 && names[0] === "Default", `layers: ${names.join(",")}`);
    expect(elementRows().length === LAYOUT_PROJECT.elements.length, `rows: ${elementRows().length}`);
    return `${names[0]} with ${elementRows().length} elements`;
  });

  await check("container interior does not steal clicks from its children", async () => {
    const cases: [string, number, number][] = [
      ["saveButton", 210, 240],
      ["heading", 260, 155],
      ["notificationsToggle", 200, 335],
      ["usernameInput", 300, 420]
    ];
    for (const [name, x, y] of cases) {
      await clickCanvas(x, y);
      expect(selectedName() === name, `click at ${x},${y} selected ${selectedName() ?? "nothing"}`);
    }
    return `selected ${cases.map(([name]) => name).join(", ")}`;
  });

  await check("container border and label still select the container", async () => {
    await clickCanvas(400, 103); // top border, right of the label
    expect(selectedName() === "panelContainer", `top border selected ${selectedName() ?? "nothing"}`);
    await clickCanvas(103, 300); // left border
    expect(selectedName() === "panelContainer", `left border selected ${selectedName() ?? "nothing"}`);
    // Label area: inside the bounds, below the top border band, inside the label hit rect.
    await clickCanvas(112, 140);
    expect(selectedName() === "panelContainer", `label selected ${selectedName() ?? "nothing"}`);
    return "border + label selectable";
  });

  await check("empty container interior selects nothing", async () => {
    // Well inside the container and away from the (screen-pixel sized) border band.
    await clickCanvas(400, 300);
    expect(selectedName() === null, `selected ${selectedName() ?? "nothing"}`);
    return "click passed through";
  });

  await check("hit-area prediction matches the canvas", async () => {
    const samples: [number, number][] = [
      [210, 240],
      [400, 103],
      [400, 300],
      [260, 155],
      [200, 335]
    ];
    const actual: (string | null)[] = [];
    for (const [x, y] of samples) {
      await clickCanvas(x, y);
      actual.push(selectedName());
    }

    const markdown = await openExport();
    const json = exportJson(markdown);
    closeModal();
    await sleep(120);
    expect(!q(".modal"), "export dialog did not close");

    const elements = json.elements as WireframeElement[];
    samples.forEach(([x, y], index) => {
      const predicted = topmostHit(elements, 1, x, y, (element) => element.visible && !element.locked);
      expect(
        (predicted?.name ?? null) === actual[index],
        `at ${x},${y}: predicted ${predicted?.name ?? "none"}, got ${actual[index] ?? "none"}`
      );
    });
    return `${samples.length} samples matched`;
  });

  await check("front-most control wins when two overlap", async () => {
    await clickCanvas(500, 700); // deselect
    await importJson(
      JSON.stringify({
        ...LAYOUT_PROJECT,
        elements: [
          { ...LAYOUT_PROJECT.elements[2], id: "back_button", name: "backButton", x: 300, y: 600, zIndex: 0 },
          { ...LAYOUT_PROJECT.elements[2], id: "front_button", name: "frontButton", x: 340, y: 620, zIndex: 1 }
        ]
      })
    );
    await clickCanvas(380, 640);
    expect(selectedName() === "frontButton", `selected ${selectedName() ?? "nothing"}`);
    return "frontButton selected";
  });

  await check("drag and resize still work at fit zoom", async () => {
    setZoomPreset("1");
    await sleep(250);
    await clickCanvas(380, 640);
    const before = panelFields();
    const delta = await dragCanvas([380, 640], [420, 640]);
    const moved = panelFields();
    expect(
      moved["X"] === String(snapped(Number(before["X"]) + delta.dx)),
      `x ${before["X"]} → ${moved["X"]} (selected: ${selectedName() ?? "none"})`
    );

    const right = Number(moved["X"]) + Number(moved["Width"]);
    const resize = await dragCanvas([right, Number(moved["Y"]) + 20], [right + 64, Number(moved["Y"]) + 20]);
    const resized = panelFields();
    expect(
      Number(resized["Width"]) === snapped(right + resize.dx) - Number(moved["X"]),
      `width → ${resized["Width"]}`
    );
    mustClickButton("Undo");
    await sleep(140);
    expect(panelFields()["Width"] === moved["Width"], "undo did not restore the width");
    setZoomPreset("fit");
    await sleep(200);
    return `${resized["Width"]}px wide, undo restored`;
  });

  await check("every new palette type can be added", async () => {
    const palette = paletteItems().join(" | ");
    for (const label of NEW_TYPE_LABELS) {
      expect(palette.includes(label), `palette is missing "${label}" (${palette})`);
    }
    await importJson(JSON.stringify({ ...LAYOUT_PROJECT, title: "Palette", elements: [] }));
    await openLayersPanel();
    for (const label of NEW_TYPE_LABELS) {
      clickPaletteItem(label);
      await sleep(120);
      const selected = selectedName();
      expect(!!selected, `adding "${label}" did not select a new element`);
    }
    const rows = elementRowNames();
    expect(rows.length === NEW_TYPE_LABELS.length, `rows: ${rows.join(",")}`);
    return `${rows.length} new elements created`;
  });

  await check("new element types round-trip through the export", async () => {
    const markdown = await openExport();
    const json = exportJson(markdown);
    const types = json.elements.map((element) => element.type);
    for (const type of ["dialog", "bottomNav", "table", "icon", "avatar", "badge", "textarea", "radio", "slider", "progress", "iconButton"]) {
      expect(types.includes(type as never), `export lost ${type}`);
    }
    const table = json.elements.find((element) => element.type === "table");
    expect(table?.columns?.length === 3, "table columns missing from the source");
    expect(markdown.includes("Type: Table"), "table not identified semantically");
    expect(markdown.includes("Columns:"), "table columns not exported");
    expect(markdown.includes("Generated by Wirefragma."), "old product name in the export");
    closeModal();

    await importJson(markdown);
    const reimported = await openExport();
    const again = exportJson(reimported);
    expect(
      again.elements.map((element) => element.type).join(",") === types.join(","),
      "round trip changed the element types"
    );
    closeModal();
    return `${types.length} elements preserved`;
  });

  await check("layer deletion asks first, then removes the layer and its elements", async () => {
    closeAnyModal();
    await openLayersPanel();
    mustClickButton("+ Layer");
    await sleep(160);
    expect(layerNames().length >= 2, `layers after create: ${layerNames().join(",")}`);
    const layerName = layerNames()[0];
    clickPaletteItem("Button");
    await sleep(120);
    clickPaletteItem("Text");
    await sleep(120);
    expect(elementRows().length >= 2, "objects were not added to the new layer");

    const row = layerRowFor(layerName);
    expect(!!row, `layer row "${layerName}" missing`);
    row!.querySelector<HTMLButtonElement>(".danger-icon")?.click();
    await sleep(200);

    const dialogText = q(".modal")?.textContent ?? "";
    expect(dialogText.includes(layerName), `confirmation does not name the layer: ${dialogText.slice(0, 80)}`);
    expect(/delete 2 elements/i.test(dialogText), `confirmation does not count the elements: ${dialogText.slice(0, 120)}`);

    const confirm = all<HTMLButtonElement>(".modal-actions button").find(
      (candidate) => (candidate.textContent ?? "").trim() === "Delete Layer"
    );
    confirm?.click();
    await sleep(250);

    expect(!layerNames().includes(layerName), "layer still present after deletion");
    const afterDelete = await openExport();
    closeModal();
    expect(!afterDelete.includes('"name": "' + layerName + '"'), "deleted layer still in the source");

    mustClickButton("Undo");
    await sleep(250);
    expect(layerNames().includes(layerName), "undo did not restore the layer");
    return `layer "${layerName}" deleted with 2 elements and restored by undo`;
  });

  await check("canvas presets cover desktop, portrait, landscape and custom", async () => {
    const select = q<HTMLSelectElement>(".toolbar-group select");
    expect(!!select, "canvas preset select missing");
    const options = Array.from(select!.options).map((option) => option.textContent ?? "");
    expect(options.some((text) => text.includes("Mobile portrait 390×844")), `options: ${options.join(" | ")}`);
    expect(options.some((text) => text.includes("Mobile landscape 844×390")), `options: ${options.join(" | ")}`);

    setFieldValue(select!, "mobileLandscape");
    await sleep(200);
    expect(statusText().includes("844 × 390"), `landscape status: ${statusText()}`);
    setFieldValue(select!, "mobile");
    await sleep(200);
    expect(statusText().includes("390 × 844"), `portrait status: ${statusText()}`);
    setFieldValue(select!, "desktop");
    await sleep(200);
    expect(statusText().includes("1200 × 800"), `desktop status: ${statusText()}`);
    return "ported through all presets";
  });

  await check("zoom presets, buttons and fit mode", async () => {
    for (const preset of ["0.5", "1", "2"]) {
      setZoomPreset(preset);
      await sleep(150);
      const expected = `${Math.round(Number(preset) * 100)}%`;
      expect(zoomReadout() === expected, `readout ${zoomReadout()} for ${expected}`);
    }
    mustClickButton("+");
    await sleep(150);
    const afterPlus = zoomReadout();
    expect(afterPlus === "300%", `zoom in gave ${afterPlus}`);
    mustClickButton("−");
    await sleep(150);
    expect(zoomReadout() === "200%", `zoom out gave ${zoomReadout()}`);
    mustClickButton("Fit");
    await sleep(200);
    expect(!!q(".zoom-readout")?.textContent, "fit mode lost the readout");
    expect(q<HTMLSelectElement>(".zoom-select")?.value === "fit", "fit button did not switch mode");
    return `fit → ${zoomReadout()}`;
  });

  await check("pinch / ctrl+wheel zooms toward the pointer", async () => {
    setZoomPreset("1");
    await sleep(150);
    const viewport = q<HTMLElement>(".canvas-viewport");
    expect(!!viewport, "viewport missing");
    const [x, y] = toClient(300, 200);
    viewport!.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: -120, ctrlKey: true })
    );
    await sleep(200);
    const zoomed = zoomReadout();
    expect(zoomed !== "100%", "ctrl+wheel did not zoom");
    expect(q<HTMLSelectElement>(".zoom-select")?.value === "fit", "pinch should switch to manual zoom");

    const before = Number.parseInt(zoomed, 10);
    viewport!.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY: 400, ctrlKey: true })
    );
    await sleep(200);
    const after = Number.parseInt(zoomReadout(), 10);
    expect(after < before, `zoom did not shrink: ${before} → ${after}`);
    return `100% → ${zoomed} → ${zoomReadout()}`;
  });

  await check("resize stays correct at 100% and 200% zoom", async () => {
    await importJson(
      JSON.stringify({
        version: 1,
        title: "Zoom",
        canvas: { mode: "desktop", width: 1200, height: 800 },
        elements: [
          {
            id: "zoom_button",
            type: "button",
            name: "zoomButton",
            label: "Zoom",
            note: "",
            x: 100,
            y: 100,
            width: 160,
            height: 40,
            zIndex: 0
          }
        ]
      })
    );
    for (const preset of ["1", "2"]) {
      closeAnyModal();
      setZoomPreset(preset);
      await sleep(250);
      scrollCanvasTo(0, 0);
      await sleep(100);
      const x = 180;
      const y = 120;
      await clickCanvas(x, y);
      const selected = selectedName();
      expect(!!selected, `nothing selected at ${preset}`);
      const before = panelFields();
      const width = Number(before["Width"]);
      const left = Number(before["X"]);
      const top = Number(before["Y"]);
      const delta = await dragCanvas([left + width, top + 20], [left + width + 40, top + 20]);
      const after = panelFields();
      expect(
        Number(after["Width"]) === snapped(left + width + delta.dx) - left,
        `at ${preset}: width ${width} → ${after["Width"]}`
      );
      mustClickButton("Undo");
      await sleep(150);
      expect(panelFields()["Width"] === String(width), `at ${preset}: undo failed`);
    }
    return "resize + undo correct at 100% and 200%";
  });

  await check("branding is Wirefragma", async () => {
    const brand = q(".brand-name")?.textContent?.trim() ?? "";
    expect(brand === "Wirefragma", `brand: ${brand}`);
    expect(document.title.includes("Wirefragma"), `title: ${document.title}`);
    const markdown = await openExport();
    expect(markdown.includes("Generated by Wirefragma."), "export attribution");
    closeModal();
    return `${brand} · ${document.title}`;
  });

  await check("prepare reload state", async () => {
    closeAnyModal();
    await openLayersPanel();
    expect(elementRows().length > 0, "no element rows in the layers panel");
    const toggleRow = elementRows()[0];
    toggleRow.querySelectorAll<HTMLButtonElement>(".row-icon")[0].click(); // hide
    await sleep(140);
    const buttonRow = elementRows()[1] ?? elementRows()[0];
    buttonRow.querySelectorAll<HTMLButtonElement>(".row-icon")[1].click(); // lock
    await sleep(140);
    // Leave two layers so pass 2 can check ordering.
    if (layerNames().length < 2) mustClickButton("+ Layer");
    await sleep(150);
    const hiddenNames = all<HTMLElement>(".element-row.hidden-row").map(
      (row) => row.querySelector(".element-name")?.textContent ?? "?"
    );
    const lockedNames = all<HTMLElement>(".element-row")
      .filter((row) => row.querySelector(".row-icon.on") !== null)
      .map((row) => row.querySelector(".element-name")?.textContent ?? "?");
    window.localStorage.setItem(
      EXPECTATION_KEY,
      JSON.stringify({ hiddenNames, lockedNames, layers: layerNames() })
    );
    return `${hiddenNames.length} hidden, ${lockedNames.length} locked, layers: ${layerNames().join(" | ")}`;
  });

  report();
}
