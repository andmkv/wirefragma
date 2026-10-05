import { describe, expect, it } from "vitest";
import { anchorScrollFor, panScroll, pinchScale, touchCentroid, touchDistance } from "./pan";

describe("panScroll", () => {
  it("moves the viewport against the drag so the content follows the pointer", () => {
    // Dragging the canvas 30 px right shows content further left, i.e. less scroll.
    expect(panScroll({ left: 200, top: 120 }, { dx: 30, dy: -20 })).toEqual({ left: 170, top: 140 });
  });

  it("accumulates incremental deltas and is a no-op for a zero delta", () => {
    let scroll = { left: 0, top: 0 };
    for (const step of [10, 10, -5]) {
      scroll = panScroll(scroll, { dx: step, dy: step });
    }
    expect(scroll).toEqual({ left: -15, top: -15 });
    expect(panScroll({ left: 7, top: 9 }, { dx: 0, dy: 0 })).toEqual({ left: 7, top: 9 });
  });

  it("stays correct when the browser clamps the scroll at the content edge", () => {
    // Starting from the *previous* offset (instead of the gesture start) is what keeps a clamped
    // gesture in sync: the caller re-reads scrollLeft/scrollTop on every move.
    const clamped = { left: 0, top: 0 };
    expect(panScroll(clamped, { dx: 40, dy: 40 })).toEqual({ left: -40, top: -40 });
  });
});

describe("pinchScale", () => {
  it("scales proportionally to the finger distance", () => {
    expect(pinchScale(1, 100, 200, 0.25, 4)).toBe(2);
    expect(pinchScale(1.5, 200, 100, 0.25, 4)).toBe(0.75);
  });

  it("clamps to the zoom range", () => {
    expect(pinchScale(1, 100, 1000, 0.25, 4)).toBe(4);
    expect(pinchScale(1, 100, 1, 0.25, 4)).toBe(0.25);
  });

  it("keeps the scale when the gesture start distance is degenerate", () => {
    expect(pinchScale(1.25, 0, 400, 0.25, 4)).toBe(1.25);
    expect(pinchScale(1.25, 100, Number.NaN, 0.25, 4)).toBe(1.25);
  });
});

describe("touch geometry", () => {
  it("averages the touch points", () => {
    expect(touchCentroid([])).toEqual({ x: 0, y: 0 });
    expect(touchCentroid([{ x: 10, y: 20 }])).toEqual({ x: 10, y: 20 });
    expect(touchCentroid([{ x: 10, y: 20 }, { x: 30, y: 40 }])).toEqual({ x: 20, y: 30 });
  });

  it("measures the distance between the first two touches", () => {
    expect(touchDistance([{ x: 0, y: 0 }])).toBe(0);
    expect(touchDistance([{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe(5);
  });
});

describe("anchorScrollFor", () => {
  it("puts a content point back under the pointer at the given scale", () => {
    const next = anchorScrollFor({ x: 300, y: 200 }, { x: 10, y: 5 }, 2, 20, 10, { left: 100, top: 50 });
    // The correction is (pointer - content*scale - canvasOrigin), added to the current scroll:
    // (300 - 20 - 20) = +260 on X and (200 - 10 - 10) = +180 on Y.
    expect(next).toEqual({ left: 360, top: 230 });
  });

  it("is an identity when the content point is already anchored", () => {
    // Canvas sitting at the viewport origin, 10 content units in at scale 2 => 20 px.
    expect(anchorScrollFor({ x: 20, y: 20 }, { x: 10, y: 10 }, 2, 0, 0, { left: 0, top: 0 })).toEqual({
      left: 0,
      top: 0
    });
  });

  it("uses exactly the same correction as the wheel/trackpad zoom anchoring", () => {
    // Kept identical on purpose: the pinch must not introduce a second anchoring formula.
    const pointer = { x: 400, y: 300 };
    const content = { x: 50, y: 25 };
    const scale = 1.5;
    const canvasLeft = 60;
    const canvasTop = 40;
    const scroll = { left: 120, top: 80 };
    const expected = {
      left: scroll.left + (pointer.x - content.x * scale - canvasLeft),
      top: scroll.top + (pointer.y - content.y * scale - canvasTop)
    };
    expect(anchorScrollFor(pointer, content, scale, canvasLeft, canvasTop, scroll)).toEqual(expected);
  });
});
