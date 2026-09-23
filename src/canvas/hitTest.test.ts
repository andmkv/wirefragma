import { describe, expect, it } from "vitest";
import { createTransform, screenToWorld } from "./transform";
import { elementGeometry, visibleGeometries } from "./geometry";
import { hitTestProject, type HitTarget } from "./hitTest";
import { PROJECT_VERSION, type ElementType, type WireframeElement, type WireframeProject } from "../model/project";

function element(
  name: string,
  type: ElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<WireframeElement> = {}
): WireframeElement {
  return {
    id: `id_${name}`,
    type,
    name,
    label: name,
    note: "",
    x,
    y,
    width,
    height,
    layerId: "l1",
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

function project(elements: WireframeElement[], options: { layers?: boolean } = {}): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Hit test",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: options.layers === false ? [] : [{ id: "l1", name: "Default", visible: true, locked: false }],
    elements
  };
}

const target = (name: string) => ({ kind: "element", elementId: `id_${name}` }) as HitTarget;
const scale = 1;
const transform = createTransform(scale, 0, 0);
const hit = (proj: WireframeProject, x: number, y: number, selectedId: string | null = null) =>
  hitTestProject({ x, y }, proj, transform, { selectedId });

describe("exact regression from the failing build", () => {
  const container = element("container1", "container", 112, 400, 600, 360);
  const button = element("button1", "button", 208, 360, 120, 40);
  const dialog = element("dialog1", "dialog", 424, 280, 360, 240);
  const proj = project([container, button, dialog]);

  it("resolves the pointer at 558.5,282.1 to the dialog, never the container", () => {
    const result = hit(proj, 558.5, 282.1);
    expect(result).toEqual(target("dialog1"));
    expect(result).not.toEqual(target("container1"));
  });

  it("still finds the button and the container where they really are", () => {
    expect(hit(proj, 268, 380)).toEqual(target("button1"));
    expect(hit(proj, 113, 700)).toEqual(target("container1")); // border
  });

  it("is independent of zoom", () => {
    for (const s of [0.25, 0.5, 1, 2, 4]) {
      const t = createTransform(s, 0, 0);
      expect(hitTestProject({ x: 558.5, y: 282.1 }, proj, t)).toEqual(target("dialog1"));
    }
  });

  it("agrees with a pointer event converted through screenToWorld", () => {
    const t = createTransform(0.37, 0, 0);
    for (const world of [
      { x: 558.5, y: 282.1 },
      { x: 268, y: 380 },
      { x: 113, y: 700 }
    ]) {
      const screen = { x: world.x * t.scale, y: world.y * t.scale };
      const back = screenToWorld(t, screen.x, screen.y);
      const fromScreen = hitTestProject(back, proj, t);
      const direct = hitTestProject(world, proj, t);
      expect(fromScreen).toEqual(direct);
    }
  });
});

describe("overlap cases used by the acceptance matrix", () => {
  const dialog = element("dialog1", "dialog", 100, 100, 500, 300);
  const button = element("button1", "button", 200, 200, 120, 40);
  const stack = project([dialog, button]);

  it("button in front wins inside its body, dialog owns the rest", () => {
    expect(hit(stack, 260, 220)).toEqual(target("button1"));
    expect(hit(stack, 450, 350)).toEqual(target("dialog1"));
  });

  it("flips when the button is sent behind the dialog", () => {
    const flipped = project([button, dialog]);
    expect(hit(flipped, 260, 220)).toEqual(target("dialog1"));
  });

  it("container interiors pass through but borders select", () => {
    const container = element("container1", "container", 100, 100, 500, 300);
    const withButton = project([container, button]);
    expect(hit(withButton, 260, 220)).toEqual(target("button1"));
    expect(hit(withButton, 450, 350)).toEqual({ kind: "none" });
    expect(hit(withButton, 103, 300)).toEqual(target("container1"));
  });

  it("two overlapping buttons: front wins and reversing the order flips it", () => {
    const back = element("buttonA", "button", 100, 100, 200, 80);
    const front = element("buttonB", "button", 150, 120, 200, 80);
    expect(hit(project([back, front]), 200, 150)).toEqual(target("buttonB"));
    expect(hit(project([front, back]), 200, 150)).toEqual(target("buttonA"));
  });

  it("selects the same target whatever was selected before the gesture", () => {
    expect(hit(stack, 260, 220, "id_dialog1")).toEqual(target("button1"));
    expect(hit(stack, 260, 220, "id_button1")).toEqual(target("button1"));
  });
});

