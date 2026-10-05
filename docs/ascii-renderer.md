# ASCII renderer

Source: [`src/utils/asciiRenderer.ts`](../src/utils/asciiRenderer.ts). Pure functions only: the
same project always produces byte-identical output.

## Purpose

The ASCII block gives an LLM a cheap, token-efficient **spatial** impression of the screen: what
is roughly where, how big, and how things nest. It is a *hint*. It is never parsed back into the
model — the canonical source is always the `ui-project` JSON block (see
[markdown-format.md](./markdown-format.md)).

```ts
renderAsciiLines(project): string[]   // one string per character row
renderAscii(project): string          // lines joined with "\n"
```

## Grid

```ts
export const ASCII_WIDE:   AsciiDimensions = { cols: 80, rows: 30 };
export const ASCII_NARROW: AsciiDimensions = { cols: 50, rows: 35 };

getAsciiDimensions(canvas) = canvas.width / canvas.height >= 1.2 ? ASCII_WIDE : ASCII_NARROW
```

Wide canvases (desktop, mobile landscape) get 80×30; tall canvases (mobile portrait) get a narrower,
taller 50×35 grid so the drawing keeps roughly the canvas aspect ratio. The fixed grids also keep
the output stable in size, which matters for prompt budgets.

## Coordinate scaling

```ts
const sx = cols / canvas.width;    // 80 / 1200  for desktop wide
const sy = rows / canvas.height;   // 30 / 800
```

Every element is mapped through `toRect(element, sx, sy, grid)`:

* `x`, `y` are rounded and clamped into the grid;
* `width`, `height` are rounded and clamped so the rect stays inside the grid;
* both are forced to at least 1 cell, so a thin Divider or a tiny Icon is still visible.

Consequences: two elements closer than one cell can collapse onto the same cell; a large canvas
compresses a lot of detail. That is accepted — the ASCII section is a sketch, not a rendering.

## Drawing rules

Elements are drawn in `visibleElementsInDrawOrder(project)` — that is, **back to front**, exactly
like the canvas. The `Grid` is a plain character matrix, so a later element overwrites the cells of
an earlier one; the front-most element wins in any overlapping cell.

Only effective-visible elements are drawn (element `visible` AND layer `visible`).

| Type | Representation |
| --- | --- |
| `container` | `┌─┐ │ └─┘` box, empty interior; the label is a title on the top border (`┌─Contact us──┐`), as on the canvas |
| `divider` | a full-width `─` line on the middle row |
| `toolbar` | box + label at the left |
| `sidebar` | box + label + `• item` rows |
| `text` | its label, one label line per `\n`, top-down from the element's top-left |
| `button` | `[ Label ]` centred; when that does not fit, `[Label]`, and only then a clipped `[Lab…]` |
| `input` | `[ Label______ ]` (underscored fill) |
| `textarea` | box with the first label line + underscore fill |
| `checkbox` | `[x] Label` |
| `radio` | `( ) Label` |
| `toggle` | label + `[●──]` knob at the right (`[●]` when the label would not fit) |
| `dropdown` | `[ Label   ▾ ]` |
| `slider` | label + `───●───` track with a thumb at ~60 % |
| `progress` | `[██████░░░░]` (60 % filled) |
| `iconButton` | `[ Label ]` (default `+`) |
| `tabs` | a `─┬─` strip with per-tab labels |
| `list` | box + item rows, with `─` separators when rows are spaced |
| `table` | box + header row, a `─┼─` separator, then `│`-divided rows |
| `image` | box + `\` / `/` diagonals + optional centred label |
| `icon` | `[label]` (default `★`) |
| `avatar` | `(AB)` centred |
| `badge` | `‹ Badge ›` centred |
| `bottomNav` | box + centred item labels per segment |
| `dialog` | box + title + a separator line |
| `diagram` (Canvas) | box + title + the nested scene sketch |
| `drawing` | box + "Drawing" + the wrapped LLM description |
| `chart` | box + title + horizontal bars with values (bar kinds) or a percentage list (pie/donut); a plain box when the box is too small |
| unknown | plain box |

Labels are clipped with `clip(text, max)`, which truncates with `…`, and centred with
`drawCentered` when the type draws a centred label.

## Clipping, trimming and determinism

* `Grid.put` stops at the right edge (silent horizontal clipping).
* `toRect` keeps every rect inside the grid (vertical clipping).
* Trailing all-blank rows are removed; leading blank rows are **kept** (a mobile canvas whose
  content starts at y=40 begins with a couple of blank lines — visible in the real example in
  [markdown-format.md](./markdown-format.md)).
* An entirely empty canvas renders as a single empty line (`[""]`), so the fenced block stays
  valid.
* There is no randomness, no time and no DOM access, so output is reproducible and snapshot-safe.
  `src/utils/asciiRenderer.test.ts` asserts determinism, grid containment, per-type rendering and
  that every declared element type stays inside the grid.

## What ASCII deliberately does not do

* A `chart` is sketched, not plotted — but each kind is recognisable. The box starts with
  `<Kind> chart: <title>` (and `max N` when it fits). **Bar**: vertical columns over an axis
  (`│ └──`) with category labels underneath; one series gets smooth tops from the eighth-block
  glyphs, several series are told apart by fill (`█ ▓ ▒ ░`) and named in a legend line.
  **Stacked bars**: the series piled up with the same fills. **Line**: points (`● ○ ◆ …`, one per
  series) joined by dots. **Area**: the same, shaded (`░`) under the first series. **Pie**: a disc
  whose cells carry the slice fill, the legend with percentages to its right; **donut**: the same
  with a hole. Negative values are drawn as zero (the Markdown table keeps the sign).
  Fallbacks, in order: horizontal bars (the data asks for `horizontal`, or the columns do not fit),
  a slice list (`█ Alpha 75%`) when a pie has no room for a disc, and a plain box when even a row
  does not fit. Capped at 14 rows; the numbers always travel in the Markdown table and `ui-project`.
* It does not resolve overlaps beyond "last drawn wins per cell".
* It does not honour typography, colour, or `contentSize` (an icon is one cell-sized `[★]`).
* It does not render multi-line text elements beyond stacking label lines downward.
* It is not pixel-accurate and must never be used to reconstruct geometry.

## Related documents

* [markdown-format.md](./markdown-format.md) — where the block appears.
* [canvas-engine.md](./canvas-engine.md) — the accurate renderer, for contrast.
