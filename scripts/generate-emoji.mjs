#!/usr/bin/env node
/**
 * Generates the committed emoji data files in src/model/emoji/:
 *   - glyphs.generated.ts             (EMOJI_GLYPHS: fully-qualified base glyphs + category)
 *   - names.<locale>.generated.ts     (EMOJI_NAMES: "name|keyword|keyword", index-aligned)
 *   - names.en.generated.ts also gets EMOJI_KEYWORD_EXTRAS from the old curated RAW list.
 *
 * Dev-only, no build step:  node scripts/generate-emoji.mjs
 *
 * Sources:
 *   - node_modules/emojibase-data/<locale>/compact.json  (en, ru, de, fr, es, ja, zh)
 *   - node_modules/emojibase-data/meta/{groups,hexcodes}.json
 *   - node_modules/cldr-annotations-full/annotations/<locale>            (Serbian, sr-Latn -> sr)
 *   - node_modules/cldr-annotations-derived-full/annotationsDerived/<locale> (Serbian flags etc.)
 *
 * Fully-qualified glyph strings: compact.json's `hexcode` has VS16 (FE0F) stripped, and its
 * `unicode` field re-adds FE0F indiscriminately (e.g. it reports U+1F610 as "😐️" even though the
 * fully-qualified form is "😐"). We therefore rebuild the fully-qualified sequence from `hexcode`
 * plus meta/hexcodes.json, which marks the bare (unqualified) form of every sequence: a code point
 * whose bare form is "unqualified" needs FE0F to be rendered as emoji. This reproduces the old
 * hand-written RAW list exactly and matches emoji-test.txt fully-qualified sequences.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const OUT_DIR = path.join(ROOT, "src", "model", "emoji");
const EMOJIBASE_DIR = path.join(ROOT, "node_modules", "emojibase-data");
const CLDR_ANNOTATIONS_DIR = path.join(ROOT, "node_modules", "cldr-annotations-full", "annotations");
const CLDR_DERIVED_DIR = path.join(ROOT, "node_modules", "cldr-annotations-derived-full", "annotationsDerived");
const MODEL_FILE = path.join(ROOT, "src", "model", "emoji.ts");

/** UI locales the app ships, in the order the files are written (sr comes from CLDR, not emojibase). */
const LOCALES = ["en", "ru", "de", "fr", "es", "sr", "ja", "zh"];
/** CLDR locales to try for Serbian, most preferred first (the app's Serbian UI is Latin script). */
const SERBIAN_CLDR_LOCALES = ["sr-Latn", "sr"];

/** emojibase group key -> our category id. */
const GROUP_TO_CATEGORY = {
  "smileys-emotion": "Smileys",
  "people-body": "People",
  "animals-nature": "Animals",
  "food-drink": "Food",
  "activities": "Activities",
  "travel-places": "Travel",
  "objects": "Objects",
  "symbols": "Symbols",
  "flags": "Flags",
};

/** Code points after which no extra FE0F is ever inserted. */
const NEVER_FOLLOWED_BY_VS16 = new Set(["FE0F", "FE0E", "200D", "20E3"]);
const REGIONAL_INDICATOR = /^1F1[EF][0-9A-F]$/;
const SKIN_TONE = /1F3F[B-F]/;

const readJson = (...parts) => JSON.parse(readFileSync(path.join(...parts), "utf8"));
const norm = (text) => text.replace(/\uFE0F/g, "");
const fromHexcode = (hexcode) => String.fromCodePoint(...hexcode.split("-").map((cp) => parseInt(cp, 16)));

// ---------------------------------------------------------------------------------------------
// Fully-qualified glyph strings
// ---------------------------------------------------------------------------------------------

/** hexcodes.json marks the bare sequence of an emoji as 2 (UNQUALIFIED) when FE0F is required. */
const NEEDS_VS16 = new Set();
for (const [base, variants] of Object.entries(readJson(EMOJIBASE_DIR, "meta", "hexcodes.json"))) {
  if (variants[base] === 2) NEEDS_VS16.add(base);
}

function fullyQualified(hexcode) {
  const codePoints = hexcode.split("-");
  const out = [];
  for (let i = 0; i < codePoints.length; i += 1) {
    const cp = codePoints[i];
    out.push(cp);
    if (NEVER_FOLLOWED_BY_VS16.has(cp) || REGIONAL_INDICATOR.test(cp)) continue;
    // Never add a second selector next to one that is already there.
    if (codePoints[i + 1] === "FE0F" || codePoints[i + 1] === "FE0E") continue;
    if (NEEDS_VS16.has(cp)) out.push("FE0F");
  }
  return fromHexcode(out.join("-"));
}

// ---------------------------------------------------------------------------------------------
// Glyph list (language independent, taken from the English dataset)
// ---------------------------------------------------------------------------------------------

