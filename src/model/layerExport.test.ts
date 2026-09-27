import { describe, expect, it } from "vitest";
import { LAYER_EXPORT_PADDING, projectForLayer } from "./layerExport";
import { createLayer, type WireframeElement, type WireframeProject } from "./project";
import { projectFromMarkdown } from "../utils/markdownImport";
import { projectToMarkdown } from "../utils/markdownExport";

function element(id: string, layerId: string, x: number, y: number, visible = true): WireframeElement {
  return {
    id,
    type: "button",
    name: id,
    label: id,
    note: "",
    x,
    y,
    width: 100,
    height: 40,
    layerId,
    visible,
    locked: false,
    zIndex: 0
  };
}

function makeProject(): WireframeProject {
  return {
    version: 2,
    title: "Screen",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [createLayer("Form", { id: "form", visible: false }), createLayer("Page", { id: "page" })],
    elements: [
      element("bg", "page", 0, 0),
      element("email", "form", 400, 300),
      element("submit", "form", 400, 360),
      element("ghost", "form", 1000, 700, false)
    ]
  };
}

describe("projectForLayer", () => {
  it("keeps only the layer's elements and forces the layer visible", () => {
    const scoped = projectForLayer(makeProject(), "form")!;
    expect(scoped.layers).toHaveLength(1);
    expect(scoped.layers[0]).toMatchObject({ id: "form", visible: true });
    expect(scoped.elements.map((item) => item.id)).toEqual(["email", "submit", "ghost"]);
    expect(scoped.elements.map((item) => item.zIndex)).toEqual([0, 1, 2]);
    expect(scoped.title).toBe("Screen — Form");
    expect(scoped.canvas).toEqual({ mode: "desktop", width: 1200, height: 800 });
  });

  it("crops the canvas to the visible content and shifts the elements", () => {
    const scoped = projectForLayer(makeProject(), "form", { crop: true })!;
    expect(scoped.canvas.mode).toBe("custom");
    expect(scoped.canvas.width).toBe(100 + LAYER_EXPORT_PADDING * 2);
    expect(scoped.canvas.height).toBe(100 + LAYER_EXPORT_PADDING * 2);
    const email = scoped.elements.find((item) => item.id === "email")!;
    expect([email.x, email.y]).toEqual([LAYER_EXPORT_PADDING, LAYER_EXPORT_PADDING]);
  });

  it("never produces a canvas below the minimum size", () => {
    const project = makeProject();
    project.elements = [{ ...element("dot", "form", 50, 50), width: 10, height: 10 }];
    const scoped = projectForLayer(project, "form", { crop: true })!;
    expect(scoped.canvas.width).toBe(120);
    expect(scoped.canvas.height).toBe(120);
  });

  it("does not mutate the source project and returns null for an unknown layer", () => {
    const project = makeProject();
    const before = JSON.stringify(project);
    projectForLayer(project, "form", { crop: true });
    expect(JSON.stringify(project)).toBe(before);
    expect(projectForLayer(project, "missing")).toBeNull();
  });

  it("exports Markdown that re-imports as a standalone project", () => {
    const scoped = projectForLayer(makeProject(), "form", { crop: true })!;
    const markdown = projectToMarkdown(scoped);
    expect(markdown).toContain("### `email`");
    expect(markdown).not.toContain("### `bg`");
    expect(projectFromMarkdown(markdown)).toEqual(scoped);
  });
});
