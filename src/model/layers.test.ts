import { describe, expect, it } from "vitest";
import {
  addLayer,
  bringToFront,
  createLayer,
  deleteLayer,
  duplicateElement,
  effectiveLocked,
  effectiveVisible,
  elementsInDrawOrder,
  elementsOfLayer,
  moveElement,
  moveLayer,
  normalizeProject,
  reorderElement,
  sendToBack,
  updateLayer,
  visibleElementsInDrawOrder,
  type ElementType,
  type WireframeElement,
  type WireframeLayer,
  type WireframeProject
} from "./project";

function element(id: string, name: string, layerId: string, zIndex: number, type: ElementType = "button"): WireframeElement {
  return {
    id,
    type,
    name,
    label: name,
    note: "",
    x: 0,
    y: 0,
    width: 120,
    height: 40,
    layerId,
    visible: true,
    locked: false,
    zIndex
  };
}

/** Controls sits in front of Layout; the element array interleaves both layers. */
function makeProject(): WireframeProject {
  const front: WireframeLayer = createLayer("Controls", { id: "l_front" });
  const back: WireframeLayer = createLayer("Layout", { id: "l_back" });
  return {
    version: 2,
    title: "Layers",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [front, back],
    elements: [
      element("a", "backOne", back.id, 0),
      element("b", "frontOne", front.id, 0),
      element("c", "backTwo", back.id, 1),
      element("d", "frontTwo", front.id, 1)
    ]
  };
}

const ids = (list: WireframeElement[]) => list.map((item) => item.id);

describe("layer z-order", () => {
  it("flattens elements layer by layer, keeping array order inside a layer", () => {
    expect(ids(elementsInDrawOrder(makeProject()))).toEqual(["a", "c", "b", "d"]);
  });

  it("reverses the flattened order when layers move", () => {
    const project = makeProject();
    const moved = moveLayer(project, "l_back", "l_front", true);
    expect(moved.layers.map((layer) => layer.name)).toEqual(["Layout", "Controls"]);
    expect(ids(elementsInDrawOrder(moved))).toEqual(["b", "d", "a", "c"]);
  });

  it("lists elements of a layer front first for the panel", () => {
    expect(ids(elementsOfLayer(makeProject(), "l_front", { frontFirst: true }))).toEqual(["d", "b"]);
    expect(ids(elementsOfLayer(makeProject(), "l_front"))).toEqual(["b", "d"]);
  });

  it("reorders elements inside their own layer only", () => {
    const project = makeProject();
    const forward = reorderElement(project, "b", "forward");
    expect(ids(elementsInDrawOrder(forward))).toEqual(["a", "c", "d", "b"]);
    expect(elementsOfLayer(forward, "l_back").map((item) => item.zIndex)).toEqual([0, 1]);

    const backward = reorderElement(project, "b", "backward");
    expect(backward).toBe(project); // already at the back of its layer
  });

  it("brings an element to the front / back of its own layer", () => {
    expect(ids(elementsInDrawOrder(bringToFront(makeProject(), "b")))).toEqual(["a", "c", "d", "b"]);
    expect(ids(elementsInDrawOrder(sendToBack(makeProject(), "d")))).toEqual(["a", "c", "d", "b"]);
  });

  it("keeps zIndex meaningful per layer", () => {
    const project = bringToFront(makeProject(), "b");
    expect(project.elements.find((item) => item.id === "b")?.zIndex).toBe(1);
    expect(project.elements.find((item) => item.id === "d")?.zIndex).toBe(0);
  });
});

describe("moving elements between layers", () => {
  it("moves an element into another layer above a target element", () => {
    const project = makeProject();
    const moved = moveElement(project, "a", "l_front", "b", true);
    const elementA = moved.elements.find((item) => item.id === "a");

    expect(elementA?.layerId).toBe("l_front");
    expect(ids(elementsInDrawOrder(moved))).toEqual(["c", "b", "a", "d"]);
    expect(elementsOfLayer(moved, "l_back")).toHaveLength(1);
  });

  it("moves an element to the top of a layer when no target element is given", () => {
    const moved = moveElement(makeProject(), "a", "l_front");
    expect(ids(elementsInDrawOrder(moved))).toEqual(["c", "b", "d", "a"]);
    expect(moved.elements.find((item) => item.id === "a")?.layerId).toBe("l_front");
  });

  it("ignores unknown layers and missing elements", () => {
    const project = makeProject();
    expect(moveElement(project, "a", "nope")).toBe(project);
    expect(moveElement(project, "nope", "l_front")).toBe(project);
  });
});

