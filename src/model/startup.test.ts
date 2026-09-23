import { describe, expect, it } from "vitest";
import { CANVAS_PRESETS, createBlankProject, createSampleProject } from "./defaults";
import { PROJECT_VERSION, normalizeProject } from "./project";
import { loadFrom, type StorageLike } from "../utils/storage";

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { values: Record<string, string> } {
  const values = { ...seed };
  return {
    values,
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    }
  };
}

describe("first launch and New", () => {
  it("starts with zero elements", () => {
    expect(createBlankProject().elements).toHaveLength(0);
  });

  it("starts with exactly one valid Default layer", () => {
    const project = createBlankProject();
    expect(project.layers).toHaveLength(1);
    const [layer] = project.layers;
    expect(layer.name).toBe("Default");
    expect(layer.id.length).toBeGreaterThan(0);
    expect(layer.visible).toBe(true);
    expect(layer.locked).toBe(false);
    expect(project.elements.every((element) => element.layerId === layer.id)).toBe(true);
  });

  it("uses the current format version, an Untitled title and the Desktop preset", () => {
    const project = createBlankProject();
    expect(project.version).toBe(PROJECT_VERSION);
    expect(project.title).toBe("Untitled");
    expect(project.canvas).toEqual({ mode: "desktop", ...CANVAS_PRESETS.desktop });
    expect(project.canvas.width).toBe(1200);
    expect(project.canvas.height).toBe(800);
  });

  it("contains none of the demo content", () => {
    const blankNames = createBlankProject().elements.map((element) => element.name);
    const sampleNames = createSampleProject().elements.map((element) => element.name);
    expect(blankNames).toHaveLength(0);
    expect(sampleNames.length).toBeGreaterThan(0);
    for (const name of sampleNames) {
      expect(blankNames).not.toContain(name);
    }
  });

  it("survives normalization unchanged", () => {
    const blank = createBlankProject();
    const normalized = normalizeProject(blank);
    expect(normalized.elements).toHaveLength(0);
    expect(normalized.layers).toHaveLength(1);
    expect(normalized.layers[0].name).toBe("Default");
    expect(normalized.canvas).toEqual(blank.canvas);
    expect(normalized.title).toBe("Untitled");
  });

  it("is what a fresh install loads", () => {
    const storage = memoryStorage();
    const result = loadFrom(storage);
    expect(result.project).toBeNull();
    // The app falls back to the blank factory when nothing is stored.
    const project = result.project ?? createBlankProject();
    expect(project.elements).toHaveLength(0);
    expect(project.layers).toHaveLength(1);
  });
});

describe("existing projects are untouched", () => {
  it("restores a saved project with all of its content", () => {
    const saved = createSampleProject();
    saved.title = "My work";
    const storage = memoryStorage({ "wirefragma.project.v1": JSON.stringify(saved) });
    const result = loadFrom(storage);

    expect(result.project?.title).toBe("My work");
    expect(result.project?.elements).toHaveLength(saved.elements.length);
    expect(result.project?.elements.map((element) => element.name)).toEqual(
      saved.elements.map((element) => element.name)
    );
    expect(result.project?.layers.map((layer) => layer.name)).toEqual(
      saved.layers.map((layer) => layer.name)
    );
  });

  it("still migrates a legacy version 1 project", () => {
    const storage = memoryStorage({
      "ui-sketch.project.v1": JSON.stringify({
        version: 1,
        title: "Legacy",
        canvas: { mode: "desktop", width: 1200, height: 800 },
        elements: [
          {
            id: "old_1",
            type: "button",
            name: "oldButton",
            label: "Old",
            note: "",
            x: 0,
            y: 0,
            width: 120,
            height: 40,
            zIndex: 0
          }
        ]
      })
    });
    const result = loadFrom(storage);
    expect(result.migrated).toBe(true);
    expect(result.project?.elements).toHaveLength(1);
    expect(result.project?.elements[0].name).toBe("oldButton");
    expect(result.project?.layers[0].name).toBe("Default");
  });
});
