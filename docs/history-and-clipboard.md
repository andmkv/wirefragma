# History, duplicate and clipboard

Sources: [`src/utils/history.ts`](../src/utils/history.ts),
[`src/model/clipboard.ts`](../src/model/clipboard.ts),
[`src/model/project.ts`](../src/model/project.ts) (duplication), [`src/App.tsx`](../src/App.tsx) (wiring).

## Undo / redo

```ts
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  meta: { key: string | null; time: number; base: T | null };
}

export const HISTORY_LIMIT = 80;          // bounded
export const COALESCE_WINDOW_MS = 700;
```

The shell stores one `History<WireframeProject>` in React state (`App.tsx`); `history.present` is
the document that is rendered, autosaved and exported.

### Commit

```ts
commit(history, next, { coalesceKey, transient, now, limit, coalesceMs })
```

* An open transaction (`meta.base !== null`) or `transient: true` updates `present` **without**
  pushing a history entry — the transaction will record exactly one entry when it closes.
* Otherwise, `coalesceKey` merges rapid commits that share the key inside
  `COALESCE_WINDOW_MS` and only while `future` is empty (i.e. before a redo branch exists).
* A real commit pushes the previous `present` onto `past` (trimmed to `HISTORY_LIMIT`) and clears
  `future`.

### Transactions

```ts
beginTransaction(history)                  // records meta.base = present (idempotent)
endTransaction(history, next)              // pushes ONE entry: base -> next
cancelTransaction(history)                 // rolls back to base
```

`endTransaction` compares `base` with `next` (identity plus `JSON.stringify`) and records nothing
when the gesture did not change the document, so a stray click never creates an undo step.

### Who opens a transaction?

`CanvasInteraction` — not React. In `onPointerDown`, a **move** or **resize** gesture calls
`beginEdit()`, and every terminating path (commit, unchanged release, `pointercancel`, `cancel()`,
lost capture) calls `endEdit()` exactly once. `App.beginInteraction` / `App.endInteraction` map
those to `beginTransaction` / `endTransaction`.

A marquee never opens a transaction. A plain click on an element does open one (the engine cannot
know yet whether the pointer will move), but `endTransaction` records nothing for an unchanged
document, so a click never creates an undo step. The engine tracks exactly one pointer per
gesture: a second finger or pen contact is ignored while a gesture runs, so it cannot replace the
gesture and orphan its transaction. `undo` / `redo` are no-ops while a transaction is open
(Cmd+Z mid-drag would otherwise discard the transaction base).

### One gesture = one history step

| Action | History behaviour |
| --- | --- |
| drag (one or many elements) | one entry (transaction), all elements written in one `mutate` |
| resize | one entry (transaction) |
| arrow-key nudge | one entry per key press, coalesced under `move:<ids>` |
| typing in a Properties field | coalesced under the field's `coalesceKey` (`name`, `label`, `note`, `items`, `x`, …) |
| toggles (visibility, locking, reorder, duplicate, delete, paste, layer ops) | `coalesceKey: null` -> one discrete entry each |
| import / New | `resetHistory(project)` — undo history is cleared |

`src/utils/history.test.ts` covers recording/reversing, coalescing, single-entry transactions,
no-op transactions and the bound.

## Duplicate

```ts
duplicateElement(project, id): { project; newId: string | null }
duplicateElements(project, ids): { project; newIds: string[] }
```

`duplicateElement`:

* new `id` via `createId(source.type)`;
* new semantic `name` via `uniqueName(project, source.name)` -> `base + "Copy"`, and `Copy2`,
  `Copy3`, … on collision (spaces are stripped: `save button` -> `savebuttonCopy`);
* `x + 16`, `y + 16`;
* the copy keeps `type`, `label`, `note`, `width`, `height`, `layerId`, `visible`, `locked`,
  `items`, `columns`, `textStyle` and `contentSize` (via object spread, with `items` cloned);
* the copy is spliced **immediately after** its source in `elements`, i.e. directly above it inside
  the same layer;
* `reindexLayers` then normalises `zIndex`.

`duplicateElements` runs `duplicateElement` over the given ids in document order, which keeps the
whole set's relative layout intact. It is the entry point for `Cmd/Ctrl+D` and the Properties
"Duplicate" button.

In the UI:

| Trigger | Behaviour |
| --- | --- |
| `Cmd/Ctrl + D`, Properties "Duplicate" | duplicates the whole selection (locked members skipped, one history entry), copies become the selection |
| Layers row duplicate icon | duplicates that one element in place and selects the copy (`App.handleDuplicateElement`) |
| `Esc` | cancels nothing but clears the selection |

Invariant: duplication never duplicates a **layer**. It only ever produces elements.

