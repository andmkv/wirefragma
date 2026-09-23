import { describe, expect, it } from "vitest";
import { PROJECT_VERSION, type WireframeElement, type WireframeProject } from "../model/project";
import { projectFromMarkdown } from "./markdownImport";
import { projectToMarkdown } from "./markdownExport";

function element(extra: Partial<WireframeElement>): WireframeElement {
  return {
    id: "el_1",
    type: "text",
    name: "heading",
    label: "Heading",
    note: "",
    x: 20,
    y: 20,
    width: 240,
    height: 32,
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
    title: "Semantics",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [{ id: "l1", name: "Default", visible: true, locked: false }],
    elements: elements.map((candidate, index) => ({ ...candidate, zIndex: index }))
  };
}

describe("markdown exports the semantics of the new style fields", () => {
  it("writes a Typography block for non-default text styling", () => {
    const markdown = projectToMarkdown(
      document([
        element({
          textStyle: { fontSize: 24, bold: true, italic: true, underline: true, align: "center" }
        })
      ])
    );
    expect(markdown).toContain("Typography:");
    expect(markdown).toContain("- Size: 24");
    expect(markdown).toContain("- Weight: Bold");
    expect(markdown).toContain("- Style: Italic");
    expect(markdown).toContain("- Style: Underlined");
    expect(markdown).toContain("- Alignment: Center");
  });

  it("writes only the attributes that differ from the defaults", () => {
    const markdown = projectToMarkdown(document([element({ textStyle: { align: "right" } })]));
    expect(markdown).toContain("- Alignment: Right");
    expect(markdown).not.toContain("- Weight: Bold");
    expect(markdown).not.toContain("- Style: Italic");
    expect(markdown).not.toContain("- Size: 16");
  });

  it("adds no Typography block when the typography is default", () => {
    const markdown = projectToMarkdown(document([element({})]));
    expect(markdown).not.toContain("Typography:");
  });

  it("never writes a Typography block for non-text elements", () => {
    const markdown = projectToMarkdown(
      document([
        element({ id: "b1", type: "button", name: "saveButton", label: "Save", textStyle: { bold: true } })
      ])
    );
    expect(markdown).not.toContain("Typography:");
  });

  it("writes a Content size line only when it differs from the type default", () => {
    const markdown = projectToMarkdown(
      document([
        element({ id: "i1", type: "icon", name: "rocketIcon", label: "🚀", contentSize: 48 }),
        element({ id: "i2", type: "image", name: "photo", label: "🐱", contentSize: 72 }),
        element({ id: "i3", type: "icon", name: "defaultIcon", label: "★" })
      ])
    );
    expect(markdown).toContain("Content size: 48px");
    expect(markdown).toContain("Content size: 72px");
    expect(markdown.match(/Content size:/g)).toHaveLength(2);
  });

  it("keeps the emoji label in the human-readable section", () => {
    const markdown = projectToMarkdown(
      document([element({ id: "i1", type: "image", name: "photo", label: "🐱", contentSize: 72 })])
    );
    expect(markdown).toContain("Label: 🐱");
  });

  it("survives a full markdown round trip, typography and emoji content size included", () => {
    const original = document([
      element({
        textStyle: { fontSize: 24, bold: true, italic: true, align: "center" }
      }),
      element({ id: "i1", type: "icon", name: "rocketIcon", label: "🚀", contentSize: 48 }),
      element({ id: "i2", type: "image", name: "photo", label: "🐱", contentSize: 72 })
    ]);
    const restored = projectFromMarkdown(projectToMarkdown(original));
    expect(restored).toEqual(original);
    expect(restored.elements[1].label).toBe("🚀");
    expect(restored.elements[1].contentSize).toBe(48);
    expect(restored.elements[2].contentSize).toBe(72);
  });

  it("does not change the ui-project fence or the project version", () => {
    const markdown = projectToMarkdown(document([element({})]));
    expect(markdown).toContain("```ui-project");
    expect(markdown).toContain('"version": 2');
  });
});
