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
  /**
   * `content` is the grabbed point in **world units** (the same units as `element.x/y`), what the
   * callers store as `(pointer - canvasLeft) / scale` at grab time. Moving the canvas to
   * `pointer - content * scale` is a scroll delta of `canvasLeft - (pointer - content * scale)`.
   */
  it("leaves the scroll alone when the content point is already anchored", () => {
    // Canvas at client 20, scrolled to 100; a point 140 world units in, at scale 2, is 280 px wide
    // and already sits under the pointer at client 300.
    const next = anchorScrollFor({ x: 300, y: 200 }, { x: 140, y: 95 }, 2, 20, 10, { left: 100, top: 50 });
    expect(next).toEqual({ left: 100, top: 50 });
  });

  it("scrolls forward when the scale doubles, keeping the grabbed point under the pointer", () => {
    // Canvas at 0 with scroll 0: the grabbed point is 300 world units in, so at scale 2 it is
    // 600 px wide and the canvas has to move to 300 - 600 = -300, i.e. scroll +300.
    const next = anchorScrollFor({ x: 300, y: 0 }, { x: 300, y: 0 }, 2, 0, 0, { left: 0, top: 0 });
    expect(next).toEqual({ left: 300, top: 0 });
  });

  it("follows a pure pan by exactly the pointer delta", () => {
    const first = anchorScrollFor({ x: 200, y: 100 }, { x: 100, y: 100 }, 1, 0, 0, { left: 0, top: 0 });
    // The canvas must end up at client 100, which means scrolling to -100 (a browser clamps that
    // to 0, which is why every step re-measures the canvas position instead of accumulating).
    expect(first).toEqual({ left: -100, top: 0 });
    // Dragging 30 px further right moves the canvas to client 130 -> another -30 of scroll.
    const panned = anchorScrollFor({ x: 230, y: 100 }, { x: 100, y: 100 }, 1, 100, 0, first);
    expect(panned.left - first.left).toBe(-30);
  });

  it("is exact over a sequence of pan steps (no accumulation drift)", () => {
    // Container left edge at client 0, so the canvas position is always -scroll.
    let scroll = { left: 500, top: 300 };
    let canvasLeft = -500;
    let canvasTop = -300;
    const content = { x: 600, y: 400 };
    for (let step = 1; step <= 5; step += 1) {
      const pointer = { x: 100 + step * 20, y: 100 + step * 10 };
      const next = anchorScrollFor(pointer, content, 1, canvasLeft, canvasTop, scroll);
      canvasLeft -= next.left - scroll.left;
      canvasTop -= next.top - scroll.top;
      scroll = next;
    }
    // Five steps of +20/+10 px to the right move the scroll by exactly -100/-50.
    expect(scroll).toEqual({ left: 400, top: 250 });
  });
});
