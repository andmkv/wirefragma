import { describe, expect, it } from "vitest";
import { effectiveVisible, createLayer, type WireframeElement, type WireframeProject, PROJECT_VERSION } from "./project";
import { effectiveLocked } from "./project";
import { selectableElements } from "./selection";

function element(id: string, extra: Partial<WireframeElement> = {}): WireframeElement {
  return {
    id,
    type: "button",
    name: id,
    label: "Button",
    note: "",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    layerId: "l1",
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

function project(elements: WireframeElement[], layerExtra: { visible?: boolean; locked?: boolean } = {}): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Select all",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [createLayer("Default", { id: "l1", ...layerExtra })],
    elements: elements.map((candidate, index) => ({ ...candidate, zIndex: index }))
  };
}

describe("selectableElements", () => {
  it("returns every visible, unlocked element in document order", () => {
    const doc = project([element("a"), element("b"), element("c")]);
    expect(selectableElements(doc)).toEqual(["a", "b", "c"]);
  });

  it("skips hidden and locked elements — the same rule the marquee uses", () => {
    const doc = project([
      element("visible"),
      element("hidden", { visible: false }),
      element("locked", { locked: true }),
      element("other")
    ]);
    const expected = doc.elements
      .filter((candidate) => effectiveVisible(doc, candidate) && !effectiveLocked(doc, candidate))
      .map((candidate) => candidate.id);
    expect(selectableElements(doc)).toEqual(expected);
    expect(selectableElements(doc)).toEqual(["visible", "other"]);
  });

  it("skips everything when the layer is hidden or locked", () => {
    expect(selectableElements(project([element("a")], { visible: false }))).toEqual([]);
    expect(selectableElements(project([element("a")], { locked: true }))).toEqual([]);
  });

  it("inherits locking and visibility from ancestors", () => {
    const parent = element("parent", { locked: true });
    const child = element("child", { parentId: "parent" });
    const doc = project([parent, child]);
    expect(selectableElements(doc)).toEqual([]);
  });

  it("is empty for an empty project", () => {
    expect(selectableElements(project([]))).toEqual([]);
  });
});
