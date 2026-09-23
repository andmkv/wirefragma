import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PROJECT_VERSION, type ElementType, type WireframeElement, type WireframeProject } from "../model/project";
import type { SelectionState } from "../model/selection";
import { CanvasInteraction } from "./interaction";
import { createTransform, type Rect } from "./transform";

/* ------------------------------------------------------------------ fixtures */

function element(
  id: string,
  type: ElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  label = ""
): WireframeElement {
  return {
    id,
    type,
    name: id,
    label,
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

const container = element("panelContainer", "container", 100, 100, 500, 300, "Panel");
const button = element("saveButton", "button", 340, 240, 120, 40, "Save");

const project: WireframeProject = {
  version: PROJECT_VERSION,
  title: "Gesture",
  canvas: { mode: "desktop", width: 1200, height: 800 },
  layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
  elements: [container, button]
};

/* --------------------------------------------------- a minimal canvas + window */

type Listener = (event: unknown) => void;

function fakeCanvas() {
  const listeners = new Map<string, Listener[]>();
  const canvas = {
    style: { cursor: "" },
    addEventListener(type: string, fn: Listener) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
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
      /* the engine guards capture failures; nothing to do here */
    },
    emit(type: string, event: Record<string, unknown>) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(event);
    }
  };
  return canvas;
}

function pointer(x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    button: 0,
    buttons: 1,
    pointerId: 1,
    clientX: x,
    clientY: y,
    type: "pointermove",
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    ...extra
  };
}