const groups = readJson(EMOJIBASE_DIR, "meta", "groups.json").groups;
const enCompact = readJson(EMOJIBASE_DIR, "en", "compact.json");

const EMOJI_GLYPHS = [];
const dropped = [];
for (const entry of enCompact) {
  if (SKIN_TONE.test(entry.hexcode)) {
    dropped.push({ hexcode: entry.hexcode, label: entry.label, reason: "skin tone" });
    continue;
  }
  const groupKey = entry.group === undefined ? undefined : groups[String(entry.group)];
  const category = groupKey ? GROUP_TO_CATEGORY[groupKey] : undefined;
  if (!category) {
    dropped.push({
      hexcode: entry.hexcode,
      label: entry.label,
      reason: groupKey ? `unmapped group "${groupKey}"` : "no group (bare regional indicator)",
    });
    continue;
  }
  EMOJI_GLYPHS.push({ hexcode: entry.hexcode, emoji: fullyQualified(entry.hexcode), category });
}

// Every generated glyph should be recognized as a fully-qualified sequence by emojibase
// (qualifier 0 === FULLY_QUALIFIED in emojibase's meta/hexcodes.json).
const hexcodes = readJson(EMOJIBASE_DIR, "meta", "hexcodes.json");
for (const glyph of EMOJI_GLYPHS) {
  const variants = hexcodes[glyph.hexcode];
  const isFullyQualified =
    variants && Object.entries(variants).some(([hex, qualifier]) => qualifier === 0 && fromHexcode(hex) === glyph.emoji);
  if (!isFullyQualified) {
    process.stderr.write(`warning: ${glyph.hexcode} (${glyph.emoji}) is not fully qualified in emojibase meta/hexcodes.json\n`);
  }
}

// ---------------------------------------------------------------------------------------------
// Name strings
// ---------------------------------------------------------------------------------------------

const clean = (text) =>
  String(text ?? "")
    .toLowerCase()
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** "name|keyword|keyword" from a label plus tags (label words are keywords too), or "". */
function nameEntry(label, tags) {
  const name = clean(label);
  if (!name) return "";
  const keywords = [];
  const seen = new Set([name]);
  const candidates = [...(tags ?? []).map(clean), ...name.split(/[^\p{L}\p{N}]+/u)];
  for (const candidate of candidates) {
    // Drop single latin letters ("e" from "e-mail"); keep digits and single CJK characters.
    if (!candidate || /^[a-z]$/.test(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    keywords.push(candidate);
  }
  return [name, ...keywords].join("|");
}

function emojibaseNames(locale) {
  const compact = readJson(EMOJIBASE_DIR, locale, "compact.json");
  const byHexcode = new Map(compact.map((entry) => [entry.hexcode, entry]));
  const names = [];
  for (const glyph of EMOJI_GLYPHS) {
    const entry = byHexcode.get(glyph.hexcode);
    names.push(entry ? nameEntry(entry.label, entry.tags) : "");
  }
  return names;
}

/** CLDR "tts" is the short name, "default" are the search keywords. */
function cldrEntryName(entry) {
  return nameEntry(clean(entry.tts?.[0] ?? entry.default?.[0] ?? ""), entry.default);
}

const cldrWarnings = [];
function serbianNames() {
  for (const locale of SERBIAN_CLDR_LOCALES) {
    const annotationFile = path.join(CLDR_ANNOTATIONS_DIR, locale, "annotations.json");
    if (!existsSync(annotationFile)) {
      cldrWarnings.push(`no CLDR annotations for ${locale}`);
      continue;
    }
    const annotations = readJson(annotationFile).annotations.annotations;
    const byEmoji = new Map(Object.entries(annotations).map(([key, value]) => [norm(key), value]));
    const derivedFile = path.join(CLDR_DERIVED_DIR, locale, "annotations.json");
    if (existsSync(derivedFile)) {
      for (const [key, value] of Object.entries(readJson(derivedFile).annotationsDerived.annotations)) {
        if (!byEmoji.has(norm(key))) byEmoji.set(norm(key), value);
      }
    } else {
      cldrWarnings.push(`no cldr-annotations-derived-full for ${locale}: flags and some ZWJ sequences stay empty`);
    }
    const names = EMOJI_GLYPHS.map((glyph) => {
      const entry = byEmoji.get(norm(glyph.emoji));
      return entry ? cldrEntryName(entry) : "";
    });
    const nonEmpty = names.filter(Boolean).length;
    if (nonEmpty > 0) return { source: `CLDR ${locale}`, names };
    cldrWarnings.push(`CLDR ${locale} produced no usable names`);
  }
  cldrWarnings.push("Serbian: no CLDR data found, emitting empty strings for sr");
  return { source: null, names: EMOJI_GLYPHS.map(() => "") };
}

// ---------------------------------------------------------------------------------------------
// English keyword extras, curated from the old hand-written RAW list in src/model/emoji.ts
// ---------------------------------------------------------------------------------------------

/** Reads the RAW array out of src/model/emoji.ts (["emoji", "name", "Category", "kw kw"]). */
function readCuratedRaw() {
  if (!existsSync(MODEL_FILE)) return [];
  const source = readFileSync(MODEL_FILE, "utf8");
  const match = source.match(/const RAW[^=]*=\s*\[([\s\S]*?)\n\];/);
  if (!match) return [];
  const rowPattern = /\["((?:[^"\\]|\\.)*)",\s*"([^"]*)",\s*"([^"]*)"(?:\s*,\s*"([^"]*)")?\]/g;
  const rows = [];
  for (let row = rowPattern.exec(match[1]); row; row = rowPattern.exec(match[1])) {
    rows.push({ emoji: row[1], name: row[2], category: row[3], keywords: row[4] ?? "" });
  }
  return rows;
}

