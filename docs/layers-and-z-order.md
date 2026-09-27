# Layers and z-order

Source: [`src/model/project.ts`](../src/model/project.ts) (ordering helpers),
[`src/components/LayersPanel.tsx`](../src/components/LayersPanel.tsx) (panel behaviour).

## The model

```ts
interface WireframeLayer { id: string; name: string; visible: boolean; locked: boolean }

interface WireframeProject {
  layers: WireframeLayer[];       // [0] = FRONT-most
  elements: WireframeElement[];   // ONE flat array, global back-to-front paint order
}
```

Layers are **grouping + stacking + bulk visibility/locking**. They have no transform, no nested
coordinate space and no separate canvas.

## The single ordering rule

```text
layers[0]              = front-most layer            (top of the Layers panel)
layers[last]           = back-most layer
elements[]             = global back-to-front paint order
elements of one layer  = keep their relative order in that array
zIndex                 = an element's index inside its own layer (0 = back of that layer)
```

The effective paint order is therefore a **stable partition** of the flat `elements` array by
layer:

```ts
export function elementsInDrawOrder(project: WireframeProject): WireframeElement[] {
  const backToFront = [...project.layers].reverse();
  const result: WireframeElement[] = [];
  const known = new Set(project.layers.map((layer) => layer.id));

  // Defensive: elements pointing at a layer that no longer exists stay at the very back.
  for (const element of project.elements) {
    if (!known.has(element.layerId)) result.push(element);
  }
  for (const layer of backToFront) {
    for (const element of project.elements) {
      if (element.layerId === layer.id) result.push(element);
    }
  }
  return result;
}
```

`reindexLayers(project)` recomputes `zIndex` with the same rule and returns the same object when
nothing changed. Every structural transform funnels through it.

## The three orders must agree

```text
top of the Layers panel    ==  visually front-most  ==  first hit candidate
bottom of the Layers panel ==  visually back-most   ==  last hit candidate
```

* **Paint order**: `renderScene` iterates `elementsInDrawOrder(project)` (back to front).
* **Hit order**: `visibleGeometries(project, transform)` returns the same array of geometries, and
  `hitTestGeometries` walks it **backwards** (front to back), returning the first semantic hit.
* **Panel order**: `elementsOfLayer(project, layerId, { frontFirst: true })` reverses the
  per-layer slice, so the top row of a layer is the element that paints last inside that layer.

Invariant: these three must stay consistent. If you change one ordering helper, the other two
follow automatically; never introduce a second ordering rule.

`src/model/layers.test.ts` and `src/canvas/hitTest.test.ts` pin this down, including the test
"renders geometry in the same order the layers panel shows".

## `zIndex`

`zIndex` is **derived data** kept for readable exported JSON and for the "Order N of M" line in
the Properties panel. It is not the source of truth — array order is. `reindexLayers` restores it
after any structural change.

## Layers panel behaviour

| Element | Behaviour |
| --- | --- |
| Layer row | drag handle for reordering; click the name to make the layer **active**; double-click to rename (Enter commits, Escape cancels) |
| Caret | collapse / expand the layer's element rows |
| Count | number of elements in the layer |
| Eye | `layer.visible` toggle |
| Lock | `layer.locked` toggle |
| Trash | delete the layer (confirmed, see below) |
| **…** menu | `RowMenu`: **Export layer…** (opens the Export dialog scoped to this layer, see [import-export.md](./import-export.md#layer-scoped-export)), **Rename**, **Delete layer** |
| Element row | click selects; Shift/Cmd-click toggles membership; drag to reorder or move between layers |
| Element eye / lock | per-element `visible` / `locked` toggle |
| Element duplicate icon | copies the element **inside its own layer**, offset +16/+16, and selects the copy |

Drag & drop semantics (`LayersPanel`):

* dropping a **layer** above/below another layer -> `moveLayer(id, targetId, placeAbove)`, where
  `placeAbove = true` means closer to the top of the panel, i.e. closer to the front;
* dropping an **element** above/below another element ->
  `moveElement(id, target.layerId, target.id, placeAbove)` with `placeAbove = position !== "below"`;
* dropping an element onto a **layer row** (or into its element list) ->
  `moveElement(id, layerId, null, true)`, i.e. on top of that layer.

## Active layer

`App` keeps `activeLayerId` as editor state. New palette elements are created in it
(`createElement(type, project, { x, y, layerId: targetLayer.id })`), centred on the canvas and
snapped to the grid. An effect keeps it valid:

```ts
if (!findLayer(project, activeLayerId)) setActiveLayerId(project.layers[0]?.id ?? null);
```

Clicking a Layers row also activates its layer. Adding an element to a **hidden** or **locked**
layer is allowed but warned about in the status toast, because the new object will not be editable
until the layer is shown or unlocked.

## Visibility and locking

```ts
effectiveVisible(project, element) = element.visible && layer.visible
effectiveLocked(project, element)  = element.locked  || layer.locked
```

* hidden (element or layer) -> not drawn, not hit-testable, dropped from the selection;
* locked (element or layer) -> still drawn and still in the draw order, but not hit-testable and
  excluded from drag, delete and duplicate; it can still be selected from the Layers panel to be
  inspected, renamed, annotated or unlocked.

The canvas module has local equivalents (`isElementVisible`, `isElementLocked` in
`src/canvas/geometry.ts`) with identical semantics; see
[known-limitations.md](./known-limitations.md).

## Layer operations

```ts
addLayer(project, name?)     // new layer is PREPENDED: it becomes front-most
updateLayer(project, id, patch)
moveLayer(project, id, targetId, placeAbove)
deleteLayer(project, layerId): { project, removedElementIds, replacedWithDefault }
```

`deleteLayer` removes the layer **and every element inside it**, then reindexes. Deleting the last
remaining layer leaves a fresh empty `Default` layer behind (`replacedWithDefault: true`), because
the document must always have a destination for new elements.

In the UI this is a two-step action: `App.handleDeleteLayer` shows a toast and opens
`ConfirmDialog` naming the layer and the number of elements that will disappear. The mutation is a
single history entry, so undo restores the layer, its elements and their order.

## Element ordering operations

```ts
reorderElement(project, id, "forward" | "backward")  // swap with the neighbour in the same layer
bringToFront(project, id)                            // last position inside its own layer
sendToBack(project, id)                              // first position inside its own layer
moveElement(project, elementId, targetLayerId, targetElementId?, placeAbove?)
```

All of them operate **inside a single layer** and never disturb other layers' relative order.
`reorderElement` is a no-op at the ends of the stack. All four are exposed in the Properties panel
as "Bring to front", "Send to back", "Bring forward", "Send backward".

## Related documents

* [data-model.md](./data-model.md) — the full field list.
* [canvas-engine.md](./canvas-engine.md) — where the draw order is consumed.
* [interactions.md](./interactions.md) — selection from the canvas and from the panel.
