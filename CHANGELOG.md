# Changelog

## 1.2.0 — unreleased

### Emoji
- **Generated full catalog** (1914 fully-qualified emoji, base glyphs only — no skin tones — with
  flags and ZWJ sequences) replacing the hand-written 336-entry list. New `Flags` category; the
  existing eight category ids keep working. The data is produced by the dev-only
  `scripts/generate-emoji.mjs` and committed.
- **Search in all 8 UI languages** (en, ru, de, fr, es, sr, ja, zh) — case- and accent-insensitive
  (`é`/`e`, `ё`/`е`), always covering the current language *plus* English. Serbian has no
  emojibase data and comes from CLDR `sr-Latn`; nothing falls back to English silently. The old
  curated keywords (`rocket`, `cart`, `warning`, …) survive as English extras.
- **Lazy chunks**: the glyph list is one chunk (~5 kB gzip) and every language is its own chunk
  (29–48 kB gzip), loaded when the picker opens. The base `index-*.js` did **not** grow — it got
  ~2 kB gzip smaller.
- **Recently used** tab (first, when non-empty): the last 24 picks, deduplicated, in
  `localStorage` (`wirefragma.emoji.recent`) — never part of a project or the cloud.
- **One reusable `EmojiTextField`** with a 🙂 button that inserts **at the caret / replacing the
  selection** (never the whole value), keeps focus and the caret, and goes through the normal
  `onChange` so undo coalescing is unchanged. Used for Name, Label, Note, Items, Columns, the
  project Title, the Canvas/Drawing popup text and description fields and layer rename. The
  Icon/Image picker keeps its replace-the-label behaviour. The popover is clamped/flipped inside
  the viewport, closes on Escape and returns focus to the field.

### Canvas size
- **Device presets**: the 3-item canvas menu became one grouped list — the three classic modes
  (unchanged for old documents), plus Phone (iPhone SE / 15 / 15 Pro Max, Android, Android large),
  Tablet (iPad, iPad landscape, iPad Pro 11"), Desktop (1280×720, 1366×768, 1440×900, 1536×864,
  1920×1080) and Other (A4, Square, 16:9, 4:3). A ⇄ button flips portrait ↔ landscape. The choice
  is stored as `canvas.mode: "custom"` plus an additive `canvas.preset` id; an unknown id, or one
  whose size disagrees with `width`/`height`, is dropped by `normalizeProject` (no version bump).
  The Markdown export names the preset in the advisory `## Screen` section only.
- **Canvas edge resize**: right-edge, bottom-edge and bottom-right handles on the canvas frame
  resize the canvas live — zoom-aware, snapped to the grid when Snap is on, clamped to the canvas
  limits, one drag = one undo step, with a "W × H" badge. Elements are never moved or scaled; if
  elements end up completely outside the new bounds a non-blocking toast reports the count and
  nothing is deleted.

### Editor
- **Viewport panning**: middle-mouse drag, `Space` + left drag (grab cursor) and — on touch — a
  two-finger drag that pans while a pinch zooms, anchored at the gesture centre. Panning only moves
  the scroll offset of the canvas viewport: no history entry, nothing serialized, and a pan can
  never start or cancel an element drag. The browser's middle-click autoscroll and paste are
  suppressed, one-finger touch keeps the marquee semantic.
- **Clipboard across wireframes**: the internal copy/paste payload moved out of `App` into a
  module-level store that survives switching wireframes, and is mirrored into `localStorage` so it
  also works between tabs of the same origin. Pasting into a project whose layer ids do not exist
  matches a layer by **name** first and otherwise uses the active layer — layers are never created.
  Copy/paste inside one wireframe behaves exactly as before (same cascade offset).
- **New shortcuts**: `Cmd/Ctrl+A` selects every visible, unlocked element, `Cmd/Ctrl+X` cuts
  (copy + delete in one undo step, locked members skipped) and `F2` jumps to the Name field in
  Properties. All of them are ignored while a text field has focus. The canvas hint lists them.

## 1.1.0 — 2026-09-27

### Editor
- **Nested elements** (Unity-style): drop an element onto another in the Layers tree to put it
  inside. Children always draw in front of their parent and move, hide, lock, copy and delete with
  it. Multi-selections can be dragged into a parent in one step.
- **Layer "…" menu** with *Export layer…*: export only one layer (optionally cropped to its
  content) to explain a single form to an LLM.
- **WIREFRAGMA schema** export tab: LLM-ready instructions (with an example and a JSON Schema) so a
  chat model can *generate* a project; Import accepts the answer as-is (`ui-project` / `json`
  fence or JSON in prose).
- Resizable Projects / Add / Layers panels; Projects and Layers collapse to identical rails.
- UI in **8 languages** (EN, RU, DE, FR, ES, SR, JA, ZH) and a **dark / system theme**. The
  Markdown export stays English.

### Accounts (optional backend)
- Sign-up with captcha, email confirmation and privacy-policy consent; sign-in, password reset,
  profile settings (name, language, theme, password), account deletion — or continue without an
  account.
- Projects panel: projects with wireframes, instant switching with per-wireframe undo history,
  autosave to MySQL with conflict detection, import into a chosen project.
- Plain PHP + MySQL (`server/`), deployable on ordinary shared hosting; see
  `docs/deployment.md` and `docs/accounts.md`.

### Fixes (from a code audit)
- Notes containing ``` code fences no longer break re-import; unreadable saved data is never
  overwritten; a second touch can no longer corrupt undo history; Cmd+Z mid-drag is ignored;
  canvas size / font size can be typed; the Grid button repaints; dialogs close on Escape and block
  editor shortcuts; Layers rows are keyboard-accessible; huge canvases no longer blank out.

## 1.0.0 — 2026-09-23

Initial open-source release.
