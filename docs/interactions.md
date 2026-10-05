# Interactions

Source: [`src/canvas/interaction.ts`](../src/canvas/interaction.ts) (the engine),
[`src/model/selection.ts`](../src/model/selection.ts) (the selection rules),
[`src/components/CanvasEditor.tsx`](../src/components/CanvasEditor.tsx) (wiring),
[`src/App.tsx`](../src/App.tsx) (shortcuts, commits, editor state).

## The engine in one screen

```ts
interface InteractionState {
  project: WireframeProject;
  transform: ViewTransform;
  selection: SelectionState;   // { ids, primary }
  snapEnabled: boolean;
  gridSize: number;            // 4 | 8 | 16 | 20 in the UI
  minSize: number;             // always MIN_ELEMENT_SIZE = 8 from CanvasEditor
}

interface InteractionCallbacks {
  select(selection: SelectionState): void;                       // editor state only
  beginEdit(): void;                                             // a drag/resize starts
  endEdit(): void;                                               // it finished (or was cancelled)
  commitMove(moves: { elementId: string; x: number; y: number }[]): void;
  commitResize(elementId: string, bounds: Rect): void;
  requestRender(): void;
  setCursor(cursor: string): void;
}
```

Four gesture kinds:

```ts
type Gesture =
  | { kind: "none" }
  | { kind: "move";    pointerId; elementId; startWorld; starts: MoveStart[] }
  | { kind: "resize";  pointerId; elementId; edge; startWorld; startBounds }
  | { kind: "marquee"; pointerId; startWorld; additive: boolean; baseIds: string[] };
```

Invariant: **gestures never write to the document.** A gesture snapshots what it needs at
pointerdown, recomputes a preview from that snapshot on every move (never an accumulated delta),
and emits exactly one commit on release. Selection changes may happen at pointerdown, but they are
editor state, not document mutations.

## Selection

Selection is editor state: `SelectionState { ids: string[]; primary: string | null }`. It is never
serialized and never exported. `primary` is the element the Properties panel edits, the element
whose handles are offered, and the element that defines drag snapping.

| Input | Result |
| --- | --- |
| click on an element that is **not** selected | `singleSelection(id)` — replaces the selection |
| click on an element **already selected** | selection unchanged, `withPrimary(selection, id)` |
| Shift-click / Cmd-click / Ctrl-click | `toggleInSelection(selection, id)` — add (and make primary) or remove; removing the primary promotes the last remaining id |
| click on empty canvas | `select(EMPTY_SELECTION)` when the selection is not already empty (a marquee that never moved) |
| Shift-click on empty canvas | selection kept (the click is additive) |
| Layers row click | `singleSelection(id)` (`App.handleSelectFromLayers`) |
| Shift/Cmd Layers row click | `toggleInSelection` |
| `Escape` | `clearSelection()` |

Additional rules:

* `normalizeSelectionState(project, selection)` drops ids that no longer exist and repairs the
  primary; `App` runs it whenever the project changes.
* An element that becomes hidden (directly or through its layer) is dropped from the selection by
  an effect in `App.tsx`.
* Locked elements are not hit-testable on the canvas, so they cannot be selected there; they *can*
  be selected from the Layers panel (to rename, annotate or unlock them).
* Marquee selection ignores hidden and locked elements.
* `App.handleCanvasSelect` compares the incoming selection with `selectionEquals` and keeps the
  previous state object when nothing changed, so a no-op selection costs no re-render.

Selection helpers also used by bulk actions:

```ts
movableSelection(project, ids)    // visible + unlocked, in selection order
deletableSelection(project, ids)  // unlocked (hidden elements may still be deleted)
selectionBounds(project, ids)     // union rect, null when empty
```

## Marquee

```text
pointerdown on empty canvas  -> gesture "marquee" (additive = Shift/Cmd/Ctrl, baseIds = current ids)
pointermove                  -> preview.marquee = rectFromPoints(startWorld, world) + requestRender
pointerup                    -> finishMarquee(...) then requestRender (always)
```

`finishMarquee`:

* `threshold = screenPxToWorld(transform, MARQUEE_CLICK_PX /* 4 */)`;
* if the rectangle is smaller than the threshold on both axes it is a **click**: with no modifier
  and a non-empty selection it calls `select(EMPTY_SELECTION)`; otherwise it changes nothing;
* otherwise `hits = marqueeSelection(project, rect)` — every **visible, unlocked** element whose
  **bounds** intersect the rectangle, in document (back-to-front) order;
* the new selection is `hits` (replace) or `unionSelection(baseIds, hits)` (additive), re-normalised
  by `selectionOf(...)`.

