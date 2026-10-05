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

## Emoji picker and catalog (1.3.5)

`src/model/emoji.ts` is the **generated** catalog: every fully-qualified emoji of a recent Unicode
version, base glyphs only (**no skin-tone variants**), including flags and ZWJ sequences that render
as one glyph — currently **1914 entries**. The data is produced by the dev-only
`scripts/generate-emoji.mjs` (from `emojibase-data`, plus CLDR for Serbian) and committed under
`src/model/emoji/*.generated.ts`; `scripts/` is never bundled.

Everything is **lazily loaded** so the base chunk stays small on shared hosting:

| Chunk | Content | gzip (1.3.5) |
| --- | --- | --- |
| `glyphs.generated-*.js` | the 1914 glyphs + their category | ~5 kB |
| `names.en.generated-*.js` | English names + keywords + the curated extras | ~33 kB |
| `names.<lang>.generated-*.js` | one chunk per UI language (ru, de, fr, es, sr, ja, zh) | 29–48 kB |

`loadEmojiCatalog({ language })` fetches the glyph chunk, the active language and **English**, and
merges them: search always covers the current UI language *plus* English, so both `rocket` and
`ракета` find 🚀. Serbian has no emojibase data, so its names come from CLDR `sr-Latn` — the script
the Serbian UI itself uses. No language silently falls back to English, and an unknown language
uses English only, explicitly.

Search is case- and accent-insensitive (`foldEmojiText`: `é`→`e`, `č`→`c`, `ё`→`е`, katakana→hiragana so `ねこ` finds `ネコ`) and matches
names and keywords; every word of a multi-word query must match. The **Recent** tab (first, shown
only when non-empty) lists the last 24 picks from `localStorage` key `wirefragma.emoji.recent` —
never part of a project, never in the cloud.

The pre-1.3.5 hand-written list is gone, but its convenience keywords (`rocket`, `cart`, `warning`,
…) survive as English extras in `EMOJI_KEYWORD_EXTRAS`, so existing habits keep working.

```ts
export type EmojiCategory =
  | "Smileys" | "People" | "Animals" | "Food" | "Activities"
  | "Travel" | "Objects" | "Symbols" | "Flags";

interface EmojiEntry { emoji: string; name: string; keywords: string[]; category: EmojiCategory; search: string }

loadEmojiCatalog({ language }): Promise<EmojiEntry[]>   // lazy chunks, cached per language
searchEmoji(catalog, query): EmojiEntry[]               // empty query -> the whole catalog
emojiByCategory(catalog, category): EmojiEntry[]
```

### The field component: `EmojiTextField`

`src/components/EmojiTextField.tsx` wraps an `<input>` or a `<textarea>` and adds a 🙂 button. It
inserts the picked emoji **at the caret, replacing the selection** through the pure
`insertEmojiAtSelection` (`src/utils/emojiInsert.ts`), calls exactly the `onChange` the user's
typing would call (so `coalesceKey` history handling is unchanged) and puts focus and the caret
back afterwards. Escape or a click outside closes the popover; the popover is `position: fixed`
and flips/clamps inside the viewport.

It is used for the element **Name**, **Label** (except Icon/Image, which keep the older
replace-the-label picker described above), **Note**, **Items** and **Columns**, the project
**Title**, the Canvas / Drawing popup **label / text / LLM description** fields, the Chart popup's
**title**, **kind-independent table fields** (category labels and series names) and its **Text/CSV
area**, and the **layer rename** field.

`EmojiPicker` behaviour (unchanged apart from the points above): category buttons plus a **Recent**
tab while the search box is empty, a compact 8-column grid of `title`-labelled cells scrolled
inside the popover, `Escape` and outside clicks to close, and picking as one normal commit — so it
is one undo step and flows through the usual autosave.

No emoji library is added to `package.json`: `emojibase-data` and `cldr-annotations-full` are
**devDependencies** used only by the generator.

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
