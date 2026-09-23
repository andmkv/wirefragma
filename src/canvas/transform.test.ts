import { describe, expect, it } from "vitest";
import {
  createTransform,
  deviceMatrix,
  rectContains,
  rectsIntersect,
  screenPxToWorld,
  screenToWorld,
  worldRectToScreen,
  worldToScreen,
  type Rect
} from "./transform";
import { clampZoom, fitScale } from "../utils/zoom";

describe("world <-> screen transform", () => {
  it("round-trips at every zoom level and DPR", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 112, y: 400 },
      { x: 558.5, y: 282.1 },
      { x: 1200, y: 800 }
    ];
    for (const scale of [0.25, 0.3, 0.5, 1, 1.5, 2, 4]) {
      for (const dpr of [1, 2]) {
        const transform = createTransform(scale, 0, 0);
        for (const point of points) {
          const screen = worldToScreen(transform, point.x, point.y);
          const back = screenToWorld(transform, screen.x, screen.y);
          expect(back.x).toBeCloseTo(point.x, 6);
          expect(back.y).toBeCloseTo(point.y, 6);
        }
        // DPR only affects the device matrix, never the logical conversion.
        const matrix = deviceMatrix(transform, dpr);
        expect(matrix[0]).toBeCloseTo(scale * dpr, 6);
        expect(matrix[3]).toBeCloseTo(scale * dpr, 6);
        expect(matrix[4]).toBeCloseTo(0, 6);
        expect(matrix[5]).toBeCloseTo(0, 6);
      }
    }
  });

  it("honours the transform origin", () => {
    const transform = createTransform(2, 40, 24);
    const screen = worldToScreen(transform, 10, 5);
    expect(screen).toEqual({ x: 60, y: 34 });
    expect(screenToWorld(transform, 60, 34)).toEqual({ x: 10, y: 5 });
  });

  it("converts rects and screen tolerances", () => {
    const transform = createTransform(0.5, 0, 0);
    const rect: Rect = { x: 100, y: 200, width: 400, height: 100 };
    expect(worldRectToScreen(transform, rect)).toEqual({ x: 50, y: 100, width: 200, height: 50 });
    expect(screenPxToWorld(transform, 11)).toBeCloseTo(22, 6);
  });

  it("keeps fit/manual zoom inside the documented range", () => {
    const viewport = { width: 900, height: 700 };
    const canvas = { width: 1200, height: 800 };
    const fit = fitScale(viewport, canvas);
    expect(fit).toBeGreaterThan(0.25);
    expect(fit).toBeLessThanOrEqual(1);
    expect(clampZoom(fit)).toBe(fit);
  });

  it("tests rect containment and intersection", () => {
    const a: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectContains(a, 5, 5)).toBe(true);
    expect(rectContains(a, 11, 5)).toBe(false);
    expect(rectsIntersect(a, { x: 9, y: 9, width: 5, height: 5 })).toBe(true);
    expect(rectsIntersect(a, { x: 11, y: 11, width: 5, height: 5 })).toBe(false);
  });
});