Notes:

* The marquee uses element **bounds**, not semantic hit regions. Sweeping a rectangle over a
  Container's empty interior therefore selects the Container — a documented consequence of the
  bounds rule, not a bug (see [known-limitations.md](./known-limitations.md)).
* `pointerup`, `pointercancel`, `lostpointercapture` and `cancel()` (Escape) all clear the
  transient `preview` **and** call `requestRender()`, so the rubber band cannot survive the
  gesture. The repaint is explicit because a marquee that matched nothing resolves to the same
  React selection object, which would otherwise not re-render.
* `src/canvas/marqueeOverlay.test.ts` covers exactly those cases.

## Drag (move)

```text
pointerdown on an element  -> select if needed, beginEdit(), snapshot starts, capture pointer
pointermove                -> preview.moves = moveSelectionFromSnapshot(starts, grabbedId, delta, opts)
pointerup                  -> commitMove(changedMoves)  (or nothing when the delta is 0), endEdit()
```

* `starts` = `withDescendants(project, movableSelection(project, selection.ids))` mapped to their
  bounds — a locked or hidden member of the selection simply does not move, while everything
  nested inside a moving element travels with it (arrow-key nudges use the same expansion).
* The delta is measured from the pointerdown snapshot: `world - startWorld`. It is **never**
  accumulated across moves.
* `moveSelectionFromSnapshot(starts, primaryId, delta, { snapEnabled, gridSize })`:
  1. snap the **primary** (grabbed) element with `moveBounds` — `round(v / grid) * grid` when
     snapping is on, `Math.round(v)` when off;
  2. derive the single integer delta `snappedPrimary - primaryStart`;
  3. apply that delta to every other member, preserving relative layout exactly.
  If the primary is not part of the snapshot, the first entry is used instead.
* Sizes are never touched by a move.
* `snapValue`/`moveBounds` round to whole world units even when snapping is off, so a drag can
  never introduce sub-pixel coordinates.
* One gesture = one history step: `beginEdit()` opens the transaction, `endEdit()` closes it, and
  `commitMove` writes all moved elements in a **single** document update.

## Resize

```text
pointerdown on a handle   -> beginEdit(), snapshot startBounds
pointermove               -> preview.moves = [resizeBounds(edge, startBounds, world, opts)]
pointerup                 -> commitResize(elementId, bounds) when something changed, endEdit()
```

`resizeBounds(edge, start, world, { snapEnabled, gridSize, minSize })`:

* only the edges named in `edge` move; the opposite edge keeps its exact coordinate;
* snapping is applied **only to the moved edges** (so an untouched edge never drifts);
* the minimum size is enforced symmetrically: a collapse from the left stops at
  `right - minSize`, from the right at `left + minSize`, and equivalently for the Y axis.

Handles are single-object only: the engine passes `handleElementId = ids.length === 1 ? primary :
null` into the hit test, so a multi-selection never shows or grabs handles.

