# Changelog

## 1.3.5 — 2026-10-05

Builds on 1.3.0 (MCP, project files, LLM-export audit). **MCP compatibility:** nothing changes on
the server — documents are still validated against the generated JSON Schema, which was regenerated
(`npm run mcp:resources`) so agents can read and write `chart` elements; verified by validating a
Chart document with the same `opis/json-schema` validator the PHP endpoint uses.

### Chart element (new)
- **Chart** (`chart`): a new element type with **bar / stacked bar / line / area / pie / donut**
  datasets, drawn in the flat wireframe style (axes, light gridlines, category labels, optional
  legend and values) entirely inside the element's bounds. The existing `diagram` element — shown as
  "Canvas" — is untouched.
- Additive optional `chart` field on `WireframeElement` with hard limits that keep documents small
  (≤ 24 categories, ≤ 8 series, names ≤ 40 characters, title ≤ 80 characters, values finite and
  clamped to ±1e12). `normalizeProject` repairs anything recoverable and never throws. **No project
  format version bump**, and old documents import unchanged.
- Editor popup reusing the Canvas/Drawing shell (draft copy, its own undo, **Done = one history
  step**, Esc/× discards with confirmation if dirty): a **Table** mode (add/remove rows and columns,
  Tab/Enter navigation, inline number validation, invalid cells highlighted) and a **Text/CSV** mode
  that accepts pasted Excel/Sheets data (comma, semicolon or tab; decimal comma; quoted cells),
  with the two modes kept in sync. Kind selector, title, option toggles, swap rows/columns, and the
  emoji button in every text field.
- Export: `elementSection` gains a compact chart block (kind, title, the data as a Markdown table),
  the ASCII renderer draws a recognisable horizontal bar sketch (bar kinds) or a percentage list
  (pie/donut) with the existing box fallback when the box is too small, the spatial summary mentions
  `chart (kind, N series × M categories)`, and the WIREFRAGMA schema export has a Chart example plus
  its JSON Schema so an LLM can generate one. Copy, duplicate, nesting, lock/hide and undo all work
  (the dataset is deep-copied).

### Responsive editor
- **Three layouts at 1100 px / 768 px.** Desktop is unchanged; at 768–1099 px the canvas gets the
  whole width and Add / Layers / Properties become overlay drawers (scrim + Escape close them, the
  state is never remembered, selecting an element never opens one); below 768 px the same drawers
  come with a compact toolbar — undo, redo, zoom/fit, Export and a "⋯" menu holding New, Import,
  Copy for LLM, Grid, Snap, grid size and canvas size/preset — so nothing becomes unreachable.
  A breakpoint hook shares the thresholds with the stylesheet.
- Measured with a headless browser at 820 / 390 / 1280 px: **no horizontal page scroll at any
  width**, the canvas viewport is **100 % of the width** on tablet and phone (was ~174 px and
  ~40 px), the toolbar is 2 rows at 820 px (was 3) and wraps to 2 rows at 390 px with every button on screen (no sideways scrolling), every drawer opens, is
  visible and closes again, and a synthetic two-finger pinch + pan still pans and zooms.
- **Touch ergonomics**: toolbar / panel hit targets are ≥ 40 px at ≤ 1099 px or with a coarse
  pointer, and the canvas handle grab tolerance grows through the single shared hit test
  (`coarsePointer`, one constant in `geometry.ts`) — still zoom-independent and still one geometry.
- `100dvh` with the `100vh` fallback, `env(safe-area-inset-*)` padding and `viewport-fit=cover`;
  dialogs stay inside a 360×640 viewport as full-screen sheets with a scrollable body; the
  signed-in workspace, the projects panel and the sign-in screen are usable at those widths.
- **Error boundary** around the editor: a localized message, "Try again" (the document, its undo
  history and the autosave state survive) and "Export what I have" (the current project JSON).
- **Lazy locale chunks**: only English ships in the base bundle; the stored language is preloaded
  before the first render, so switching or starting a language never flashes untranslated text.
  The base JS chunk is 141.5 kB gzip even with charts, the emoji picker and the new editors (1.3.0: 176 kB).
- Fixed the zoom/pinch anchoring arithmetic: the correction is now
  `canvasPosition − (pointer − content × scale)`, measured against the canvas position read on
  every step, so pinch-zoom keeps the grabbed point under the fingers and panning follows the
  pointer exactly (previously the sign was inverted and the pan over-corrected).