/**
 * Curated search terms from the old RAW list (name words + keywords) that are *not* already
 * findable in the generated English string. A term counts as covered when it appears as a
 * substring of the generated "name|keyword|..." text, which is how the picker searches.
 */
function englishExtras(glyphs, names) {
  const byEmoji = new Map();
  glyphs.forEach((glyph, index) => byEmoji.set(norm(glyph.emoji), { emoji: glyph.emoji, text: names[index].replace(/\|/g, " ") }));

  const extras = {};
  const missingFromGlyphs = [];
  const stats = { curated: 0, covered: 0, uncovered: 0 };
  for (const row of readCuratedRaw()) {
    const target = byEmoji.get(norm(row.emoji));
    if (!target) {
      missingFromGlyphs.push(row.emoji);
      continue;
    }
    const curated = [...row.name.toLowerCase().split(" "), ...row.keywords.toLowerCase().split(" ")].filter(Boolean);
    const missing = [];
    for (const word of curated) {
      stats.curated += 1;
      if (target.text.includes(word)) {
        stats.covered += 1;
        continue;
      }
      stats.uncovered += 1;
      if (!missing.includes(word)) missing.push(word);
    }
    if (missing.length > 0) extras[target.emoji] = missing.join(" ");
  }
  return { extras, missingFromGlyphs, stats };
}

// ---------------------------------------------------------------------------------------------
// Emit
// ---------------------------------------------------------------------------------------------

const HEADER = "/** GENERATED by scripts/generate-emoji.mjs — do not edit by hand. */";

/** Category ids in the order used by the one-character category index in glyphs.generated.ts. */
const CATEGORY_ORDER = ["Smileys", "People", "Animals", "Food", "Activities", "Travel", "Objects", "Symbols", "Flags"];
/** U+001F (unit separator) never occurs inside an emoji sequence. */
const RECORD_SEPARATOR = "\u001f";
/** Source text of the separator as it must appear inside the emitted .ts file. */
const RECORD_SEPARATOR_SOURCE = '"\\u001f"';
const RECORDS_PER_LINE = 96;

/**
 * The catalog is emitted as one primitive string ("<categoryIndex><emoji>" joined by U+001F) and
 * mapped to objects at module load. ~1900 object literals with literal category strings make
 * `tsc` fail with TS2590 (union type too complex); primitive data does not. The exported shape is
 * unchanged: EMOJI_GLYPHS is still a GeneratedEmojiGlyph[] of { emoji, category }.
 */
function glyphsFile(glyphs) {
  const records = glyphs.map((glyph) => `${CATEGORY_ORDER.indexOf(glyph.category)}${glyph.emoji}`);
  const chunks = [];
  for (let i = 0; i < records.length; i += RECORDS_PER_LINE) {
    const chunk = records.slice(i, i + RECORDS_PER_LINE);
    const isLast = i + RECORDS_PER_LINE >= records.length;
    chunks.push(`  ${JSON.stringify(chunk.join(RECORD_SEPARATOR) + (isLast ? "" : RECORD_SEPARATOR))}`);
  }
  return [
    HEADER,
    "export type GeneratedEmojiCategory =",
    '  | "Smileys" | "People" | "Animals" | "Food"',
    '  | "Activities" | "Travel" | "Objects" | "Symbols" | "Flags";',
    "",
    "export interface GeneratedEmojiGlyph {",
    "  emoji: string;",
    "  category: GeneratedEmojiCategory;",
    "}",
    "",
    "/** Every fully-qualified emoji, base glyphs only (no skin tones), in a stable order. */",
    `/** Encoded as "<categoryIndex><emoji>" records joined by U+001F, ${RECORDS_PER_LINE} per line. */`,
    "const EMOJI_GLYPH_RECORDS =",
    `${chunks.join(" +\n")};`,
    "",
    "const EMOJI_GLYPH_CATEGORIES: GeneratedEmojiCategory[] = [",
    `  ${CATEGORY_ORDER.map((category) => JSON.stringify(category)).join(", ")}`,
    "];",
    "",
    "export const EMOJI_GLYPHS: GeneratedEmojiGlyph[] = EMOJI_GLYPH_RECORDS",
    `  .split(${RECORD_SEPARATOR_SOURCE})`,
    "  .map((record) => ({",
    "    emoji: record.slice(1),",
    "    category: EMOJI_GLYPH_CATEGORIES[record.charCodeAt(0) - 48] ?? \"Symbols\",",
    "  }));",
    "",
  ].join("\n");
}