Handle geometry, screen-pixel sizing and the Container corner-only rule are documented in
[canvas-engine.md](./canvas-engine.md#resize-handles).

## Responsive layouts (1.3.5)

Below 1100 px the workspace switches to overlay drawers (see
[canvas-engine.md](./canvas-engine.md#responsive-layouts-and-drawers-12)): the same panels slide in
over a full-width canvas, the toolbar buttons toggle them, Escape or a scrim click closes them and
selecting an element never opens one. Touch targets are ≥ 40 px at those widths and for coarse
pointers, and the canvas handle grab tolerance grows through the shared hit test
(`coarsePointer`), never through a second one.

## Viewport panning (view-only, 1.3.5)

Panning moves the scrollable viewport, never the document. It is implemented in
`src/canvas/pan.ts` (pure maths: `panScroll`, `pinchScale`, `touchCentroid`, `touchDistance`,
`anchorScrollFor`) and wired up in `CanvasEditor`.

| Input | Behaviour |
| --- | --- |
| middle mouse button drag | pans; the browser's autoscroll / middle-click paste is suppressed |
| `Space` + left drag | pans (cursor `grab`, then `grabbing`); `Space` is ignored while editing text |
| one-finger touch drag | **no** pan — it keeps the marquee semantic |
| two-finger touch drag | pans, anchored at the centroid |
| two-finger pinch | zooms through the same anchoring path as the wheel / trackpad pinch |

Rules that keep this safe:

* pan writes **only** `scrollLeft` / `scrollTop` of `.canvas-viewport`; no history entry is
  created, nothing is serialized, and `geometry.ts` / `hitTest.ts` / `transform.ts` are untouched;
* the pointerdown listener runs in the **capture** phase on the viewport and calls
  `stopPropagation()`, so the engine never sees a pan pointerdown: a pan can neither start nor
  cancel an element drag, and no history transaction is left open;
* the two-finger gesture only starts when the running engine gesture is `none` or `marquee`
  (a marquee may be cancelled — it changes selection only). A second finger arriving during a
  `move` or `resize` is ignored so that gesture's transaction is never orphaned;
* `Space` and middle-drag are separate from `Escape`/`Delete`: they only affect the viewport.

## Which gestures change the document?

| Gesture | Document mutation | History |
| --- | --- | --- |
| click / Shift-click (canvas or Layers) | no — selection only | no entry |
| marquee | no — selection only | no entry |
| drag (move) | yes, one `mutate()` with every moved element | one entry per gesture |
| resize | yes, one `mutate()` | one entry per gesture |
| viewport pan / pinch (middle drag, Space+drag, two fingers) | no — scroll offset only | no entry |
| canvas edge resize (right / bottom / corner handles) | yes, live `canvas.width/height` | one entry per drag |
| arrow-key nudge | yes, one `mutate()` per key press | coalesced by key/shortcut |
| Properties field edits | yes, one `mutate()` per commit | coalesced per field |
| delete / duplicate / paste | yes, one `mutate()` | one entry each |

## Pointer lifecycle

Listeners installed by `CanvasInteraction`:

```text
canvas: pointerdown, pointermove, pointerup, pointercancel,
        lostpointercapture, pointerleave, contextmenu
window: pointerup, pointercancel        (fallback when the pointer leaves the canvas)
```

| Event | Behaviour |
| --- | --- |
| `pointerdown` | only `button === 0`; resolves a hit target and starts the matching gesture; calls `setPointerCapture` inside a `try` (synthetic events may not support it) |
| `pointermove` | while gesturing: rebuilds the preview from the snapshot and calls `requestRender()`; otherwise only hover-cursor feedback |
| `pointerup` | clears the gesture and preview, then commits (move/resize), finishes the marquee, or repaints |
| `pointercancel` | `endEdit()` (if a drag/resize was open) + `requestRender()`; nothing is committed |
| `lostpointercapture` | cancels an in-flight gesture through `cancel()`; a no-op for the release that follows a normal pointerup |
| `pointerleave` | resets the hover cursor when no gesture is active |
| `contextmenu` | `preventDefault()` — no browser menu on the canvas |

`cancel()` (used by `Escape` through `CanvasEditor`'s window keydown handler, and by lost capture)
drops the gesture, clears the preview, closes the transaction if one was open, and repaints. The
committed document is untouched, so a cancelled drag is simply discarded.

Cursor feedback is pushed to the canvas element style by the engine: `ew-resize`, `ns-resize`,
`nwse-resize`, `nesw-resize`, `move`, or `default`.

## Keyboard

Handled in `src/App.tsx` on `window`, and skipped entirely when
`isEditingTextInput(event.target)` is true (see [`src/utils/keyboard.ts`](../src/utils/keyboard.ts)).

| Keys | Action |
| --- | --- |
| `Delete` / `Backspace` | delete the whole selection (locked members skipped, one undo step) |
| `Cmd/Ctrl + Z` / `Cmd/Ctrl + Shift + Z` / `Ctrl + Y` | undo / redo |
| `Cmd/Ctrl + D` | duplicate the selection |
| `Cmd/Ctrl + C` / `Cmd/Ctrl + V` | copy / paste through the internal clipboard |
| `Cmd/Ctrl + X` | cut: copy the deletable members, then delete them — one undo step |
| `Cmd/Ctrl + A` | select every visible, unlocked element (the marquee rule) |
| `F2` | focus the Name field in Properties (single selection) |
| `Space` (held) | pan modifier for the canvas viewport |
| arrow keys | nudge every movable selected element by 1 unit |
| `Shift` + arrows | nudge by the current grid size |
| `Cmd/Ctrl + +` / `-` / `0` | zoom in / out / fit |
| `Escape` | clear the selection; `CanvasEditor` also cancels an active gesture |

## Related documents

* [canvas-engine.md](./canvas-engine.md) — geometry, handles, hit test, zoom.
* [history-and-clipboard.md](./history-and-clipboard.md) — how commits become undo steps.
* [layers-and-z-order.md](./layers-and-z-order.md) — why the front-most element wins a click.
* [testing.md](./testing.md) — `interaction.test.ts`, `multiDrag.test.ts`,
  `containerGesture.test.ts`, `marqueeOverlay.test.ts`.
