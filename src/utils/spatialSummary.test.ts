import { describe, expect, it } from "vitest";
import { createSampleProject } from "../model/defaults";
import { buildSpatialSummary } from "./spatialSummary";

describe("spatial summary", () => {
  it("describes the sample layout deterministically", () => {
    const project = createSampleProject();
    const first = buildSpatialSummary(project);
    const second = buildSpatialSummary(project);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(2);
    expect(first.join("\n")).toMatch(/sidebar/i);
    expect(first.join("\n")).toMatch(/toolbar/i);
    expect(first.every((line) => line.startsWith("- "))).toBe(true);
  });

  it("ignores hidden elements and hidden layers", () => {
    const project = createSampleProject();
    const visible = buildSpatialSummary(project).join("\n");
    expect(visible).toContain("settingsSidebar");

    project.layers = project.layers.map((layer) =>
      layer.name === "Layout" ? { ...layer, visible: false } : layer
    );
    const hidden = buildSpatialSummary(project).join("\n");
    expect(hidden).not.toContain("settingsSidebar");
  });

  it("handles an empty canvas", () => {
    const project = createSampleProject();
    project.elements = [];
    expect(buildSpatialSummary(project)).toEqual(["- The screen is empty."]);
  });

  it("describes nested elements inside their parent, in reading order", () => {
    const project = createSampleProject();
    const toolbar = project.elements.find((element) => element.name === "topToolbar")!;
    project.elements = project.elements.map((element) =>
      element.name === "saveButton" || element.name === "cancelButton" ? { ...element, parentId: toolbar.id, layerId: toolbar.layerId, y: 12 } : element
    );
    const summary = buildSpatialSummary(project).join("\n");
    expect(summary).toContain('- Inside "topToolbar" (Toolbar), top to bottom: "cancelButton" (Button), "saveButton" (Button) side by side.');
    expect(summary).not.toMatch(/contains:[^\n]*saveButton/);
  });
});
