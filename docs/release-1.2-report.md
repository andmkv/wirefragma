# Wirefragma 1.2 — release report

Branch `feature/1.2-editor-maturity`, created from `feature/canvas-and-drawing`. Seven commits:
**one per block (A–E)**, plus two documentation commits (`f0adc78`, `3739bce`) for this report and
the refreshed test inventory. No commit carries a Co-Authored-By / "Generated with" trailer, and
nothing was pushed.

| Commit | Block |
| --- | --- |
| `6965665` | A — canvas panning, cross-wireframe clipboard, select-all / cut / F2 |
| `b3c9816` | B — canvas device presets and zoom-aware edge resize handles |
| `e3abdc7` | C — generated lazy emoji catalog, recent picks, emoji field for every text input |
| `2f03d0f` | D — responsive layouts with overlay drawers, error boundary, lazy locales |
| `726393c` | E — Chart element with table/CSV editor, ASCII and Markdown export, schema |
| `f0adc78` | docs — this report + test inventory |
| `3739bce` | docs — corrected the measured browser geometry table |

Every number below was produced by a command run in this repository during the work; nothing is
projected. Where a check could not be run, it says so explicitly.

---

## Numbers

### Tests

| Point in time | Test files | Tests | Command |
| --- | --- | --- | --- |
| baseline (`feature/canvas-and-drawing`, before any change) | 31 | 319 | `npm test` |
| after A | 33 | 350 | `npm test` |
| after B | 34 | 373 | `npm test` |
| after C | 35 | 394 | `npm test` |
| after D | 37 | 409 | `npm test` |
| after E (final) | **39** | **451** | `npm test` |

### Bundle size (`npm run build`, gzip)

| Point in time | `index-*.js` raw | `index-*.js` gzip | `index-*.css` gzip |
| --- | --- | --- | --- |
| baseline | 539.49 kB | **170.58 kB** | 8.32 kB |
| after A | 550.79 kB | 174.13 kB | 8.34 kB |
| after A+B | 567.56 kB | 178.27 kB | 8.68 kB |
| after C | 561.94 kB | 176.26 kB | 8.76 kB |
| after D | 401.02 kB | 125.37 kB | 9.62 kB |
| after E (final) | 430.36 kB | **134.74 kB** | 9.93 kB |

The emoji work (C1) *shrank* the base chunk: 178.27 → 176.26 kB gzip (−2.01 kB) against a budget of
+5 kB, because the 336-entry hand-written list left the base chunk and the generated data moved into
lazy chunks. C1's own lazy chunks:

| Chunk | raw | gzip |
| --- | --- | --- |
| `glyphs.generated-*.js` (1 914 glyphs) | 9.41 kB | **5.08 kB** |
| `names.zh.generated-*.js` | 41.85 kB | 35.59 kB |
| `names.ja.generated-*.js` | 46.72 kB | 33.14 kB |
| `names.es.generated-*.js` | 96.97 kB | 29.38 kB |
| `names.sr.generated-*.js` | 99.70 kB | 31.46 kB |
| `names.en.generated-*.js` | 103.24 kB | 33.09 kB |
| `names.de.generated-*.js` | 118.18 kB | 36.07 kB |
| `names.ru.generated-*.js` | 118.28 kB | 47.74 kB |
| `names.fr.generated-*.js` | 131.10 kB | 39.47 kB |

D8 (lazy locale dictionaries) removed another ~51 kB gzip from the base chunk; the remaining locale
chunks are 8.74–10.45 kB gzip each (`zh`, `ja`, `sr`, `de`, `ru`, `es`, `fr`).

Block E costs +9.37 kB gzip on the base chunk (chart model, editor popup, renderer, exporter,
schema, 32 i18n keys × 8 locales). The final base chunk is still **35.84 kB gzip smaller** than the
1.1.0 baseline, thanks to the lazy emoji and locale chunks.

### D7 — browser geometry measurements

