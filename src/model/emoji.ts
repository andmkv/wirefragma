/**
 * Emoji catalog for the icon/image picker and every text field.
 *
 * The data is **generated** (`scripts/generate-emoji.mjs` → `src/model/emoji/*.generated.ts`) and
 * loaded **lazily**:
 *
 *  - `glyphs.generated.ts` (1914 fully-qualified emoji, base glyphs only, no skin tones) is one
 *    chunk;
 *  - `names.<language>.generated.ts` is one chunk per UI language, fetched when the picker opens.
 *
 * That keeps the base bundle small on shared hosting while search still works in every UI
 * language: `loadEmojiCatalog` merges the current language with English, so an English keyword
 * ("rocket") and a localized one ("ракета") both match.
 *
 * This module is pure data + pure functions: no DOM, no React, no i18n import.
 */

export type EmojiCategory =
  | "Smileys"
  | "People"
  | "Animals"
  | "Food"
  | "Activities"
  | "Travel"
  | "Objects"
  | "Symbols"
  | "Flags";

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  "Smileys",
  "People",
  "Animals",
  "Food",
  "Activities",
  "Travel",
  "Objects",
  "Symbols",
  "Flags"
];

export interface EmojiEntry {
  emoji: string;
  /** Display name in the primary language, falling back to the English name. */
  name: string;
  /** Every searchable keyword from the loaded languages (not folded). */
  keywords: string[];
  category: EmojiCategory;
  /** Pre-folded `name + keywords` haystack used by `searchEmoji`. */
  search: string;
}

/** Languages the generated names exist for; mirrors `src/i18n` `LOCALES`. */
export const EMOJI_LANGUAGES = ["en", "ru", "de", "fr", "es", "sr", "ja", "zh"] as const;
export type EmojiLanguage = (typeof EMOJI_LANGUAGES)[number];

export function isEmojiLanguage(value: unknown): value is EmojiLanguage {
  return typeof value === "string" && (EMOJI_LANGUAGES as readonly string[]).includes(value);
}

interface NamesModule {
  EMOJI_NAMES: string[];
  EMOJI_KEYWORD_EXTRAS?: Record<string, string>;
}

interface GlyphsModule {
  EMOJI_GLYPHS: { emoji: string; category: string }[];
}

/**
 * One loader per language, written out explicitly: a template-literal `import()` would make Vite
 * bundle every locale into the base chunk instead of one chunk per language.
 */
const NAME_LOADERS: Record<EmojiLanguage, () => Promise<NamesModule>> = {
  en: () => import("./emoji/names.en.generated"),
  ru: () => import("./emoji/names.ru.generated"),
  de: () => import("./emoji/names.de.generated"),
  fr: () => import("./emoji/names.fr.generated"),
  es: () => import("./emoji/names.es.generated"),
  sr: () => import("./emoji/names.sr.generated"),
  ja: () => import("./emoji/names.ja.generated"),
  zh: () => import("./emoji/names.zh.generated")
};

let glyphsModule: Promise<GlyphsModule> | null = null;
const namesModules = new Map<EmojiLanguage, Promise<NamesModule>>();

function loadEmojiGlyphs(): Promise<GlyphsModule> {
  glyphsModule ??= import("./emoji/glyphs.generated");
  return glyphsModule;
}

export function loadEmojiNames(language: EmojiLanguage): Promise<NamesModule> {
  let pending = namesModules.get(language);
  if (!pending) {
    pending = NAME_LOADERS[language]();
    namesModules.set(language, pending);
  }
  return pending;
}

/**
 * Case- and accent-insensitive folding used by the search: `é` → `e`, `č` → `c`, `ё` → `е`.
 * Emoji names in every supported language are plain words, so stripping combining marks is enough.
 */
export function foldEmojiText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0451/g, "\u0435");
}

/** `"name|keyword|keyword"` → tokens, or `[]` for an empty/missing entry. */
function splitNames(record: string | undefined): string[] {
  if (!record) return [];
  return record
    .split("|")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function isCategory(value: string): value is EmojiCategory {
  return (EMOJI_CATEGORIES as string[]).includes(value);
}

export interface EmojiCatalogOptions {
  /** Primary language first; English is always merged in for search. */
  language?: string;
}

/**
 * Load (and cache) the catalog: glyphs + the primary language names + English names.
 *
 * An unknown language falls back to English only — explicitly, never silently skipped.
 */
export async function loadEmojiCatalog(options: EmojiCatalogOptions = {}): Promise<EmojiEntry[]> {
  const primary: EmojiLanguage = isEmojiLanguage(options.language) ? options.language : "en";
  const [glyphs, primaryNames, englishNames] = await Promise.all([
    loadEmojiGlyphs(),
    loadEmojiNames(primary),
    loadEmojiNames("en")
  ]);

  const extras = englishNames.EMOJI_KEYWORD_EXTRAS ?? {};
  const total = glyphs.EMOJI_GLYPHS.length;

  const entries: EmojiEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    const glyph = glyphs.EMOJI_GLYPHS[index];
    const primaryTokens = splitNames(primaryNames.EMOJI_NAMES[index]);
    const englishTokens = splitNames(englishNames.EMOJI_NAMES[index]);
    const name = primaryTokens[0] ?? englishTokens[0] ?? glyph.emoji;

    const keywords: string[] = [];
    const seen = new Set<string>();
    const add = (token: string) => {
      const key = token.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      keywords.push(token);
    };
    for (const token of primaryTokens.slice(1)) add(token);
    for (const token of englishTokens) add(token);
    // The curated extras from the pre-1.2 hand-written list (rocket, cart, warning, …) are
    // English-only conveniences layered on top of the generated keywords.
    for (const token of (extras[glyph.emoji] ?? "").split(/\s+/)) {
      if (token) add(token);
    }

    entries.push({
      emoji: glyph.emoji,
      name,
      keywords,
      category: isCategory(glyph.category) ? glyph.category : "Symbols",
      search: foldEmojiText([name, ...keywords].join(" "))
    });
  }
  return entries;
}

/** Drop every cached language chunk (tests). */
export function resetEmojiCache(): void {
  glyphsModule = null;
  namesModules.clear();
}

/**
 * Search name and keywords. Case- and accent-insensitive; a multi-word query must match every
 * word (in any loaded language, and always in English). An empty query returns the whole catalog.
 */
export function searchEmoji(catalog: EmojiEntry[], query: string): EmojiEntry[] {
  const terms = foldEmojiText(query.trim())
    .split(/\s+/)
    .filter((term) => term.length > 0);
  if (terms.length === 0) return catalog;
  return catalog.filter((entry) => terms.every((term) => entry.search.includes(term)));
}

export function emojiByCategory(catalog: EmojiEntry[], category: EmojiCategory): EmojiEntry[] {
  return catalog.filter((entry) => entry.category === category);
}
