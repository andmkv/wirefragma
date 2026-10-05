# Canvas engine

The canvas engine is the part of Wirefragma that must not be duplicated, approximated or
bypassed. Everything the user sees or clicks goes through this pipeline:

```text
WireframeProject
    -> geometry.ts    elementGeometry(element, transform)
                      -> bounds          (world)
                      -> hitRegions      (world, semantic)
                      -> resizeHandles   (world + screen)
    -> transform.ts   world <-> screen (CSS px) <-> device (CSS px * DPR)
    -> render.ts      renderScene(canvas, SceneInput)
    -> hitTest.ts     hitTestProject(world, project, transform, options)
    -> interaction.ts CanvasInteraction (pointer state machine)
```

Invariant: **one model, one geometry representation, one coordinate transform, one deterministic
hit test.** Rendering and hit testing consume the *same* `elementGeometry()` output, so a handle
can never be drawn where it cannot be grabbed, and an element can never be painted where it cannot
be clicked.

## Files

| File | Role |
| --- | --- |
| [`src/canvas/transform.ts`](../src/canvas/transform.ts) | the only place where coordinates change meaning |
| [`src/canvas/geometry.ts`](../src/canvas/geometry.ts) | element -> bounds / hit regions / handles |
| [`src/canvas/hitTest.ts`](../src/canvas/hitTest.ts) | world point -> `handle` \| `element` \| `none` |
| [`src/canvas/render.ts`](../src/canvas/render.ts) | Canvas 2D drawing (document, chrome, marquee) |
| [`src/canvas/interaction.ts`](../src/canvas/interaction.ts) | pointer gestures and their maths |
| [`src/components/CanvasEditor.tsx`](../src/components/CanvasEditor.tsx) | React host: viewport, zoom, DPR, engine lifecycle |

## Coordinate systems

```text
world   = logical project units from the model (element.x/y/width/height), Y-down, no rotation
screen  = CSS pixels inside the <canvas> element (canvas-local, i.e. after subtracting its rect)
device  = screen * devicePixelRatio, the canvas backing store
```

`ViewTransform` is the whole conversion layer:

```ts
export interface ViewTransform {
  scale: number;      // CSS pixels per logical unit
  originX: number;    // screen position of world (0,0)
  originY: number;
}
```

`CanvasEditor` always builds it as `createTransform(scale, 0, 0)`: the canvas element is sized to
the scaled document, so the origin is the canvas corner and the scroll container handles panning.

```ts
worldToScreen(t, x, y)   // { x: originX + x * scale, y: originY + y * scale }
screenToWorld(t, x, y)   // { x: (x - originX) / scale, y: (y - originY) / scale }
worldRectToScreen(t, r)  // rect in CSS px (width/height also scaled)
worldSizeToScreen(t, s)
screenPxToWorld(t, px)   // px / scale — how screen-pixel tolerances become world units
deviceMatrix(t, dpr)     // [s, 0, 0, s, originX*dpr, originY*dpr] with s = scale * dpr
```

Invariant: hit testing, handle geometry and rendering must all convert through these functions.
Never mix units by hand, and never store a screen coordinate in the model.

## DPR handling

`CanvasEditor` keeps `dpr = max(1, window.devicePixelRatio)` in React state (updated on `resize`),
then sizes the backing store:

```ts
const cssWidth = Math.max(1, Math.round(canvasWidth * scale));
const cssHeight = Math.max(1, Math.round(canvasHeight * scale));
canvas.width = Math.max(1, Math.round(cssWidth * dpr));
canvas.height = Math.max(1, Math.round(cssHeight * dpr));
canvas.style.width = `${cssWidth}px`;
canvas.style.height = `${cssHeight}px`;
```

`renderScene` then applies `deviceMatrix(transform, dpr)` to draw in **world units**, and resets to
`setTransform(dpr, 0, 0, dpr, 0, 0)` to draw editor chrome in **screen units** (so outlines and
handles keep a constant size regardless of zoom).

## Geometry

```ts
export interface ElementGeometry {
  elementId: string;
  type: ElementType;
  bounds: Rect;              // world — exactly the element's x/y/width/height
  hitRegions: Rect[];        // world — semantic selectable areas
  resizeHandles: HandleGeometry[];  // world anchor + screen anchor + cursor
}
```

