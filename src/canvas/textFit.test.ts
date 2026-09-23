import { describe, expect, it } from "vitest";
import { createLayer, type WireframeProject } from "../model/project";
import { fitText, renderScene, splitGraphemes } from "./render";
import { createTransform } from "./transform";

/**
 * Regression: `fitText` used to slice the label by UTF-16 code unit, so clipping an emoji left a
 * lone surrogate that every browser renders as U+FFFD ("�…" instead of "…").
 */

const hasSegmenter = typeof (Intl as unknown as { Segmenter?: unknown }).Segmenter === "function";

/** Per-cluster width model: a fixed px per cluster, or a function for mixed-width tests. */
type ClusterWidth = number | ((cluster: string) => number);

function measuringCtx(width: ClusterWidth) {
  const widthOf = typeof width === "function" ? width : () => width;
  const filled: string[] = [];
  const ctx = {
    font: "",
    measureText: (text: string) => ({
      width: splitGraphemes(text).reduce((total, cluster) => total + widthOf(cluster), 0)
    }),
    fillText: (text: string) => {
      filled.push(text);
    },
    setTransform() {},
    clearRect() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    rect() {},
    roundRect() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    setLineDash() {},
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    textAlign: "left",
    textBaseline: "alphabetic",
    lineCap: "butt",
    lineJoin: "miter"
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, filled };
}

/** A string is well-formed when it contains no unpaired surrogate code unit. */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe("fitText", () => {
  it("returns the text unchanged when it fits, and nothing for a zero width", () => {
    const { ctx } = measuringCtx(10);
    expect(fitText(ctx, "Save", 100)).toBe("Save");
    expect(fitText(ctx, "Save", 0)).toBe("");
    expect(fitText(ctx, "Save", -5)).toBe("");
  });

  it("still truncates long ASCII labels with an ellipsis", () => {
    const { ctx } = measuringCtx(10);
    const result = fitText(ctx, "Notifications", 40);
    expect(result.endsWith("…")).toBe(true);
    expect(result.length).toBeLessThan("Notifications".length);
    expect(ctx.measureText(result).width).toBeLessThanOrEqual(40);
  });

  it("never leaves a lone surrogate when an emoji is clipped", () => {
    const { ctx } = measuringCtx(20);
    // "🚀" is one grapheme cluster = 20 px, so nothing but the ellipsis fits in 15 px.
    for (const maxWidth of [1, 5, 15, 19]) {
      const result = fitText(ctx, "🚀", maxWidth);
      expect(hasLoneSurrogate(result)).toBe(false);
      expect(result).toBe("…");
    }
    // Wide enough for the symbol: it is returned untouched.
    expect(fitText(ctx, "🚀", 20)).toBe("🚀");
  });

  it("keeps the whole label when it fits and clips whole clusters only", () => {
    // Symbols are 20 px, the ellipsis 5 px: "🚀🚀🚀" (60) must lose exactly one cluster.
    const { ctx } = measuringCtx((cluster) => (cluster === "…" ? 5 : 20));
    const result = fitText(ctx, "🚀🚀🚀", 45);
    expect(hasLoneSurrogate(result)).toBe(false);
    // 2 clusters + ellipsis = 45 px, which fits; the untouched input measures 60 px.
    expect(result).toBe("🚀🚀…");
    expect(splitGraphemes(result).every((cluster) => cluster === "🚀" || cluster === "…")).toBe(true);
  });

  it("never cuts a combining mark away from its base character", () => {
    const { ctx } = measuringCtx(10);
    const combining = "e\u0301e\u0301e\u0301"; // é é é as base + combining acute
    const result = fitText(ctx, combining, 25);
    expect(result.endsWith("…")).toBe(true);
    // A trailing combining mark would mean the cluster was cut in half.
    expect(/[\u0300-\u036f]$/.test(result)).toBe(false);
    // With grapheme segmentation the dropped unit is a whole base+mark cluster.
    if (hasSegmenter) expect(result).toBe("e\u0301…");
  });

  it.skipIf(!hasSegmenter)("never splits a ZWJ sequence or a regional-indicator flag", () => {
    const { ctx } = measuringCtx(20);
    // Both are single grapheme clusters for Intl.Segmenter, but several code points long.
    expect(splitGraphemes("👨‍👩‍👧")).toEqual(["👨‍👩‍👧"]);
    expect(splitGraphemes("🇸🇮")).toEqual(["🇸🇮"]);
    expect(fitText(ctx, "👨‍👩‍👧", 15)).toBe("…");
    expect(fitText(ctx, "🇸🇮", 15)).toBe("…");
    expect(hasLoneSurrogate(fitText(ctx, "🇸🇮", 15))).toBe(false);
  });

  it("produces a result that fits (or is the bare ellipsis)", () => {
    const { ctx } = measuringCtx(13);
    for (const text of ["Hello world", "🚀 Launch", "🇸🇮 Slovenija", "👨‍👩‍👧 Family"]) {
      for (let maxWidth = 0; maxWidth <= 130; maxWidth += 7) {
        const result = fitText(ctx, text, maxWidth);
        expect(hasLoneSurrogate(result)).toBe(false);
        if (maxWidth >= ctx.measureText("…").width) {
          expect(ctx.measureText(result).width).toBeLessThanOrEqual(maxWidth);
        }
      }
    }
  });
});

describe("icon and image symbols are drawn whole", () => {
  function projectWithSymbol(type: "icon" | "image", label: string, contentSize: number): WireframeProject {
    const layer = createLayer("Default", { id: "l1" });
    return {
      version: 2,
      title: "symbols",
      canvas: { mode: "desktop", width: 1200, height: 800 },
      layers: [layer],
      elements: [
        {
          id: `el_${type}`,
          type,
          name: `${type}1`,
          label,
          note: "",
          x: 0,
          y: 0,
          width: 32,
          height: 32,
          layerId: layer.id,
          visible: true,
          locked: false,
          zIndex: 0,
          contentSize
        }
      ]
    };
  }

  function drawSymbol(type: "icon" | "image", label: string, contentSize: number) {
    const { ctx, filled } = measuringCtx(20);
    renderScene({ width: 1200, height: 800, getContext: () => ctx } as unknown as HTMLCanvasElement, {
      project: projectWithSymbol(type, label, contentSize),
      transform: createTransform(1, 0, 0),
      dpr: 1,
      showGrid: false,
      gridSize: 8,
      selectedIds: [],
      primarySelectedId: null,
      preview: null,
      marquee: null,
      activeEdge: null
    });
    return filled;
  }

  it("paints the emoji itself even when contentSize is wider than the element", () => {
    // 48 px symbol in a 32 px wide icon is exactly the case that used to paint a lone surrogate.
    expect(drawSymbol("icon", "🚀", 48)).toContain("🚀");
    expect(drawSymbol("image", "🐱", 72)).toContain("🐱");
  });

  it("never paints a mangled symbol for an image placeholder label", () => {
    for (const text of drawSymbol("icon", "🚀", 48)) {
      expect(hasLoneSurrogate(text)).toBe(false);
      expect(text.includes("�")).toBe(false);
    }
  });
});
