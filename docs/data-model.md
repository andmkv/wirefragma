# Data model

Source of truth: [`src/model/project.ts`](../src/model/project.ts). The model is plain,
JSON-serializable data — no classes, no DOM nodes, no canvas objects. `JSON.parse(JSON.stringify(p))`
produces an equivalent project.

## `WireframeProject`

```ts
export interface WireframeProject {
  version: 2;
  title: string;
  canvas: { mode: CanvasMode; width: number; height: number };
  layers: WireframeLayer[];       // layers[0] is the FRONT-most layer
  elements: WireframeElement[];   // ONE flat array: the global back-to-front paint order
}
```

* `version` is the **project format version** (`PROJECT_VERSION = 2`, `LEGACY_PROJECT_VERSION = 1`).
* `title` is free text, used for the Markdown `# UI Wireframe: <title>` header and the download
  filename slug.
* `canvas.mode` is one of `desktop | mobile | mobileLandscape | custom`.
* `canvas.width` / `height` are logical project units, clamped to
  `MIN_CANVAS_SIZE = 120` … `MAX_CANVAS_SIZE = 6000`.

### Ordering rules (the only ones that exist)

1. `layers[0]` is the **front-most** layer (top of the Layers panel); the last layer is drawn
   first (furthest back).
2. `elements` is a single flat array in **global back-to-front paint order**. Elements of the same
   layer keep their relative array order, so the effective paint order is a stable partition of
   that array by layer.
3. `zIndex` mirrors an element's position **inside its own layer** (`0` = back of that layer).
   It is derived data: `reindexLayers(project)` recomputes it after structural changes.

Details and examples in [layers-and-z-order.md](./layers-and-z-order.md).

## `WireframeLayer`

```ts
export interface WireframeLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}
```

A layer is grouping + stacking + bulk visibility/locking. It is **not** a separate canvas and it
has no transform of its own. A document always has at least one layer
(`deleteLayer` recreates a fresh `Default` when the last one is removed).

## `WireframeElement`

```ts
export interface WireframeElement {
  id: string;
  type: ElementType;              // 24 values, see below

  name: string;                   // semantic id, e.g. "saveButton" (used in Markdown headings)
  label: string;                  // visible text / emoji drawn on the canvas
  note: string;                   // free-form LLM note

  x: number; y: number;           // world coordinates, Y-down
  width: number; height: number;  // >= MIN_ELEMENT_SIZE (8)

  layerId: string;
  visible: boolean;               // element-level visibility
  locked: boolean;                // element-level locking
  zIndex: number;                 // position inside its own layer (derived)

  items?: string[];               // list / tabs / sidebar / bottomNav rows, table rows
  columns?: string[];             // table column headers
  textStyle?: TextStyle;          // text elements only
  contentSize?: number;           // icon / image symbol size
}
```

### Element types

`ELEMENT_TYPES` (24, in declaration order):

```text
container, text, button, input, textarea, checkbox, radio, toggle, dropdown, slider,
progress, iconButton, tabs, list, table, image, icon, avatar, badge, divider,
toolbar, sidebar, bottomNav, dialog
```

`ELEMENT_TYPE_LABEL` maps each type to its human label used by the palette, the Properties panel
and the Markdown export (`iconButton -> "Icon Button"`, `badge -> "Badge / Chip"`,
`bottomNav -> "Bottom Navigation"`, …).

### What each field means for the renderer

| Field | Used by rendering | Used by hit testing | Notes |
| --- | --- | --- | --- |
| `x, y, width, height` | yes | yes | world units; the source of `bounds` |
| `label` | yes | container only | container labels are selectable; most types draw it as text |
| `items` | tabs, list, sidebar, bottomNav, table | no | `table` rows are `"a | b | c"` strings |
| `columns` | table | no | column headers |
| `textStyle` | `text` only | no | see [typography-and-symbols.md](./typography-and-symbols.md) |
| `contentSize` | `icon`, `image` | no | symbol size, independent of the element bounds |
| `visible` / `locked` | visibility | visibility + locking | combined with the layer, see below |
| `layerId`, `zIndex` | paint order | paint order | see [layers-and-z-order.md](./layers-and-z-order.md) |

