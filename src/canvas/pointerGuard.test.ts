import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROJECT_VERSION, type WireframeElement, type WireframeProject } from "../model/project";
import type { SelectionState } from "../model/selection";
import { CanvasInteraction } from "./interaction";
import { createTransform } from "./transform";

function element(id: string, x: number, y: number, extra: Partial<WireframeElement> = {}): WireframeElement {
  return {
    id,
    type: "button",
    name: id,
    label: id,
    note: "",
    x,
    y,
    width: 120,
    height: 40,
    layerId: "l1",
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

const project: WireframeProject = {
  version: PROJECT_VERSION,
  title: "Pointers",
  canvas: { mode: "desktop", width: 1200, height: 800 },
  layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
  elements: [
    element("card", 100, 100, { width: 400, height: 300 }),
    element("child", 140, 140, { parentId: "card" }),
    element("loose", 700, 500)
  ]
};

type Listener = (event: unknown) => void;

function harness(selection: SelectionState = { ids: [], primary: null }) {
  const listeners = new Map<string, Listener[]>();
  const canvas = {
    style: { cursor: "" },
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
    setPointerCapture() {},
    emit(type: string, event: Record<string, unknown>) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn({ button: 0, shiftKey: false, metaKey: false, ctrlKey: false, type, ...event });
    }
  };
  const log: string[] = [];
  const moves: { elementId: string; x: number; y: number }[][] = [];
  const state = { project, transform: createTransform(1, 0, 0), selection, snapEnabled: false, gridSize: 8, minSize: 8 };
  new CanvasInteraction(canvas as unknown as HTMLCanvasElement, state, {
    select: (next) => {
      state.selection = next;
    },
    beginEdit: () => log.push("begin"),
    endEdit: () => log.push("end"),
    commitMove: (moved) => moves.push(moved),
    commitResize: () => {},
    requestRender: () => {},
    setCursor: () => {}
  });
  return { canvas, log, moves };
}

beforeAll(() => {
  (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {} };
});
afterAll(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("pointer guard", () => {
  it("a second pointer cannot hijack a running drag or leave a transaction open", () => {
    const { canvas, log, moves } = harness();
    canvas.emit("pointerdown", { pointerId: 1, clientX: 720, clientY: 510 });
    canvas.emit("pointerdown", { pointerId: 2, clientX: 1000, clientY: 50 });
    canvas.emit("pointermove", { pointerId: 2, clientX: 1100, clientY: 150 });
    canvas.emit("pointerup", { pointerId: 2, clientX: 1100, clientY: 150 });
    canvas.emit("pointermove", { pointerId: 1, clientX: 740, clientY: 530 });
    canvas.emit("pointerup", { pointerId: 1, clientX: 740, clientY: 530 });
    expect(log).toEqual(["begin", "end"]);
    expect(moves).toEqual([[{ elementId: "loose", x: 720, y: 520 }]]);
  });

  it("dragging a parent carries its nested children", () => {
    const { canvas, moves } = harness({ ids: ["card"], primary: "card" });
    // grab the card body, away from the child
    canvas.emit("pointerdown", { pointerId: 1, clientX: 400, clientY: 350 });
    canvas.emit("pointermove", { pointerId: 1, clientX: 410, clientY: 360 });
    canvas.emit("pointerup", { pointerId: 1, clientX: 410, clientY: 360 });
    expect(moves).toEqual([
      [
        { elementId: "card", x: 110, y: 110 },
        { elementId: "child", x: 150, y: 150 }
      ]
    ]);
  });
});
