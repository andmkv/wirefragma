# Testing

## Commands

```bash
npm test                                        # all unit tests (Vitest, node environment)
npm run test:watch                              # watch mode
npm run typecheck                               # tsc --noEmit only
npx vitest run src/canvas/hitTest.test.ts       # one focused file
npx vitest run src/model src/utils              # one focused directory
npm run build                                   # typecheck + production build
npm run dev                                     # dev server (+ ?selftest=N for the browser harness)
```

Vitest is configured inside `vite.config.ts`:

```ts
test: { environment: "node", globals: true, include: ["src/**/*.test.ts"] }
```

There is **no jsdom, no happy-dom and no browser test runner**. That shapes the whole strategy.

## Four kinds of verification

| Kind | Where | What it can prove |
| --- | --- | --- |
| Pure unit tests | most of `src/model/**`, `src/utils/**`, `src/canvas/{transform,interaction,multiDrag}.test.ts` | maths, data transforms, serialization, no DOM involved |
| Geometry / hit tests | `src/canvas/{hitTest,containerDrag}.test.ts`, `src/model/{hitAreas,overlapRegression}.test.ts` | the canonical hit test and geometry rules, including zoom independence |
| Synthetic pointer tests | `src/canvas/{containerGesture,marqueeOverlay}.test.ts` | the real `CanvasInteraction` state machine driven through a fake canvas element |
| Browser self-test harness | `src/dev/selfTest.ts`, run manually in a browser | the real application with real DOM events: React wiring, canvas host, panels, storage, export |

Manual, human-verified checks (visual quality, real emoji rendering, an actual trackpad pinch) are
not automated and must not be claimed as automated.

## Test inventory (33 files, 337 cases)

| File | Cases | Covers |
| --- | --- | --- |
| `src/canvas/transform.test.ts` | 5 | world↔screen round trips at every zoom/DPR, origin, rects, tolerances, containment |
| `src/canvas/textFit.test.ts` | 9 | Unicode-safe label truncation (never splits a surrogate pair, combining mark, ZWJ sequence or flag) and the fact that icon/image symbols are drawn whole |
| `src/canvas/hitTest.test.ts` | 16 | the canonical hit test: handle priority, element order, locking/visibility, thin-element handles, the historical overlap regression |
| `src/model/hitAreas.test.ts` | 10 | semantic hit regions: container border/label/interior, divider band, full-bounds types |
| `src/model/overlapRegression.test.ts` | 11 | the acceptance matrix for Button inside Dialog/Container, z-order flips, drag target stability |
| `src/canvas/interaction.test.ts` | 11 | `moveBounds`, `resizeBounds`, `snapValue` maths |
| `src/canvas/multiDrag.test.ts` | 9 | `moveSelectionFromSnapshot` (rigid multi-drag) and `rectFromPoints` |
| `src/canvas/containerDrag.test.ts` | 9 | Container corner-only handles, border/label drag, interior pass-through |
| `src/canvas/containerGesture.test.ts` | 14 | the real pointer state machine: container drag/resize, marquee, multi-drag, locked members |
| `src/canvas/marqueeOverlay.test.ts` | 6 | the marquee overlay is cleared and repainted on pointerup/pointercancel/lost capture/Escape |
| `src/model/layers.test.ts` | 23 | draw order, per-layer reordering, layer ops, visibility/locking, normalization of layer data |
| `src/model/selectionState.test.ts` | 16 | selection state helpers, marquee selection rules, movable/deletable membership |
| `src/model/typography.test.ts` | 15 | `textStyleOf`, `contentSizeOf`, `mergeTextStyle`, normalization/round-trip of the optional fields |
| `src/model/emoji.test.ts` | 7 | catalog integrity, search, emoji + content size through JSON and `localStorage` |
| `src/model/duplicate.test.ts` | 7 | single/multi duplication, relative layout, layers, styles, names |
| `src/model/clipboard.test.ts` | 7 | copy/paste one and many, cascade, layer fallback, immutability |
| `src/model/startup.test.ts` | 8 | blank first launch, `New`, saved projects untouched, v1 migration |
| `src/utils/history.test.ts` | 5 | commit/undo/redo, coalescing, transactions, bounds |
| `src/utils/storage.test.ts` | 4 | key precedence, legacy migration, corrupted data |
| `src/utils/zoom.test.ts` | 9 | clamping, fit, presets, wheel zoom, pointer anchoring |
| `src/utils/asciiRenderer.test.ts` | 10 | determinism, grid containment, per-type glyphs, wide/narrow grids |
| `src/utils/spatialSummary.test.ts` | 3 | deterministic prose, hidden elements ignored, empty canvas |
| `src/utils/markdownRoundTrip.test.ts` | 32 | the full export/import contract, v1 import, all element types, invalid input, the `## Screen` mode label |
| `src/utils/markdownSemantics.test.ts` | 8 | `Typography:` / `Content size:` output and the emoji round trip |
| `src/model/hierarchy.test.ts` | 19 | nesting: canonical tree order, repair of bad links, inheritance, nest/unnest/move, subtree delete/duplicate/copy, multi-row drops, round trip |
| `src/model/layerExport.test.ts` | 5 | layer-scoped export: filtering, crop, minimum canvas, immutability, re-import |
| `src/canvas/pointerGuard.test.ts` | 2 | one pointer per gesture (no orphaned transaction), parents drag their children |
| `src/utils/auditRegressions.test.ts` | 5 | backticks in notes round-trip, undo inert mid-gesture, unreadable-storage backup, font-size clamp, DPR cap |
| `src/utils/schemaExport.test.ts` | 6 | WIREFRAGMA schema covers every type, its example imports unchanged, lenient LLM-answer import |
| `src/i18n/i18n.test.ts` | 26 | every locale has every key, keeps placeholders and covers its plural categories; `translate` fallback |
| `src/account/projectsPanel.test.ts` | 2 | compact relative ages for the projects panel |
| `src/account/remoteSync.test.ts` | 13 | noticing changes made elsewhere: clean reload, dirty → conflict path, no action mid-save, evict/removed, loading a server revision is clean (no save loop), poll back-off |
| `src/utils/mcpResources.test.ts` | 5 | the committed `server/mcp/resources/*` equal the TypeScript generator output; the MCP schema variant covers every type and the tool workflow |

