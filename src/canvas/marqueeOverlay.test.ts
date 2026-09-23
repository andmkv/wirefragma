import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROJECT_VERSION, type WireframeElement, type WireframeProject } from "../model/project";
import { EMPTY_SELECTION, singleSelection, type SelectionState } from "../model/selection";
import { CanvasInteraction } from "./interaction";
import { createTransform } from "./transform";

/**
 * The marquee rubber band is transient editor state, so ending the gesture must invalidate the
 * canvas on its own. Regression: a marquee that matched nothing (or whose result equalled the
 * current selection) resolved to an unchanged React selection state, React bailed out, and the
 * last drawn rectangle stayed on screen until some later action happened to redraw.
 */

function element(id: string, x: number, y: number, width = 120, height = 40): WireframeElement {
  return {
    id,
    type: "button",
    name: id,
    label: id,
    note: "",
    x,
    y,
    width,
    height,
    layerId: "l1",
    visible: true,
    locked: false,
    zIndex: 0
  };
}

/** The only object lives far away from the marquee rectangles used below. */
const project: WireframeProject = {
  version: PROJECT_VERSION,
  title: "Marquee overlay",
  canvas: { mode: "desktop", width: 1200, height: 800 },
  layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
  elements: [element("far", 800, 600)]
};

type Listener = (event: unknown) => void;

function fakeCanvas() {
  const listeners = new Map<string, Listener[]>();
  return {
    style: { cursor: "" },
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== fn));
    },
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
      x: 0,
      y: 0,
      toJSON: () => ({})
    }),
    setPointerCapture() {
      /* capture is not available on synthetic events in this environment */
    },
    emit(type: string, event: Record<string, unknown>) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    }
  };
}

function pointer(x: number, y: number, type: string) {
  return {
    button: 0,
    buttons: type === "pointerup" ? 0 : 1,
    pointerId: 1,
    clientX: x,
    clientY: y,
    type,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false
  };
}

beforeAll(() => {
  // The engine installs window-level fallback listeners for pointerup/pointercancel.
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {}
  };
});

afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

function harness(selection: SelectionState = EMPTY_SELECTION) {
  const canvas = fakeCanvas();
  const selections: SelectionState[] = [];
  const state = {
    project,
    transform: createTransform(1, 0, 0),
    selection,
    snapEnabled: false,
    gridSize: 8,
    minSize: 8
  };
  let renders = 0;
  const interaction = new CanvasInteraction(canvas as unknown as HTMLCanvasElement, state, {
    select: (next) => {
      selections.push(next);
      state.selection = next;
    },
    beginEdit: () => {},
    endEdit: () => {},
    commitMove: () => {},
    commitResize: () => {},
    requestRender: () => {
      renders += 1;
    },
    setCursor: () => {}
  });
  return {
    canvas,
    interaction,
    selections,
    renders: () => renders,
    resetRenders: () => {
      renders = 0;
    },
    preview: () => interaction.getPreview()
  };
}

/**
 * Drag on empty canvas so the engine is in a live marquee with a visible rectangle. The render
 * counter is reset *after* the pointermove, so only the render that ends the gesture counts.
 */
function startMarquee(
  h: ReturnType<typeof harness>,
  from: [number, number] = [100, 100],
  to: [number, number] = [300, 260]
) {
  h.canvas.emit("pointerdown", pointer(from[0], from[1], "pointerdown"));
  h.canvas.emit("pointermove", pointer(to[0], to[1], "pointermove"));
  const marquee = h.preview()?.marquee ?? null;
  if (!marquee) throw new Error("the marquee gesture did not start");
  expect(marquee.width).toBeGreaterThan(0);
  h.resetRenders();
  return marquee;
}

describe("the marquee overlay is cleared and repainted when the gesture ends", () => {
  it("repaints on pointerup even when the marquee selected nothing at all", () => {
    const h = harness(EMPTY_SELECTION);
    startMarquee(h);

    h.canvas.emit("pointerup", pointer(300, 260, "pointerup"));

    // Transient state gone…
    expect(h.preview()).toBeNull();
    // …and the gesture invalidated the canvas itself, instead of relying on a React update:
    expect(h.renders()).toBeGreaterThan(0);
    // The engine reports the (unchanged) result — the same object identity that makes React bail
    // out, which is exactly why the explicit repaint above is required.
    expect(h.selections).toEqual([EMPTY_SELECTION]);
    expect(h.selections[0]).toBe(EMPTY_SELECTION);
  });

  it("repaints when the marquee resolves to the selection that was already active", () => {
    const h = harness(EMPTY_SELECTION);
    // A marquee over the object: the first sweep really changes the selection.
    startMarquee(h, [780, 580], [960, 680]);
    h.canvas.emit("pointerup", pointer(960, 680, "pointerup"));
    expect(h.selections[h.selections.length - 1]).toEqual(singleSelection("far"));

    // The identical sweep now produces the same set, so `select()` changes nothing.
    startMarquee(h, [780, 580], [960, 680]);
    h.canvas.emit("pointerup", pointer(960, 680, "pointerup"));

    expect(h.preview()).toBeNull();
    expect(h.renders()).toBeGreaterThan(0);
    expect(h.selections[h.selections.length - 1]).toEqual(singleSelection("far"));
  });

  it("repaints on pointercancel", () => {
    const h = harness(EMPTY_SELECTION);
    startMarquee(h);

    h.canvas.emit("pointercancel", pointer(300, 260, "pointercancel"));

    expect(h.preview()).toBeNull();
    expect(h.renders()).toBeGreaterThan(0);
  });

  it("repaints when pointer capture is lost mid-gesture", () => {
    const h = harness(EMPTY_SELECTION);
    startMarquee(h);

    h.canvas.emit("lostpointercapture", { pointerId: 1 });

    expect(h.preview()).toBeNull();
    expect(h.renders()).toBeGreaterThan(0);
  });

  it("repaints when Escape cancels an active marquee", () => {
    const h = harness(EMPTY_SELECTION);
    startMarquee(h);

    h.interaction.cancel();

    expect(h.preview()).toBeNull();
    expect(h.renders()).toBeGreaterThan(0);
  });

  it("ignores a late lostpointercapture once the gesture is already finished", () => {
    const h = harness(EMPTY_SELECTION);
    startMarquee(h);
    h.canvas.emit("pointerup", pointer(300, 260, "pointerup"));
    h.resetRenders();

    h.canvas.emit("lostpointercapture", { pointerId: 1 });

    expect(h.preview()).toBeNull();
    expect(h.renders()).toBe(0);
  });
});
