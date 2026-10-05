import { describe, expect, it } from "vitest";
import { createBlankProject, createElement } from "../model/defaults";
import { reindexLayers } from "../model/project";
import { createTransform } from "./transform";
import { renderScene } from "./render";

/** A recording 2D context: tracks translate/save/restore so clip rects can be placed in world space. */
function recordingCanvas() {
  const stack: { x: number; y: number }[] = [];
  let offset = { x: 0, y: 0 };
  const clips: { x: number; y: number; width: number; height: number }[] = [];
  const target: Record<string, unknown> = {
    save: () => void stack.push({ ...offset }),
    restore: () => void (offset = stack.pop() ?? { x: 0, y: 0 }),
    translate: (x: number, y: number) => void (offset = { x: offset.x + x, y: offset.y + y }),
    setTransform: () => void (offset = { x: 0, y: 0 }),
    rect: (x: number, y: number, width: number, height: number) =>
      void clips.push({ x: x + offset.x, y: y + offset.y, width, height }),
    measureText: (text: string) => ({ width: text.length * 6 })
  };
  const ctx = new Proxy(target, {
    get: (object, key: string) => object[key] ?? (() => undefined),
    set: () => true
  });
  const canvas = { width: 1200, height: 800, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, clips };
}

describe("chart element rendering", () => {
  it("paints inside the element's own bounds, not at the canvas origin", () => {
    const base = createBlankProject();
    const chart = { ...createElement("chart", base, { x: 424, y: 280 }), x: 424, y: 280 };
    const project = reindexLayers({ ...base, elements: [chart] });
    const { canvas, clips } = recordingCanvas();
    renderScene(canvas, {
      project,
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
    // drawChartScene clips to the chart box; that clip must sit on the element.
    const clip = clips.find((rect) => Math.abs(rect.width - (chart.width - 1)) < 0.01);
    expect(clip).toBeDefined();
    expect(clip!.x).toBeGreaterThanOrEqual(424);
    expect(clip!.y).toBeGreaterThanOrEqual(280);
    expect(clip!.x + clip!.width).toBeLessThanOrEqual(424 + chart.width);
    expect(clip!.y + clip!.height).toBeLessThanOrEqual(280 + chart.height);
  });
});