## House rules for writing tests

* **No DOM in unit tests.** Model and maths tests stay pure so they run in milliseconds.
* **Hit tests must go through the canonical entry point.** Use `hitTestProject` (or
  `elementGeometry`), never a test-local re-implementation of the geometry rules. The
  `containerGesture`/`marqueeOverlay` files show the accepted pattern for the *engine* level: a
  fake canvas object with `addEventListener`, `getBoundingClientRect`, `setPointerCapture` and
  `style`, plus a `window` stub that only needs `addEventListener`/`removeEventListener`.
* **Prefer behaviour over internals.** Assert on returned projects, hit targets, committed moves
  and rendered state, not on private fields.
* **Keep determinism assertions.** Same project in ⇒ identical Markdown/ASCII out.
* **When fixing a bug, prove the test fails without the fix** (temporarily revert, re-run, restore).
  `marqueeOverlay.test.ts` documents the bug it reproduces in its header comment.

## Browser self-test harness

`src/dev/selfTest.ts` is a development-only script, loaded by `src/main.tsx` when
`import.meta.env.DEV` **and** the URL contains `?selftest=N`. It drives the running application
with synthetic DOM events (the same events a user produces), through the real React tree.

```text
http://localhost:5173/?selftest=1     hit testing, drag, resize, undo, palette, export, zoom, branding
http://localhost:5173/?selftest=2     persistence after a reload (runs after pass 1 left expectations)
http://localhost:5173/?selftest=3     legacy UI Sketch key migration (navigates on to pass 4)
http://localhost:5173/?selftest=4     fresh first launch / New
http://localhost:5173/?selftest=5     mobile-landscape showcase of every element type
http://localhost:5173/?selftest=6     the overlap matrix: Button in Dialog/Container/Toolbar/Sidebar at several zooms
http://localhost:5173/?selftest=7     non-overlapping small elements at fit zoom
http://localhost:5173/?selftest=8     canvas transform + DPR per zoom level
http://localhost:5173/?selftest=9     visual state of a selected Button inside a Dialog
http://localhost:5173/?selftest=10    multi-selection, clipboard, typing guards, container drag,
                                      typography (pixel-measured), emoji picker, header logo
```

