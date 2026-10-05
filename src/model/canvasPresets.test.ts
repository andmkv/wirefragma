import { describe, expect, it } from "vitest";
import {
  CANVAS_DEVICE_PRESETS,
  CANVAS_PRESET_GROUPS,
  findCanvasPreset,
  presetMatchingSize,
  type CanvasPresetGroup
} from "./canvasPresets";
import { CANVAS_PRESETS, flipCanvas } from "./defaults";
import { MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, normalizeProject, type WireframeProject } from "./project";
import { canvasSizeFromDrag, elementsOutsideCanvas } from "./canvasSize";

describe("device preset catalog", () => {
  it("has unique ids and non-empty groups", () => {
    const ids = CANVAS_DEVICE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of CANVAS_PRESET_GROUPS) {
      expect(CANVAS_DEVICE_PRESETS.some((preset) => preset.group === group)).toBe(true);
    }
    expect(CANVAS_PRESET_GROUPS.length).toBe(4);
  });

  it("covers at least the devices the release promised", () => {
    const ids = new Set<string>(CANVAS_DEVICE_PRESETS.map((preset) => preset.id));
    for (const id of [
      "phone-iphone-se",
      "phone-iphone-15",
      "phone-iphone-15-pro-max",
      "phone-android",
      "phone-android-large",
      "tablet-ipad",
      "tablet-ipad-landscape",
      "tablet-ipad-pro-11",
      "desktop-1280x720",
      "desktop-1366x768",
      "desktop-1440x900",
      "desktop-1536x864",
      "desktop-1920x1080",
      "other-a4",
      "other-square",
      "other-16-9",
      "other-4-3"
    ]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("keeps every preset inside the canvas limits", () => {
    for (const preset of CANVAS_DEVICE_PRESETS) {
      expect(preset.width, preset.id).toBeGreaterThanOrEqual(MIN_CANVAS_SIZE);
      expect(preset.height, preset.id).toBeGreaterThanOrEqual(MIN_CANVAS_SIZE);
      expect(preset.width, preset.id).toBeLessThanOrEqual(MAX_CANVAS_SIZE);
      expect(preset.height, preset.id).toBeLessThanOrEqual(MAX_CANVAS_SIZE);
      expect(Number.isInteger(preset.width) && Number.isInteger(preset.height)).toBe(true);
      expect(preset.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("groups every preset into exactly one known group", () => {
    const known = new Set<CanvasPresetGroup>(CANVAS_PRESET_GROUPS);
    for (const preset of CANVAS_DEVICE_PRESETS) expect(known.has(preset.group)).toBe(true);
  });

  it("looks presets up by id and by size, rejecting anything else", () => {
    expect(findCanvasPreset("phone-iphone-15")?.width).toBe(393);
    expect(findCanvasPreset("nope")).toBeNull();
    expect(findCanvasPreset(undefined)).toBeNull();
    expect(findCanvasPreset({ id: "phone-iphone-15" })).toBeNull();
    expect(presetMatchingSize(393, 852)?.id).toBe("phone-iphone-15");
    expect(presetMatchingSize(393, 853)).toBeNull();
  });
});

describe("flipCanvas", () => {
  it("swaps portrait and landscape", () => {
    // 844×390 is exactly the classic mobileLandscape size, so the legacy mode survives the flip.
    expect(flipCanvas({ mode: "mobile", width: 390, height: 844 })).toEqual({
      mode: "mobileLandscape",
      width: 844,
      height: 390
    });
    expect(flipCanvas({ mode: "mobileLandscape", width: 844, height: 390 })).toEqual({
      mode: "mobile",
      width: 390,
      height: 844
    });
  });

  it("prefers a device preset over the classic mode when the size matches one", () => {
    // 1024×768 is both "iPad landscape" and "4:3"; the catalog order decides, and the device
    // preset comes first.
    expect(flipCanvas({ mode: "custom", preset: "tablet-ipad", width: 768, height: 1024 })).toEqual({
      mode: "custom",
      preset: "tablet-ipad-landscape",
      width: 1024,
      height: 768
    });
    // A size with no catalog entry becomes a plain custom size (the desktop presets are
    // landscape-only, so flipping one drops the preset identity).
    expect(flipCanvas({ mode: "custom", preset: "desktop-1920x1080", width: 1920, height: 1080 })).toEqual({
      mode: "custom",
      width: 1080,
      height: 1920
    });
  });

  it("falls back to a custom size when neither a preset nor a classic mode matches", () => {
    expect(flipCanvas({ mode: "desktop", width: 1200, height: 800 })).toEqual({
      mode: "custom",
      width: 800,
      height: 1200
    });
  });

  it("falls back to a plain custom size for a phone without a landscape twin", () => {
    expect(flipCanvas({ mode: "custom", preset: "phone-iphone-se", width: 375, height: 667 })).toEqual({
      mode: "custom",
      width: 667,
      height: 375
    });
  });

  it("is its own inverse for every preset", () => {
    for (const preset of CANVAS_DEVICE_PRESETS) {
      const flipped = flipCanvas({ mode: "custom", preset: preset.id, width: preset.width, height: preset.height });
      const back = flipCanvas(flipped);
      expect({ width: back.width, height: back.height }, preset.id).toEqual({
        width: preset.width,
        height: preset.height
      });
    }
  });

  it("keeps the classic modes reachable", () => {
    for (const mode of Object.keys(CANVAS_PRESETS) as (keyof typeof CANVAS_PRESETS)[]) {
      const size = CANVAS_PRESETS[mode];
      const flipped = flipCanvas({ mode, ...size });
      expect(flipped.width).toBe(size.height);
      expect(flipped.height).toBe(size.width);
    }
  });
});

describe("canvas preset normalization", () => {
  function raw(preset: unknown, width = 393, height = 852, mode = "custom"): unknown {
    return {
      version: 2,
      title: "Preset",
      canvas: { mode, width, height, preset },
      layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
      elements: []
    };
  }

  it("keeps a known preset that matches the stored size", () => {
    const project = normalizeProject(raw("phone-iphone-15"));
    expect(project.canvas).toEqual({ mode: "custom", width: 393, height: 852, preset: "phone-iphone-15" });
  });

  it("drops an unknown preset id", () => {
    const project = normalizeProject(raw("phone-nokia-3310"));
    expect(project.canvas.preset).toBeUndefined();
    expect(project.canvas).toEqual({ mode: "custom", width: 393, height: 852 });
  });

  it("drops a preset whose dimensions disagree with the stored size", () => {
    const project = normalizeProject(raw("phone-iphone-15", 400, 900));
    expect(project.canvas.preset).toBeUndefined();
  });

  it("drops a non-string preset", () => {
    expect(normalizeProject(raw(42)).canvas.preset).toBeUndefined();
    expect(normalizeProject(raw({ id: "phone-iphone-15" })).canvas.preset).toBeUndefined();
  });

  it("survives a JSON round trip", () => {
    const project = normalizeProject(raw("tablet-ipad", 768, 1024));
    const restored = normalizeProject(JSON.parse(JSON.stringify(project)));
    expect(restored.canvas).toEqual(project.canvas);
  });

  it("does not invent a preset for an old document", () => {
    const legacy: WireframeProject = {
      version: 2,
      title: "Old",
      canvas: { mode: "desktop", width: 1200, height: 800 },
      layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
      elements: []
    };
    expect(normalizeProject(JSON.parse(JSON.stringify(legacy))).canvas.preset).toBeUndefined();
  });
});

describe("canvasSizeFromDrag", () => {
  const options = { snap: false, gridSize: 8, min: MIN_CANVAS_SIZE, max: MAX_CANVAS_SIZE };

  it("moves only the dragged edges", () => {
    expect(canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: 40, dy: 25 }, "right", options)).toEqual({
      width: 1040,
      height: 600
    });
    expect(canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: 40, dy: 25 }, "bottom", options)).toEqual({
      width: 1000,
      height: 625
    });
    expect(
      canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: 40, dy: 25 }, "bottom-right", options)
    ).toEqual({ width: 1040, height: 625 });
  });

  it("snaps the dragged edge to the grid when Snap is on", () => {
    const snapped = { ...options, snap: true };
    expect(canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: 13, dy: 13 }, "bottom-right", snapped)).toEqual({
      width: 1016,
      height: 616
    });
    // Rounding, not flooring: a negative delta snaps to the nearest grid line too.
    expect(canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: -9, dy: -9 }, "bottom-right", snapped)).toEqual({
      width: 992,
      height: 592
    });
  });

  it("rounds to whole units when Snap is off", () => {
    expect(
      canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: 0.6, dy: -0.4 }, "bottom-right", options)
    ).toEqual({ width: 1001, height: 600 });
  });

  it("clamps to the canvas limits", () => {
    expect(canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: -5000, dy: -5000 }, "bottom-right", options)).toEqual({
      width: MIN_CANVAS_SIZE,
      height: MIN_CANVAS_SIZE
    });
    expect(canvasSizeFromDrag({ width: 1000, height: 600 }, { dx: 99999, dy: 99999 }, "bottom-right", options)).toEqual({
      width: MAX_CANVAS_SIZE,
      height: MAX_CANVAS_SIZE
    });
  });
});

describe("elementsOutsideCanvas", () => {
  const element = (x: number, y: number, width = 100, height = 40) => ({ x, y, width, height });

  it("counts only elements that do not touch the canvas at all", () => {
    const elements = [
      element(10, 10),        // inside
      element(-50, 10),       // hangs over the left edge, still partly visible
      element(1000, 10),      // starts exactly at the right edge -> outside
      element(10, 600),       // starts exactly at the bottom edge -> outside
      element(-100, 10),      // ends exactly at the left edge -> outside
      element(10, -40),       // ends exactly at the top edge -> outside
      element(5000, 5000)     // far away
    ];
    expect(elementsOutsideCanvas(elements, 1000, 600)).toBe(5);
  });

  it("is zero for an empty document and larger canvas", () => {
    expect(elementsOutsideCanvas([], 1000, 600)).toBe(0);
    expect(elementsOutsideCanvas([element(10, 10)], 5000, 5000)).toBe(0);
  });
});
