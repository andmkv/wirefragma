import { describe, expect, it } from "vitest";
import {
  CONTAINER_BORDER_HIT_PX,
  hitRectsFor,
  hitsAt,
  pointHitsElement,
  topmostHit
} from "./hitAreas";
import type { ElementType, WireframeElement } from "./project";

function element(
  id: string,
  type: ElementType,
  box: { x: number; y: number; width: number; height: number },
  extra: Partial<WireframeElement> = {}
): WireframeElement {
  return {
    id,
    type,
    name: id,
    label: "",
    note: "",
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    layerId: "l1",
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

const SCALE = 1;

describe("semantic hit areas", () => {
  it("does not cover the empty interior of a container", () => {
    const container = element("containerOne", "container", { x: 100, y: 100, width: 600, height: 400 });
    const rects = hitRectsFor(container, SCALE);

    // Middle of the container: passes through to whatever is behind.
    expect(hitsAt(rects, 300, 300)).toBe(false);
    expect(pointHitsElement(container, SCALE, 400, 250)).toBe(false);
    // Just inside the top border: still selectable.
    expect(pointHitsElement(container, SCALE, 400, 102)).toBe(true);
    // Just inside the left border.
    expect(pointHitsElement(container, SCALE, 102, 300)).toBe(true);
    // Well outside.
    expect(pointHitsElement(container, SCALE, 40, 300)).toBe(false);
  });

  it("keeps a forgiving border band at every zoom level", () => {
    const container = element("c", "container", { x: 0, y: 0, width: 600, height: 400 });
    for (const scale of [0.25, 1, 2, 4]) {
      expect(hitsAt(hitRectsFor(container, scale), 300, 400)).toBe(true);
      const band = (CONTAINER_BORDER_HIT_PX / scale) * 0.5;
      expect(hitsAt(hitRectsFor(container, scale), 300, 400 - band)).toBe(true);
      expect(hitsAt(hitRectsFor(container, scale), 300, 400 - band * 3)).toBe(false);
    }
  });

  it("makes a labelled container selectable through its label", () => {
    const container = element("c", "container", { x: 0, y: 0, width: 600, height: 400 }, { label: "Settings" });
    const rects = hitRectsFor(container, SCALE);
    expect(hitsAt(rects, 30, 10)).toBe(true);
    expect(hitsAt(rects, 300, 200)).toBe(false);
  });

  it("uses a thin band for a divider instead of its bounding box", () => {
    const divider = element("d", "divider", { x: 100, y: 300, width: 400, height: 8 });
    expect(pointHitsElement(divider, SCALE, 300, 304)).toBe(true);
    expect(pointHitsElement(divider, SCALE, 300, 270)).toBe(false);
  });

  it("keeps full-bounds selection for controls and content", () => {
    const button = element("b", "button", { x: 10, y: 10, width: 120, height: 40 });
    expect(pointHitsElement(button, SCALE, 70, 30)).toBe(true);

    const text = element("t", "text", { x: 0, y: 0, width: 200, height: 30 });
    expect(pointHitsElement(text, SCALE, 100, 15)).toBe(true);

    const list = element("l", "list", { x: 0, y: 0, width: 300, height: 200 });
    expect(pointHitsElement(list, SCALE, 150, 100)).toBe(true);
  });
});

describe("overlapping elements", () => {
  const container = element("containerOne", "container", { x: 100, y: 100, width: 600, height: 400 });
  const button = element("saveButton", "button", { x: 200, y: 200, width: 140, height: 40 }, { zIndex: 1 });
  const toggle = element("notificationsToggle", "toggle", { x: 200, y: 280, width: 200, height: 30 }, {
    zIndex: 2
  });
  const text = element("heading", "text", { x: 200, y: 150, width: 220, height: 24 }, { zIndex: 3 });
  const drawOrder = [container, button, toggle, text];

  it("selects controls inside a container instead of the container", () => {
    expect(topmostHit(drawOrder, SCALE, 260, 220)?.id).toBe("saveButton");
    expect(topmostHit(drawOrder, SCALE, 260, 295)?.id).toBe("notificationsToggle");
    expect(topmostHit(drawOrder, SCALE, 260, 162)?.id).toBe("heading");
  });

  it("selects the container from its border", () => {
    expect(topmostHit(drawOrder, SCALE, 400, 101)?.id).toBe("containerOne");
    expect(topmostHit(drawOrder, SCALE, 101, 300)?.id).toBe("containerOne");
  });

  it("selects nothing in an empty container interior", () => {
    expect(topmostHit(drawOrder, SCALE, 500, 400)).toBeNull();
  });

  it("gives the front-most element the click when two controls overlap", () => {
    const back = element("backButton", "button", { x: 100, y: 100, width: 200, height: 80 });
    const front = element("frontButton", "button", { x: 150, y: 120, width: 200, height: 80 });
    expect(topmostHit([back, front], SCALE, 200, 150)?.id).toBe("frontButton");
    // Reversing the draw order (sending `front` to the back) flips the result.
    expect(topmostHit([front, back], SCALE, 200, 150)?.id).toBe("backButton");
  });

  it("skips locked and hidden elements", () => {
    const locked = { ...button, locked: true };
    const selectable = (candidate: WireframeElement) => !candidate.locked && candidate.visible;
    expect(topmostHit([container, locked], SCALE, 260, 220, selectable)).toBeNull();
    expect(topmostHit([container, locked], SCALE, 260, 220, (candidate) => candidate.locked)?.id).toBe(
      "saveButton"
    );
    expect(
      topmostHit([container, { ...button, visible: false }], SCALE, 260, 220, selectable)
    ).toBeNull();
  });
});
