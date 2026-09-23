# Architecture

## Layers of the application

Wirefragma is a one-page React application with a hand-written Canvas 2D engine. There are five
conceptual layers, and dependencies only ever point downwards.

```text
1. React shell            src/App.tsx, src/components/*, src/main.tsx
   document state - editor state - shortcuts - dialogs - panels
2. Model (pure)           src/model/*
   WireframeProject - layers - elements - selection - clipboard
   normalization - pure project transforms - defaults - emoji catalog
3. Canvas engine          src/canvas/*
   transform - geometry - hitTest - render - interaction
4. Serialization (pure)   src/utils/markdown*.ts, asciiRenderer.ts,
   spatialSummary.ts, history.ts, zoom.ts, storage.ts
5. Platform               DOM, Canvas 2D, Pointer Events, localStorage
```

Invariant: `src/model/**` and the pure helpers in `src/utils/**` must not import React or touch
the DOM, so they keep running under Vitest's `environment: "node"`. The single exception is
`src/utils/storage.ts`: it is written against a `StorageLike` interface and only reaches for
`window.localStorage` inside its two browser wrappers (`loadProject`, `saveProject`).

## Responsibility of each area

### React shell — `src/App.tsx`, `src/components/`

`App.tsx` owns everything the engine is not allowed to know about:

| State | Type | Persisted? |
| --- | --- | --- |
| `history` | `History<WireframeProject>` | only `history.present` is autosaved |
| `selection` | `SelectionState { ids, primary }` | no |
| `clipboardRef`, `pasteCounterRef` | internal clipboard + cascade counter | no |
| `activeLayerId` | `string \| null` | no |
| `zoomMode`, `manualScale`, `zoomView` | fit / manual zoom | no |
| `showGrid`, `snapToGrid`, `gridSize` | canvas aids | no |
| `layersOpen`, `dialog`, pending confirmations, `notice`, `status` | UI chrome | no |

Every document mutation funnels through one helper:

```ts
const mutate = useCallback(
  (updater: (current: WireframeProject) => WireframeProject, options: CommitOptions = {}) => {
    setHistory((current) => {
      const next = updater(current.present);
      if (next === current.present) return current;   // identity: no re-render, no history entry
      return commit(current, next, options);
    });
  },
  []
);
```

Components are presentational: they receive the project (or one selected element) plus
callbacks, and never mutate the document themselves.

| Component | Responsibility |
| --- | --- |
| `components/AppToolbar.tsx` | canvas preset/size, grid, snap, zoom controls, undo/redo, New, Layers toggle, Import, Copy for LLM, Export, brand logo |
| `components/LeftPanel.tsx` | palette column + collapsible layers column |
| `components/ElementPalette.tsx` | the 24 palette buttons (adds to the active layer) |
| `components/LayersPanel.tsx` | layer rows, element rows, drag & drop reordering, visibility/lock toggles, per-element duplicate, delete layer |
| `components/PropertiesPanel.tsx` | single-element inspector, multi-selection panel, typography controls, emoji picker trigger |
| `components/EmojiPicker.tsx` | compact emoji popover (categories, search, grid) |
| `components/ExportDialog.tsx` | Markdown / Copy-for-LLM / Project JSON tabs with Copy + Download |
| `components/ImportDialog.tsx` | paste box + `.md` upload; shows importer errors inline |
| `components/ConfirmDialog.tsx` | in-app confirmation (New project, delete layer) |
| `components/icons.tsx` | the small inline SVGs (eye, lock, caret, trash, duplicate) |

### Model — `src/model/`

| File | Contents |
| --- | --- |
| `project.ts` | element types, `WireframeProject` / `WireframeLayer` / `WireframeElement`, `TextStyle`, `contentSize`, constants, `createId`, `normalizeProject`, queries, pure transforms (`addElement`, `updateElement`, `removeElement`, `duplicateElement`, `duplicateElements`, `reorderElement`, `bringToFront`, `sendToBack`, `moveElement`, `addLayer`, `updateLayer`, `moveLayer`, `deleteLayer`), `reindexLayers`, `mergeTextStyle` |
| `defaults.ts` | `CANVAS_PRESETS`, `ELEMENT_DEFAULTS`, `PALETTE_GROUPS`, `defaultNameFor`, `createElement`, `emptyProject`, `createBlankProject`, `createSampleProject` (fixture for tests/showcase, never loaded at startup) |
| `selection.ts` | `SelectionState` plus every selection rule (toggle, normalize, bounds, marquee, movable/deletable membership) |
| `clipboard.ts` | `copySelection`, `pasteClipboard`, `CLIPBOARD_OFFSET` |
| `hitAreas.ts` | `hitRectsFor` — the semantic hit regions per element type (container border/label, divider band, full bounds) |
| `emoji.ts` | 336-entry curated emoji catalog with categories, names and keywords; `searchEmoji`, `emojiByCategory` |

### Canvas engine — `src/canvas/`

