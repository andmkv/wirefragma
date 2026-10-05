/**
 * Development-only layout measurement harness (`?measure=1`).
 *
 * It exists for the responsive release (1.4, D7): the numbers a browser actually computes are the
 * only honest evidence that "the canvas gets the full width", "no page scroll" and "every drawer
 * opens and closes" hold. The results are written as JSON into a hidden `<pre id="dsh-layout-measure">`
 * element, which `scripts/measure-layout.mjs` reads back from a headless browser (`--dump-dom`).
 *
 * Never part of a production build: it is imported behind `import.meta.env.DEV`.
 */

const OUTPUT_ID = "dsh-layout-measure";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxOf(node: Element | null): Box | null {
  if (!node) return null;
  const rect = node.getBoundingClientRect();
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function isVisible(node: Element | null): boolean {
  if (!node) return false;
  const style = window.getComputedStyle(node);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

/**
 * How many wrapped rows the toolbar currently occupies.
 *
 * Flex children are vertically centred, so their `top` values differ even inside a single line;
 * adjacent tops closer than `ROW_TOLERANCE_PX` are counted as the same row.
 */
const ROW_TOLERANCE_PX = 8;

function toolbarRows(toolbar: Element | null): number {
  if (!toolbar) return 0;
  const tops = Array.from(toolbar.children)
    .map((child) => child.getBoundingClientRect())
    .filter((rect) => rect.height > 0 && rect.width > 0)
    .map((rect) => Math.round(rect.top))
    .sort((a, b) => a - b);
  let rows = 0;
  let previous: number | null = null;
  for (const top of tops) {
    if (previous === null || top - previous > ROW_TOLERANCE_PX) rows += 1;
    previous = top;
  }
  return rows;
}

/**
 * Elements whose box sticks out of the viewport, widest first. This is the diagnostic that turns
 * "the page scrolls sideways" into a concrete selector.
 */
function overflowingElements(limit = 8): { selector: string; right: number; width: number }[] {
  const viewportWidth = document.documentElement.clientWidth;
  const offenders: { selector: string; right: number; width: number }[] = [];
  for (const node of Array.from(document.body.querySelectorAll("*"))) {
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= viewportWidth + 1 && rect.left >= -1) continue;
    const id = node.id ? `#${node.id}` : "";
    const classes = typeof node.className === "string" && node.className ? `.${node.className.trim().split(/\s+/).join(".")}` : "";
    offenders.push({
      selector: `${node.tagName.toLowerCase()}${id}${classes}`,
      right: Math.round(rect.right),
      width: Math.round(rect.width)
    });
  }
  return offenders.sort((a, b) => b.right - a.right).slice(0, limit);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 15000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await delay(100);
  }
  return false;
}

/**
 * A short real-time pause. Deliberately not `requestAnimationFrame`: in a headless browser with
 * no compositor rAF may never fire, which would hang the harness instead of measuring.
 */
function settle(): Promise<void> {
  return delay(80);
}

export interface DrawerMeasurement {
  present: boolean;
  opened: boolean;
  visibleWhenOpen: boolean;
  box: Box | null;
  closesAgain: boolean;
}

export interface LayoutMeasurement {
  width: number;
  height: number;
  devicePixelRatio: number;
  layoutClass: string;
  toolbarLayoutClass: string;
  pageScrollWidth: number;
  clientWidth: number;
  horizontalPageScroll: boolean;
  toolbar: { box: Box | null; rows: number };
  canvasColumn: Box | null;
  canvasViewport: Box | null;
  canvasViewportWidthRatio: number;
  canvasFrame: Box | null;
  sideColumnsVisible: { add: boolean; layers: boolean; properties: boolean };
  drawers: Record<string, DrawerMeasurement>;
  errorBoundaryVisible: boolean;
  overflowingElements: { selector: string; right: number; width: number }[];
  touch: TouchGestureMeasurement;
  errorBoundary: ErrorBoundaryMeasurement;
  emojiField: EmojiFieldMeasurement;
  chart: ChartElementMeasurement;
}

