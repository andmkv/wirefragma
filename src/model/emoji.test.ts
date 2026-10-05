import { beforeAll, describe, expect, it } from "vitest";
import {
  EMOJI_CATEGORIES,
  emojiByCategory,
  foldEmojiText,
  loadEmojiCatalog,
  resetEmojiCache,
  searchEmoji,
  type EmojiEntry
} from "./emoji";
import { MAX_RECENT_EMOJI, parseRecentEmoji, withRecentEmoji } from "./emojiRecent";
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

/** The generated catalog is a lazy chunk; these suites await it once. */
let en: EmojiEntry[] = [];
let ru: EmojiEntry[] = [];
let fr: EmojiEntry[] = [];
let sr: EmojiEntry[] = [];
let ja: EmojiEntry[] = [];

beforeAll(async () => {
  en = await loadEmojiCatalog({ language: "en" });
  ru = await loadEmojiCatalog({ language: "ru" });
  fr = await loadEmojiCatalog({ language: "fr" });
  sr = await loadEmojiCatalog({ language: "sr" });
  ja = await loadEmojiCatalog({ language: "ja" });
});

describe("generated emoji catalog", () => {
  it("covers every advertised category", () => {
    for (const category of EMOJI_CATEGORIES) {
      expect(emojiByCategory(en, category).length, category).toBeGreaterThan(0);
    }
    expect(EMOJI_CATEGORIES).toContain("Flags");
  });

  it("holds the full generated set, not the old curated one", () => {
    expect(en.length).toBeGreaterThan(1800);
    expect(emojiByCategory(en, "Flags").length).toBeGreaterThan(200);
  });

  it("has unique, non-empty entries", () => {
    const keys = en.map((entry) => `${entry.category}/${entry.emoji}/${entry.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(en.every((entry) => entry.name.trim().length > 0)).toBe(true);
    const glyphs = en.map((entry) => entry.emoji);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it("skips skin-tone variants but keeps ZWJ sequences and flags", () => {
    const all = en.map((entry) => entry.emoji).join("");
    for (const tone of ["\u{1F3FB}", "\u{1F3FC}", "\u{1F3FD}", "\u{1F3FE}", "\u{1F3FF}"]) {
      expect(all.includes(tone), tone).toBe(false);
    }
    expect(en.some((entry) => entry.emoji.includes("\u200d"))).toBe(true);
    expect(en.some((entry) => entry.emoji === "🇺🇸")).toBe(true);
    expect(en.some((entry) => entry.emoji === "👨‍👩‍👧")).toBe(true);
  });

  it("includes the emoji the UI itself uses", () => {
    const glyphs = new Set(en.map((entry) => entry.emoji));
    for (const glyph of ["💳", "📧", "🗑️", "💰", "🏳️", "🚀", "🛒", "⚠️", "🐱", "🇷🇸", "🇯🇵"]) {
      expect(glyphs.has(glyph), glyph).toBe(true);
    }
  });

  it("finds emoji by name and by the curated keyword extras", () => {
    expect(searchEmoji(en, "rocket").map((entry) => entry.emoji)).toContain("🚀");
    expect(searchEmoji(en, "cat").map((entry) => entry.emoji)).toContain("🐱");
    expect(searchEmoji(en, "warning").map((entry) => entry.emoji)).toContain("⚠️");
    expect(searchEmoji(en, "cart").map((entry) => entry.emoji)).toContain("🛒");
    expect(searchEmoji(en, "alert").length).toBeGreaterThan(0);
  });

  it("searches the current UI language AND English", () => {
    expect(searchEmoji(ru, "ракета").map((entry) => entry.emoji)).toContain("🚀");
    expect(searchEmoji(ru, "rocket").map((entry) => entry.emoji)).toContain("🚀");
    expect(searchEmoji(ja, "ロケット").map((entry) => entry.emoji)).toContain("🚀");
    // A Japanese IME produces hiragana by default; the names are katakana.
    expect(searchEmoji(ja, "ろけっと").map((entry) => entry.emoji)).toContain("🚀");
    // Serbian comes from CLDR `sr-Latn`: Latin script, real data, no English fallback.
    expect(searchEmoji(sr, "raketa").map((entry) => entry.emoji)).toContain("🚀");
    expect(sr.find((entry) => entry.emoji === "🚀")?.name).not.toBe(
      en.find((entry) => entry.emoji === "🚀")?.name
    );
  });

  it("is case-insensitive", () => {
    expect(searchEmoji(en, "ROCKET").map((entry) => entry.emoji)).toContain("🚀");
    expect(searchEmoji(en, "ThUmBs Up").map((entry) => entry.emoji)).toContain("👍");
  });

  it("is accent-insensitive (é/e, ё/е)", () => {
    const accented = fr.find((entry) => /[éèêëàâçîïôûù]/.test(entry.name));
    expect(accented).toBeDefined();
    const folded = foldEmojiText(accented!.name);
    expect(searchEmoji(fr, folded).map((entry) => entry.emoji)).toContain(accented!.emoji);

    const withYo = ru.find((entry) => entry.name.includes("ё"));
    expect(withYo).toBeDefined();
    expect(searchEmoji(ru, withYo!.name.replace(/ё/g, "е")).map((entry) => entry.emoji)).toContain(
      withYo!.emoji
    );
  });

  it("matches every word of a multi-word query", () => {
    expect(searchEmoji(en, "face tears").map((entry) => entry.emoji)).toContain("😂");
    expect(searchEmoji(en, "face zzzzzznope")).toEqual([]);
  });

  it("returns the whole catalog for an empty query and nothing for a miss", () => {
    expect(searchEmoji(en, "")).toHaveLength(en.length);
    expect(searchEmoji(en, "   ")).toHaveLength(en.length);
    expect(searchEmoji(en, "zzzzzznope")).toEqual([]);
  });

  it("falls back to English for an unsupported language", async () => {
    const unknown = await loadEmojiCatalog({ language: "tlh" });
    expect(unknown).toHaveLength(en.length);
    expect(unknown[0].name).toBe(en[0].name);
  });

  it("caches the language chunks and can be reset", async () => {
    resetEmojiCache();
    const again = await loadEmojiCatalog({ language: "en" });
    expect(again).toHaveLength(en.length);
    expect(again[10].emoji).toBe(en[10].emoji);
  });
});

describe("foldEmojiText", () => {
  it("lowercases and strips accents", () => {
    expect(foldEmojiText("Café")).toBe("cafe");
    expect(foldEmojiText("Čokoláda")).toBe("cokolada");
    expect(foldEmojiText("Ёжик")).toBe("ежик");
  });

  it("treats katakana and hiragana alike", () => {
    expect(foldEmojiText("ネコ")).toBe(foldEmojiText("ねこ"));
  });
});

describe("recent emoji", () => {
  it("accepts only plausible emoji strings and deduplicates", () => {
    expect(parseRecentEmoji(null)).toEqual([]);
    expect(parseRecentEmoji([1, "🚀", "", "🚀", "   ", "👨‍👩‍👧"])).toEqual(["🚀", "👨‍👩‍👧"]);
    expect(parseRecentEmoji(["x".repeat(64)])).toEqual([]);
  });

  it("puts the newest first and caps the list", () => {
    let list: string[] = [];
    for (let index = 0; index < MAX_RECENT_EMOJI + 5; index += 1) {
      list = withRecentEmoji(list, `#${index}`);
    }
    expect(list).toHaveLength(MAX_RECENT_EMOJI);
    expect(list[0]).toBe(`#${MAX_RECENT_EMOJI + 4}`);
    expect(withRecentEmoji(list, list[3])[0]).toBe(list[3]);
    expect(withRecentEmoji(list, list[3])).toHaveLength(MAX_RECENT_EMOJI);
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
    for (const glyph of ["⚠️", "☑️", "🛡️", "🏁", "👨‍👩‍👧", "🇷🇸"]) {
      const restored = normalizeProject(JSON.parse(JSON.stringify(iconProject(glyph, 32))));
      expect(restored.elements[0].label).toBe(glyph);
    }
  });
});