How it reports:

* a hidden `<pre id="selftest-report">` with the full JSON report (results for this pass plus a
  `sessionStorage` history under `wirefragma.selftest.history`, so chained passes survive reloads);
* a visible `<div id="selftest-panel">` with a coloured `PASS`/`FAIL` line per check, so a human or
  an accessibility-tree-based agent can read the outcome;
* `localStorage` key `wirefragma.selftest.expected` is used by pass 1 to hand state to pass 2.

The harness is stripped from production builds (the whole module is behind `import.meta.env.DEV`).

Manual caveats: the harness clears and rewrites `localStorage`, so run it on a throwaway origin or
profile if you care about the project currently stored there (see
[persistence-and-migrations.md](./persistence-and-migrations.md#origin-scoping)).

## Server (accounts backend)

`server/tests/api-smoke.sh` drives the whole PHP API against a **local** `npm run dev:api` server
with the `log` mail transport: registration with captcha, email confirmation, sessions and CSRF,
optimistic-concurrency saves, settings, password change and reset, account deletion. It reads the
captcha answer from the PHP session file, so it cannot run against a real deployment. Run
`php -l` on `server/api/**/*.php` and `server/mcp/{index.php,src/*.php}` after editing PHP.

`server/tests/mcp-smoke.sh` (≈90 checks, needs `npm run mcp:install`) covers MCP end to end against
the same kind of local server, with two throwaway users:

* tokens: CSRF + password required, raw token returned once, only the SHA-256 in the database,
  listing never leaks secret or hash, revoke → 401 immediately, expired → 401, account deletion
  cascades;
* transport: 401 + `WWW-Authenticate` without a token, foreign `Host`/`Origin` → 403, no CORS
  header, oversized body → 413, handshake-era sessions and the stateless `2026-07-28` era;
* tools and resources: every tool listed, no `force` anywhere, reads, all writes, the other user's
  ids answer `not_found`, scope enforcement (read-only / write / delete), delete confirmations and
  project cascade, a session id reused with another token acts as that token's user;
* documents: schema validation (`bad_document`), lossless unknown fields (`{}`, `{"0":…}`, `1.0`),
  title synchronisation, conflict returns the current copy and never overwrites, browser and MCP
  share one revision counter.

```bash
mysql -u USER -p TEST_DB < server/schema.sql     # a throwaway local database, never production
npm run mcp:install && npm run dev:api
server/tests/api-smoke.sh && server/tests/mcp-smoke.sh
```

Both scripts accept `API=` / `BASE=` for another local port and edit only the configured local
database. The MCP Inspector (`npx @modelcontextprotocol/inspector --cli …`, see
[mcp.md](./mcp.md#connecting-a-client)) is useful for manual checks.

## What is not verified automatically

* Visual quality of the rendered wireframe (only a few pixel-level assertions exist — the
  typography centring check in pass 10).
* Platform emoji glyph appearance (it depends on the OS font).
* Real trackpad pinch and multi-touch behaviour (the wheel path is tested; the hardware is not).
* Real `localStorage` quota behaviour, private-mode quirks and cross-browser scrolling.
* Email delivery (only that `mail()` / SMTP accepted the message) and the translations' wording.
* The polling wiring inside `Workspace.tsx` (timers, focus/visibility events) — its rules are
  unit-tested in `remoteSync.test.ts`, the wiring was verified manually in a browser.
* The `.htaccess` protection of `mcp/` — PHP's built-in server ignores `.htaccess`; check the
  403s after deploying (see [deployment.md](./deployment.md#mcp-endpoint)).

## Related documents

* [agent-guide.md](./agent-guide.md) — which checks to run before/after a change.
* [canvas-engine.md](./canvas-engine.md) — the rules these tests pin down.
