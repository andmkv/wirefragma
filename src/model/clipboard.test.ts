import { describe, expect, it } from "vitest";
import {
  PROJECT_VERSION,
  createLayer,
  findElement,
  type WireframeElement,
  type WireframeProject
} from "./project";
import { CLIPBOARD_OFFSET, copySelection, pasteClipboard } from "./clipboard";
import {
  CLIPBOARD_STORAGE_KEY,
  MAX_CLIPBOARD_ELEMENTS,
  createClipboardStore,
  parseClipboardPayload
} from "./clipboardStore";
import type { StorageLike } from "../utils/storage";

class MemoryStorage implements StorageLike {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

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

  it("deep-copies a chart through copy and paste", () => {
    const chart: WireframeElement["chart"] = {
      kind: "stackedBar",
      title: "Totals",
      categories: ["A", "B"],
      series: [{ name: "S", values: [1, null] }]
    };
    const doc = project([element("chart1", 100, 100, LAYER_A, { type: "chart", chart })]);
    const payload = copySelection(doc, ["chart1"])!;
    expect(payload.elements[0].chart).not.toBe(chart);
    expect(payload.elements[0].chart!.series).not.toBe(chart!.series);

    const { project: next, newIds } = pasteClipboard(doc, payload, PASTE);
    const copy = findElement(next, newIds[0])!;
    expect(copy.chart).toEqual(chart);

    copy.chart!.categories[0] = "changed";
    copy.chart!.series[0].values[0] = 42;
    expect(chart!.categories[0]).toBe("A");
    expect(chart!.series[0].values[0]).toBe(1);
    expect(doc.elements[0].chart!.categories[0]).toBe("A");
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

/* ------------------------------------------------------------------ *
 * Cross-wireframe clipboard store (1.2)
 * ------------------------------------------------------------------ */

describe("clipboard payload validation", () => {
  it("accepts a payload produced by copySelection", () => {
    const doc = project([element("a", 10, 10, LAYER_A)]);
    const payload = copySelection(doc, ["a"])!;
    const parsed = parseClipboardPayload(JSON.parse(JSON.stringify(payload)));
    expect(parsed).not.toBeNull();
    expect(parsed!.elements).toHaveLength(1);
    expect(parsed!.elements[0].id).toBe("a");
    expect(parsed!.layerNames).toEqual({ [LAYER_A]: "Front" });
  });

  it("rejects anything that is not a usable payload", () => {
    const good = copySelection(project([element("a", 0, 0, LAYER_A)]), ["a"])!;
    expect(parseClipboardPayload(null)).toBeNull();
    expect(parseClipboardPayload("nope")).toBeNull();
    expect(parseClipboardPayload([])).toBeNull();
    expect(parseClipboardPayload({})).toBeNull();
    expect(parseClipboardPayload({ elements: [] })).toBeNull();
    expect(parseClipboardPayload({ elements: "nope" })).toBeNull();
    // Unknown element type.
    expect(parseClipboardPayload({ elements: [{ ...good.elements[0], type: "spaceship" }] })).toBeNull();
    // Missing geometry.
    const { x, ...noX } = good.elements[0];
    expect(x).toBe(0);
    expect(parseClipboardPayload({ elements: [noX] })).toBeNull();
    // Non-finite / degenerate geometry.
    expect(parseClipboardPayload({ elements: [{ ...good.elements[0], width: 0 }] })).toBeNull();
    expect(parseClipboardPayload({ elements: [{ ...good.elements[0], y: Number.NaN }] })).toBeNull();
    // Too many elements.
    const many = Array.from({ length: MAX_CLIPBOARD_ELEMENTS + 1 }, (_, index) => ({
      ...good.elements[0],
      id: `e${index}`
    }));
    expect(parseClipboardPayload({ elements: many })).toBeNull();
  });

  it("drops unusable layer names instead of failing the whole payload", () => {
    const payload = copySelection(project([element("a", 0, 0, LAYER_A)]), ["a"])!;
    const parsed = parseClipboardPayload({ ...payload, layerNames: { [LAYER_A]: 42 } });
    expect(parsed!.layerNames).toBeUndefined();
  });

  it("repairs a payload that lacks the optional fields", () => {
    const minimal = {
      elements: [
        {
          id: "x",
          type: "button",
          name: "x",
          label: "",
          note: "",
          x: 1,
          y: 2,
          width: 10,
          height: 10,
          layerId: "l1"
        }
      ]
    };
    const parsed = parseClipboardPayload(minimal)!;
    expect(parsed.elements[0].visible).toBe(true);
    expect(parsed.elements[0].locked).toBe(false);
    expect(parsed.elements[0].zIndex).toBe(0);
  });
});

describe("clipboard store", () => {
  it("keeps the payload in memory when there is no storage at all", () => {
    const store = createClipboardStore(null);
    expect(store.get()).toBeNull();
    const payload = copySelection(project([element("a", 0, 0, LAYER_A)]), ["a"])!;
    store.set(payload);
    expect(store.get()!.elements[0].id).toBe("a");
  });

  it("gives every copy its own token, so the paste cascade restarts", () => {
    const store = createClipboardStore(null);
    const payload = copySelection(project([element("a", 0, 0, LAYER_A)]), ["a"])!;
    store.set(payload);
    const first = store.get()!.token;
    store.set(payload);
    expect(store.get()!.token).not.toBe(first);
  });

  it("survives a remount through localStorage and is stable while unchanged", () => {
    const storage = new MemoryStorage();
    const editor1 = createClipboardStore(storage);
    const payload = copySelection(project([element("a", 5, 6, LAYER_A)]), ["a"])!;
    editor1.set(payload);
    expect(storage.getItem(CLIPBOARD_STORAGE_KEY)).not.toBeNull();

    // A second editor (another wireframe, or another tab) reads the same payload back.
    const editor2 = createClipboardStore(storage);
    const restored = editor2.get()!;
    expect(restored.elements[0].id).toBe("a");
    expect(restored.elements[0].x).toBe(5);
    expect(restored.layerNames).toEqual({ [LAYER_A]: "Front" });
    // The token is derived from the stored bytes, so it does not change between reads.
    expect(editor2.get()!.token).toBe(restored.token);
  });

  it("clears memory and storage when the payload is set to null", () => {
    const storage = new MemoryStorage();
    const store = createClipboardStore(storage);
    store.set(copySelection(project([element("a", 0, 0, LAYER_A)]), ["a"])!);
    store.set(null);
    expect(store.get()).toBeNull();
    expect(storage.getItem(CLIPBOARD_STORAGE_KEY)).toBeNull();
  });

  it("ignores unreadable or hostile stored data", () => {
    const storage = new MemoryStorage();
    storage.setItem(CLIPBOARD_STORAGE_KEY, "{not json");
    expect(createClipboardStore(storage).get()).toBeNull();

    storage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ elements: [{ type: "nope" }] }));
    expect(createClipboardStore(storage).get()).toBeNull();

    storage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ elements: [] }));
    expect(createClipboardStore(storage).get()).toBeNull();
  });

  it("keeps a huge payload in memory but does not mirror it into storage", () => {
    const storage = new MemoryStorage();
    const store = createClipboardStore(storage);
    const big = copySelection(
      project([
        element("a", 0, 0, LAYER_A, {
          note: "x".repeat(80 * 1024)
        })
      ]),
      ["a"]
    )!;
    store.set(big);
    expect(store.get()!.elements[0].note.length).toBe(80 * 1024);
    expect(storage.getItem(CLIPBOARD_STORAGE_KEY)).toBeNull();
  });

  it("copies the payload instead of aliasing the caller's array", () => {
    const store = createClipboardStore(null);
    const payload = copySelection(project([element("a", 0, 0, LAYER_A)]), ["a"])!;
    store.set(payload);
    payload.elements[0].x = 9999;
    expect(store.get()!.elements[0].x).toBe(0);
  });
});

