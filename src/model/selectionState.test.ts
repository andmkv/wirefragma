import { describe, expect, it } from "vitest";
import { PROJECT_VERSION, type ElementType, type WireframeElement, type WireframeProject } from "./project";
import {
  EMPTY_SELECTION,
  deletableSelection,
  marqueeSelection,
  movableSelection,
  normalizeSelectionState,
  rectsOverlap,
  selectionBounds,
  selectionEquals,
  selectionOf,
  singleSelection,
  toggleInSelection,
  withPrimary
} from "./selection";

const LAYER = "layer_default";

function element(
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 40,
  extra: Partial<WireframeElement> = {}
): WireframeElement {
  return {
    id,
    type: "button" as ElementType,
    name: id,
    label: id,
    note: "",
    x,
    y,
    width,
    height,
    layerId: LAYER,
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

function project(elements: WireframeElement[], layerLocked = false, layerVisible = true): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Selection",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [{ id: LAYER, name: "Default", visible: layerVisible, locked: layerLocked }],
    elements: elements.map((candidate, index) => ({ ...candidate, zIndex: index }))
  };
}

describe("selection state helpers", () => {
  it("starts empty and builds a single selection", () => {
    expect(EMPTY_SELECTION).toEqual({ ids: [], primary: null });
    expect(singleSelection("a")).toEqual({ ids: ["a"], primary: "a" });
  });

  it("deduplicates ids and repairs a primary outside the set", () => {
    expect(selectionOf(["a", "b", "a"])).toEqual({ ids: ["a", "b"], primary: "b" });
    expect(selectionOf(["a", "b"], "zz")).toEqual({ ids: ["a", "b"], primary: "b" });
    expect(selectionOf([], "a")).toEqual(EMPTY_SELECTION);
  });

  it("toggles membership and promotes a new primary when the primary is removed", () => {
    const one = singleSelection("a");
    const two = toggleInSelection(one, "b");
    expect(two).toEqual({ ids: ["a", "b"], primary: "b" });

    const three = toggleInSelection(two, "c");
    expect(three.ids).toEqual(["a", "b", "c"]);

    // Removing a non-primary member keeps the primary.
    expect(toggleInSelection(three, "a")).toEqual({ ids: ["b", "c"], primary: "c" });
    // Removing the primary promotes the last remaining id.
    expect(toggleInSelection(selectionOf(["a", "b"], "a"), "a")).toEqual({ ids: ["b"], primary: "b" });
    // Removing the only member leaves an empty selection.
    expect(toggleInSelection(singleSelection("a"), "a")).toEqual(EMPTY_SELECTION);
  });

  it("keeps shift-clicking reversible", () => {
    const selection = toggleInSelection(toggleInSelection(singleSelection("a"), "b"), "b");
    expect(selection).toEqual({ ids: ["a"], primary: "a" });
  });

  it("re-points the primary without changing the set", () => {
    const selection = withPrimary(selectionOf(["a", "b"], "b"), "a");
    expect(selection).toEqual({ ids: ["a", "b"], primary: "a" });
    // Unknown ids never become the primary.
    expect(withPrimary(selection, "zz")).toBe(selection);
  });

  it("compares selections by set order and primary", () => {
    expect(selectionEquals(singleSelection("a"), singleSelection("a"))).toBe(true);
    expect(selectionEquals(singleSelection("a"), selectionOf(["a"], null))).toBe(true);
    expect(selectionEquals(selectionOf(["a", "b"], "a"), selectionOf(["b", "a"], "a"))).toBe(false);
  });

  it("drops deleted elements from the selection", () => {
    const doc = project([element("a", 0, 0), element("b", 200, 0)]);
    const stale = selectionOf(["a", "b", "gone"], "gone");
    expect(normalizeSelectionState(doc, stale)).toEqual({ ids: ["a", "b"], primary: "b" });
    // Nothing to do → the same object comes back (no needless re-render).
    const clean = selectionOf(["a", "b"], "b");
    expect(normalizeSelectionState(doc, clean)).toBe(clean);
  });
});

describe("selection geometry", () => {
  it("measures the union bounds of a set", () => {
    const doc = project([element("a", 100, 100, 100, 40), element("b", 300, 220, 80, 60)]);
    expect(selectionBounds(doc, ["a", "b"])).toEqual({ x: 100, y: 100, width: 280, height: 180 });
    expect(selectionBounds(doc, [])).toBeNull();
    expect(selectionBounds(doc, ["missing"])).toBeNull();
  });

  it("treats touching edges as overlapping", () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(true);
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10.5, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("marquee selection", () => {
  const doc = project([
    element("inside", 120, 120, 100, 40),
    element("crossing", 200, 200, 200, 100),
    element("outside", 900, 600, 100, 40),
    element("hidden", 130, 130, 50, 30, { visible: false }),
    element("locked", 140, 140, 50, 30, { locked: true })
  ]);

  it("keeps visible unlocked elements that intersect the rectangle", () => {
    expect(marqueeSelection(doc, { x: 100, y: 100, width: 320, height: 220 })).toEqual([
      "inside",
      "crossing"
    ]);
  });

  it("excludes hidden and locked elements", () => {
    const all = marqueeSelection(doc, { x: 0, y: 0, width: 1200, height: 800 });
    expect(all).toEqual(["inside", "crossing", "outside"]);
    expect(all).not.toContain("hidden");
    expect(all).not.toContain("locked");
  });

  it("excludes elements hidden or locked by their layer", () => {
    const hiddenLayer = project([element("a", 0, 0, 50, 50)], false, false);
    expect(marqueeSelection(hiddenLayer, { x: -10, y: -10, width: 200, height: 200 })).toEqual([]);
    const lockedLayer = project([element("a", 0, 0, 50, 50)], true, true);
    expect(marqueeSelection(lockedLayer, { x: -10, y: -10, width: 200, height: 200 })).toEqual([]);
  });

  it("returns nothing for a rectangle over empty canvas", () => {
    expect(marqueeSelection(doc, { x: 500, y: 20, width: 40, height: 40 })).toEqual([]);
  });
});

describe("bulk action membership", () => {
  const doc = project([
    element("free", 0, 0),
    element("locked", 100, 0, 100, 40, { locked: true }),
    element("hidden", 200, 0, 100, 40, { visible: false })
  ]);
  const ids = ["free", "locked", "hidden", "nowhere"];

  it("moves only visible unlocked elements", () => {
    expect(movableSelection(doc, ids)).toEqual(["free"]);
  });

  it("deletes only unlocked elements (hidden ones may still be deleted)", () => {
    expect(deletableSelection(doc, ids)).toEqual(["free", "hidden"]);
  });

  it("excludes everything on a locked layer", () => {
    const locked = project([element("a", 0, 0)], true, true);
    expect(movableSelection(locked, ["a"])).toEqual([]);
    expect(deletableSelection(locked, ["a"])).toEqual([]);
  });
});