`elementGeometry(element, transform)`:

1. `bounds = { x, y, width, height }` from the element;
2. `hitRegions = hitRectsFor(element, transform.scale)` translated into world space (see below);
3. `resizeHandles = resizeEdgesForElement(element, transform)` mapped to handle anchors.

### Semantic hit regions (`src/model/hitAreas.ts`)

Elements are not uniformly a rectangle:

| Type | Hit regions |
| --- | --- |
| `container` | four border bands of `CONTAINER_BORDER_HIT_PX = 9` **screen** px (converted to world), plus an optional label rect at the top-left (`min(width, max(24, label.length * 7 + 16))` × `20/scale`) — the empty interior is **not** part of the hit area |
| `divider` | one horizontal band, `max(height, DIVIDER_HIT_PX / scale)` tall with `DIVIDER_HIT_PX = 14` |
| everything else | the full bounds |

The border band is expressed in *screen* pixels and divided by the scale, so it stays a forgiving
~9 px target at every zoom level.

Invariant: a Container interior must stay non-greedy. Clicks in the empty interior resolve to
whatever is behind (or to nothing), never to the Container. See
`src/model/hitAreas.test.ts` and `src/canvas/containerDrag.test.ts`.

### Resize handles

```ts
export const RESIZE_EDGES = ["top-left","top","top-right","right","bottom-right","bottom","bottom-left","left"];
export const HANDLE_SIZE_PX = 9;      // visual size, never scaled with zoom
export const HANDLE_HIT_PX = 11;      // grab tolerance
export const MIN_AXIS_HANDLE_PX = 12; // below this on-screen size an axis offers no handles

resizeEdgesFor(screenWidth, screenHeight): ResizeEdge[]
  - both axes thin            -> []            (no handles at all)
  - height thin (< 12 px)     -> ["left", "right"]
  - width thin ( < 12 px)     -> ["top", "bottom"]
  - otherwise                 -> all eight

handleHitTolerancePx(screenWidth, screenHeight): number
  = max(2, min(11, min(screenWidth, screenHeight) * 0.35))

resizeEdgesForElement(element, transform): ResizeEdge[]
  = resizeEdgesFor(w*scale, h*scale), and for border-only types (containers)
    the edge midpoints are removed: corners only
```

Two rules fall out of this:

* a thin element (a Divider) keeps only the handles of the axis that is actually usable, so its
  body stays draggable;
* a Container, whose body *is* its border, resizes from its four **corners** so that the whole
  border and the title label stay draggable. This is the fix for the historical "a selected
  Container can be resized but not moved" bug.

## Hit testing

```ts
export type HitTarget =
  | { kind: "handle"; elementId: string; edge: ResizeEdge }
  | { kind: "element"; elementId: string }
  | { kind: "none" };

hitTestProject(world, project, transform, options?)
```

Resolution order (deterministic, no heuristics):

1. **resize handles of the handle element** — `options.handleElementId` (the older `selectedId`
   alias is still accepted). Only a single-object selection provides a handle element, so a
   multi-selection can never be hijacked by an individual handle. The grab tolerance is
   `screenPxToWorld(transform, handleHitTolerancePx(...))`.
2. **elements front to back** — `visibleGeometries(project, transform)` is walked from the end
   (front-most) to the start; the first geometry whose `hitRegions` contain the point wins.
3. **`none`** — empty canvas.

`visibleGeometries` filters with `isElementVisible` (element flag AND layer flag) and
`hitTestProject`'s default `isSelectable` excludes `isElementLocked` elements (element flag OR
layer flag), so hidden and locked objects are invisible to the pointer.

## Renderer

```ts
renderScene(canvas: HTMLCanvasElement, input: SceneInput): void

interface SceneInput {
  project: WireframeProject;
  transform: ViewTransform;
  dpr: number;
  showGrid: boolean;
  gridSize: number;
  selectedIds: string[];
  primarySelectedId: string | null;
  preview: PreviewOverride[] | null;   // { elementId, bounds } overrides during a gesture
  marquee: Rect | null;                // rubber band in world units
  activeEdge: ResizeEdge | null;       // the handle currently being dragged
}
```

Drawing order inside one call:

