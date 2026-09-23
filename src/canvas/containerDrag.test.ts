import { describe, expect, it } from "vitest";
import { PROJECT_VERSION, type ElementType, type WireframeElement, type WireframeProject } from "../model/project";
import { elementGeometry } from "./geometry";
import { hitTestProject, type HitTarget } from "./hitTest";
import { createTransform } from "./transform";

function element(
  name: string,
  type: ElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  label = ""
): WireframeElement {
  return {
    id: `id_${name}`,
    type,
    name,
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

function project(elements: WireframeElement[]): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Container drag",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
    elements: elements.map((candidate, index) => ({ ...candidate, zIndex: index }))
  };
}

const transform = createTransform(1, 0, 0);
const hit = (doc: WireframeProject, x: number, y: number, selectedId: string | null = null): HitTarget =>
  hitTestProject({ x, y }, doc, transform, { selectedId });

const container = element("panelContainer", "container", 100, 100, 500, 300, "Panel");
const button = element("saveButton", "button", 340, 240, 120, 40, "Save");
const doc = project([container, button]);

describe("a Container is grabbed by its border, not swallowed by its own handles", () => {
  it("offers corner handles only — no edge handles on the border band", () => {
    const edges = elementGeometry(container, transform).resizeHandles.map((handle) => handle.edge);
    expect(edges).toEqual(["top-left", "top-right", "bottom-right", "bottom-left"]);
    expect(edges).not.toContain("top");
    expect(edges).not.toContain("bottom");
    expect(edges).not.toContain("left");
    expect(edges).not.toContain("right");
  });

  it("keeps the full handle set for normal elements", () => {
    expect(elementGeometry(button, transform).resizeHandles).toHaveLength(8);
  });

  it("drags from the top border even while the Container is selected", () => {
    // This is the regression: the top border used to resolve to the "top" resize handle, so a
    // selected Container could be resized but never moved by its own border.
    expect(hit(doc, 350, 103, "id_panelContainer")).toEqual({
      kind: "element",
      elementId: "id_panelContainer"
    });
  });

  it("drags from every border, selected or not", () => {
    const samples: [number, number][] = [
      [350, 103], // top border
      [350, 397], // bottom border
      [103, 250], // left border
      [597, 250] // right border
    ];
    for (const [x, y] of samples) {
      expect(hit(doc, x, y)).toEqual({ kind: "element", elementId: "id_panelContainer" });
      expect(hit(doc, x, y, "id_panelContainer")).toEqual({
        kind: "element",
        elementId: "id_panelContainer"
      });
    }
  });

  it("drags from the title label near the top-left corner", () => {
    // y = 115 is below the 9 px border band, so only the label rect can explain this hit.
    expect(hit(doc, 120, 115, "id_panelContainer")).toEqual({
      kind: "element",
      elementId: "id_panelContainer"
    });
  });

  it("still resizes from a corner handle", () => {
    expect(hit(doc, 100, 100, "id_panelContainer")).toEqual({
      kind: "handle",
      elementId: "id_panelContainer",
      edge: "top-left"
    });
    expect(hit(doc, 600, 400, "id_panelContainer")).toEqual({
      kind: "handle",
      elementId: "id_panelContainer",
      edge: "bottom-right"
    });
  });

  it("passes an empty interior through to what is behind it", () => {
    expect(hit(doc, 200, 200)).toEqual({ kind: "none" });
    expect(hit(doc, 200, 200, "id_panelContainer")).toEqual({ kind: "none" });
  });

  it("never steals clicks from a child inside the interior", () => {
    expect(hit(doc, 400, 260)).toEqual({ kind: "element", elementId: "id_saveButton" });
    expect(hit(doc, 400, 260, "id_panelContainer")).toEqual({
      kind: "element",
      elementId: "id_saveButton"
    });
  });

  it("keeps the border band thin on screen at any zoom", () => {
    // A Container zoomed out keeps a screen-pixel band, so its interior stays clickable.
    const zoomedOut = createTransform(0.25, 0, 0);
    const band = elementGeometry(container, zoomedOut).hitRegions.slice(0, 4); // 4 border bands
    expect(band).toHaveLength(4);
    // Each band is thin in at least one axis: 36 world px means 9 CSS px at 25 % zoom.
    expect(band.every((rect) => rect.width <= 36 || rect.height <= 36)).toBe(true);
    const centre = { x: 350, y: 250 };
    expect(band.some((rect) => rect.x <= centre.x && centre.x <= rect.x + rect.width && rect.y <= centre.y && centre.y <= rect.y + rect.height)).toBe(false);
  });
});
