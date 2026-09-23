import { describe, expect, it } from "vitest";
import { hitTestProject } from "../canvas/hitTest";
import { createTransform } from "../canvas/transform";
import type { ElementType, WireframeElement } from "./project";
import { PROJECT_VERSION, type WireframeProject } from "./project";

function element(
  name: string,
  type: ElementType,
  x: number,
  y: number,
  width: number,
  height: number
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
    zIndex: 0
  };
}

/**
 * These tests deliberately go through the SAME canonical hit test the running canvas uses
 * (`hitTestProject`), not a parallel approximation.
 */
const transform = createTransform(1, 0, 0);

function project(elements: WireframeElement[]): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Overlap",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
    elements: elements.map((element, index) => ({ ...element, zIndex: index }))
  };
}

const nameOf = (project: WireframeProject, target: ReturnType<typeof hitTestProject>): string | null => {
  if (target.kind === "none") return null;
  return project.elements.find((element) => element.id === target.elementId)?.name ?? null;
};

const hit = (stack: WireframeElement[], x: number, y: number): string | null => {
  const document = project(stack);
  return nameOf(document, hitTestProject({ x, y }, document, transform));
};

describe("case 1 — dialog with a button inside", () => {
  const dialog = element("dialog1", "dialog", 100, 100, 500, 300);
  const button = element("button1", "button", 200, 200, 120, 40);
  const stack = [dialog, button]; // button in front

  it("resolves the button at the button's centre", () => {
    expect(hit(stack, 260, 220)).toBe("button1");
  });

  it("resolves the dialog in its empty body", () => {
    expect(hit(stack, 450, 350)).toBe("dialog1");
  });

  it("resolves the dialog on its title bar and border", () => {
    expect(hit(stack, 150, 110)).toBe("dialog1");
    expect(hit(stack, 102, 380)).toBe("dialog1");
  });

  it("still resolves the button at other zoom levels", () => {
    const document = project(stack);
    for (const scale of [0.25, 0.5, 1, 2, 4]) {
      const target = hitTestProject({ x: 260, y: 220 }, document, createTransform(scale, 0, 0));
      expect(nameOf(document, target)).toBe("button1");
    }
  });
});

describe("case 2 — container with a button inside", () => {
  const container = element("container1", "container", 100, 100, 500, 300);
  const button = element("button1", "button", 200, 200, 120, 40);
  const stack = [container, button];

  it("resolves the button at the button's centre", () => {
    expect(hit(stack, 260, 220)).toBe("button1");
  });

  it("lets the empty interior pass through instead of selecting the container", () => {
    expect(hit(stack, 450, 350)).toBeNull();
  });

  it("resolves the container on its border", () => {
    expect(hit(stack, 103, 300)).toBe("container1");
    expect(hit(stack, 400, 103)).toBe("container1");
  });
});

describe("case 3 — two overlapping buttons", () => {
  const back = element("buttonA", "button", 100, 100, 200, 80);
  const front = element("buttonB", "button", 150, 120, 200, 80);

  it("gives the overlap to the front button", () => {
    expect(hit([back, front], 200, 150)).toBe("buttonB");
    expect(hit([back, front], 120, 110)).toBe("buttonA"); // outside the front button
  });

  it("flips when the order is reversed", () => {
    expect(hit([front, back], 200, 150)).toBe("buttonA");
  });
});

describe("case 4 — drag target comes from the pointer, not from the selection", () => {
  const dialog = element("dialog1", "dialog", 100, 100, 500, 300);
  const button = element("button1", "button", 200, 200, 120, 40);
  const stack = [dialog, button];

  it("is stable no matter what was selected before the gesture", () => {
    // The hit test takes the pointer position, never the previous selection, which is exactly
    // what the canvas drag gesture uses to resolve its target.
    const document = project(stack);
    const withDialogSelected = hitTestProject({ x: 260, y: 220 }, document, transform, {
      selectedId: dialog.id
    });
    const withButtonSelected = hitTestProject({ x: 260, y: 220 }, document, transform, {
      selectedId: button.id
    });
    expect(nameOf(document, withDialogSelected)).toBe("button1");
    expect(nameOf(document, withButtonSelected)).toBe("button1");
    expect(withButtonSelected).toMatchObject({ elementId: button.id });
    expect(withDialogSelected).not.toMatchObject({ elementId: dialog.id });
  });

  it("skips locked or hidden elements so clicks fall through", () => {
    expect(hit([dialog, { ...button, locked: true }], 260, 220)).toBe("dialog1");
    expect(hit([dialog, { ...button, visible: false }], 260, 220)).toBe("dialog1");
  });
});
