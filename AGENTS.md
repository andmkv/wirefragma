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
- accounts backend, projects panel, polling → `docs/accounts.md`
- MCP endpoint, tokens, tools, schema resources → `docs/mcp.md`
- deployment (build:deploy, dist/mcp) → `docs/deployment.md`
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
  explicit architecture review;
- project/wireframe persistence exists once (`server/api/lib/projects.php`), shared by the browser
  API and MCP; `server/api` stays Composer-free, Composer lives in `server/mcp` only;
- the MCP schema is generated from `src/utils/schemaExport.ts` (`npm run mcp:resources`) — never
  hand-write the project format in PHP; MCP never force-writes;
- MCP stays at the server/account boundary: no MCP code in `App`, the canvas engine or the model.

Before finishing: run the focused tests for the touched area and `npm run build`. For server
changes also run `server/tests/api-smoke.sh` and `server/tests/mcp-smoke.sh` against a local
server and a throwaway database (never production).
