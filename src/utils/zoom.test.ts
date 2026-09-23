import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_PRESETS,
  clampZoom,
  contentPointAt,
  fitScale,
  formatZoom,
  nearestPreset,
  scaleForMode,
  scrollOffsetToKeepPoint,
  zoomFromWheel,
  zoomStep
} from "./zoom";

describe("zoom math", () => {
  it("clamps to the supported range", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(12)).toBe(MAX_ZOOM);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("fits the desktop canvas into the viewport without magnifying past 100%", () => {
    // 1200×800 canvas in an 800×600 box: limited by width.
    const scale = fitScale({ width: 800, height: 600 }, { width: 1200, height: 800 });
    expect(scale).toBeCloseTo((800 - 56) / 1200, 5);
    expect(fitScale({ width: 4000, height: 3000 }, { width: 1200, height: 800 })).toBe(1);
  });

  it("picks the mode specific scale", () => {
    expect(scaleForMode("fit", 2, 0.6)).toBe(0.6);
    expect(scaleForMode("manual", 2, 0.6)).toBe(2);
    expect(scaleForMode("manual", 99, 0.6)).toBe(MAX_ZOOM);
  });

  it("steps through the presets in both directions", () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1.25, 1)).toBe(1.5);
    expect(zoomStep(1, -1)).toBe(0.75);
    expect(zoomStep(0.25, -1)).toBe(MIN_ZOOM);
    expect(zoomStep(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(zoomStep(0.6, 1)).toBe(0.75);
    expect(zoomStep(0.6, -1)).toBe(0.5);
  });

  it("never leaves the preset ladder out of range", () => {
    for (const preset of ZOOM_PRESETS) {
      expect(clampZoom(preset)).toBe(preset);
    }
  });

  it("zooms exponentially from wheel deltas", () => {
    expect(zoomFromWheel(1, -100)).toBeGreaterThan(1);
    expect(zoomFromWheel(1, 100)).toBeLessThan(1);
    expect(zoomFromWheel(1, 0)).toBe(1);
    expect(zoomFromWheel(3.9, -10000)).toBe(MAX_ZOOM);
    expect(zoomFromWheel(0.3, 10000)).toBe(MIN_ZOOM);
  });

  it("formats percentages", () => {
    expect(formatZoom(1)).toBe("100%");
    expect(formatZoom(0.755)).toBe("76%");
    expect(nearestPreset(1)).toBe(1);
    expect(nearestPreset(0.51)).toBeNull();
  });

  it("keeps the point under the pointer stationary while zooming", () => {
    const scroll = 40;
    const pointer = 120;
    const offset = 20;
    const scale = 0.5;
    const content = contentPointAt(scroll, pointer, scale, offset);
    expect(content).toBeCloseTo((40 + 120 - 20) / 0.5, 6);

    const nextScale = 1;
    const nextScroll = scrollOffsetToKeepPoint(content, pointer, nextScale, offset);
    expect(contentPointAt(nextScroll, pointer, nextScale, offset)).toBeCloseTo(content, 6);
  });

  it("never returns a negative scroll offset", () => {
    expect(scrollOffsetToKeepPoint(0, 400, 1, 20)).toBe(0);
  });
});
