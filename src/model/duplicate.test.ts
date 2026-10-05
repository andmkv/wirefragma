import { describe, expect, it } from "vitest";
import {
  PROJECT_VERSION,
  createLayer,
  duplicateElement,
  duplicateElements,
  findElement,
  type WireframeElement,
  type WireframeProject
} from "./project";

const LAYER_A = "layer_a";
const LAYER_B = "layer_b";

function element(
  id: string,
  x: number,
  y: number,
  layerId: string,
  extra: Partial<WireframeElement> = {}
): WireframeElement {
  return {
    id,
    type: "button",
    name: id,
    label: "Button",
    note: "",
    x,
    y,
    width: 120,
    height: 40,
    layerId,
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

function project(elements: WireframeElement[]): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Duplicate",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [createLayer("Front", { id: LAYER_A }), createLayer("Back", { id: LAYER_B })],
    elements: elements.map((candidate, index) => ({ ...candidate, zIndex: index }))
  };
}

describe("duplicateElements", () => {
  it("duplicates a single element with an offset and a unique name", () => {
    const doc = project([element("a", 100, 100, LAYER_A)]);
    const { project: next, newIds } = duplicateElements(doc, ["a"]);

    expect(newIds).toHaveLength(1);
    const copy = findElement(next, newIds[0])!;
    expect(copy.id).not.toBe("a");
    expect(copy.x).toBe(116);
    expect(copy.y).toBe(116);
    expect(copy.name).not.toBe("a");
    expect(next.elements).toHaveLength(2);
  });

  it("duplicates a whole set, keeping relative layout, layers, styles and content", () => {
    const doc = project([
      element("a", 100, 100, LAYER_A, {
        type: "text",
        label: "Headline",
        textStyle: { fontSize: 24, bold: true, align: "center" },
        note: "a note"
      }),
      element("b", 260, 180, LAYER_A),
      element("c", 400, 300, LAYER_B, { type: "icon", label: "🚀", contentSize: 64 })
    ]);

    const { project: next, newIds } = duplicateElements(doc, ["a", "b", "c"]);
    expect(newIds).toHaveLength(3);

    const [copyA, copyB, copyC] = newIds.map((id) => findElement(next, id)!);
    expect([copyA.x, copyA.y]).toEqual([116, 116]);
    expect(copyB.x - copyA.x).toBe(160);
    expect(copyB.y - copyA.y).toBe(80);
    expect(copyC.x - copyB.x).toBe(140);
    expect(copyC.y - copyB.y).toBe(120);

    expect(copyA.layerId).toBe(LAYER_A);
    expect(copyC.layerId).toBe(LAYER_B);
    expect(copyA.textStyle).toEqual({ fontSize: 24, bold: true, align: "center" });
    expect(copyA.note).toBe("a note");
    expect(copyC.label).toBe("🚀");
    expect(copyC.contentSize).toBe(64);
  });

  it("keeps the copies inside the source layer and above their originals", () => {
    const doc = project([element("a", 0, 0, LAYER_A), element("b", 100, 0, LAYER_A)]);
    const { project: next, newIds } = duplicateElements(doc, ["a", "b"]);
    const names = next.elements.map((candidate) => candidate.id);
    expect(names.indexOf(newIds[0])).toBe(names.indexOf("a") + 1);
    expect(names.indexOf(newIds[1])).toBe(names.indexOf("b") + 1);
    expect(next.elements.filter((candidate) => candidate.layerId === LAYER_A)).toHaveLength(4);
  });

  it("does not duplicate the layer itself", () => {
    const doc = project([element("a", 0, 0, LAYER_A)]);
    const { project: next } = duplicateElements(doc, ["a"]);
    expect(next.layers).toHaveLength(doc.layers.length);
  });

  it("ignores ids that are not in the document", () => {
    const doc = project([element("a", 0, 0, LAYER_A)]);
    const { project: next, newIds } = duplicateElements(doc, ["nope"]);
    expect(newIds).toEqual([]);
    expect(next).toBe(doc);
  });

  it("gives every copy a distinct, collision-free name", () => {
    const doc = project([element("a", 0, 0, LAYER_A), element("aCopy", 50, 0, LAYER_A)]);
    const { project: next, newIds } = duplicateElements(doc, ["a"]);
    const names = next.elements.map((candidate) => candidate.name);
    expect(findElement(next, newIds[0])!.name).not.toBe("aCopy");
    expect(new Set(names).size).toBe(names.length);
  });

  it("deep-copies a chart, so the copy never aliases the source", () => {
    const chart: WireframeElement["chart"] = {
      kind: "bar",
      title: "Sessions",
      categories: ["Jan"],
      series: [{ name: "Sessions", values: [120] }],
      options: { legend: true }
    };
    const doc = project([element("chart1", 10, 10, LAYER_A, { type: "chart", chart })]);
    const { project: next, newId } = duplicateElement(doc, "chart1");
    const copy = findElement(next, newId)!;

    expect(copy.chart).toEqual(chart);
    expect(copy.chart).not.toBe(chart);
    expect(copy.chart!.series).not.toBe(chart!.series);
    expect(copy.chart!.categories).not.toBe(chart!.categories);

    copy.chart!.categories.push("Feb");
    copy.chart!.series[0].values.push(999);
    copy.chart!.options!.legend = false;
    expect(chart!.categories).toEqual(["Jan"]);
    expect(chart!.series[0].values).toEqual([120]);
    expect(chart!.options!.legend).toBe(true);
  });

  it("duplicateElement still works for the Layers row action", () => {
    const doc = project([element("a", 10, 10, LAYER_B)]);
    const { project: next, newId } = duplicateElement(doc, "a");
    const copy = findElement(next, newId)!;
    expect(copy.layerId).toBe(LAYER_B);
    expect([copy.x, copy.y]).toEqual([26, 26]);
  });
});
