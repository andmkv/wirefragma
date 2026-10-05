/**
 * Development-only layout measurement harness (`?measure=1`).
 *
 * It exists for the responsive release (1.2, D7): the numbers a browser actually computes are the
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
    publish({ ready, phase: "final", ...(await measureBaseline()), drawers, touch });
  } catch (error) {
    publish({ error: String(error) });
  }
}
