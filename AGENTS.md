# Wirefragma — agent guide

This repository ships an LLM-oriented documentation set in `docs/`. Read it before changing code.

Start with:

- `docs/README.md` — what the product is, the stack, the documentation map.
- `docs/agent-guide.md` — invariants, scope discipline, common tasks, verification protocol.

For the area you are about to touch, also read:

- canvas / rendering / hit testing / gestures → `docs/canvas-engine.md`, `docs/interactions.md`
- model fields or project format → `docs/data-model.md`, `docs/persistence-and-migrations.md`
- layers, ordering, visibility → `docs/layers-and-z-order.md`
- undo/redo, copy/paste, duplicate → `docs/history-and-clipboard.md`
- export/import or the Markdown contract → `docs/import-export.md`, `docs/markdown-format.md`
- tests and commands → `docs/testing.md`
- what is deliberately out of scope → `docs/known-limitations.md`

Non-negotiables (details in `docs/agent-guide.md`):

- one geometry derivation and one hit test (`src/canvas/geometry.ts`, `src/canvas/hitTest.ts`) —
  never add a second one;
- rendering and hit testing must keep sharing canonical geometry;
- zoom, selection, grid and clipboard are editor state and are never serialized;
- one gesture = one history step (transaction opened by the interaction engine);
- `ui-project` is the canonical export source; the ASCII section is advisory only;
- do not bump the project format version for additive fields, and keep old documents importable;
- do not make a Container interior greedy, and do not replace the Canvas 2D engine without an
  explicit architecture review.

Before finishing: run the focused tests for the touched area and `npm run build`.