## Clipboard

```ts
export const CLIPBOARD_OFFSET = 16;

interface WirefragmaClipboard {
  elements: WireframeElement[];
  /** layerId -> layer name of the copy source; used when pasting into another wireframe. */
  layerNames?: Record<string, string>;
}

copySelection(project, ids): WirefragmaClipboard | null
pasteClipboard(project, clipboard, { pasteIndex, activeLayerId }): { project; newIds }
```

### Why an internal clipboard

Core copy/paste must work without OS clipboard permissions, without a secure context and without
user prompts. `Cmd/Ctrl+C` / `Cmd/Ctrl+V` therefore use an in-memory payload, which is why paste
works in `http://localhost` dev, in `file://` contexts and in embedded browsers alike.

### Cross-wireframe store (`src/model/clipboardStore.ts`)

The signed-in workspace remounts `<App key=…>` for every wireframe, so a payload held in an
`App` ref would die on every switch. It lives in a **module-level store** instead:

* `createClipboardStore(storage)` returns `{ get(), set(payload) }`; the editor uses the shared
  `clipboardStore`, which is backed by `localStorage` (`wirefragma.clipboard`).
* The store is **not** React state — nothing in the UI renders from the clipboard, so `Cmd+C`
  followed by `Cmd+V` in the same task still works.
* Every `set()` gets a fresh `token`; `App` compares it with the token of the previous paste and
  restarts the cascade (`pasteIndex = 1`) when the payload changed. Inside one wireframe the
  cascade behaviour is therefore exactly what it was before this store existed.
* Storage is best-effort: writes and reads are wrapped in `try/catch`, payloads are re-validated
  on read (unknown element types, missing geometry, non-finite numbers and oversized payloads are
  rejected), and a payload larger than `MAX_STORED_CLIPBOARD_CHARS` (64 K) stays in memory and is
  not mirrored. That is what makes a copy in one **tab** pasteable in another tab of the same
  origin — not between origins, and never in another application.
* **New / Import keep the clipboard.** Replacing the document no longer empties it, because the
  clipboard is cross-wireframe now and behaves like the OS clipboard. This is safe: pasting into a
  project that has no matching layer falls back to the active layer and never creates layers.

The **OS** clipboard is used only for the explicit "Copy" / "Copy for LLM" buttons, through
`src/utils/clipboard.ts::copyText`, which prefers `navigator.clipboard.writeText` and falls back
to a hidden `<textarea>` + `document.execCommand("copy")`.

### Copy

`copySelection` deep-copies the selected elements **and everything nested inside them**
(`withDescendants`; including `items`, `columns` and `textStyle`) into the payload. It returns
`null` for an empty or unknown selection.

### Paste

`pasteClipboard`:

* creates a new `id` for every element and a unique `name` (`uniqueName`);
* keeps each source's `layerId` **when that layer still exists**; otherwise it looks for a layer
  with the same **name** (`layerNames` in the payload, i.e. a paste from another wireframe); and
  only then falls back to `activeLayerId`, then to `project.layers[0]`. Layers are never created;
* offsets every element by `CLIPBOARD_OFFSET * pasteIndex`, where `pasteIndex` is
  `1` for the first paste, `2` for the next, … so repeated pastes **cascade** (+16, +32, +48, …)
  instead of stacking identical copies;
* copies `items`, `columns` and `textStyle` per element;
* re-points `parentId` links inside the payload at the new copies; a pasted root keeps its
  original parent only when that parent still exists in the document;
* returns the ids of the pasted **roots**, which `App` turns into the new selection (their
  children come along).

`App` keeps the cascade counter (`pasteCounterRef`) plus the token of the payload it belongs to
(`pasteTokenRef`): a copy resets both, and a paste increments the counter only while the payload is
unchanged. The payload itself lives in `clipboardStore` (see above), so `Cmd+C` immediately
followed by `Cmd+V` works even when both land in the same task.

### Shortcut safety

`src/utils/keyboard.ts::isEditingTextInput(target)` guards every global shortcut:
`INPUT` of any type except button/checkbox/radio/submit/range/color, `TEXTAREA`, `SELECT` and
`contentEditable`. While the user is typing, `Cmd+C`, `Cmd+V`, `Cmd+X`, `Cmd+A`, `Cmd+D`, `F2`,
`Space`, `Delete`, arrows and zoom keys are ignored and the browser keeps its native behaviour.

Invariant: never bypass `isEditingTextInput` when adding a global shortcut.

## Related documents

* [interactions.md](./interactions.md) — where `beginEdit` / `endEdit` are called.
* [data-model.md](./data-model.md) — the fields duplication and paste copy.
* [import-export.md](./import-export.md) — the other way documents enter the editor.