### Fixes found while auditing this release
- A Chart on the canvas was painted at the canvas origin instead of inside its element (the popup
  preview was right) — fixed, with a regression test.
- A Chart copied in one tab was pasted as the demo dataset in another tab (the `localStorage`
  mirror of the clipboard dropped the `chart` field) — fixed, with a round-trip test.
- The Add drawer now closes after adding an element on tablet and phone layouts.
- Merged with 1.3.0: icon-button toolbar kept on desktop/tablet, the phone "⋯" menu reuses it; every
  new string fits the English length rule in all languages (test-enforced).

### Emoji
- **Generated full catalog** (1914 fully-qualified emoji, base glyphs only — no skin tones — with
  flags and ZWJ sequences) replacing the hand-written 336-entry list. New `Flags` category; the
  existing eight category ids keep working. The data is produced by the dev-only
  `scripts/generate-emoji.mjs` and committed.
- **Search in all 8 UI languages** (en, ru, de, fr, es, sr, ja, zh) — case- and accent-insensitive
  (`é`/`e`, `ё`/`е`, katakana/hiragana), always covering the current language *plus* English. Serbian has no
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

## 1.3.0 — 2026-09-28

### MCP for coding agents
- **Remote MCP endpoint** at `/mcp/` (Streamable HTTP, official PHP MCP SDK, both the handshake
  and the stateless 2026-07-28 protocol eras) that operates on the same account storage as the
  browser: `list_projects`, `get_wireframe`, `get_wirefragma_schema`, `create_project`,
  `rename_project`, `create_wireframe`, `update_wireframe`, `rename_wireframe`,
  `duplicate_wireframe`, `delete_wireframe`, `delete_project`, plus `wirefragma://` resources.
- **Personal MCP tokens** in Settings → MCP access: `read` / `write` / `delete` scopes (delete is
  opt-in), expiry (30 d / 90 d / 1 y / never), current password required, shown once, stored as
  SHA-256 only, revocable immediately.
- Optimistic concurrency for agents: `update_wireframe` needs `baseRevision`; a stale write returns
  a `conflict` with the current document — there is no force option over MCP.
- Documents sent by agents are validated against the JSON Schema generated from the TypeScript
  model (`npm run mcp:resources`); unknown fields are preserved exactly.
- The signed-in editor **notices changes made elsewhere** (another device or an agent) by polling
  the project tree: clean wireframes reload ("Updated elsewhere"), unsaved edits go through the
  conflict banner, remote creates/renames/deletes appear in the panel.
- `npm run build:deploy` adds `dist/mcp` (Composer, PHP 8.1+); `npm run build` stays
  Composer-free.
- Public documentation site at `/docs/`.

### Projects
- **Project files (`.wfproj`)**: export a whole project with all its wireframes (project **…** menu)
  or one wireframe (Export → Project JSON). Import has two flows: one wireframe (also picked out of
  a `.wfproj`, works for guests) or a whole `.wfproj` as a new project.

### LLM export (audit)
- Element sections are a compact field list; `Layer` only when there are several layers; a single
  label is no longer repeated as "Visible content"; list entries appear as `Items:`.
- The `ui-project` block is written one element per line — the same JSON, far fewer tokens.
- Spatial Summary describes nested elements inside their parent, in reading order.
- ASCII: container labels sit on the border; buttons and toggles no longer truncate captions that fit.
- Canvas contents take one line per shape; the Copy-for-LLM preamble explains coordinates, fields,
  Canvas/Drawing and the role of `ui-project`.

### Interface
- Compact toolbar: icon buttons with tooltips (Export keeps its label), no duplicate zoom readout.
- Every translation fits the English length (short strings +2 characters, sentences +10 %), checked
  by a test.

### Editor
- **Canvas** and **Drawing** scene elements (palette group "Custom"): a small structured-diagram
  editor (lines, arrows, rectangles, ellipses, bezier curves, text, labels) and a freehand editor
  (pen, eraser, widths), opened by double-click, a hover pencil or Properties. Canvas exports as a
  nested ASCII sketch, a primitive list and relationships; a Drawing exports only its LLM
  description and shows a ⚠ badge until it has one.
- The Add panel collapses to a two-column icon grid; long element names are truncated.

### Server
- Project and wireframe persistence moved from `api/index.php` into the shared
  `api/lib/projects.php` (used by the browser API and MCP).
- Documents are stored losslessly: `{}` no longer turns into `[]` on rename, duplicate or save.
- New table `wf_mcp_tokens` (created on demand; `schema.sql` updated).

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