| File | Contents |
| --- | --- |
| `transform.ts` | `ViewTransform`, `worldToScreen`, `screenToWorld`, `worldRectToScreen`, `worldSizeToScreen`, `screenPxToWorld`, `deviceMatrix`, `rectContains`, `rectsIntersect`, `round` |
| `geometry.ts` | `elementGeometry` (bounds + hit regions + resize handles), handle sizing rules, `resizeEdgesForElement`, `visibleGeometries` |
| `hitTest.ts` | `hitTestGeometries` / `hitTestProject` -> `{ kind: "handle" \| "element" \| "none" }` |
| `render.ts` | `renderScene(canvas, SceneInput)` — document, editor chrome, marquee overlay |
| `interaction.ts` | `CanvasInteraction` — pointer state machine, drag/resize/marquee maths, gesture transactions |

Details: [canvas-engine.md](./canvas-engine.md), [interactions.md](./interactions.md).

### Serialization and helpers — `src/utils/`

| File | Contents |
| --- | --- |
| `markdownExport.ts` | `projectToMarkdown`, `projectToLlmMarkdown`, `projectToJson`, `markdownFilename`, `PROJECT_FENCE`, `LLM_PREAMBLE` |
| `markdownImport.ts` | `projectFromMarkdown`, `projectFromJson`, `extractProjectSource`, `MarkdownImportError` |
| `asciiRenderer.ts` | `renderAsciiLines`, `renderAscii`, `getAsciiDimensions` (pure, deterministic) |
| `spatialSummary.ts` | `buildSpatialSummary` — rule-based "what sits where" prose |
| `history.ts` | bounded undo/redo with transactions and coalescing |
| `storage.ts` | `loadProject`, `saveProject`, `loadFrom`, `saveTo`, `clearStoredProject`, storage keys |
| `zoom.ts` | zoom constants and pure zoom maths (`fitScale`, `scaleForMode`, `zoomStep`, `zoomFromWheel`, …) |
| `keyboard.ts` | `isEditingTextInput` — the one place that decides whether the user is typing |
| `clipboard.ts` | `copyText` (OS clipboard with fallback) and `downloadText` (`.md` / `.json` download) |

### Development harness — `src/dev/selfTest.ts`

A development-only script that drives the real application with synthetic DOM pointer/keyboard
events and writes a report (hidden `#selftest-report` plus a visible `#selftest-panel`). Loaded by
`src/main.tsx` only when the URL contains `?selftest=N` **and** the build is a dev build.
See [testing.md](./testing.md).

## Dependency rules

```text
components/*, App.tsx  ->  model/*, canvas/*, utils/*
canvas/*               ->  model/*, canvas/transform
utils/*                ->  model/*
model/*                ->  (nothing)
```

Invariant: `canvas/*` may import `model/*`, but `model/*` never imports `canvas/*` or
`components/*`. The model is the bottom of the stack.

Invariant: there is exactly one hit-test implementation (`canvas/hitTest.ts`) and one geometry
derivation (`canvas/geometry.ts`). Renderer, editor and tests all consume them; a second
"approximately the same" implementation must not be introduced.

## Architectural history that still matters

The current engine exists because an earlier version drew the document with **Konva /
react-konva**. That created two descriptions of the same element — the scene graph used for
drawing and the model used for hit testing — which could disagree, producing the classic
"clicked the button, selected the dialog behind it" bug.

Konva is gone; `package.json` contains only React. The replacement follows the approach proven in
the **NEVERCAT** web editor the original author had already built:

* one document model, one geometry derivation, one coordinate transform, one hit test;
* gestures never write to the document — they snapshot, draw a preview, and emit exactly one
  commit on release;
* editor chrome (selection outline, handles, marquee) is drawn after the document, in screen
  space, so it is never covered by the object it belongs to.

Invariant: do not migrate back to a retained-mode canvas library (Konva, Fabric, PixiJS, …)
without a full architecture review — see
[agent-guide.md](./agent-guide.md#do-not-casually-replace-the-canvas-2d-engine).

## Request / update cycle

```text
user gesture
  -> CanvasInteraction (snapshot, preview, requestRender)
  -> renderScene(canvas, { project, transform, dpr, selectedIds, preview, marquee, ... })
  -> pointerup: exactly one callback
       commitMove / commitResize -> App.handleMoveMany / App.handleResizeElement -> mutate() -> history
       select                    -> App.handleCanvasSelect -> setSelection (editor state only)
  -> React re-render -> CanvasEditor useLayoutEffect -> engine.setState + renderScene
```

Two properties keep this cheap:

* **pointermove never re-renders React.** The engine repaints directly through `requestRender`;
  React only sees the release.
* **commits are identity-checked.** `mutate` returns the previous object when nothing changed, so
  a no-op gesture produces neither a re-render nor a history entry.

## Related documents

* [canvas-engine.md](./canvas-engine.md) — the pipeline in detail.
* [interactions.md](./interactions.md) — gestures and selection.
* [testing.md](./testing.md) — how each layer is verified.
* [agent-guide.md](./agent-guide.md) — the rules.