describe("visibility and locking", () => {
  it("computes effective visibility from the element and its layer", () => {
    const project = makeProject();
    const elementA = project.elements[0];
    expect(effectiveVisible(project, elementA)).toBe(true);

    const hiddenElement = { ...elementA, visible: false };
    expect(effectiveVisible(project, hiddenElement)).toBe(false);

    const hiddenLayer = updateLayer(project, "l_back", { visible: false });
    expect(effectiveVisible(hiddenLayer, elementA)).toBe(false);
    expect(visibleElementsInDrawOrder(hiddenLayer)).toHaveLength(2);
  });

  it("computes effective locking from the element or its layer", () => {
    const project = updateLayer(makeProject(), "l_back", { locked: true });
    const [backElement, frontElement] = [project.elements[0], project.elements[1]];
    expect(effectiveLocked(project, backElement)).toBe(true);
    expect(effectiveLocked(project, frontElement)).toBe(false);
    expect(effectiveLocked(project, { ...frontElement, locked: true })).toBe(true);
  });

  it("keeps locked elements in the draw order (they stay visible)", () => {
    const project = updateLayer(makeProject(), "l_back", { locked: true });
    expect(ids(visibleElementsInDrawOrder(project))).toEqual(["a", "c", "b", "d"]);
  });
});

describe("layer operations", () => {
  it("adds a layer in front and names it uniquely", () => {
    const first = addLayer(makeProject());
    expect(first.layer.name).toBe("Layer");
    expect(first.project.layers[0].id).toBe(first.layer.id);

    const second = addLayer(first.project);
    expect(second.layer.name).toBe("Layer 2");
  });

  it("renames and toggles layers", () => {
    const project = makeProject();
    const renamed = updateLayer(project, "l_back", { name: "Background" });
    expect(renamed.layers.map((layer) => layer.name)).toEqual(["Controls", "Background"]);

    const hidden = updateLayer(project, "l_back", { visible: false });
    expect(hidden.layers[1].visible).toBe(false);
  });

  it("reorders layers with drag semantics", () => {
    const project = makeProject();
    const below = moveLayer(project, "l_front", "l_back", false);
    expect(below.layers.map((layer) => layer.name)).toEqual(["Layout", "Controls"]);
    expect(moveLayer(project, "l_front", "l_front", true)).toBe(project);
  });

  it("keeps elements attached to their layer when a layer moves", () => {
    const moved = moveLayer(makeProject(), "l_front", "l_back", false);
    expect(elementsOfLayer(moved, "l_front")).toHaveLength(2);
    expect(moved.elements.every((item) => item.zIndex >= 0)).toBe(true);
  });

  it("deletes a layer together with its elements", () => {
    const project = makeProject();
    const result = deleteLayer(project, "l_front");

    expect(result.project.layers.map((layer) => layer.name)).toEqual(["Layout"]);
    expect(result.removedElementIds.sort()).toEqual(["b", "d"]);
    expect(result.project.elements.map((element) => element.id).sort()).toEqual(["a", "c"]);
    expect(result.replacedWithDefault).toBe(false);
  });

  it("keeps element order in the surviving layer and reindexes z", () => {
    const result = deleteLayer(makeProject(), "l_front");
    expect(result.project.elements.map((element) => element.id)).toEqual(["a", "c"]);
    expect(result.project.elements.map((element) => element.zIndex)).toEqual([0, 1]);
  });

  it("never leaves the document without a layer", () => {
    const project = makeProject();
    const onlyOne = deleteLayer(project, "l_back");
    const result = deleteLayer(onlyOne.project, "l_front");

    expect(result.replacedWithDefault).toBe(true);
    expect(result.project.layers).toHaveLength(1);
    expect(result.project.layers[0].name).toBe("Default");
    expect(result.project.elements).toHaveLength(0);
  });

  it("ignores unknown layers", () => {
    const project = makeProject();
    const result = deleteLayer(project, "nope");
    expect(result.project).toBe(project);
    expect(result.removedElementIds).toEqual([]);
  });
});

describe("duplication", () => {
  it("keeps the layer and stacks the copy on top of the source", () => {
    const project = makeProject();
    const { project: copy, newId } = duplicateElement(project, "a");
    const cloned = copy.elements.find((item) => item.id === newId);
    expect(cloned?.layerId).toBe("l_back");
    expect(cloned?.name).toBe("backOneCopy");
    expect(cloned?.x).toBe(project.elements[0].x + 16);
    expect(copy.elements.map((item) => item.id).indexOf(newId as string)).toBe(1);
  });
});

describe("normalization of hand-written layer data", () => {
  it("repairs unknown layerIds to the fallback layer", () => {
    const repaired = normalizeProject({
      version: 2,
      title: "Broken",
      canvas: { width: 1200, height: 800 },
      layers: [{ id: "l1", name: "One" }],
      elements: [
        { id: "e1", type: "button", x: 0, y: 0, width: 10, height: 10, layerId: "missing" },
        { id: "e2", type: "text", x: 0, y: 0, width: 10, height: 10, layerId: "l1", visible: false, locked: true }
      ]
    });
    expect(repaired.elements[0].layerId).toBe("l1");
    expect(repaired.elements[1].visible).toBe(false);
    expect(repaired.elements[1].locked).toBe(true);
    expect(repaired.layers[0].visible).toBe(true);
  });

  it("creates a Default layer when layers are missing", () => {
    const repaired = normalizeProject({
      version: 2,
      canvas: { width: 1200, height: 800 },
      elements: [{ id: "e1", type: "button", x: 0, y: 0, width: 10, height: 10 }]
    });
    expect(repaired.layers.map((layer) => layer.name)).toEqual(["Default"]);
    expect(repaired.elements[0].layerId).toBe(repaired.layers[0].id);
  });
});
