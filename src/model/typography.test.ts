import { describe, expect, it } from "vitest";
import {
  DEFAULT_ICON_CONTENT_SIZE,
  DEFAULT_IMAGE_CONTENT_SIZE,
  DEFAULT_TEXT_STYLE,
  MAX_CONTENT_SIZE,
  MAX_FONT_SIZE,
  MIN_CONTENT_SIZE,
  MIN_FONT_SIZE,
  PROJECT_VERSION,
  contentSizeOf,
  mergeTextStyle,
  normalizeProject,
  textStyleOf,
  type WireframeElement,
  type WireframeProject
} from "./project";

function base(extra: Partial<WireframeElement> = {}): WireframeElement {
  return {
    id: "el_1",
    type: "text",
    name: "heading",
    label: "Heading",
    note: "",
    x: 10,
    y: 10,
    width: 200,
    height: 30,
    layerId: "l1",
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
}

function document(elements: WireframeElement[]): WireframeProject {
  return {
    version: PROJECT_VERSION,
    title: "Typography",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
    elements
  };
}

describe("textStyleOf", () => {
  it("returns the documented defaults for an element with no style", () => {
    expect(textStyleOf(base())).toEqual({
      fontSize: 16,
      bold: false,
      italic: false,
      underline: false,
      align: "left"
    });
    expect(DEFAULT_TEXT_STYLE.fontSize).toBe(16);
  });

  it("reads a fully specified style", () => {
    const styled = base({
      textStyle: { fontSize: 24, bold: true, italic: true, underline: true, align: "center" }
    });
    expect(textStyleOf(styled)).toEqual({
      fontSize: 24,
      bold: true,
      italic: true,
      underline: true,
      align: "center"
    });
  });

  it("treats explicit false as not set", () => {
    const style = textStyleOf(base({ textStyle: { bold: false, italic: false } }));
    expect(style.bold).toBe(false);
    expect(style.italic).toBe(false);
  });

  it("clamps the font size into the supported range", () => {
    expect(textStyleOf(base({ textStyle: { fontSize: 500 } })).fontSize).toBe(MAX_FONT_SIZE);
    expect(textStyleOf(base({ textStyle: { fontSize: 1 } })).fontSize).toBe(MIN_FONT_SIZE);
    expect(MIN_FONT_SIZE).toBe(8);
    expect(MAX_FONT_SIZE).toBe(96);
  });

  it("falls back to left for an unknown alignment", () => {
    const style = textStyleOf(base({ textStyle: { align: "justify" as never } }));
    expect(style.align).toBe("left");
  });
});

describe("contentSizeOf", () => {
  it("uses a per-type default", () => {
    expect(contentSizeOf(base({ type: "icon" }))).toBe(DEFAULT_ICON_CONTENT_SIZE);
    expect(contentSizeOf(base({ type: "image" }))).toBe(DEFAULT_IMAGE_CONTENT_SIZE);
    expect(DEFAULT_ICON_CONTENT_SIZE).toBe(24);
    expect(DEFAULT_IMAGE_CONTENT_SIZE).toBe(48);
  });

  it("reads and clamps an explicit content size", () => {
    expect(contentSizeOf(base({ type: "icon", contentSize: 48 }))).toBe(48);
    expect(contentSizeOf(base({ type: "image", contentSize: 72 }))).toBe(72);
    expect(contentSizeOf(base({ type: "icon", contentSize: 4000 }))).toBe(MAX_CONTENT_SIZE);
    expect(contentSizeOf(base({ type: "icon", contentSize: 0 }))).toBe(MIN_CONTENT_SIZE);
  });
});

describe("mergeTextStyle", () => {
  it("writes only what differs from the defaults", () => {
    expect(mergeTextStyle(base(), { fontSize: 24 })).toEqual({ fontSize: 24 });
    expect(mergeTextStyle(base(), { bold: true, align: "center" })).toEqual({ bold: true, align: "center" });
    expect(mergeTextStyle(base(), {})).toBeUndefined();
  });

  it("keeps previously set attributes when one of them changes", () => {
    const styled = base({ textStyle: { fontSize: 24, bold: true } });
    expect(mergeTextStyle(styled, { italic: true })).toEqual({ fontSize: 24, bold: true, italic: true });
  });

  it("removes an attribute that is switched back to its default", () => {
    const styled = base({ textStyle: { fontSize: 24, bold: true } });
    expect(mergeTextStyle(styled, { bold: false })).toEqual({ fontSize: 24 });
    // Switching off the last non-default attribute clears the field entirely.
    expect(mergeTextStyle(base({ textStyle: { bold: true } }), { bold: false })).toBeUndefined();
  });

  it("stores a non-default alignment but never the default one", () => {
    expect(mergeTextStyle(base(), { align: "right" })).toEqual({ align: "right" });
    expect(mergeTextStyle(base({ textStyle: { align: "right" } }), { align: "left" })).toBeUndefined();
  });
});

describe("project normalization of the optional style fields", () => {
  it("keeps an old project working: no textStyle, no contentSize", () => {
    const legacy = document([
      { ...base(), textStyle: undefined, contentSize: undefined },
      { ...base({ id: "el_2", type: "icon", label: "★" }) }
    ]);
    const normalized = normalizeProject(JSON.parse(JSON.stringify(legacy)));

    expect(normalized.elements[0].textStyle).toBeUndefined();
    expect(normalized.elements[1].contentSize).toBeUndefined();
    // …and the helpers still answer with the defaults.
    expect(textStyleOf(normalized.elements[0]).fontSize).toBe(16);
    expect(contentSizeOf(normalized.elements[1])).toBe(24);
  });

  it("round-trips a full style through JSON", () => {
    const doc = document([
      base({
        textStyle: { fontSize: 24, bold: true, italic: true, underline: true, align: "right" },
        contentSize: 40
      })
    ]);
    const restored = normalizeProject(JSON.parse(JSON.stringify(doc)));
    expect(restored.elements[0].textStyle).toEqual({
      fontSize: 24,
      bold: true,
      italic: true,
      underline: true,
      align: "right"
    });
    expect(restored.elements[0].contentSize).toBe(40);
  });

  it("drops empty or invalid styles instead of storing junk", () => {
    const doc = document([
      base({ id: "a", textStyle: {} }),
      base({ id: "b", textStyle: { fontSize: Number.NaN } }),
      base({ id: "c", textStyle: { align: "middle" as never } }),
      base({ id: "d", contentSize: Number.NaN })
    ]);
    const restored = normalizeProject(JSON.parse(JSON.stringify(doc)));
    expect(restored.elements.map((element) => element.textStyle)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined
    ]);
    expect(restored.elements[3].contentSize).toBeUndefined();
  });

  it("clamps imported values instead of rejecting the project", () => {
    const doc = document([
      base({ textStyle: { fontSize: 400, align: "center" }, contentSize: 9999 })
    ]);
    const restored = normalizeProject(JSON.parse(JSON.stringify(doc)));
    expect(restored.elements[0].textStyle).toEqual({ fontSize: MAX_FONT_SIZE, align: "center" });
    expect(restored.elements[0].contentSize).toBe(MAX_CONTENT_SIZE);
  });
});