describe("pasting a payload copied in another wireframe", () => {
  function otherProject(): WireframeProject {
    return {
      version: PROJECT_VERSION,
      title: "Other",
      canvas: { mode: "desktop", width: 1200, height: 800 },
      layers: [createLayer("Front", { id: "other_front" }), createLayer("Back", { id: "other_back" })],
      elements: []
    };
  }

  it("matches a missing layer by name, not by id", () => {
    const source = project([element("a", 10, 10, LAYER_B)]);
    const payload = copySelection(source, ["a"])!;
    const target = otherProject();
    const { project: next, newIds } = pasteClipboard(target, payload, {
      pasteIndex: 1,
      activeLayerId: "other_front"
    });
    // LAYER_B ("Back") does not exist, but a layer named "Back" does.
    expect(findElement(next, newIds[0])!.layerId).toBe("other_back");
  });

  it("falls back to the active layer when neither the id nor the name matches", () => {
    const source = project([element("a", 10, 10, LAYER_B)]);
    const payload = copySelection(source, ["a"])!;
    const target = otherProject();
    target.layers = [createLayer("Only", { id: "solo" }), createLayer("Other", { id: "solo2" })];
    const { project: next, newIds } = pasteClipboard(target, payload, {
      pasteIndex: 1,
      activeLayerId: "solo2"
    });
    expect(findElement(next, newIds[0])!.layerId).toBe("solo2");
    expect(next.layers).toHaveLength(2);
  });

  it("keeps names unique in the target document", () => {
    const source = project([element("a", 10, 10, LAYER_A)]);
    const payload = copySelection(source, ["a"])!;
    const target: WireframeProject = {
      ...otherProject(),
      layers: [createLayer("Front", { id: LAYER_A })],
      elements: [element("existing", 0, 0, LAYER_A)]
    };
    const { project: next, newIds } = pasteClipboard(target, payload, {
      pasteIndex: 1,
      activeLayerId: LAYER_A
    });
    const names = next.elements.map((candidate) => candidate.name);
    expect(new Set(names).size).toBe(names.length);
    expect(findElement(next, newIds[0])!.name).not.toBe("a");
  });

  it("drops parent links that do not exist in the target document", () => {
    const parent = element("parent", 0, 0, LAYER_A);
    const child = element("child", 5, 5, LAYER_A, { parentId: "parent" });
    const source = project([parent, child]);
    const payload = copySelection(source, ["child"])!;
    const target: WireframeProject = {
      ...otherProject(),
      layers: [createLayer("Front", { id: LAYER_A })]
    };
    const { project: next, newIds } = pasteClipboard(target, payload, {
      pasteIndex: 1,
      activeLayerId: LAYER_A
    });
    expect(findElement(next, newIds[0])!.parentId).toBeUndefined();
  });
});

describe("a chart survives the localStorage mirror", () => {
  it("keeps the chart dataset when the payload is read back by another tab", () => {
    const storage = new MemoryStorage();
    const chart: WireframeElement["chart"] = {
      kind: "line",
      title: "Visits",
      categories: ["Mon", "Tue"],
      series: [{ name: "Web", values: [3, 7] }]
    };
    const doc = project([element("chart1", 10, 10, LAYER_A, { type: "chart", chart })]);
    createClipboardStore(storage).set(copySelection(doc, ["chart1"]));
    // A second store instance reads only from storage, like a fresh tab or a reload.
    const restored = createClipboardStore(storage).get();
    expect(restored?.elements[0].chart).toEqual(chart);
  });
});