/** E2–E4 through a real browser: add a Chart, open its popup, commit it. */
export interface ChartElementMeasurement {
  available: boolean;
  reason?: string;
  added?: boolean;
  elementName?: string | null;
  popupOpened?: boolean;
  hasTable?: boolean;
  hasKindSelector?: boolean;
  hasEmojiButton?: boolean;
  dialogBox?: Box | null;
  dialogFitsViewport?: boolean;
  committed?: boolean;
  historyGrew?: boolean;
}

/** C1 + C3 end to end: the picker loads its lazy chunks, stays inside the viewport, inserts. */
export interface EmojiFieldMeasurement {
  available: boolean;
  reason?: string;
  cellCount?: number;
  pickerInViewport?: boolean;
  pickerBox?: Box | null;
  hasCategoryTabs?: boolean;
  hasRecentTab?: boolean;
  picked?: string | null;
  inserted?: boolean;
  fieldValue?: string;
}

/** D6 through a real browser: a throwing child must render the fallback, not a blank page. */
export interface ErrorBoundaryMeasurement {
  rendered: boolean;
  title: string | null;
  buttons: string[];
  hasRetry: boolean;
  hasExport: boolean;
  recovered: boolean;
  reason?: string;
}

/** A1 through a real browser: two synthetic fingers must pan and pinch the viewport. */
export interface TouchGestureMeasurement {
  available: boolean;
  reason?: string;
  scaleBefore?: number;
  scaleAfterPinch?: number;
  scrollBefore?: { left: number; top: number };
  scrollAfterPan?: { left: number; top: number };
  pannedBy?: { dx: number; dy: number };
}

/** The measurements that do not require touching the UI. */
async function measureBaseline() {
  const toolbar = document.querySelector(".app-toolbar");
  const workspace = document.querySelector(".workspace");
  const viewport = document.querySelector(".canvas-viewport");
  const addPanel = document.querySelector('[data-drawer="add"]');
  const layersPanel = document.querySelector('[data-drawer="layers"]');
  const propertiesPanel = document.querySelector('[data-drawer="properties"]');

  const viewportBox = boxOf(viewport);
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    layoutClass: workspace?.className ?? "",
    toolbarLayoutClass: toolbar?.className ?? "",
    pageScrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    horizontalPageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    toolbar: { box: boxOf(toolbar), rows: toolbarRows(toolbar) },
    canvasColumn: boxOf(document.querySelector(".canvas-column")),
    canvasViewport: viewportBox,
    canvasViewportWidthRatio: viewportBox ? Math.round((viewportBox.width / window.innerWidth) * 1000) / 1000 : 0,
    canvasFrame: boxOf(document.querySelector(".canvas-frame")),
    sideColumnsVisible: {
      add: isVisible(addPanel),
      layers: isVisible(layersPanel),
      properties: isVisible(propertiesPanel)
    },
    errorBoundaryVisible: isVisible(document.querySelector(".error-boundary")),
    overflowingElements: overflowingElements()
  };
}

/** Open and close every drawer, recording what the browser reports while it is open. */
async function measureDrawers(): Promise<Record<string, DrawerMeasurement>> {
  const drawers: Record<string, DrawerMeasurement> = {};
  for (const id of ["add", "layers", "properties", "projects"]) {
    const toggle = document.querySelector<HTMLButtonElement>(`[data-drawer-toggle="${id}"]`);
    const panel = document.querySelector(`[data-drawer="${id}"]`);
    if (!toggle || !panel) {
      drawers[id] = { present: false, opened: false, visibleWhenOpen: false, box: null, closesAgain: false };
      continue;
    }
    const wasOpen = panel.classList.contains("open");
    if (!wasOpen) {
      toggle.click();
      await settle();
      await delay(240);
    }
    const opened = panel.classList.contains("open");
    const visibleWhenOpen = isVisible(panel);
    const box = boxOf(panel);
    if (!wasOpen) {
      toggle.click();
      await settle();
      await delay(240);
    }
    drawers[id] = { present: true, opened, visibleWhenOpen, box, closesAgain: !panel.classList.contains("open") };
  }
  return drawers;
}

interface CanvasDiagnostics {
  transform: () => { scale: number };
  elementNames?: () => string[];
}

function canvasDiagnostics(): CanvasDiagnostics | undefined {
  return (window as unknown as { __wirefragmaCanvas?: CanvasDiagnostics }).__wirefragmaCanvas;
}