1. clear to `COLORS.surface` (white);
2. apply `deviceMatrix` and optionally draw the grid (`gridSize`, `COLORS.grid`);
3. draw elements in `elementsInDrawOrder(project)`, skipping `!isElementVisible`, substituting
   `bounds` from the preview map for the element currently being dragged/resized;
4. switch to the screen-space transform and draw editor chrome:
   * an outline for every selected element (dashed when locked or when several are selected);
   * a dashed union box when more than one element is selected;
   * resize handles for the **primary** element, only when exactly one element is selected and it
     is unlocked — taken from `elementGeometry(element, transform).resizeHandles`;
5. draw the marquee overlay: `rgba(47, 111, 237, 0.14)` fill + `rgba(47, 111, 237, 0.85)` stroke.

Chrome is drawn last and in screen space, so a selected object can never cover its own outline or
handles.

The renderer is a pure projection: it owns no state, reads everything from `SceneInput`, and never
writes to the project.

## Zoom

Zoom lives in `CanvasEditor` + `src/utils/zoom.ts` and is **view state only**.

| Constant | Value |
| --- | --- |
| `MIN_ZOOM` / `MAX_ZOOM` | 0.25 / 4 |
| `ZOOM_PRESETS` | 25 %, 50 %, 75 %, 100 %, 125 %, 150 %, 200 %, 300 %, 400 % |
| `ZOOM_PADDING` | 56 px of breathing room used by `fitScale` |

* `fitScale(viewport, canvas, padding)` = `min(availW / canvasW, availH / canvasH, 1)`, clamped —
  **fit never magnifies past 100 %**.
* `scaleForMode(mode, manualScale, automaticScale)` picks the active scale and clamps it.
* The effective scale feeds `createTransform(scale, 0, 0)`; the canvas element is resized to
  `canvasWidth * scale` × `canvasHeight * scale` CSS px, and the surrounding
  `.canvas-viewport` provides native scrollbars when it overflows.
* `zoomStep(current, ±1)` moves through the preset ladder (falling back to ×1.25 / ÷1.25).
* `zoomFromWheel(current, deltaY, 0.0022)` is exponential, used for trackpad pinch and
  `Cmd/Ctrl + wheel`.
* `contentPointAt` / `scrollOffsetToKeepPoint` keep the point under the pointer stationary: on
  each scale change `CanvasEditor` reads the pending pointer position and adjusts `scrollLeft` /
  `scrollTop` in `useLayoutEffect`, through `anchorScrollFor` (`canvas/pan.ts`) — ONE anchoring
  formula shared with the touch pinch. The correction is a delta
  `canvasPosition - (pointer - content * scale)`; the canvas position is re-measured on every step,
  so a browser clamp at a content edge can never make the gesture drift.

### Panning

