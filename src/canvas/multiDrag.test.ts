import { describe, expect, it } from "vitest";
import { moveSelectionFromSnapshot, rectFromPoints, type MoveStart } from "./interaction";
import type { Rect } from "./transform";

const snapOn = { snapEnabled: true, gridSize: 8 };
const snapOff = { snapEnabled: false, gridSize: 8 };

function start(elementId: string, x: number, y: number, width = 100, height = 40): MoveStart {
  return { elementId, bounds: { x, y, width, height } };
}

describe("moveSelectionFromSnapshot", () => {
  it("returns nothing for an empty snapshot", () => {
    expect(moveSelectionFromSnapshot([], "a", { x: 10, y: 10 }, snapOn)).toEqual([]);
  });

  it("snaps the primary element and gives every other member the same delta", () => {
    const starts = [start("a", 100, 100), start("b", 260, 180), start("c", 400, 300)];
    const moved = moveSelectionFromSnapshot(starts, "b", { x: 37, y: 21 }, snapOn);

    // b: 260+37 = 297 → 296 and 180+21 = 201 → 200 on the 8 px grid, so the gesture delta is +36/+20.
    expect(moved).toEqual([
      { elementId: "a", bounds: { x: 136, y: 120, width: 100, height: 40 } },
      { elementId: "b", bounds: { x: 296, y: 200, width: 100, height: 40 } },
      { elementId: "c", bounds: { x: 436, y: 320, width: 100, height: 40 } }
    ]);
  });

  it("preserves the relative layout exactly", () => {
    const starts = [start("a", 100, 100), start("b", 260, 180)];
    const moved = moveSelectionFromSnapshot(starts, "a", { x: 200, y: -50 }, snapOn);
    expect(moved[1].bounds.x - moved[0].bounds.x).toBe(160);
    expect(moved[1].bounds.y - moved[0].bounds.y).toBe(80);
  });

  it("falls back to the first snapshot entry when the primary is not part of it", () => {
    const starts = [start("a", 100, 100), start("b", 260, 180)];
    const moved = moveSelectionFromSnapshot(starts, "zzz", { x: 8, y: 8 }, snapOn);
    // 100+8 = 108 lands exactly between grid lines and snaps up to 112, so the delta is +12.
    expect(moved[0].bounds.x).toBe(112);
    expect(moved[1].bounds.x).toBe(272);
  });

  it("never accumulates: the same snapshot and delta give the same result", () => {
    const starts = [start("a", 100, 100), start("b", 260, 180)];
    const first = moveSelectionFromSnapshot(starts, "a", { x: 24, y: 24 }, snapOn);
    const second = moveSelectionFromSnapshot(starts, "a", { x: 24, y: 24 }, snapOn);
    expect(first).toEqual(second);
  });

  it("keeps integer positions when snapping is off", () => {
    const starts = [start("a", 100, 100), start("b", 105, 133)];
    const moved = moveSelectionFromSnapshot(starts, "a", { x: 12.4, y: -3.6 }, snapOff);
    expect(moved[0].bounds).toEqual({ x: 112, y: 96, width: 100, height: 40 });
    expect(moved[1].bounds).toEqual({ x: 117, y: 129, width: 100, height: 40 });
  });

  it("leaves size untouched on every member", () => {
    const starts = [start("a", 0, 0, 10, 20), start("b", 50, 50, 300, 90)];
    const moved = moveSelectionFromSnapshot(starts, "a", { x: 16, y: 16 }, snapOn);
    expect(moved.map((entry) => [entry.bounds.width, entry.bounds.height])).toEqual([
      [10, 20],
      [300, 90]
    ]);
  });
});

describe("rectFromPoints", () => {
  it("normalises any drag direction", () => {
    const expected: Rect = { x: 10, y: 20, width: 90, height: 60 };
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 100, y: 80 })).toEqual(expected);
    expect(rectFromPoints({ x: 100, y: 80 }, { x: 10, y: 20 })).toEqual(expected);
    expect(rectFromPoints({ x: 100, y: 20 }, { x: 10, y: 80 })).toEqual(expected);
    expect(rectFromPoints({ x: 10, y: 80 }, { x: 100, y: 20 })).toEqual(expected);
  });

  it("produces an empty rectangle for a click", () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, width: 0, height: 0 });
  });
});