/** Drive one complete gesture through the real state machine and report what it committed. */
function gesture(
  canvas: ReturnType<typeof fakeCanvas>,
  from: [number, number],
  to: [number, number],
  options: { modifier?: boolean } = {}
) {
  canvas.emit("pointerdown", pointer(from[0], from[1], { type: "pointerdown", shiftKey: options.modifier ?? false }));
  canvas.emit("pointermove", pointer(to[0], to[1]));
  canvas.emit("pointerup", pointer(to[0], to[1], { type: "pointerup", buttons: 0 }));
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

interface Harness {
  canvas: ReturnType<typeof fakeCanvas>;
  interaction: CanvasInteraction;
  moves: { elementId: string; x: number; y: number }[][];
  resizes: { elementId: string; bounds: Rect }[];
  selections: SelectionState[];
  setSelection(selection: SelectionState): void;
}

function harness(selection: SelectionState = { ids: [], primary: null }): Harness {
  const canvas = fakeCanvas();
  const moves: { elementId: string; x: number; y: number }[][] = [];
  const resizes: { elementId: string; bounds: Rect }[] = [];
  const selections: SelectionState[] = [];
  const state = {
    project,
    transform: createTransform(1, 0, 0),
    selection,
    snapEnabled: false,
    gridSize: 8,
    minSize: 8
  };
  const interaction = new CanvasInteraction(canvas as unknown as HTMLCanvasElement, state, {
    select: (next) => {
      selections.push(next);
      state.selection = next;
    },
    beginEdit: () => {},
    endEdit: () => {},
    commitMove: (moved) => moves.push(moved),
    commitResize: (elementId, bounds) => resizes.push({ elementId, bounds }),
    requestRender: () => {},
    setCursor: () => {}
  });
  return {
    canvas,
    interaction,
    moves,
    resizes,
    selections,
    setSelection(next) {
      state.selection = next;
      interaction.setState({ ...state, selection: next });
    }
  };
}

/* ---------------------------------------------------------------------- tests */

describe("container drag through the real pointer state machine", () => {
  it("drags the Container by its border when it is already selected", () => {
    const h = harness({ ids: ["panelContainer"], primary: "panelContainer" });
    gesture(h.canvas, [350, 103], [390, 143]);

    expect(h.resizes).toHaveLength(0);
    expect(h.moves).toEqual([[{ elementId: "panelContainer", x: 140, y: 140 }]]);
  });

  it("selects and drags the Container from an unselected border", () => {
    const h = harness();
    gesture(h.canvas, [103, 250], [83, 250]);

    expect(h.selections).toEqual([{ ids: ["panelContainer"], primary: "panelContainer" }]);
    expect(h.moves).toEqual([[{ elementId: "panelContainer", x: 80, y: 100 }]]);
  });

  it("resizes instead of dragging when the pointer grabs a corner", () => {
    const h = harness({ ids: ["panelContainer"], primary: "panelContainer" });
    gesture(h.canvas, [600, 400], [640, 440]);

    expect(h.moves).toHaveLength(0);
    expect(h.resizes).toHaveLength(1);
    expect(h.resizes[0].elementId).toBe("panelContainer");
    expect(h.resizes[0].bounds).toEqual({ x: 100, y: 100, width: 540, height: 340 });
  });

  it("lets the Button inside win every interaction", () => {
    const h = harness();
    gesture(h.canvas, [400, 260], [440, 260]);

    expect(h.selections).toEqual([{ ids: ["saveButton"], primary: "saveButton" }]);
    expect(h.moves).toEqual([[{ elementId: "saveButton", x: 380, y: 240 }]]);
  });

  it("passes an empty interior through: the Container never moves", () => {
    const h = harness({ ids: ["panelContainer"], primary: "panelContainer" });
    gesture(h.canvas, [200, 200], [240, 220]);

    // The drag began on empty canvas, so it is a marquee — never a Container drag or resize.
    expect(h.moves).toHaveLength(0);
    expect(h.resizes).toHaveLength(0);
    // A marquee selects by *bounds* (documented behaviour), so the Container it swept over is in.
    expect(h.selections).toEqual([{ ids: ["panelContainer"], primary: "panelContainer" }]);
  });

  it("a click inside the empty interior clears the selection instead of grabbing the Container", () => {
    const h = harness({ ids: ["panelContainer"], primary: "panelContainer" });
    gesture(h.canvas, [200, 200], [200, 200]);
    expect(h.moves).toHaveLength(0);
    expect(h.resizes).toHaveLength(0);
    expect(h.selections).toEqual([{ ids: [], primary: null }]);
  });

  it("a plain click on empty canvas clears the selection", () => {
    const h = harness({ ids: ["panelContainer"], primary: "panelContainer" });
    gesture(h.canvas, [700, 700], [700, 700]);
    expect(h.selections).toEqual([{ ids: [], primary: null }]);
  });
});

describe("marquee and multi-object drag", () => {
  const wide: WireframeProject = {
    ...project,
    elements: [
      element("a", "button", 100, 100, 120, 40),
      element("b", "button", 300, 100, 120, 40),
      element("c", "button", 500, 100, 120, 40),
      element("d", "button", 700, 500, 120, 40)
    ]
  };

  function multiHarness(selection: SelectionState = { ids: [], primary: null }) {
    const canvas = fakeCanvas();
    const moves: { elementId: string; x: number; y: number }[][] = [];
    const selections: SelectionState[] = [];
    const state = {
      project: wide,
      transform: createTransform(1, 0, 0),
      selection,
      snapEnabled: false,
      gridSize: 8,
      minSize: 8
    };
    const interaction = new CanvasInteraction(canvas as unknown as HTMLCanvasElement, state, {
      select: (next) => {
        selections.push(next);
        state.selection = next;
      },
      beginEdit: () => {},
      endEdit: () => {},
      commitMove: (moved) => moves.push(moved),
      commitResize: () => {},
      requestRender: () => {},
      setCursor: () => {}
    });
    return { canvas, interaction, moves, selections, state };
  }

  it("marquee selects every intersecting element and replaces the selection", () => {
    const h = multiHarness({ ids: ["d"], primary: "d" });
    gesture(h.canvas, [50, 50], [640, 200]);
    expect(h.selections).toEqual([{ ids: ["a", "b", "c"], primary: "c" }]);
  });

  it("a shift-marquee adds to the existing selection", () => {
    const h = multiHarness({ ids: ["d"], primary: "d" });
    gesture(h.canvas, [50, 50], [640, 200], { modifier: true });
    expect(h.selections).toEqual([{ ids: ["d", "a", "b", "c"], primary: "c" }]);
  });

  it("moves the whole selected set as one rigid body with a single commit", () => {
    const h = multiHarness({ ids: ["a", "b", "c"], primary: "b" });
    gesture(h.canvas, [350, 120], [400, 160]);
    expect(h.moves).toHaveLength(1);
    expect(h.moves[0]).toEqual([
      { elementId: "a", x: 150, y: 140 },
      { elementId: "b", x: 350, y: 140 },
      { elementId: "c", x: 550, y: 140 }
    ]);
  });

  it("shift-click toggles membership without starting a duplicate selection", () => {
    const h = multiHarness({ ids: ["a"], primary: "a" });
    gesture(h.canvas, [350, 120], [350, 120], { modifier: true });
    expect(h.selections).toEqual([{ ids: ["a", "b"], primary: "b" }]);
    expect(h.moves).toHaveLength(0);
  });

  it("dragging one member of a multi-selection never resizes it", () => {
    const h = multiHarness({ ids: ["a", "b"], primary: "a" });
    // A point on b's right edge would be a handle for a single selection.
    gesture(h.canvas, [420, 120], [430, 130]);
    expect(h.moves).toHaveLength(1);
    expect(h.moves[0]).toEqual([
      { elementId: "a", x: 110, y: 110 },
      { elementId: "b", x: 310, y: 110 }
    ]);
  });
});

describe("locked objects are never dragged", () => {
  it("skips a locked member of the selection", () => {
    const canvas = fakeCanvas();
    const moves: { elementId: string; x: number; y: number }[][] = [];
    const projectWithLock: WireframeProject = {
      ...project,
      elements: [container, button, { ...element("locked", "button", 500, 500, 100, 40), locked: true }]
    };
    const state = {
      project: projectWithLock,
      transform: createTransform(1, 0, 0),
      selection: { ids: ["saveButton", "locked"], primary: "saveButton" } as SelectionState,
      snapEnabled: false,
      gridSize: 8,
      minSize: 8
    };
    new CanvasInteraction(canvas as unknown as HTMLCanvasElement, state, {
      select: () => {},
      beginEdit: () => {},
      endEdit: () => {},
      commitMove: (moved) => moves.push(moved),
      commitResize: () => {},
      requestRender: () => {},
      setCursor: () => {}
    });
    gesture(canvas, [400, 260], [420, 280]);
    expect(moves).toEqual([[{ elementId: "saveButton", x: 360, y: 260 }]]);
  });
});

describe("sanity: the harness itself", () => {
  it("records the cursor feedback the engine pushes", () => {
    const canvas = fakeCanvas();
    const setCursor = vi.fn();
    const state = {
      project,
      transform: createTransform(1, 0, 0),
      selection: { ids: [], primary: null } as SelectionState,
      snapEnabled: false,
      gridSize: 8,
      minSize: 8
    };
    new CanvasInteraction(canvas as unknown as HTMLCanvasElement, state, {
      select: () => {},
      beginEdit: () => {},
      endEdit: () => {},
      commitMove: () => {},
      commitResize: () => {},
      requestRender: () => {},
      setCursor
    });
    canvas.emit("pointerdown", pointer(400, 260, { type: "pointerdown" }));
    expect(setCursor).toHaveBeenCalledWith("move");
  });
});