Panning (middle-drag, `Space` + left drag, two-finger touch drag/pinch) is **view-only**: it
changes `scrollLeft` / `scrollTop` of `.canvas-viewport` and nothing else. The maths lives in
`src/canvas/pan.ts` (`panScroll`, `pinchScale`, `touchCentroid`, `touchDistance`,
`anchorScrollFor`); `anchorScrollFor` deliberately reproduces the zoom-anchoring correction above
so a pinch cannot introduce a second anchoring formula. See
[interactions.md](./interactions.md#viewport-panning-view-only-12).

Invariant: zoom must never alter `element.x/y/width/height`, never change `canvas.width/height`,
and never appear in an export. `src/utils/zoom.test.ts` and the persistence self-test pass assert
this.

## Canvas size (1.4)

`project.canvas.width/height` are document data; nothing in the view layer may change them except
an explicit user gesture.

* **Device presets** — the catalog lives in `src/model/canvasPresets.ts` (pure data: id, English
  name, group, size). The toolbar renders one grouped `<select>`: the three classic modes
  (`desktop` / `mobile` / `mobileLandscape`) first, then Phone / Tablet / Desktop / Other, then
  "Custom…". Choosing a preset stores `mode: "custom"` + `preset: <id>` (see
  [data-model.md](./data-model.md)). ⇄ flips portrait ↔ landscape via `flipCanvas`.
* **Edge handles** — a right-edge, bottom-edge and bottom-right DOM affordance inside
  `.canvas-frame` (not elements, and not part of `geometry.ts`/`hitTest.ts`). Dragging one calls
  `canvasSizeFromDrag` in `src/model/canvasSize.ts`: the world delta is the screen delta divided by
  the current scale, only the dragged axes change, the edge is snapped when Snap is on, and the
  result is clamped to `MIN_CANVAS_SIZE`/`MAX_CANVAS_SIZE`. The drag opens the usual history
  transaction, so one drag is one undo step, and a "W × H" badge shows the live size.
* Resizing the canvas **never** moves, scales or deletes elements. When the new bounds leave
  elements completely outside, the editor shows a non-blocking toast with the count
  (`elementsOutsideCanvas`); nothing is removed, and the user can undo.
* A manual size (typed or dragged) switches `canvas.mode` to `custom` and drops `canvas.preset`.

## Responsive layouts and drawers (1.4)

`src/utils/layoutMode.ts` holds the breakpoints as pure data (`layoutModeForWidth`) and
`src/utils/useMediaQuery.ts` reads the *same* thresholds through `matchMedia`, so CSS and JS can
never disagree. The `.app-toolbar` carries `layout-desktop` / `layout-tablet` / `layout-phone`.

| Mode | Width | Shell |
| --- | --- | --- |
| `desktop` | ≥ 1100 px | the three-column workspace, unchanged |
| `tablet` | 768–1099 px | canvas gets the full width; Add / Layers / Properties are overlay drawers |
| `phone` | < 768 px | same drawers + a compact toolbar with a "⋯" menu (New, Import, Copy for LLM, Grid, Snap, grid size, canvas size / preset) |

Drawers are the *same* panels, positioned absolutely over the workspace inside a
`@media (max-width: 1099px)` block (`.panel.drawer-left` / `.drawer-right`, `.open`): no second
markup tree, no duplicated state. The open drawer is transient editor state — it is never
remembered and is closed by Escape or a click on the scrim. Selecting an element never opens a
drawer. D2 adds `100dvh` (with the `100vh` fallback) and `env(safe-area-inset-*)` padding; D3
raises toolbar / panel hit targets to 40 px at ≤ 1099 px or on a coarse pointer, and the canvas
handle tolerance for a coarse pointer is the single `HANDLE_HIT_COARSE_PX` constant threaded
through the one hit test (`hitTestProject(..., { coarsePointer })`).

`?measure=1` (DEV only) runs `src/dev/measureLayout.ts`, which reports the real DOM geometry and
exercises every drawer plus a two-finger pinch/pan; `scripts/measure-layout.mjs` drives it in a
headless browser. See [testing.md](./testing.md).

## Canvas host (`src/components/CanvasEditor.tsx`)

The component is deliberately thin; the engine does the work.

* Owns the scroll viewport (`ResizeObserver` -> `viewport` state), the canvas ref, and the
  `CanvasInteraction` instance.
* Keeps a `latest` ref with everything the imperative renderer needs (project, selection, grid,
  transform, DPR) so `pointermove` never triggers a React render.
* `render()` calls `renderScene` with the current `getPreview()` / `getActiveEdge()`.
* `useLayoutEffect` re-applies `setState(...)` and repaints whenever the document, selection,
  size, scale, DPR or grid changes.
* Installs a non-passive `wheel` listener on the viewport: `Ctrl`/`Cmd` + wheel zooms around the
  pointer and switches to manual zoom; plain wheel scrolls natively.
* Exposes dev diagnostics on `window.__wirefragmaCanvas` (`transform`, `hitTest`, `hitTarget`,
  `geometries`, `elementNames`, `preview`, `marquee`, `selection`, `edges`) in dev builds or with
  `?inputdebug=1`. The self-test harness and manual debugging use these instead of a second
  hit-test implementation.

## Known duplication in the codebase

`isElementVisible` / `isElementLocked` in `src/canvas/geometry.ts` are thin aliases that delegate
to the model's `effectiveVisible` / `effectiveLocked` (element + every ancestor + layer), so the
canvas and the React shell can no longer disagree about visibility or locking.

## Related documents

* [interactions.md](./interactions.md) — who calls all of this, and when.
* [layers-and-z-order.md](./layers-and-z-order.md) — `elementsInDrawOrder` in context.
* [testing.md](./testing.md) — the tests that pin these rules down.