Measured with `node scripts/measure-layout.mjs` (the DEV-only `?measure=1` harness, see
[testing.md](./testing.md#browser-layout-measurements-d7)) in a real headless Chromium
(`chrome-headless-shell`, window = viewport, `devicePixelRatio` 1):

| | 820 × 900 (tablet) | 390 × 700 (phone) | 1280 × 900 (desktop) |
| --- | --- | --- | --- |
| layout class | `layout-overlay` / `layout-tablet` | `layout-overlay` / `layout-phone` | `layout-desktop` / `layout-desktop` |
| **horizontal page scroll** | **no** (820 = 820) | **no** (390 = 390) | **no** (1280 = 1280) |
| canvas viewport width | 820 px = **100 %** | 390 px = **100 %** | 562 px = 44 % (three side columns) |
| canvas viewport height | 711 px | 524 px | 712 px |
| toolbar height / wrapped rows | 107 px / **2** (was 3) | 68 px / **1** | 93 px / 2 |
| side columns visible | none (drawers) | none (drawers) | Add + Layers + Properties |
| Add drawer | opens, visible, closes (320 px) | opens, visible, closes (320 px) | n/a |
| Layers drawer | opens, visible, closes (320 px) | opens, visible, closes (320 px) | n/a |
| Properties drawer | opens, visible, closes (340 px) | opens, visible, closes (340 px) | n/a |
| touch pinch | scale 0.637 → 1.401 | 0.278 → 0.612 | 0.422 → 0.928 |
| touch pan (two fingers +60/+30 px) | scroll moved exactly −60 / −30 | −60 / −3 (clamped at the top edge) | −60 / −30 |
| error boundary | rendered, "Try again" recovers | rendered, "Try again" recovers | rendered, "Try again" recovers |
| emoji picker (C1/C3) | 171 cells, 320 × 344 at (492, 260), inserts at the caret | 171 cells, 374 × 344 at (8, 221), inserts at the caret | 171 cells, 320 × 344 at (952, 219), inserts at the caret |
| Chart element (E2–E4) | added, popup opened, Done committed, history grew; dialog 754 × 792 at (33, 54) | same; dialog **390 × 616 at (0, 0)** — a full-screen sheet inside 390 × 700 | same; dialog 1100 × 792 at (90, 54) inside 1280 × 900 |

Before this release the same harness shape read ~174 px canvas viewport at 820 px and ~40 px at
390 px with a horizontally scrolling page (the numbers quoted in the task). The projects drawer is
**not** covered: it only exists for a signed-in session and there is no backend running here, so
`present: false` is all that could be measured (see Risks).

---

## Block A — editor quick wins

### A1 Viewport panning

* New pure module `src/canvas/pan.ts` (`panScroll`, `pinchScale`, `touchCentroid`, `touchDistance`,
  `anchorScrollFor`) with `src/canvas/pan.test.ts`.
* `src/components/CanvasEditor.tsx` owns the wiring: middle-mouse drag, `Space` + left drag
  (cursor `grab` / `grabbing`), and — on touch — a two-finger drag that pans while a pinch zooms.
  The pointerdown listener runs in the **capture** phase on `.canvas-viewport` and calls
  `stopPropagation()`, so the engine never sees a pan pointerdown: a pan cannot start or cancel an
  element drag and never leaves a history transaction open. Middle-click autoscroll / paste are
  suppressed (`mousedown`, `auxclick`). One-finger touch keeps the marquee semantic; a second finger
  arriving during a `move`/`resize` is ignored (the engine gained a read-only `getGestureKind()`),
  so that gesture's transaction is never orphaned.
* Pan writes only `scrollLeft` / `scrollTop` of `.canvas-viewport`; zoom/geometry/hit-test are
  untouched and nothing is serialized. `.canvas-viewport` gained `touch-action: none` +
  `overscroll-behavior: contain`.
* **Decision:** `Space` only calls `preventDefault()` while the focus is in the canvas column, so the
  space bar still scrolls a focused panel.
* **Bug found and fixed while verifying this** (also affects the pre-existing wheel/trackpad zoom
  anchoring): `anchorScrollFor` had the correction inverted and, more importantly, a pan step was
  applied against a stale canvas position. It is now
  `scroll + (canvasPosition − pointer + content × scale)` where *all three* inputs are read at the
  same instant, and the wheel-zoom layout effect uses the **same** function instead of its own
  inline copy. The unit tests document the semantics (including a 5-step no-drift case) and the
  browser harness reproduces exactly −60/−30 px of scroll for a +60/+30 px two-finger drag.

### A2 Cross-wireframe clipboard

* New `src/model/clipboardStore.ts`: a module-level store (`createClipboardStore(storage)`), the
  editor uses the shared `clipboardStore` backed by `localStorage` (`wirefragma.clipboard`). It is
  not React state, so `Cmd+C` immediately followed by `Cmd+V` still works; every `set()` gets a fresh
  `token`, and `App` restarts the paste cascade when the token changes — inside one wireframe the
  cascade behaviour is byte-for-byte what it was before.
* Payloads are re-validated on read (unknown type, missing geometry, non-finite numbers, an empty or
  oversized element list are rejected), writes/reads are wrapped in `try/catch`, and a payload above
  64 K stays in memory and is not mirrored.
* `WirefragmaClipboard` gained the optional `layerNames` map: a paste that cannot find the source
  `layerId` looks for a layer with the same **name** before falling back to the active layer. Layers
  are never created, parent links to missing parents are still dropped, names stay unique.
* **Decision:** New / Import **keep** the clipboard (the old behaviour cleared it). Rationale: the
  clipboard is cross-wireframe now and behaves like the OS clipboard — replacing a document should
  not destroy what the user just copied — and it is safe because an unmatched layer falls back to
  the active layer instead of creating one. Documented in `docs/history-and-clipboard.md` and
  `docs/known-limitations.md`.

### A3 Shortcuts

* `Cmd/Ctrl+A` → `selectableElements(project)` in `src/model/selection.ts`, i.e. exactly the
  marquee predicate (visible + unlocked, document order) — one selection change, no history entry.
* `Cmd/Ctrl+X` → copy the deletable members, then delete, in **one** `mutate()` (one undo step);
  locked members are skipped and reported.
* `F2` → focuses and selects the Name field (`PROPERTIES_NAME_FIELD_ID` exported from
  `PropertiesPanel`).
* All guarded by `isEditingTextInput`, all listed in `canvas.hint` and in
  `docs/interactions.md#keyboard`.

### Files touched (A)

`src/canvas/pan.ts` (+test), `src/canvas/interaction.ts`, `src/components/CanvasEditor.tsx`,
`src/components/PropertiesPanel.tsx`, `src/model/clipboard.ts`, `src/model/clipboardStore.ts`,
`src/model/clipboard.test.ts`, `src/model/selection.ts`, `src/model/selectAll.test.ts`,
`src/App.tsx`, `src/styles.css`, `src/i18n/en.ts` + 7 locales, `docs/interactions.md`,
`docs/history-and-clipboard.md`, `docs/known-limitations.md`, `docs/canvas-engine.md`,
`CHANGELOG.md`.

### Deviations / not done (A)

* Nothing from A1–A3 was skipped. `docs/known-limitations.md` now states the real limits: the
  clipboard crosses tabs of the same origin, not origins, and a > 64 K payload is memory-only.
* The A1 touch gesture is covered by the browser harness (synthetic `PointerEvent`s with
  `pointerType: "touch"`), not by a physical device; see Risks.

---

## Block B — canvas size

### B1 Device presets

* New pure catalog `src/model/canvasPresets.ts` (ids as a literal union, so the toolbar's
  `canvas.preset.<id>` i18n keys cannot drift), re-exported from `src/model/defaults.ts`, with all
  the required entries (Phone 375×667 … 412×915, Tablet 768×1024 / 1024×768 / 834×1194, Desktop
  1280×720 … 1920×1080, Other A4 / Square / 16:9 / 4:3) plus groups.
* `WireframeProject.canvas` gained the additive optional `preset?: CanvasPresetId`.
  `normalizeProject` drops an unknown id **and** an id whose dimensions disagree with
  `width`/`height` (otherwise the document could describe two different canvases). No version bump.
* The toolbar renders one grouped `<select>`: the three classic modes first (unchanged for old
  documents), then Phone / Tablet / Desktop / Other, then "Custom…". A `⇄` button flips
  portrait ↔ landscape through `flipCanvas`, which re-derives a matching device preset, else a
  matching classic mode (mobile ↔ mobile landscape), else a plain custom size.
* **Decision on the export:** the advisory `## Screen` section names the preset
  (`Device preset: iPhone 15`) only when `canvas.preset` is a known id. The canonical `ui-project`
  block carries the id itself, so the round trip is lossless with or without that line.
  Documented in `docs/markdown-format.md` and `docs/data-model.md`.

### B2 Edge resize handles

* Three DOM affordances inside `.canvas-frame` (right edge, bottom edge, bottom-right corner), half
  outside the frame so they barely overlap the drawing area. They are **not** elements, not part of
  `geometry.ts` / `hitTest.ts`, and never scale with zoom. Coarse pointers get a larger grab area
  in CSS.
* `src/model/canvasSize.ts` holds the pure maths: `canvasSizeFromDrag` (only the dragged axes move,
  the dragged edge snaps to the grid when Snap is on, clamped to `MIN/MAX_CANVAS_SIZE`) and
  `elementsOutsideCanvas`.
* The drag divides the screen delta by the current zoom, opens the usual history transaction
  (one drag = one undo step) and shows a live `W × H` badge. A manual size switches
  `canvas.mode` to `custom` and drops `canvas.preset`.
* Elements are never moved, scaled or deleted; when the new bounds leave elements completely
  outside, a non-blocking toast reports the count.

### B3 Tests

`src/model/canvasPresets.test.ts` (23 cases): unique ids, non-empty known groups, the promised
device list, min/max bounds, lookup by id/size, flip (including "its own inverse for every preset"
and the classic-mode round trip), normalization of unknown/contradictory/non-string ids, JSON round
trip, `canvasSizeFromDrag` (axes, snapping on/off, rounding, clamping) and `elementsOutsideCanvas`
(inclusive edges).

### Files touched (B)

`src/model/canvasPresets.ts` (+test), `src/model/canvasSize.ts`, `src/model/defaults.ts`,
`src/model/project.ts`, `src/components/AppToolbar.tsx`, `src/components/CanvasEditor.tsx`,
`src/App.tsx`, `src/styles.css`, `src/utils/markdownExport.ts`, `src/i18n/*` (8),
`docs/{data-model,markdown-format,persistence-and-migrations,canvas-engine,interactions}.md`,
`CHANGELOG.md`.

### Deviations / not done (B)

* Two catalog entries share dimensions with another (`desktop-1280x720` vs `other-16-9`,
  `tablet-ipad-landscape` vs `other-4-3`). `presetMatchingSize` returns the first match in catalog
  order (a device preset); flipping a preset whose flipped size is one of those picks the *first*
  matching entry. This is documented in the test rather than disambiguated, because both entries
  must exist.
* `flipCanvas` has no landscape twin for the phone presets, so flipping an iPhone preset yields a
  custom size (documented in `docs/data-model.md`). Adding twins was not requested and would have
  doubled the catalog.

---

## Block C — emoji

### C1 Generated catalog, lazy chunks

* `scripts/generate-emoji.mjs` (dev-only, offline, deterministic — the generator author verified
  byte-identical output over 5 consecutive runs) produces the committed
  `src/model/emoji/glyphs.generated.ts` and `src/model/emoji/names.<locale>.generated.ts`.
  Glyphs are encoded as primitive data (`"<categoryIndex><emoji>"` records joined by U+001F) and
  built at module load, which also avoids a TypeScript "union type too complex" failure that the
  first object-literal version hit.
* **1 914 fully-qualified emoji**: base glyphs only (0 skin-tone hexcodes, 0 bare regional
  indicators), 249 ZWJ sequences, 270 flags, 9 categories (`Flags` added; the original 8 ids
  unchanged). All 336 glyphs of the old hand-written list are present and matched exactly. The
  common UI glyphs 💳 📧 🗑️ 💰 🏳️ and all country flags are present.
* Data sources: `emojibase-data` for en/ru/de/fr/es/ja/zh; CLDR `sr-Latn` for Serbian (added
  `cldr-annotations-full` **and** `cldr-annotations-derived-full` as devDependencies — the latter
  was needed because the former ships no `annotationsDerived`; without it Serbian would have been
  1 588/1 914). **All eight languages have real data; none fell back to English.**
* `src/model/emoji.ts` now exposes `loadEmojiCatalog({ language })` (glyph chunk + active language +
  English), `searchEmoji(catalog, query)`, `emojiByCategory(catalog, category)`,
  `foldEmojiText`, `isEmojiLanguage`, `resetEmojiCache`. Search is case- and accent-insensitive
  (`é`→`e`, `č`→`c`, `ё`→`е`), matches names and keywords, requires every word of a multi-word
  query, and always covers the current UI language plus English. The old curated keywords survive as
  `EMOJI_KEYWORD_EXTRAS` (61 glyphs / 72 terms: `rocket`, `cart`, `warning`, …).
* **Decision:** the picker's `emoji.recent` tab is *first* and only shown when non-empty (as asked);
  the category list is the 9 real categories plus that tab, so the tab strip wraps in a narrow
  popover but never hides a category.

### C2 Recently used

`src/model/emojiRecent.ts`: `wirefragma.emoji.recent`, capped at 24, deduplicated, validated on read
(strings, ≤ 16 chars, non-empty), `try/catch` everywhere, never part of a project or the cloud.

### C3 `EmojiTextField` everywhere

* `src/components/EmojiTextField.tsx` wraps an `<input>`/`<textarea>` + a 🙂 button; the insertion
  maths is the pure `insertEmojiAtSelection` (`src/utils/emojiInsert.ts`) — insert **at the caret,
  replacing the selection**, never the whole value, focus and caret restored, and the same `onChange`
  path so `coalesceKey` history coalescing is untouched.
* Used in: element **Name**, **Label** (except Icon/Image), **Note**, **Items**, **Columns**, project
  **Title**, the Canvas popup's **label / text / LLM description**, the Drawing popup's
  **description**, the Properties scene description, and **layer rename**.
* **Decision:** for `icon`/`image` the Label keeps the older *replace the label* picker (as the
  prompt requires); every other Label field inserts at the caret.
* The popover is `position: fixed` and flips/clamps inside the viewport; Escape and outside clicks
  close it and focus returns to the field (verified manually in the browser harness page).

### C1–C3 verified in a real browser

The D7 harness also opens the first `EmojiTextField`, waits for the lazy chunks and picks a cell:

* pixel-3 / phone: the popover measured **374 × 344 at (8, 221)** inside a 390 × 700 viewport
  (`pickerInViewport: true`), 171 cells (the Smileys category), category tabs present;
* picking 😀 inserted it **at the caret** into the project Title field (`"Untitled😀"`, i.e. the
  emoji went after the existing text rather than replacing the value) and focus/caret were restored;
* running the same profile twice showed the **Recent** tab on the second load with exactly one cell
  (the previously picked 😀), and picking it appended a second 😀 — the `localStorage` round trip and
  the "first tab when non-empty" rule both work in the browser, not just in unit tests.

### Files touched (C)

`scripts/generate-emoji.mjs`, `scripts/README.md`, `src/model/emoji/*.generated.ts` (9 files),
`src/model/emoji.ts`, `src/model/emoji.test.ts`, `src/model/emojiRecent.ts`,
`src/utils/emojiInsert.ts` (+test), `src/components/EmojiTextField.tsx`,
`src/components/EmojiPicker.tsx`, `src/components/PropertiesPanel.tsx`,
`src/components/LayersPanel.tsx`, `src/components/DiagramEditor.tsx`,
`src/components/DrawingEditor.tsx`, `src/styles.css`, `src/i18n/*` (8),
`docs/typography-and-symbols.md`, `docs/README.md`, `package.json` (devDependencies only),
`CHANGELOG.md`.

### Deviations / not done (C)

* `cldr-annotations-derived-full` is a second devDependency beyond the one suggested; the reason is
  above. No runtime dependency was added (`dependencies` is still `react`, `react-dom`).
* The generated data is ~1.05 MB of TypeScript source (committed). It is the price of "generated,
  not hand-written" plus "search in 8 languages"; the *runtime* cost is what the chunk table shows.
* Serbian's `sr` UI dictionary is Latin script and so is the CLDR `sr-Latn` annotation data, which is
  why `sr-Latn` (not `sr`, Cyrillic) is the source.

---

## Block D — responsive editor

### D1 Breakpoints and drawers

* `src/utils/layoutMode.ts` holds the thresholds as pure data (`desktop ≥ 1100`, `tablet 768–1099`,
  `phone < 768`) with tests; `src/utils/useMediaQuery.ts` reads the **same** numbers through
  `matchMedia` (`useLayoutMode`, `useCoarsePointer`), so CSS and JS cannot drift.
* Below 1100 px the workspace becomes a single column and the *same* panels are positioned
  absolutely over it (`.panel.drawer-left` / `.drawer-right` + `.open`, scrim, `visibility` flipped
  without a transition delay). No second markup tree, no duplicated state. Escape or a scrim click
  closes the open drawer, the drawer state is never remembered, and selecting an element never opens
  one.
* Tablet keeps everything visible plus three drawer buttons (Add / Layers / Properties); the phone
  toolbar is a compact bar — drawer buttons, undo, redo, zoom −/+/fit, Export and a **⋯** menu
  holding New, Import, Copy for LLM, Grid, Snap, grid size and canvas size/preset. Nothing is
  unreachable.
* The signed-in projects panel is a left drawer in the overlay layouts (`.workspace-drawer`).

### D2 Viewport

`100dvh` with the `100vh` fallback on `.app` / `.boot-screen` / `.auth-screen`,
`env(safe-area-inset-*)` padding on the toolbar, workspace and sign-in screens, and
`viewport-fit=cover` in `index.html`.

### D3 Touch ergonomics

Toolbar / panel-header / dialog-footer buttons and selects get a ≥ 40 px target at ≤ 1099 px **or**
with `(pointer: coarse)`. The canvas element handles keep the existing rules: the coarse-pointer
tolerance is the single `HANDLE_HIT_COARSE_PX` constant threaded through the one hit test as
`hitTestProject(..., { coarsePointer })`; `handleTolerance.test.ts` asserts at 0.25× / 0.5× / 1× /
2× / 4× that a coarse pointer grabs a handle a fine pointer does not, that the tolerance stays a
screen-pixel rule, and that the element body hit is unchanged.

### D4 Dialogs

At ≤ 767 px dialogs become full-screen sheets (`100dvh`, no border radius, scrollable body) and
inputs/selects/textareas are capped at `max-width: 100%`; the emoji popover shrinks to
`calc(100vw - 16px)`. The 360 × 640 claim is CSS-level (no dialog was opened in the browser
harness; see Risks).

### D5 Workspace / AuthScreen

The sign-in grid (`minmax(0, 1.2fr) minmax(400px, 1fr)`) collapses to one column at ≤ 900 px — the
400 px minimum would otherwise force horizontal scrolling on a phone; the hero keeps a compact
header instead of being hidden. The projects panel is a drawer and is capped at `max-width: 100%`.

### D6 Error boundary

`src/components/ErrorBoundary.tsx`: a class boundary rendering a localized message, "Try again"
(clears the error; the document, undo history and autosave state all live above it) and
"Export what I have" (the current project JSON, via the existing `projectToJson` + `downloadText`).
It is installed **inside** `App` (so a child crash keeps the editor's own history state) **and**
inside `Workspace` above `<App>` (so a crash in `App`'s own render body keeps the workspace's
in-memory history cache — a ref — and still offers the download). The browser harness renders a
deliberately crashing child in the real boundary and confirms the fallback, both buttons and that
"Try again" recovers.

### D7 Verification

See the measured table at the top. `?measure=1` (`src/dev/measureLayout.ts`, DEV only) reads real
DOM geometry, opens/closes every drawer, runs a synthetic two-finger pinch + pan and probes the
error boundary; `scripts/measure-layout.mjs` drives it with `--dump-dom`. Raw JSON:
`/tmp/d7-measurements.json` (ephemeral — the numbers are reproduced in the table and by re-running
the script).

### D8 Lazy locales

Only English stays in the base chunk. `main.tsx` preloads the stored language **before the first
render**, so a non-English user never sees a frame of English; a language switch in Settings keeps
the previous language on screen until the chunk has arrived, then swaps in one frame; `translate()`
falls back to English for a chunk that has not loaded. `src/i18n/i18n.test.ts` now loads all eight
dictionaries explicitly. Base chunk: 176.26 → **125.37 kB gzip**.

### Files touched (D)

`src/utils/layoutMode.ts` (+test), `src/utils/useMediaQuery.ts`, `src/components/ErrorBoundary.tsx`,
`src/components/AppToolbar.tsx`, `src/components/LeftPanel.tsx`, `src/components/PropertiesPanel.tsx`,
`src/components/CanvasEditor.tsx`, `src/canvas/geometry.ts`, `src/canvas/hitTest.ts`,
`src/canvas/interaction.ts`, `src/canvas/handleTolerance.test.ts`, `src/canvas/pan.ts` (+test),
`src/App.tsx`, `src/account/Workspace.tsx`, `src/i18n/index.tsx`, `src/i18n/i18n.test.ts`,
`src/i18n/*` (8), `src/main.tsx`, `src/styles.css`, `index.html`, `src/dev/measureLayout.ts`,
`scripts/measure-layout.mjs`, `scripts/README.md`,
`docs/{canvas-engine,interactions,testing,i18n-and-theming}.md`, `CHANGELOG.md`.

### Deviations / not done (D)

* The tablet toolbar still needs **two** rows at 820 px (it was three before; the canvas no longer
  loses width to it). Getting to one row would mean hiding controls behind a menu on tablet, which
  the prompt only asks for on phones.
* D4 is implemented in CSS and asserted by construction, **not** measured: the harness never opens
  the Export/Import/Settings dialogs at 360 px. The emoji-picker clamp *is* exercised indirectly.
* The projects drawer and the signed-in `Workspace` could not be measured at these widths: there is
  no running PHP/MySQL backend, so the app ran as the guest editor (`present: false`).
* The `visibility` transition needed a second CSS iteration: a plain `transition: visibility 160ms`
  delays the change, so the first harness run reported drawers as "closed" while they were sliding.
  The final rule flips `visibility` instantly when opening and after the slide when closing.

---

## Block E — Chart element

**Process note:** Block E was implemented by a delegated agent against a written spec (after I had
read the codebase and the docs), and then independently verified by me: `npx tsc --noEmit`,
`npm test` (39 files / 451 tests, run by me), `npm run build`, targeted greps for the invariants
below, and the browser probe described at the end of this section. Everything below is what the
code and commands actually show.

### E1 Model

`src/model/chart.ts` (pure, 194 lines): `CHART_KINDS`, `isChartKind`, `CHART_LIMITS`
(24 categories / 8 series / 40-char names / 80-char title / ±1e12), `createChartData()` (3 categories
× 2 series demo), `normalizeChartData(value)` (never throws; unknown kind → `bar`; optionals filled;
finite numeric strings coerced; `null` / `""` / `NaN` → a **gap**; values clamped; pie/donut use the
first series only), plus `isSingleSeriesKind`, `chartValue`, `chartSummaryCounts`,
`chartMaxAbsValue`.

`WireframeElement.chart?: ChartData` is additive and optional; `normalizeProject` calls
`normalizeChartData` for `type === "chart"`; `cloneElement` deep-copies it
(`JSON.parse(JSON.stringify(...))`), which is what makes copy/paste and duplicate safe. Verified:

* `PROJECT_VERSION` is still **2** (`grep`), `LEGACY_PROJECT_VERSION` still 1;
* `dependencies` in `package.json` is still exactly `react` + `react-dom`;
* `grep -rn chart src/canvas/{geometry,hitTest,interaction,transform}.ts src/model/hitAreas.ts` →
  **no matches**: the Chart is a bounds element and reuses the one geometry and the one hit test;
* `docs/data-model.md` documents the field, the limits and the "no hit regions" rule.

### E2 Palette and type registration

`ELEMENT_TYPES` / `ELEMENT_TYPE_LABEL` ("Chart") / `ELEMENT_DEFAULTS.chart = 360 × 240` /
`PALETTE_GROUPS` Content entry / `ElementPalette` glyph `▧` / `createElement` attaches
`createChartData()`. The Chart is a normal palette element (verified in the browser below).

### E3 Rendering

`src/canvas/render.ts` gained `case "chart"` **and an exported `drawChartScene`** that the editor
popup reuses — the same pattern `DiagramEditor` already uses with `drawDiagramScene`, so the preview
and the wireframe cannot drift. All six kinds, `horizontal` bars, axes, light gridlines, `fitText`
category labels, optional legend and values, flat grays plus the existing accent, no gradients or
shadows, clipped to the element bounds at any size/zoom. `isSceneElement` in `CanvasEditor` and
`openSceneEditor` / `commitScene` in `App.tsx` accept `chart`, so double-click, the hover pencil and
the Properties "Edit" button all open its popup.

### E4 Editor popup

`src/components/ChartEditor.tsx` (444 lines) on the existing `SceneEditorShell`: draft copy, its own
undo, **Done = one `mutate(..., { coalesceKey: null })`**, Esc/× discards with the dirty
confirmation. **Table** mode (rows = categories, columns = series, add/remove, Tab/Enter navigation,
invalid cells highlighted red with a count and never written into the model) and **Text/CSV** mode
(paste from Excel/Sheets; tab/comma/semicolon, decimal comma, quoted cells, `""` escapes, ragged
rows, header detection) stay in sync through `mergeParsedChart`. Kind selector with icons, title,
three option toggles, swap rows/columns, and `EmojiTextField` in **every** text field including the
table cells. Parser/serializer: `src/utils/chartText.ts` (`parseChartText`,
`serializeChartText`, `detectChartDelimiter`, `mergeParsedChart`, `formatChartValue`), serializer
delimiter = tab so it can never clash with a decimal comma.

**Decisions the spec left open** (all pinned by tests):

* the demo fallback fires only when `categories` **and** `series` are both *absent*, so an
  explicitly emptied chart stays empty through save/import;
* `categories.length` is the authoritative shape — series are padded with `null` or truncated;
* invalid cells keep the typed text on screen (highlighted) rather than being dropped;
* the preview paints through the wireframe renderer's `drawChartScene`;
* the text mode keeps the table shape when the pasted text has fewer rows/columns.

### E5 Export

`elementSection` emits a compact chart block (kind, title, the data as a **Markdown table**);
`asciiRenderer` draws a horizontal bar sketch for the bar kinds (`Chart: Sessions`, `Jan`/`Feb`
labels, values) and a percentage list for pie/donut, degrading to the existing box when the box is
too small; the spatial summary reports `chart (kind, N series × M categories)`; the WIREFRAGMA
schema export gained a third example element (`sessionsChart`, built through `createChartData()`)
plus a `chart` JSON-Schema fragment, so an LLM can *generate* a Chart. `ui-project` carries `chart`
unchanged (`projectToJson` untouched) and re-import is lossless — asserted by
`markdownRoundTrip.test.ts`.

### E6/E7 Tests

`src/model/chart.test.ts` (15 cases: kinds, demo, limits, coercion, never-throws over 12 junk
inputs, JSON round trip), `src/utils/chartText.test.ts` (19 cases: the three delimiters, decimal
comma, quoted cells, ragged rows, invalid-cell coordinates, header detection, limits, round trip),
plus Chart assertions in `asciiRenderer.test.ts`, `markdownRoundTrip.test.ts`,
`schemaExport.test.ts`, `spatialSummary.test.ts` and the deep-copy checks in `duplicate.test.ts` /
`clipboard.test.ts`. Focused run: **6 files, 91 tests passed**. Full suite: **39 files, 451 tests
passed** (was 37 / 409 before E).

### E verified in a real browser

I extended the D7 harness (`?measure=1`) with a Chart probe and ran it in headless Chromium:

| | 820 × 900 | 390 × 700 | 1280 × 900 |
| --- | --- | --- | --- |
| added from the palette | yes (`chart1` in `__wirefragmaCanvas.elementNames()`) | yes | yes |
| popup opened | yes | yes | yes |
| table / kind selector / emoji button present | yes / yes / yes | yes / yes / yes | yes / yes / yes |
| "Done" committed (popup closed) | yes | yes | yes |
| history grew (Undo enabled afterwards) | yes | yes | yes |
| dialog box | — | **390 × 616 at (0, 0)** — full-screen sheet, inside the viewport | **1100 × 792 at (90, 54)**, inside the viewport |

This also supplies the D4 evidence that was missing earlier: a real dialog measured at phone width
fits 390 × 700 with no horizontal scroll.

### Deviations / not done (E)

* The delegated agent did **not** run a browser pass and did not claim one; the DOM-level probe above
  is mine. **No human has looked at the rendered chart pixels** — the art is verified by code review,
  the ASCII/Markdown renderers' tests and the fact that the popup opens, renders and commits.
* `src/dev/selfTest.ts` was not extended with a Chart pass (not requested).
* `src/model/hitAreas.ts`, `geometry.ts`, `hitTest.ts`, `interaction.ts` and `history.ts` were not
  touched — intentional, and verified by grep.
* `parseChartText` delimiter auto-detection is tested but not exercised against a real spreadsheet
  paste from Excel/Sheets (only synthetic strings).

### Files touched (E)

`src/model/chart.ts` (+test), `src/utils/chartText.ts` (+test), `src/components/ChartEditor.tsx`,
`src/model/project.ts`, `src/model/defaults.ts`, `src/components/ElementPalette.tsx`,
`src/canvas/render.ts`, `src/components/CanvasEditor.tsx`, `src/components/PropertiesPanel.tsx`,
`src/App.tsx`, `src/utils/{markdownExport,asciiRenderer,spatialSummary,schemaExport}.ts`,
`src/styles.css`, `src/i18n/*` (8 files, 32 keys), `src/{model/duplicate,model/clipboard,utils/asciiRenderer,utils/markdownRoundTrip}.test.ts`,
`docs/{data-model,markdown-format,ascii-renderer,typography-and-symbols,architecture,agent-guide}.md`,
`CHANGELOG.md`.

---

## Out of scope (not implemented, as instructed)

Alignment / distribution / guides, group resize, version history, sharing, skin-tone emoji, server
features and new export formats were **not** touched. The cloud footprint did not grow: no new
endpoints, tables, server files or binary assets, and the Chart field is bounded (24 × 8, short
strings, ±1e12) so a document stays far below the 2 MB limit.

## Risks and things I am unsure about

1. **Nobody looked at the pixels.** Everything user-visible here is verified by unit tests, DOM
   geometry, ASCII/Markdown output and the synthetic browser gestures. The Chart's six kinds, the
   emoji picker's look, the drawer animation and the dark theme were never inspected visually.
2. **Touch is synthetic.** The pinch/pan evidence comes from dispatched `PointerEvent`s in a
   headless Chromium, not from a device: iOS Safari's dynamic `100dvh`, real `safe-area-inset`
   values, `pointer: coarse` media queries and a real trackpad pinch are untested. In particular
   `useCoarsePointer()` was never observed returning `true`.
3. **The signed-in half is unmeasured.** No PHP/MySQL backend ran here, so the projects drawer, the
   `Workspace` layout at these widths and account-stored language switching were not exercised; the
   projects drawer reports `present: false` in every measurement. The `EditorErrorBoundary` inside
   `Workspace` is therefore reasoned, not measured.
4. **"Export what I have" was never clicked.** The harness confirms the button exists and that
   "Try again" recovers; the JSON download path itself (and the file dialog) is not covered.
5. **The zoom/pinch anchoring arithmetic changed** (sign and staleness fix, §A1). It is covered by
   unit tests and a synthetic gesture that reproduces an exact −60/−30 px pan, but a human should
   confirm that a real trackpad pinch still feels anchored — the old formula was wrong, so behaviour
   visibly changes for the better.
6. **Two preset pairs share dimensions** (`desktop-1280x720`/`other-16-9`,
   `tablet-ipad-landscape`/`other-4-3`): `presetMatchingSize` returns the first catalog match, so
   flipping picks the device entry. Phone presets have no landscape twin, so flipping one yields a
   custom size.
7. **The tablet toolbar still wraps to two rows** at 820 px (three before). Reaching one row would
   mean hiding controls behind a menu on tablet, which the prompt only asked for on phones.
8. **Emoji data is ~1 MB of generated TypeScript source** (committed). A non-English user fetches two
   chunks (their language plus English, 29–48 kB gzip each) the first time the picker opens; the
   first paint of the picker therefore depends on the network.
9. **`emoji.recent` is per browser** (by design, and documented) — it does not follow the account.
10. **Chart paste detection** is tested with synthetic strings; a real Excel/Sheets clipboard may
    contain something untested (e.g. quoted cells with embedded newlines).
11. **`docs/README.md`'s rough size estimates** (module line counts) are stale; the file list and the
    new `scripts/` entry are up to date.
12. **The generated emoji catalog is only as good as `emojibase-data` / CLDR.** Serbian depends on
    `sr-Latn` annotations; if that package's shape changes, the generator (not the app) breaks —
    the committed data keeps working regardless.