function touchEvent(type: string, id: number, x: number, y: number): PointerEvent {
  return new PointerEvent(type, {
    pointerId: id,
    pointerType: "touch",
    isPrimary: id === 1,
    clientX: x,
    clientY: y,
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    bubbles: true,
    cancelable: true
  });
}

/**
 * Drive the A1 two-finger gesture with synthetic touch pointers: first a pinch (fingers apart,
 * the scale must grow), then a pure pan (both fingers move together, the scroll offset must move).
 */
async function measureTouchGesture(): Promise<TouchGestureMeasurement> {
  const diagnostics = canvasDiagnostics();
  const canvas = document.querySelector<HTMLCanvasElement>(".canvas-surface");
  const viewport = document.querySelector<HTMLElement>(".canvas-viewport");
  if (!canvas || !viewport || !diagnostics) {
    return { available: false, reason: "no canvas or no dev diagnostics" };
  }
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const scaleBefore = diagnostics.transform().scale;

  canvas.dispatchEvent(touchEvent("pointerdown", 901, cx - 50, cy));
  canvas.dispatchEvent(touchEvent("pointerdown", 902, cx + 50, cy));
  await settle();
  // Fingers apart: 100 px -> 160 px.
  for (const step of [1, 2, 3]) {
    const spread = 50 + step * 20;
    canvas.dispatchEvent(touchEvent("pointermove", 901, cx - spread, cy));
    canvas.dispatchEvent(touchEvent("pointermove", 902, cx + spread, cy));
    await delay(40);
  }
  const scaleAfterPinch = diagnostics.transform().scale;
  const scrollBefore = { left: viewport.scrollLeft, top: viewport.scrollTop };

  // Pure pan: both fingers move 60 px to the right and 30 px down, distance unchanged.
  for (const step of [1, 2]) {
    const shift = step * 30;
    canvas.dispatchEvent(touchEvent("pointermove", 901, cx - 110 + shift, cy + shift / 2));
    canvas.dispatchEvent(touchEvent("pointermove", 902, cx + 110 + shift, cy + shift / 2));
    await delay(40);
  }
  const scrollAfterPan = { left: viewport.scrollLeft, top: viewport.scrollTop };
  canvas.dispatchEvent(touchEvent("pointerup", 901, cx, cy));
  canvas.dispatchEvent(touchEvent("pointerup", 902, cx, cy));
  await settle();

  return {
    available: true,
    scaleBefore,
    scaleAfterPinch,
    scrollBefore,
    scrollAfterPan,
    pannedBy: { dx: scrollBefore.left - scrollAfterPan.left, dy: scrollBefore.top - scrollAfterPan.top }
  };
}

/**
 * Render a deliberately crashing child inside the real error boundary and check what the browser
 * shows. Runs in a detached, off-screen container so the measured layout is untouched.
 */
async function measureErrorBoundary(): Promise<ErrorBoundaryMeasurement> {
  try {
    const [{ createElement }, { createRoot }, { EditorErrorBoundary }] = await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("../components/ErrorBoundary")
    ]);
    const container = document.createElement("div");
    container.style.position = "fixed";
    container.style.left = "-10000px";
    container.style.width = "600px";
    document.body.appendChild(container);

    /**
     * Keeps throwing until the probe releases it, so the two phases are deterministic: first the
     * boundary must show its fallback, then "Try again" must render the child successfully (a
     * permanently broken child would legitimately stay caught forever).
     */
    let crashing = true;
    const Boom = () => {
      if (crashing) throw new Error("harness: deliberate render error");
      return null;
    };
    const project = {
      version: 2 as const,
      title: "Boundary probe",
      canvas: { mode: "desktop" as const, width: 1200, height: 800 },
      layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
      elements: []
    };

    const root = createRoot(container);
    const realError = console.error;
    console.error = () => undefined;
    // `createElement` with a typed component: the boundary needs `children` explicitly.
    root.render(
      createElement(
        EditorErrorBoundary as (props: { project?: typeof project; children?: unknown }) => JSX.Element,
        { project },
        createElement(Boom)
      )
    );
    await delay(250);

    const fallback = container.querySelector(".error-boundary");
    const buttons = Array.from(container.querySelectorAll(".error-boundary button")).map(
      (button) => button.textContent?.trim() ?? ""
    );
    const rendered = isVisible(fallback);
    const title = fallback?.querySelector("h2")?.textContent?.trim() ?? null;

    // "Try again" must clear the error and render the child again — now successfully.
    let recovered = false;
    const retry = container.querySelector<HTMLButtonElement>(".error-boundary button");
    crashing = false;
    if (retry) {
      retry.click();
      await delay(120);
      recovered = !container.querySelector(".error-boundary");
    }
    console.error = realError;
    root.unmount();
    container.remove();
    return {
      rendered,
      title,
      buttons,
      hasRetry: buttons.length > 0,
      hasExport: buttons.length > 1,
      recovered
    };
  } catch (error) {
    return { rendered: false, title: null, buttons: [], hasRetry: false, hasExport: false, recovered: false, reason: String(error) };
  }
}

