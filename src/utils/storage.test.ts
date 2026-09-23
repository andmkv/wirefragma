import { describe, expect, it } from "vitest";
import { LEGACY_STORAGE_KEY, STORAGE_KEY, loadFrom, saveTo, type StorageLike } from "./storage";
import { createSampleProject } from "../model/defaults";

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

const legacyProject = JSON.stringify({
  version: 1,
  title: "Old UI Sketch project",
  canvas: { mode: "mobile", width: 390, height: 844 },
  elements: [
    {
      id: "legacy_1",
      type: "button",
      name: "saveButton",
      label: "Save",
      note: "",
      x: 20,
      y: 700,
      width: 120,
      height: 40,
      zIndex: 0
    }
  ]
});

describe("storage keys", () => {
  it("writes to the Wirefragma key", () => {
    const storage = memoryStorage();
    const project = createSampleProject();
    expect(saveTo(storage, project)).toBeNull();
    expect(storage.values[STORAGE_KEY]).toBeDefined();
    expect(loadFrom(storage).project?.title).toBe("Settings");
  });

  it("migrates a project saved under the old UI Sketch key", () => {
    const storage = memoryStorage({ [LEGACY_STORAGE_KEY]: legacyProject });
    const result = loadFrom(storage);

    expect(result.project?.title).toBe("Old UI Sketch project");
    expect(result.project?.version).toBe(2);
    expect(result.project?.layers[0].name).toBe("Default");
    expect(result.migrated).toBe(true);
    // Copied to the new key, and the old data is left untouched.
    expect(storage.values[STORAGE_KEY]).toContain("Old UI Sketch project");
    expect(storage.values[LEGACY_STORAGE_KEY]).toBe(legacyProject);
  });

  it("prefers the new key once it exists", () => {
    const current = createSampleProject();
    current.title = "Current";
    const storage = memoryStorage({
      [STORAGE_KEY]: JSON.stringify(current),
      [LEGACY_STORAGE_KEY]: legacyProject
    });
    const result = loadFrom(storage);
    expect(result.project?.title).toBe("Current");
    expect(result.migrated).toBe(false);
  });

  it("reports corrupted data instead of throwing", () => {
    const storage = memoryStorage({ [STORAGE_KEY]: "{not json" });
    const result = loadFrom(storage);
    expect(result.project).toBeNull();
    expect(result.error).toMatch(/corrupted/i);
  });
});