### Defaults and limits

| Constant | Value | Meaning |
| --- | --- | --- |
| `MIN_ELEMENT_SIZE` | 8 | smallest `width` / `height` a resize may produce |
| `MIN_FONT_SIZE` / `MAX_FONT_SIZE` | 8 / 96 | `textStyle.fontSize` range |
| `DEFAULT_TEXT_STYLE.fontSize` | 16 | text default |
| `MIN_CONTENT_SIZE` / `MAX_CONTENT_SIZE` | 8 / 256 | `contentSize` range |
| `DEFAULT_ICON_CONTENT_SIZE` | 24 | icon default |
| `DEFAULT_IMAGE_CONTENT_SIZE` | 48 | image default |

## `TextStyle`

```ts
export type TextAlign = "left" | "center" | "right";

export interface TextStyle {
  fontSize?: number;    // 8..96, default 16
  bold?: boolean;       // default false
  italic?: boolean;     // default false
  underline?: boolean;  // default false
  align?: TextAlign;    // default "left"
}
```

Read it through `textStyleOf(element)`, which applies defaults and clamps:

```ts
{ fontSize: 16, bold: false, italic: false, underline: false, align: "left" }
```

Write it through `mergeTextStyle(element, patch)`, which stores **only** values that differ from
the defaults (and returns `undefined` when nothing is left). A text element that was never
restyled therefore has no `textStyle` key at all.

## Optional fields and backward compatibility

`items`, `columns`, `textStyle` and `contentSize` are **optional**. Older projects simply do not
have them, and `normalizeTextStyle` / `normalizeContentSize` return `undefined` for missing or
invalid input rather than inventing values. Helpers apply the defaults at read time
(`textStyleOf`, `contentSizeOf`), so the model stays minimal without losing behaviour.

Because these fields are optional additions, the project format stays at **version 2**; only
version 1 (no layers, no visibility/locking) is migrated, see
[persistence-and-migrations.md](./persistence-and-migrations.md).

## Canonical vs. non-canonical state

| Canonical (serialized) | Optional / backward-compatible | Editor-only (never serialized) |
| --- | --- | --- |
| `version`, `title`, `canvas` | `items`, `columns` | selection (`ids`, `primary`) |
| `layers[]` (`id`, `name`, `visible`, `locked`) | `textStyle`, `contentSize` | hover / cursor, marquee preview |
| `elements[]` (`id`, `type`, `name`, `label`, `note`, `x`, `y`, `width`, `height`, `layerId`, `visible`, `locked`, `zIndex`) | `zIndex` (derived, recomputed) | zoom mode/scale, scroll offset |
| | | grid visibility, grid size, snap toggle |
| | | active layer, open panels, dialogs, toasts |
| | | the internal clipboard |

Invariant: editor-only state must never be written into the project, and must never be exported.
Zoom in particular is view state — `zoom.test.ts` and the Markdown round-trip tests assert that it
does not leak into the document.

## Identity, ids and names

```ts
createId(prefix = "el"): string   // "el_1a2b3c4d" via crypto.randomUUID().slice(0, 8)
```

* `crypto.randomUUID()` is used when available, with a timestamp + counter fallback, so ids are
  unique without a server.
* `normalizeProject` regenerates ids that are empty or duplicated.
* `name` is a *semantic* identifier for LLMs and is not enforced to be unique by the model.
  `defaultNameFor(type, project)` produces `button1`, `button2`, … when elements are created;
  `uniqueName(project, base)` produces `saveButtonCopy`, `saveButtonCopy2`, … when one is copied.

## `normalizeProject` — validation and repair

`normalizeProject(raw: unknown): WireframeProject` is the single entry point for all untrusted
input (import, `localStorage`, hand-written JSON, tests). It **validates structure and repairs
recoverable data**:

Throws `ProjectValidationError` when:

* the value is not an object;
* `version` is neither 1 nor 2;
* `canvas` is not an object, or `width`/`height` are not finite numbers, or smaller than 120;
* `elements` is not an array;
* an element is not an object;
* an element `type` is not one of the 24 known types.

Repairs silently when:

* `layers` is missing or empty -> one fresh `Default` layer;
* `layerId` is unknown -> the **last** layer (the furthest back) becomes the fallback;
* `id` is empty or duplicated -> a new id is generated;
* `width`/`height` are below `MIN_ELEMENT_SIZE` or missing -> clamped/defaulted;
* `items`/`columns` contain empty or non-string entries -> filtered out;
* `textStyle`/`contentSize` are invalid, empty or out of range -> dropped or clamped;
* `canvas.mode` is missing/unknown -> inferred from the dimensions (`inferCanvasMode`);
* `zIndex` is missing -> recomputed by `reindexLayers`.

## Element defaults

`ELEMENT_DEFAULTS` (see [`src/model/defaults.ts`](../src/model/defaults.ts)) drives both `createElement`
and the palette:

| type | w × h | label | items / columns |
| --- | --- | --- | --- |
| `container` | 320 × 200 | `""` | |
| `text` | 220 × 24 | `Text` | |
| `button` | 120 × 40 | `Button` | |
| `input` | 260 × 40 | `Input` | |
| `textarea` | 260 × 96 | `Notes` | |
| `checkbox` | 200 × 24 | `Checkbox` | |
| `radio` | 200 × 24 | `Radio` | |
| `toggle` | 200 × 28 | `Toggle` | |
| `dropdown` | 240 × 40 | `Select` | |
| `slider` | 220 × 24 | `Slider` | |
| `progress` | 220 × 20 | `""` | |
| `iconButton` | 40 × 40 | `+` | |
| `tabs` | 320 × 36 | `""` | items `Tab 1`, `Tab 2` |
| `list` | 280 × 168 | `""` | items `Item 1..3` |
| `table` | 420 × 180 | `""` | columns `Name`, `Status`, `Size`; rows like ``Project A \| Active \| 24 GB`` |
| `image` | 220 × 150 | `""` | empty label ⇒ generic crossed placeholder |
| `icon` | 32 × 32 | `★` | |
| `avatar` | 40 × 40 | `AB` | |
| `badge` | 96 × 28 | `Badge` | |
| `divider` | 320 × 8 | `""` | |
| `toolbar` | 480 × 48 | `Toolbar` | |
| `sidebar` | 220 × 400 | `Sidebar` | items `Item 1..3` |
| `bottomNav` | 360 × 64 | `""` | items `Home`, `Search`, `Profile` |
| `dialog` | 360 × 240 | `Dialog` | |

`createElement(type, project, { x, y, layerId?, name?, width?, height?, label?, items?, columns? })`
rounds the coordinates, sets `visible: true`, `locked: false`, `note: ""` and
`zIndex: <elements already in that layer>`.

Canvas presets (`CANVAS_PRESETS`): `desktop 1200×800`, `mobile 390×844`,
`mobileLandscape 844×390`; `custom` keeps the current size and only switches the mode.

## Pure project transforms

All of these return a **new** project (or the same object when nothing changed) and never mutate
their input:

```text
addElement, updateElement, removeElement
duplicateElement, duplicateElements
reorderElement, bringToFront, sendToBack, moveElement
addLayer, updateLayer, moveLayer, deleteLayer
reindexLayers
```

They are the only way the React shell changes a document, and they are covered directly by
`src/model/layers.test.ts`, `src/model/duplicate.test.ts`, `src/model/clipboard.test.ts` and
`src/model/startup.test.ts`.

## Related documents

* [layers-and-z-order.md](./layers-and-z-order.md)
* [canvas-engine.md](./canvas-engine.md)
* [typography-and-symbols.md](./typography-and-symbols.md)
* [persistence-and-migrations.md](./persistence-and-migrations.md)