/** Open the first emoji text field's picker, verify it fits the viewport, then pick a cell. */
async function measureEmojiField(): Promise<EmojiFieldMeasurement> {
  try {
    const drawerToggle = document.querySelector<HTMLButtonElement>('[data-drawer-toggle="properties"]');
    const drawer = document.querySelector('[data-drawer="properties"]');
    if (drawerToggle && drawer && !drawer.classList.contains("open")) {
      drawerToggle.click();
      await settle();
      await delay(240);
    }
    const field = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      ".emoji-text-field input, .emoji-text-field textarea"
    );
    const button = document.querySelector<HTMLButtonElement>(".emoji-text-field .emoji-open");
    if (!field || !button) return { available: false, reason: "no emoji text field" };

    button.click();
    const loaded = await waitFor(() => !!document.querySelector(".emoji-picker .emoji-cell"), 12000);
    if (!loaded) return { available: false, reason: "the picker never rendered cells" };

    const picker = document.querySelector(".emoji-picker");
    const rect = picker?.getBoundingClientRect();
    const pickerInViewport = !!rect &&
      rect.left >= -1 &&
      rect.top >= -1 &&
      rect.right <= window.innerWidth + 1 &&
      rect.bottom <= window.innerHeight + 1;
    // Measured while the popover is still mounted (afterwards the node is detached).
    const pickerBox = boxOf(picker);
    const hasCategoryTabs = document.querySelectorAll(".emoji-picker .emoji-category").length > 0;
    const hasRecentTab = Array.from(document.querySelectorAll(".emoji-picker .emoji-category")).some(
      (tab) => tab.textContent?.trim() === "Recent"
    );
    const cells = Array.from(document.querySelectorAll<HTMLButtonElement>(".emoji-picker .emoji-cell"));
    const first = cells[0];
    const picked = first?.textContent ?? null;
    first?.click();
    await delay(160);
    const insertion = { picked, inserted: !!picked && field.value.includes(picked), fieldValue: field.value };

    // Close the popover again (Escape is handled by the picker itself).
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await delay(80);
    if (drawerToggle && drawer?.classList.contains("open")) {
      drawerToggle.click();
      await settle();
    }
    return {
      available: true,
      cellCount: cells.length,
      pickerInViewport,
      pickerBox,
      hasCategoryTabs,
      hasRecentTab,
      ...insertion
    };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

function drawerToggleFor(id: string): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>(`[data-drawer-toggle="${id}"]`);
}

/** Open a drawer in the overlay layouts (no-op on desktop, where the panels are always there). */
async function ensureDrawerOpen(id: string): Promise<void> {
  const toggle = drawerToggleFor(id);
  const drawer = document.querySelector(`[data-drawer="${id}"]`);
  if (!toggle || !drawer || drawer.classList.contains("open")) return;
  toggle.click();
  await settle();
  await delay(240);
}

async function closeDrawer(id: string): Promise<void> {
  const toggle = drawerToggleFor(id);
  const drawer = document.querySelector(`[data-drawer="${id}"]`);
  if (!toggle || !drawer || !drawer.classList.contains("open")) return;
  toggle.click();
  await settle();
}

/**
 * Add a Chart from the palette, verify it reached the document, open its popup, check the editor
 * chrome, then commit it with "Done" and confirm that exactly the history grew.
 */