function namesFile(names, extras) {
  const lines = [
    HEADER,
    '/** Index-aligned with EMOJI_GLYPHS in ./glyphs.generated.ts: "name|keyword|keyword", or "". */',
    "export const EMOJI_NAMES: string[] = [",
    ...names.map((name) => `  ${JSON.stringify(name)},`),
    "];",
    "",
  ];
  if (extras) {
    lines.push(
      "/** Extra English search keywords for specific glyphs (curated, from the old hand-written list). */",
      "export const EMOJI_KEYWORD_EXTRAS: Record<string, string> = {",
      ...Object.entries(extras).map(([emoji, keywords]) => `  ${JSON.stringify(emoji)}: ${JSON.stringify(keywords)},`),
      "};",
      "",
    );
  }
  return lines.join("\n");
}

mkdirSync(OUT_DIR, { recursive: true });

const written = [];
const write = (fileName, contents) => {
  const file = path.join(OUT_DIR, fileName);
  writeFileSync(file, contents, "utf8");
  written.push({ file, bytes: Buffer.byteLength(contents, "utf8") });
};

write("glyphs.generated.ts", glyphsFile(EMOJI_GLYPHS));

const extras = englishExtras(EMOJI_GLYPHS, emojibaseNames("en"));
const nonEmptyByLocale = {};
for (const locale of LOCALES) {
  let names;
  let source;
  if (locale === "sr") {
    const serbian = serbianNames();
    names = serbian.names;
    source = serbian.source ?? "empty (no CLDR data)";
  } else {
    names = emojibaseNames(locale);
    source = `emojibase-data ${locale}`;
  }
  if (names.length !== EMOJI_GLYPHS.length) throw new Error(`${locale}: ${names.length} names for ${EMOJI_GLYPHS.length} glyphs`);
  nonEmptyByLocale[locale] = { source, nonEmpty: names.filter(Boolean).length, total: names.length };
  write(`names.${locale}.generated.ts`, namesFile(names, locale === "en" ? extras.extras : null));
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

const byCategory = {};
for (const glyph of EMOJI_GLYPHS) byCategory[glyph.category] = (byCategory[glyph.category] ?? 0) + 1;
const droppedByReason = {};
for (const entry of dropped) droppedByReason[entry.reason] = (droppedByReason[entry.reason] ?? 0) + 1;
const zwj = EMOJI_GLYPHS.filter((glyph) => glyph.emoji.includes("\u200D")).length;
const skinTones = EMOJI_GLYPHS.filter((glyph) => SKIN_TONE.test(glyph.emoji)).length;

process.stdout.write(`generated ${EMOJI_GLYPHS.length} glyphs (${enCompact.length} emojibase entries, ${dropped.length} dropped)\n`);
process.stdout.write(`categories: ${Object.entries(byCategory).map(([c, n]) => `${c}=${n}`).join(" ")}\n`);
process.stdout.write(`dropped: ${Object.entries(droppedByReason).map(([r, n]) => `${n} ${r}`).join(", ")}\n`);
process.stdout.write(`zwj sequences: ${zwj}, skin-tone hexcodes kept: ${skinTones}\n`);
process.stdout.write(
  `english extras: ${Object.keys(extras.extras).length} glyphs (${extras.stats.uncovered}/${extras.stats.curated} curated terms not covered by generated english)\n`,
);
if (extras.missingFromGlyphs.length > 0) {
  process.stdout.write(`warning: ${extras.missingFromGlyphs.length} curated RAW glyphs are missing from EMOJI_GLYPHS: ${extras.missingFromGlyphs.join(" ")}\n`);
}
for (const locale of LOCALES) {
  const info = nonEmptyByLocale[locale];
  process.stdout.write(`${locale}: ${info.nonEmpty}/${info.total} non-empty (${info.source})\n`);
}
for (const warning of cldrWarnings) process.stderr.write(`warning: ${warning}\n`);
for (const { file, bytes } of written) {
  process.stdout.write(`${path.relative(ROOT, file)} ${bytes} bytes\n`);
}
