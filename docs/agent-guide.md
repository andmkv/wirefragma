# Agent guide

Instructions for a coding agent (Codex, Claude Code, DeepSeek, …) working on Wirefragma. Read this
file before editing anything; it encodes the rules that keep the editor coherent.

## Before changing code

1. Read [README.md](./README.md) (this documentation set's entry point) and the focused document for
   your task — [canvas-engine.md](./canvas-engine.md) + [interactions.md](./interactions.md) for
   anything involving the canvas, [data-model.md](./data-model.md) for model changes,
   [markdown-format.md](./markdown-format.md) for the export, and so on.
2. Inspect the **actual current source** named by those documents. The docs are a map, not a
   substitute: verify signatures, constants and behaviour in `src/` before editing.
3. Run the focused tests for the area you are about to touch (see [testing.md](./testing.md)) so
   you start from a known-green baseline.
4. Prefer the smallest change that preserves the invariants below. Do not refactor adjacent code,
   do not reorder modules, do not re-style unrelated files.
5. After the change: focused tests → `npm run build`. Only then consider a broader run.

## Critical invariants

These are non-negotiable; breaking one of them has already caused real bugs in this project.

1. **One geometry, one hit test.** `src/canvas/geometry.ts` derives everything an element needs
   (`bounds`, semantic `hitRegions`, `resizeHandles`); `src/canvas/hitTest.ts` is the only hit
   resolution. Do not add a second hit-test, a parallel "bounds" helper or an approximation in a
   component.
2. **Rendering and hit testing share canonical geometry.** The renderer draws handles from
   `elementGeometry(element, transform).resizeHandles`, i.e. exactly the handles the hit test can
   grab. Never draw a control that cannot be interacted with.
3. **One coordinate transform.** All world↔screen↔device conversion goes through
   `src/canvas/transform.ts`. Never mix units by hand, and never store a screen coordinate in the
   model.
4. **World units in the document.** `element.x/y/width/height` are logical units. Zoom, scroll and
   DPR live in the view layer only.
5. **Zoom is view state.** It must never change element geometry, canvas size, or the export.
6. **Selection is editor state.** `SelectionState { ids, primary }` is never serialized, never
   exported, and never part of `WireframeProject`.
7. **One gesture = one history step.** A drag or resize opens a transaction (`beginEdit`), commits
   once (`commitMove` / `commitResize`) and closes it (`endEdit`). Never add per-pointermove
   commits, and never leave a transaction open.
8. **Gestures snapshot, they do not accumulate.** Preview geometry is recomputed from the
   pointerdown snapshot on every move.
9. **`ui-project` is the canonical export source.** Human-readable sections are advisory. Never
   parse the ASCII drawing back into the model.
10. **Backward compatibility.** New model fields are optional, and importing an older document must
    keep working. Do not silently bump `PROJECT_VERSION`; a bump requires a migration in
    `normalizeProject` plus round-trip tests.
11. **Layers order, render order and hit order stay consistent.** Top of the Layers list =
    visually front-most = first hit candidate. One ordering helper (`elementsInDrawOrder`) defines
    it.
12. **A Container interior is never greedy.** A Container is grabbed by its border band or its
    label; clicks inside its empty interior pass through to whatever is behind/inside.
13. **Locked and hidden elements are inert.** Hidden: not drawn, not hit-testable. Locked: drawn
    but not hit-testable, and excluded from drag, delete and duplicate. Both are inherited from
    ancestors when elements are nested.
16. **Nested subtrees stay contiguous.** `elements` is kept in canonical tree order by
    `canonicalizeTree` (via `reindexLayers`). Any transform that changes `parentId`, `layerId` or
    array order must end in `reindexLayers`; never hand-build an order that splits a subtree.
14. **Global shortcuts must respect text editing.** Guard every window-level shortcut with
    `isEditingTextInput(event.target)` from `src/utils/keyboard.ts`.
15. **Transient editor state must be repainted explicitly.** Clearing marquee/preview state is not
    enough: call `requestRender()` when the gesture ends, because React may bail out of re-rendering
    when the selection is unchanged.

## Do not casually replace the Canvas 2D engine

The canvas is intentionally explicit Canvas 2D + Pointer Events, and it replaced an earlier
Konva/react-konva implementation that could not keep drawing and hit testing in agreement. The
current design trades convenience for a guarantee: **the thing you see is the thing you click**.

Do **not** migrate to Konva, Fabric, PixiJS, Three.js, an SVG/React reconciliation approach, or a
DOM-per-element approach without a full architecture review, a written migration plan and a
replacement for every rule in [canvas-engine.md](./canvas-engine.md). "It would be shorter" is not
sufficient justification; the geometry contract, handle sizing rules, hit-test priority, DPR
handling, zoom anchoring and pointer lifecycle all have to survive.

## Scope discipline

Wirefragma is a *wireframe sketcher that produces an LLM-readable spec*, not a design tool:

* a fixed palette of 27 generic primitives (24 UI primitives + the Canvas, Drawing and Chart
  elements) is a feature, not a limitation to remove;
* the Markdown export and its `ui-project` block are the product — canvas polish that does not
  improve the export is usually not worth it;
* no rotation, group objects, auto-layout, alignment guides, fonts/colours, rich text, plugins,
  real-time collaboration or AI calls (see [known-limitations.md](./known-limitations.md));
* accounts are an **optional** layer (PHP + MySQL, [accounts.md](./accounts.md)): the editor must
  keep working with no backend at all, and signed-in documents are still plain
  `WireframeProject` JSON;
* MCP ([mcp.md](./mcp.md)) is another client of the same account storage, not a feature of the
  editor: no MCP code in `App`, the canvas engine, the model or editor components, and no AI calls
  from Wirefragma itself;
* prefer keeping the app dependency-free (two runtime dependencies today) over pulling in a library
  for a small feature;
* when a request is ambiguous, favour the smallest interpretation that keeps the export lossless.

## Common tasks and where to touch

### Add a new element type

1. `src/model/project.ts` — add the id to `ELEMENT_TYPES` and a label to `ELEMENT_TYPE_LABEL`.
2. `src/model/defaults.ts` — add to `ELEMENT_DEFAULTS` and to a group in `PALETTE_GROUPS`.
3. `src/components/ElementPalette.tsx` — add a `GLYPH` entry.
4. `src/canvas/render.ts` — add a `case` in `drawElement`.
5. `src/utils/asciiRenderer.ts` — add a `case` in `drawElement` (a box fallback already exists).
6. `src/model/hitAreas.ts` — only if the type needs semantic (non-bounds) hit regions.
7. Tests: `asciiRenderer.test.ts` and `markdownRoundTrip.test.ts` iterate every declared type, so
   they will fail until the new type is handled; add focused assertions for its rendering.

### Add or change a model field

* make it optional and default it at read time (as `textStyleOf` / `contentSizeOf` do);
* validate/repair it in `normalizeProject` (drop or clamp, never throw for recoverable input);
* keep it out of the export unless it is meaningful to an LLM, and if it is, add it to
  `elementSection` **and** to [markdown-format.md](./markdown-format.md);
* add round-trip coverage to `typography.test.ts`-style tests;
* do not bump `PROJECT_VERSION`.

### Change selection, drag, resize or marquee behaviour

* rules live in `src/model/selection.ts` and `src/canvas/interaction.ts` — nowhere else;
* keep `SelectionState` shape (`ids` + `primary`) and the helper contract;
* update [interactions.md](./interactions.md) and add a case to
  `selectionState.test.ts` / `multiDrag.test.ts` / `containerGesture.test.ts` / `marqueeOverlay.test.ts`.

### Change hit testing or geometry rules

* `src/canvas/geometry.ts` (derivation + handle sets) and `src/model/hitAreas.ts` (semantic regions);
* keep the resolution order (handles → front-to-back elements → none);
* update `hitTest.test.ts`, `hitAreas.test.ts`, `overlapRegression.test.ts` and
  [canvas-engine.md](./canvas-engine.md);
* verify at several zoom levels — tolerances are expressed in screen pixels and must stay
  zoom-independent.

### Add a Properties control

* render it in `src/components/PropertiesPanel.tsx`;
* if the new value derives from the current one (a toggle), go through `onUpdateElement(updater)`
  so the patch is computed inside the document updater — clicking two toggles in the same tick must
  not lose one of them;
* otherwise use `onChangeElement(patch, { coalesceKey })` with a stable key so typing coalesces
  into one undo step;
* never edit a field that the multi-selection view would have to merge — mixed-value editing is
  deliberately unsupported.

### Change the export format

* extend `src/utils/markdownExport.ts` by appending, never by reordering or renaming existing
  sections/blocks;
* keep the `ui-project` fence name and `projectToJson`'s field set stable;
* update [markdown-format.md](./markdown-format.md) and `markdownRoundTrip.test.ts` /
  `markdownSemantics.test.ts`;
* remember that the same document is re-imported, so any change must survive a round trip.

### Change the server, accounts or MCP

* project/wireframe persistence exists **once**, in `server/api/lib/projects.php`; the browser API
  (`api/index.php`) and the MCP tools (`server/mcp/src/Tools.php`) are thin adapters over it —
  never add a query or a project rule to only one of them;
* keep `server/api/` dependency-free and PHP 7.4-compatible; Composer code belongs in `server/mcp/`
  (PHP 8.1+);
* handle documents as `stdClass` trees (`wf_input_object_field`, `wf_document_decode`), never
  re-encode an assoc-decoded document — `{}` would become `[]`;
* the MCP schema is generated: after changing the model or `schemaExport.ts`, run
  `npm run mcp:resources` (the `mcpResources.test.ts` staleness test fails otherwise); never write
  a PHP copy of the project format;
* MCP writes never force: `update_wireframe` always passes `force = false`;
* run `server/tests/api-smoke.sh` and `server/tests/mcp-smoke.sh` against a local server and a
  throwaway database (see [testing.md](./testing.md)).

## Common failure modes and how to recognise them

| Symptom | Usual cause |
| --- | --- |
| A click selects the wrong object | Two geometry sources, or hit order not equal to paint order; check `visibleGeometries` + `hitTestGeometries` |
| A handle is drawn but cannot be grabbed | The renderer computed handles independently of `elementGeometry` |
| The interior of a Container swallows clicks | `hitRectsFor` fell back to full bounds for `container`, or the internal `Container` handling was removed |
| A drag jumps on the first move | The delta was accumulated instead of measured from the pointerdown snapshot |
| Undo jumps back several actions | A commit ran per pointermove, or a transaction was left open (`beginEdit` without `endEdit`) |
| A stale overlay stays on screen | Transient state was cleared without an explicit `requestRender()` |
| Typography/visibility toggles "lose" clicks | The patch was derived from props instead of inside the document updater |
| Zoom looks right but clicks are offset | Screen coordinates were stored/compared as world coordinates (or DPR was applied twice) |
| Export/import changes the document | A field was added to the model without a normalizer/serializer update, or `zIndex` was trusted instead of recomputed |
| Projects "disappear" | Different origin (host/port) — see [persistence-and-migrations.md](./persistence-and-migrations.md#origin-scoping) |
| `mcpResources.test.ts` fails | the model or `schemaExport.ts` changed; run `npm run mcp:resources` and commit `server/mcp/resources/` |
| MCP answers 401 with a valid token (production) | the PHP handler drops `Authorization`; see [deployment.md](./deployment.md#mcp-endpoint) |

## Verification protocol

```bash
npx vitest run <the focused test files for your change>
npm run build                     # tsc --noEmit catches unused imports/vars (noUnusedLocals)
```

Then, only if the change is user-visible, run the matching browser pass
(`npm run dev` + `?selftest=N`, see [testing.md](./testing.md)). Never claim a browser/manual check
you did not run, and never claim the suite is green when you only ran a subset.

## Keep the documentation true

If your change alters behaviour described here, update the affected document **in the same
change**. Documentation drift is treated as a bug: the next agent will trust these files.

## Related documents

* [architecture.md](./architecture.md) — where everything lives.
* [canvas-engine.md](./canvas-engine.md) / [interactions.md](./interactions.md) — the contract.
* [known-limitations.md](./known-limitations.md) — what not to "fix" accidentally.