async function measureChartElement(): Promise<ChartElementMeasurement> {
  try {
    await ensureDrawerOpen("add");
    // The palette renders tiles when compact and labelled rows otherwise; match both.
    const tiles = Array.from(document.querySelectorAll<HTMLButtonElement>(".palette-tile, .palette-item"));
    const chartTile = tiles.find((tile) =>
      `${tile.getAttribute("aria-label") ?? ""} ${tile.getAttribute("title") ?? ""} ${tile.textContent ?? ""}`
        .toLowerCase()
        .includes("chart")
    );
    if (!chartTile) return { available: false, reason: "no chart tile in the palette" };
    chartTile.click();
    await delay(300);
    await closeDrawer("add");

    const names = canvasDiagnostics()?.elementNames?.() ?? [];
    const elementName = names.find((name) => name.toLowerCase().includes("chart")) ?? null;

    await ensureDrawerOpen("properties");
    const edit = document.querySelector<HTMLButtonElement>('[data-drawer="properties"] .scene-edit-open');
    if (!edit) return { available: true, added: !!elementName, elementName, popupOpened: false, reason: "no chart edit button" };
    edit.click();
    await delay(320);

    const dialog = document.querySelector(".modal.scene-modal");
    const popupOpened = !!dialog;
    const hasTable = !!dialog?.querySelector(".chart-table, .chart-text-mode");
    const hasKindSelector = !!dialog?.querySelector(".chart-kinds, .scene-toolbar");
    const hasEmojiButton = !!dialog?.querySelector(".emoji-text-field .emoji-open");
    // D4: a dialog must fit a small viewport without horizontal scroll.
    const dialogRect = dialog?.getBoundingClientRect();
    const dialogFitsViewport =
      !!dialogRect &&
      dialogRect.left >= -1 &&
      dialogRect.top >= -1 &&
      dialogRect.right <= window.innerWidth + 1 &&
      dialogRect.bottom <= window.innerHeight + 1;
    const dialogBox = dialogRect
      ? {
          x: Math.round(dialogRect.x),
          y: Math.round(dialogRect.y),
          width: Math.round(dialogRect.width),
          height: Math.round(dialogRect.height)
        }
      : null;

    const done = Array.from(dialog?.querySelectorAll("button") ?? []).find(
      (button) => button.textContent?.trim() === "Done"
    );
    done?.click();
    await delay(320);
    const committed = !document.querySelector(".modal.scene-modal");
    const undoButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".app-toolbar button")).find(
      (button) => (button.getAttribute("aria-label") ?? "") === "Undo"
    );
    const historyGrew = !!undoButton && !undoButton.disabled;
    await closeDrawer("properties");
    return {
      available: true,
      added: !!elementName,
      elementName,
      popupOpened,
      hasTable,
      hasKindSelector,
      hasEmojiButton,
      dialogBox,
      dialogFitsViewport,
      committed,
      // "Done" is exactly one history step: Undo must have become available.
      historyGrew: historyGrew && committed
    };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

function publish(payload: unknown): void {
  let output = document.getElementById(OUTPUT_ID);
  if (!output) {
    output = document.createElement("pre");
    output.id = OUTPUT_ID;
    output.setAttribute("data-layout-measure", "1");
    output.style.display = "none";
    document.body.appendChild(output);
  }
  output.textContent = JSON.stringify(payload);
}

/** Run the measurement and publish it in the DOM for `--dump-dom`. */
export async function runLayoutMeasure(): Promise<void> {
  try {
    // Transitions are disabled while measuring: a headless browser advances virtual time without
    // running the animation clock, so a half-finished slide would report a closed drawer.
    const style = document.createElement("style");
    style.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    document.head.appendChild(style);
    const ready = await waitFor(() => !!document.querySelector(".canvas-viewport"), 20000);
    // The baseline is published immediately, so a failure during the drawer probing still leaves
    // usable numbers in the DOM.
    publish({ ready, phase: "baseline", ...(await measureBaseline()) });
    const drawers = await measureDrawers();
    const touch = await measureTouchGesture();
    const errorBoundary = await measureErrorBoundary();
    const emojiField = await measureEmojiField();
    const chart = await measureChartElement();
    publish({ ready, phase: "final", ...(await measureBaseline()), drawers, touch, errorBoundary, emojiField, chart });
  } catch (error) {
    publish({ error: String(error) });
  }
}
