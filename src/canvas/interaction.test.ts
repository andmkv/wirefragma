import { describe, expect, it } from "vitest";
import { moveBounds, resizeBounds, snapValue } from "./interaction";
import type { Rect } from "./transform";

const start: Rect = { x: 200, y: 200, width: 120, height: 40 };
const options = { snapEnabled: true, gridSize: 8, minSize: 8 };

describe("drag maths", () => {
  it("moves from the snapshot with snapping in world units", () => {
    const moved = moveBounds(start, { x: 37, y: -13 }, options);
    // 200+37 → 240, 200-13 → 184; width/height untouched.
    expect(moved).toEqual({ x: 240, y: 184, width: 120, height: 40 });
  });

  it("lands the element on the grid even when it started off-grid", () => {
    const offGrid: Rect = { x: 340, y: 340, width: 120, height: 40 };
    expect(moveBounds(offGrid, { x: 40, y: 40 }, options)).toEqual({
      x: 384,
      y: 384,
      width: 120,
      height: 40
    });
  });

  it("keeps sub-pixel precision when snapping is off", () => {
    const moved = moveBounds(start, { x: 37.4, y: -12.6 }, { snapEnabled: false, gridSize: 8 });
    expect(moved.x).toBe(237);
    expect(moved.y).toBe(187);
  });

  it("never accumulates a delta: two moves from the same snapshot give the same result", () => {
    const first = moveBounds(start, { x: 40, y: 40 }, options);
    const second = moveBounds(start, { x: 40, y: 40 }, options);
    expect(first).toEqual(second);
  });

  it("snaps values to the grid", () => {
    expect(snapValue(11, true, 8)).toBe(8);
    expect(snapValue(13, true, 8)).toBe(16);
    expect(snapValue(11.4, false, 8)).toBe(11);
  });
});

describe("resize maths", () => {
  it("moves only the dragged edge", () => {
    expect(resizeBounds("right", start, { x: 400, y: 999 }, options)).toEqual({
      x: 200,
      y: 200,
      width: 200,
      height: 40
    });
    expect(resizeBounds("bottom", start, { x: 999, y: 300 }, options)).toEqual({
      x: 200,
      y: 200,
      width: 120,
      height: 104
    });
  });

  it("preserves the opposite edge for every single edge", () => {
    const right = resizeBounds("right", start, { x: 400, y: 220 }, options);
    expect(right.x).toBe(200);
    const left = resizeBounds("left", start, { x: 100, y: 220 }, options);
    expect(left.x + left.width).toBe(320);
    const bottom = resizeBounds("bottom", start, { x: 260, y: 300 }, options);
    expect(bottom.y).toBe(200);
    const top = resizeBounds("top", start, { x: 260, y: 100 }, options);
    expect(top.y + top.height).toBe(240);
  });

  it("resizes corners on both axes", () => {
    // 300 snaps to 304 on the grid; 400 is already aligned.
    const corner = resizeBounds("bottom-right", start, { x: 400, y: 300 }, options);
    expect(corner).toEqual({ x: 200, y: 200, width: 200, height: 104 });
    const topLeft = resizeBounds("top-left", start, { x: 100, y: 100 }, options);
    expect(topLeft).toEqual({ x: 104, y: 104, width: 216, height: 136 });
  });

  it("snaps only the moved edges", () => {
    const right = resizeBounds("right", start, { x: 397, y: 220 }, options);
    expect(right.x).toBe(200); // untouched edge stays exactly where it was
    expect(right.width).toBe(200); // 197 snapped up to 200
  });

  it("enforces the minimum size from either side", () => {
    const collapsedRight = resizeBounds("right", start, { x: 200, y: 220 }, options);
    expect(collapsedRight.width).toBe(8);
    expect(collapsedRight.x).toBe(200);
    const collapsedLeft = resizeBounds("left", start, { x: 400, y: 220 }, options);
    expect(collapsedLeft.width).toBe(8);
    expect(collapsedLeft.x).toBe(312);
  });

  it("handles resize without snapping", () => {
    const result = resizeBounds("right", start, { x: 397.5, y: 220 }, {
      snapEnabled: false,
      gridSize: 8,
      minSize: 8
    });
    expect(result.width).toBe(198);
  });
});
