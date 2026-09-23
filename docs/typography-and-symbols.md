# Typography and symbols (Icon / Image)

Sources: [`src/model/project.ts`](../src/model/project.ts) (`TextStyle`, `contentSize`, helpers),
[`src/components/PropertiesPanel.tsx`](../src/components/PropertiesPanel.tsx) (controls),
[`src/components/EmojiPicker.tsx`](../src/components/EmojiPicker.tsx) (popover),
[`src/model/emoji.ts`](../src/model/emoji.ts) (catalog),
[`src/canvas/render.ts`](../src/canvas/render.ts) (drawing),
[`src/utils/markdownExport.ts`](../src/utils/markdownExport.ts) (semantic output).

## Text typography

Behaviour is limited by design: **size, bold, italic, underline, alignment**. There is no
font-family picker, no colours and no rich-text spans.

### Model

```ts
export interface TextStyle {
  fontSize?: number;    // 8..96, default 16
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: "left" | "center" | "right";   // default "left"
}

textStyleOf(element): Required<TextStyle>       // defaults + clamping, used by renderer and panel
mergeTextStyle(element, patch): TextStyle | undefined  // stores only non-default values
```

Only `text` elements read or write `textStyle`; the field is optional and absent on elements that
were never restyled, so old projects stay byte-identical.

### UI

`PropertiesPanel` renders a **Typography** section for `element.type === "text"`:

```text
Size      [ 24 ]                 input[type=number], aria-label="Font size", 8..96
Style     [B] [I] [U]            toggle buttons with title="bold" | "italic" | "underline"
Alignment [Left] [Center] [Right] toggle buttons with title="Align left" | …
```

The toggles derive their next value from the element's **current** state and are applied through
`onUpdateElement(updater)`, which computes the patch inside the document updater:

```ts
onUpdateElement((current) => ({ textStyle: mergeTextStyle(current, next) }), { coalesceKey: key });
```

This matters: clicking B, I and Center in quick succession must accumulate, not overwrite each
other with stale prop-derived state.

### Canvas rendering

`drawElement` case `text`:

```ts
const style = textStyleOf(element);
drawText(c, label, bounds, {
  size: style.fontSize,
  weight: style.bold ? 700 : 400,
  italic: style.italic,
  underline: style.underline,
  align: style.align
});
```

* the element's own **width is the alignment area** (`rect.x`, `rect.x + width/2`, `rect.x + width`);
* the text is vertically centred in the element's height (`textBaseline = "middle"`);
* `underline` draws a line of `max(size/16, 1 screen px)` just below the baseline;
* labels longer than the element width are truncated with `…` by `fitText`, which removes whole
  grapheme clusters only (`Intl.Segmenter`, falling back to `Array.from`) so a clipped emoji can
  never become a lone surrogate.

## Icon and Image symbols

```ts
contentSizeOf(element): number
// icon  -> default 24
// image -> default 48
// clamped to 8..256
```

`contentSize` is the rendered size of the symbol and is **independent of the element bounds**: a
32×32 icon can draw a 48 px emoji, and a 220×150 image can draw a 72 px emoji.

### Rendering

| Element | Condition | Canvas output |
| --- | --- | --- |
| `icon` | always | the label (default `★`) centred at `contentSize` with the emoji font stack, never ellipsised |
| `image` | `label` is empty/whitespace | the generic placeholder: light surface + two crossed diagonals |
| `image` | `label` non-empty | the label (usually an emoji) centred at `contentSize`, never ellipsised, **no** crossed placeholder |

Symbols are drawn with `ellipsis: false`: they use the size the user configured, so a symbol wider
than its element overflows it symmetrically instead of being replaced by `…`.

The emoji font stack is `EMOJI_FONT_FAMILY`:

```text
'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Twemoji Mozilla', 'EmojiOne Color', <FONT_FAMILY>
```

Glyphs come from the platform font — no artwork is bundled, and the exact rendering is
OS-dependent. `ELEMENT_DEFAULTS.image.label` is `""`, so a fresh Image shows the placeholder until
a label is set.

### UI

For `icon` and `image`, the Properties panel shows the label field with an extra emoji button and
a **Content size (px)** number field (8..256, step 2):

```text
Label            [ 🚀                     ] [🙂]      <- emoji button opens the popover
Content size (px)[ 48 ]
```

The button toggles `EmojiPicker`; the picker and the button share an `anchorRef`, so clicking the
button while open closes the popover instead of immediately reopening it.

## Emoji picker and catalog

`src/model/emoji.ts` is a curated, dependency-free catalog of **336 entries**:

```ts
export type EmojiCategory =
  | "Smileys" | "People" | "Animals" | "Food"
  | "Activities" | "Travel" | "Objects" | "Symbols";

export interface EmojiEntry { emoji: string; name: string; keywords?: string[]; category: EmojiCategory }

searchEmoji(query): EmojiEntry[]        // empty query -> the whole catalog
emojiByCategory(category): EmojiEntry[]
```

Search matches the entry name, the emoji itself and the keyword list, so `cat`, `rocket`,
`warning` and `alert` all resolve.

`EmojiPicker` behaviour:

* category buttons (shown when the search box is empty) and a search field (`type="search"`);
* a compact 8-column grid of `title`-labelled cells, scrolled inside the popover;
* clicking a cell writes the emoji into the element's **Label** (the popover stays open so the user
  can keep browsing; the chosen cell is highlighted);
* `Escape` (document-capture listener) and a click outside the picker/anchor close it;
* picking is a normal `onChangeElement({ label }, { coalesceKey: null })` commit, so it is one
  undo step and it flows through the usual autosave.

No emoji library is added to `package.json`.

## Persistence and round-trips

`textStyle`, `contentSize` and emoji labels survive every path, because they are ordinary model
fields:

| Path | Verified by |
| --- | --- |
| `localStorage` autosave/load | `src/model/emoji.test.ts` (emoji + content size through `saveTo`/`loadFrom`), `src/model/typography.test.ts` |
| `ui-project` JSON round trip | `src/utils/markdownSemantics.test.ts`, `src/utils/markdownRoundTrip.test.ts` |
| duplicate / copy / paste | `src/model/duplicate.test.ts`, `src/model/clipboard.test.ts` |
| undo/redo | the whole project is snapshotted by `History<WireframeProject>` |
| Markdown human sections | `Typography:` and `Content size:` lines, see [markdown-format.md](./markdown-format.md) |

`normalizeProject` validates and clamps both fields on import, dropping empty or invalid styles
rather than failing the import.

## Related documents

* [data-model.md](./data-model.md) — field definitions and limits.
* [canvas-engine.md](./canvas-engine.md) — how `drawText` fits into the render pass.
* [markdown-format.md](./markdown-format.md) — how typography is described to an LLM.