describe("handles, locking and visibility", () => {
  const button = element("button1", "button", 200, 200, 120, 40);
  const proj = project([button]);

  it("handles of the selected element beat its own body", () => {
    const result = hit(proj, 320, 220, "id_button1");
    expect(result.kind).toBe("handle");
    expect(result).toMatchObject({ edge: "right" });
  });

  it("handles are only active for the selection and use a screen-pixel tolerance", () => {
    expect(hit(proj, 320, 220)).toEqual(target("button1")); // nothing selected → body
    const zoomedOut = createTransform(0.25, 0, 0);
    // At 25 % zoom the button is 30×10 CSS px: the tolerance adapts (~3.5 px) so the body stays
    // draggable, but a point right on the edge handle is still a handle.
    expect(hitTestProject({ x: 320, y: 220 }, proj, zoomedOut, { selectedId: "id_button1" }).kind).toBe(
      "handle"
    );
    expect(hitTestProject({ x: 260, y: 220 }, proj, zoomedOut, { selectedId: "id_button1" }).kind).toBe(
      "element"
    );
  });

  it("skips locked and hidden elements", () => {
    const locked = project([{ ...button, locked: true }]);
    expect(hit(locked, 260, 220)).toEqual({ kind: "none" });
    const hidden = project([{ ...button, visible: false }]);
    expect(hit(hidden, 260, 220)).toEqual({ kind: "none" });
  });

  it("respects layer visibility and locking", () => {
    const hiddenLayer = project([button]);
    hiddenLayer.layers[0].visible = false;
    expect(hit(hiddenLayer, 260, 220)).toEqual({ kind: "none" });

    const lockedLayer = project([button]);
    lockedLayer.layers[0].locked = true;
    expect(hit(lockedLayer, 260, 220)).toEqual({ kind: "none" });
  });

  it("geometry exposes bounds, semantic regions and eight handles", () => {
    const geometry = elementGeometry(button, transform);
    expect(geometry.bounds).toEqual({ x: 200, y: 200, width: 120, height: 40 });
    expect(geometry.hitRegions).toHaveLength(1);
    expect(geometry.resizeHandles).toHaveLength(8);
    expect(geometry.resizeHandles.map((handle) => handle.edge)).toEqual([
      "top-left",
      "top",
      "top-right",
      "right",
      "bottom-right",
      "bottom",
      "bottom-left",
      "left"
    ]);
  });

  it("narrows handles for elements that are thin on screen instead of swallowing their body", () => {
    // A Divider is 8 logical px tall: at 100 % only its two end handles remain usable, so the
    // middle of the line stays draggable.
    const divider = element("divider1", "divider", 100, 100, 320, 8);
    const dividerProject = project([divider]);
    const geometry = elementGeometry(divider, transform);
    expect(geometry.resizeHandles.map((handle) => handle.edge)).toEqual(["left", "right"]);
    expect(hit(dividerProject, 260, 104, "id_divider1")).toEqual(target("divider1"));
    expect(hitTestProject({ x: 100, y: 104 }, dividerProject, transform, { selectedId: "id_divider1" }).kind).toBe(
      "handle"
    );

    // A small button keeps left/right handles until zoom makes the whole set meaningful.
    const small = elementGeometry(button, createTransform(0.25, 0, 0));
    expect(small.resizeHandles.map((handle) => handle.edge)).toEqual(["left", "right"]);
    // Zoomed in, every handle is offered again.
    const zoomedIn = elementGeometry(button, createTransform(1, 0, 0));
    expect(zoomedIn.resizeHandles).toHaveLength(8);
  });

  it("renders geometry in the same order the layers panel shows", () => {
    const back = element("back", "button", 0, 0, 50, 50);
    const front = element("front", "button", 0, 0, 50, 50);
    const proj = project([back, front]);
    const geometries = visibleGeometries(proj, transform);
    expect(geometries.map((geometry) => geometry.elementId)).toEqual(["id_back", "id_front"]);
    expect(hit(proj, 25, 25)).toEqual(target("front"));
  });
});
