import { describe, expect, it } from "vitest";
import {
  EMOJI_CATALOG,
  EMOJI_CATEGORIES,
  emojiByCategory,
  searchEmoji
} from "./emoji";
import { PROJECT_VERSION, createLayer, normalizeProject, type WireframeProject } from "./project";
import { loadFrom, saveTo, type StorageLike } from "../utils/storage";

class MemoryStorage implements StorageLike {
  private readonly map = new Map<string, string>();
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

describe("emoji catalog", () => {
  it("covers every advertised category", () => {
    for (const category of EMOJI_CATEGORIES) {
      expect(emojiByCategory(category).length).toBeGreaterThan(0);
    }
    expect(EMOJI_CATALOG.length).toBeGreaterThan(200);
  });

  it("finds emoji by name and by keyword", () => {
    expect(searchEmoji("rocket").map((entry) => entry.emoji)).toContain("🚀");
    expect(searchEmoji("cat").map((entry) => entry.emoji)).toContain("🐱");
    expect(searchEmoji("warning").map((entry) => entry.emoji)).toContain("⚠️");
    expect(searchEmoji("alert").length).toBeGreaterThan(0);
  });

  it("returns the whole catalog for an empty query and nothing for a miss", () => {
    expect(searchEmoji("")).toHaveLength(EMOJI_CATALOG.length);
    expect(searchEmoji("   ")).toHaveLength(EMOJI_CATALOG.length);
    expect(searchEmoji("zzzzzznope")).toEqual([]);
  });

  it("has unique emoji entries with no empty names", () => {
    const names = EMOJI_CATALOG.map((entry) => `${entry.category}/${entry.emoji}/${entry.name}`);
    expect(new Set(names).size).toBe(names.length);
    expect(EMOJI_CATALOG.every((entry) => entry.name.trim().length > 0)).toBe(true);
  });
});

describe("emoji survive every persistence path", () => {
  function iconProject(label: string, contentSize: number): WireframeProject {
    const layer = createLayer("Default", { id: "l1" });
    return {
      version: PROJECT_VERSION,
      title: "Emoji",
      canvas: { mode: "desktop", width: 1200, height: 800 },
      layers: [layer],
      elements: [
        {
          id: "el_icon",
          type: "icon",
          name: "rocketIcon",
          label,
          note: "",
          x: 40,
          y: 40,
          width: 40,
          height: 40,
          layerId: layer.id,
          visible: true,
          locked: false,
          zIndex: 0,
          contentSize
        }
      ]
    };
  }

  it("keeps the emoji and the content size through JSON normalization", () => {
    const restored = normalizeProject(JSON.parse(JSON.stringify(iconProject("🚀", 48))));
    expect(restored.elements[0].label).toBe("🚀");
    expect(restored.elements[0].contentSize).toBe(48);
  });

  it("keeps the emoji through localStorage", () => {
    const storage = new MemoryStorage();
    expect(saveTo(storage, iconProject("🐱", 72))).toBeNull();
    const loaded = loadFrom(storage);
    expect(loaded.error).toBeNull();
    expect(loaded.project?.elements[0].label).toBe("🐱");
    expect(loaded.project?.elements[0].contentSize).toBe(72);
  });

  it("survives emoji with variation selectors and multi-codepoint glyphs", () => {
    for (const glyph of ["⚠️", "☑️", "🛡️", "🏁"]) {
      const restored = normalizeProject(JSON.parse(JSON.stringify(iconProject(glyph, 32))));
      expect(restored.elements[0].label).toBe(glyph);
    }
  });
});
