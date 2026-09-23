# Known limitations

Everything here is a **deliberate** scope boundary or a known rough edge in the current code.
Nothing in this list is a plan; do not "fix" an entry without checking
[agent-guide.md](./agent-guide.md) first.

## Product scope

Wirefragma is a wireframe sketcher that produces an LLM-readable spec — not a design tool.

| Not supported | Notes |
| --- | --- |
| Rotation | no element rotation, no rotated bounds, no rotated hit testing |
| Grouping | no groups, no group selection objects, no nested groups, no instances/components |
| Group resize | a multi-selection can be **moved** but not resized as a unit; handles appear only for a single selected element |
| Alignment / distribution / guides | none |
| Auto-layout / constraints | none; positions are explicit numbers |
| Nested layers | `layers` is a flat list; elements belong to exactly one layer |
| Multi-page / multi-artboard | one canvas per project, one project per storage slot |
| Real assets | Image/Icon content is a **text/emoji label**, not an uploaded file; there is no asset pipeline, no SVG/PNG embedding |
| Rich text | no font-family picker, no colours, no per-span styling, no text boxes with wrapping/line breaks in the model |
| Collaboration / sync | no accounts, no server, no realtime, no comments |
| AI features | none; the "LLM" part of the product is the export format |

## Editor behaviour

* **Marquee selects by bounds.** `marqueeSelection` intersects the rectangle with `elementRect`
  (the full bounds), not with semantic hit regions. Sweeping over a large Container therefore
  selects the Container even though clicking its empty interior does not. This is documented
  behaviour, chosen for predictability.
* **Locked objects are skipped, not unlocked.** Drag, delete and duplicate silently ignore locked
  members of a selection (with a toast when it matters). There is no "unlock and continue" flow.
* **No mixed-value editing.** With several objects selected the Properties panel offers Duplicate
  and Delete only; it never edits shared fields or shows "Mixed".
* **Multi-selection has no group handles** (see group resize above).
* **A fresh Image has an empty label** (`ELEMENT_DEFAULTS.image.label = ""`) and therefore renders
  the crossed placeholder until a label/emoji is set.
* **Text labels are single-line on the canvas.** `render.ts` draws a `text` label with one
  `fillText` call, so a `\n` in a label does not create a second line there, while the ASCII
  renderer *does* split labels on `\n`. Avoid multi-line text labels until this is unified.
* **Small elements offer fewer handles.** Below `MIN_AXIS_HANDLE_PX` (12 CSS px) an axis loses its
  handles so the body stays draggable; Containers only ever offer corner handles.
* **No canvas accessibility layer.** The `<canvas>` exposes no DOM/ARIA representation of its
  content. The panels (palette, layers, properties) are ordinary semantic HTML, so a keyboard user
  can select rows in the Layers panel and nudge with the arrow keys — but the drawing itself is
  invisible to assistive technology.
* **English only.** All UI strings, Markdown sections and messages are hard-coded English.
* **Narrow windows** collapse the Layers column; there is no other responsive behaviour.

## Data and persistence

* **One autosaved slot** per origin (`wirefragma.project.v1`). No project library, no named
  documents, no import/export history.
* **Undo history is not persisted.** A reload starts a fresh `History` with empty `past`/`future`;
  the limit is `HISTORY_LIMIT = 80` entries in memory.
* **`localStorage` limits apply** (typically ~5 MB per origin). Large projects can hit the quota;
  the app surfaces a notice instead of crashing.
* **Origin-scoped** storage: dev and deployed builds, different ports and different schemes keep
  separate projects. Transfer work with the Markdown/JSON export.
* **`zIndex` is derived.** A hand-edited `zIndex` in imported JSON is ignored;
  `reindexLayers` recomputes it from array order.
* **`name` uniqueness is not enforced** by the model. Generated names are unique, but a
  hand-written import can contain duplicates (the Markdown will show both).

## Clipboard

* Object copy/paste uses an **internal** clipboard. Elements cannot be pasted between browser tabs,
  between origins or into another application.
* Only plain text goes to the OS clipboard (the Markdown export, "Copy for LLM"). The OS clipboard
  path can be unavailable over `file://` or without permission, which is exactly why object
  copy/paste never depends on it.

## Export / import

* **Markdown and JSON only.** No SVG, PNG, PDF, HTML or Figma export.
* The human-readable sections are advisory; anything an LLM needs must also be expressible in
  `ui-project`. Typography and symbol sizes are the only style facts in the prose sections.
* The ASCII drawing is approximate: glyphs are one character per cell, `contentSize` and typography
  are ignored, and overlapping elements resolve per cell ("last drawn wins").
* Imports replace the current document and clear the undo history.

## Rendering

* **Emoji are platform glyphs.** Icon/Image symbols render with the OS emoji font, so appearance
  and metrics differ between macOS, Windows, Linux and Android.
* **Label truncation is Unicode-safe but text-only.** `fitText` removes whole grapheme clusters
  (via `Intl.Segmenter`, falling back to `Array.from`), so a clipped `🚀` becomes `…` and can
  never leave a lone surrogate. `icon`/`image` symbols are exempt from truncation — they are drawn
  at `contentSize` and may therefore overflow their element if `contentSize` exceeds its width
  (that is the configured intent, but the symbol is not clipped to the box).
* **The grid is drawn in world space**, so at very low zoom it can alias; there is no
  pixel-snapped grid.
* **No shadows, gradients, blur or clipping regions** — wireframe primitives are intentionally flat.

## Code-level notes for future agents

These are honest observations about the current source, not bugs to fix opportunistically.

* `isElementVisible` / `isElementLocked` exist in **both** `src/canvas/geometry.ts` and
  `src/model/project.ts` (`effectiveVisible` / `effectiveLocked`) with identical semantics. They
  must be kept in sync; unifying them is a reasonable small refactor, but do it deliberately with
  tests, not as a drive-by change.
* Some exported API surface is currently used only by tests: `selection.toggleSelection`,
  `normalizeSelection`, `replaceSelection`, `selectionHas`, `selectionBounds`, `rectsOverlap`,
  `elementRect`, and `interaction.getCursor` / `isGesturing` / `EMPTY_PREVIEW`. They are kept as
  documented helpers; removing them means updating the tests that pin them down.
* `createSampleProject()` in `src/model/defaults.ts` is a **fixture** (used by tests and the
  development showcase pass) and is never loaded at startup. Do not wire it into the first-run
  experience — a fresh install must show a blank project.

## Related documents

* [agent-guide.md](./agent-guide.md) — invariants and scope discipline.
* [interactions.md](./interactions.md) — the exact selection/marquee rules referenced above.
* [markdown-format.md](./markdown-format.md) — what the export does and does not contain.
