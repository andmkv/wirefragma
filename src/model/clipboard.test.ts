import { describe, expect, it } from "vitest";
import {
  PROJECT_VERSION,
  createLayer,
  findElement,
  type WireframeElement,
  type WireframeProject
} from "./project";
import { CLIPBOARD_OFFSET, copySelection, pasteClipboard } from "./clipboard";

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
    title: "Clipboard",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [createLayer("Front", { id: LAYER_A }), createLayer("Back", { id: LAYER_B })],
    elements: elements.map((candidate, index) => ({ ...candidate, zIndex: index }))
  };
}

const PASTE = { pasteIndex: 1, activeLayerId: LAYER_A };

describe("copy / paste through the internal clipboard", () => {
  it("copies nothing when the selection is empty or unknown", () => {
    const doc = project([element("a", 10, 10, LAYER_A)]);
    expect(copySelection(doc, [])).toBeNull();
    expect(copySelection(doc, ["missing"])).toBeNull();
  });

  it("pastes one object with a new id, a unique name and a cascade offset", () => {
    const doc = project([element("a", 100, 100, LAYER_A)]);
    const payload = copySelection(doc, ["a"]);
    expect(payload).not.toBeNull();

    const { project: next, newIds } = pasteClipboard(doc, payload!, PASTE);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe("a");
    const copy = findElement(next, newIds[0])!;
    expect(copy.x).toBe(100 + CLIPBOARD_OFFSET);
    expect(copy.y).toBe(100 + CLIPBOARD_OFFSET);
    expect(copy.name).not.toBe("a");
    expect(next.elements).toHaveLength(2);
  });

  it("pastes a multi-selection keeping relative positions", () => {
    const doc = project([
      element("a", 100, 100, LAYER_A),
      element("b", 260, 180, LAYER_A),
      element("c", 400, 300, LAYER_A)
    ]);
    const payload = copySelection(doc, ["a", "b", "c"])!;
    const { project: next, newIds } = pasteClipboard(doc, payload, PASTE);

    expect(newIds).toHaveLength(3);
    const copies = newIds.map((id) => findElement(next, id)!);
    expect(copies[0].x).toBe(100 + CLIPBOARD_OFFSET);
    expect(copies[0].y).toBe(100 + CLIPBOARD_OFFSET);
    expect(copies[1].x - copies[0].x).toBe(160);
    expect(copies[1].y - copies[0].y).toBe(80);
    expect(copies[2].x - copies[1].x).toBe(140);
    expect(copies[2].y - copies[1].y).toBe(120);
  });

  it("cascades further on every repeated paste instead of stacking copies", () => {
    const doc = project([element("a", 40, 40, LAYER_A)]);
    const payload = copySelection(doc, ["a"])!;
    const first = pasteClipboard(doc, payload, { pasteIndex: 1, activeLayerId: LAYER_A });
    const second = pasteClipboard(first.project, payload, { pasteIndex: 2, activeLayerId: LAYER_A });
    const third = pasteClipboard(second.project, payload, { pasteIndex: 3, activeLayerId: LAYER_A });

    const positions = [...first.newIds, ...second.newIds, ...third.newIds].map((id) => {
      const found = findElement(third.project, id)!;
      return [found.x, found.y];
    });
    expect(positions).toEqual([
      [56, 56],
      [72, 72],
      [88, 88]
    ]);
    expect(new Set(positions.map(String)).size).toBe(3);
  });

  it("preserves layer, style, content and emoji through a paste", () => {
    const doc = project([
      element("icon1", 10, 10, LAYER_B, {
        type: "icon",
        label: "🚀",
        contentSize: 48,
        textStyle: { fontSize: 24, bold: true, italic: true, underline: true, align: "center" },
        items: ["one", "two"],
        note: "keeps its note"
      })
    ]);
    const payload = copySelection(doc, ["icon1"])!;
    const { project: next, newIds } = pasteClipboard(doc, payload, PASTE);
    const copy = findElement(next, newIds[0])!;

    expect(copy.type).toBe("icon");
    expect(copy.label).toBe("🚀");
    expect(copy.contentSize).toBe(48);
    expect(copy.textStyle).toEqual({
      fontSize: 24,
      bold: true,
      italic: true,
      underline: true,
      align: "center"
    });
    expect(copy.items).toEqual(["one", "two"]);
    expect(copy.note).toBe("keeps its note");
    // The source layer still exists, so the copy stays in it.
    expect(copy.layerId).toBe(LAYER_B);
  });

  it("falls back to the active layer when the source layer is gone", () => {
    const doc = project([element("a", 0, 0, LAYER_B)]);
    const payload = copySelection(doc, ["a"])!;
    const withoutB: WireframeProject = { ...doc, layers: doc.layers.filter((layer) => layer.id !== LAYER_B) };
    const { project: next, newIds } = pasteClipboard(withoutB, payload, PASTE);
    expect(findElement(next, newIds[0])!.layerId).toBe(LAYER_A);
  });

  it("does not mutate the source project or the payload", () => {
    const doc = project([element("a", 100, 100, LAYER_A)]);
    const snapshot = JSON.stringify(doc);
    const payload = copySelection(doc, ["a"])!;
    const payloadSnapshot = JSON.stringify(payload);

    const { project: next } = pasteClipboard(doc, payload, PASTE);
    // The original element is untouched and the clipboard payload is reusable.
    expect(next.elements[0]).toEqual(doc.elements[0]);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(JSON.stringify(payload)).toBe(payloadSnapshot);
  });
});
