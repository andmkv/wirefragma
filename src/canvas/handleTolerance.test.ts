import { describe, expect, it } from "vitest";
import { HANDLE_HIT_COARSE_PX, HANDLE_HIT_PX, handleHitTolerancePx } from "./geometry";
import { hitTestProject } from "./hitTest";
import { createTransform } from "./transform";
import { PROJECT_VERSION, createLayer, type WireframeProject } from "../model/project";

/**
 * D3: a coarse (finger / stylus) pointer gets a larger handle grab tolerance, but it stays the
 * SAME hit test, the same handle set and the same zoom-independent screen-pixel rule.
 */
describe("handle grab tolerance (fine vs coarse pointer)", () => {
  it("keeps the fine tolerance for a mouse and grows it for a finger", () => {
    expect(HANDLE_HIT_COARSE_PX).toBeGreaterThan(HANDLE_HIT_PX);
    expect(handleHitTolerancePx(400, 300, false)).toBe(HANDLE_HIT_PX);
    expect(handleHitTolerancePx(400, 300, true)).toBe(HANDLE_HIT_COARSE_PX);
  });

  it("never swallows more than the element's smaller axis", () => {
    for (const coarse of [false, true]) {
      expect(handleHitTolerancePx(6, 6, coarse)).toBeLessThanOrEqual(6);
      expect(handleHitTolerancePx(10, 200, coarse)).toBeGreaterThanOrEqual(2);
      expect(handleHitTolerancePx(1, 1, coarse)).toBe(2);
    }
  });

  it("stays expressed in screen pixels, so it shrinks in world units as you zoom in", () => {
    const tiny = handleHitTolerancePx(1000, 800, true);
    for (const scale of [0.25, 0.5, 1, 2, 4]) {
      // The world tolerance is the screen tolerance divided by the scale (see hitTest.ts).
      expect(tiny / scale).toBeCloseTo(HANDLE_HIT_COARSE_PX / scale, 6);
    }
  });
});

function project(): WireframeProject {
  const layer = createLayer("Default", { id: "l1" });
  return {
    version: PROJECT_VERSION,
    title: "Handles",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [layer],
    elements: [
      {
        id: "el_box",
        type: "button",
        name: "box",
        label: "Box",
        note: "",
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        layerId: layer.id,
        visible: true,
        locked: false,
        zIndex: 0
      }
    ]
  };
}

const options = { handleElementId: "el_box" };

describe("hitTestProject with a coarse pointer", () => {
  // The grab point sits 15 px to the LEFT of the element's bottom-right corner handle centre, so
  // it is still inside the element body: outside the fine tolerance (11 px), inside the coarse
  // one (20 px). Distance is measured in screen pixels at every zoom.
  const OFFSET_SCREEN_PX = 15;

  for (const scale of [0.25, 0.5, 1, 2, 4]) {
    it(`hits the handle at ${scale}× only for a coarse pointer`, () => {
      const transform = createTransform(scale, 0, 0);
      const corner = { x: 300, y: 200 };
      const world = { x: corner.x - OFFSET_SCREEN_PX / scale, y: corner.y };

      const fine = hitTestProject(world, project(), transform, { ...options, coarsePointer: false });
      const coarse = hitTestProject(world, project(), transform, { ...options, coarsePointer: true });

      // Which handle wins is still the existing "nearest handle inside the tolerance" rule: at a
      // low zoom the world tolerance is large enough to reach several of them.
      expect(coarse.kind).toBe("handle");
      expect(coarse).toMatchObject({ elementId: "el_box" });
      // The same point with a fine pointer misses the handle and selects the element body, which
      // proves the tolerance is the screen-pixel rule and not a second hit test.
      expect(fine).toEqual({ kind: "element", elementId: "el_box" });
    });
  }

  it("defaults to the fine tolerance when the flag is absent", () => {
    const transform = createTransform(1, 0, 0);
    const world = { x: 300 - OFFSET_SCREEN_PX, y: 200 };
    expect(hitTestProject(world, project(), transform, options).kind).toBe("element");
  });

  it("does not change how the element body itself is hit", () => {
    const transform = createTransform(1, 0, 0);
    const centre = { x: 200, y: 150 };
    expect(hitTestProject(centre, project(), transform, { ...options, coarsePointer: true })).toEqual({
      kind: "element",
      elementId: "el_box"
    });
  });
});
