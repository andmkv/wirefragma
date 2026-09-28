# Changelog

## Unreleased

### MCP for coding agents
- **Remote MCP endpoint** at `/mcp/` (Streamable HTTP, official PHP MCP SDK, both the handshake
  and the stateless 2026-07-28 protocol eras) that operates on the same account storage as the
  browser: `list_projects`, `get_wireframe`, `get_wirefragma_schema`, `create_project`,
  `rename_project`, `create_wireframe`, `update_wireframe`, `rename_wireframe`,
  `duplicate_wireframe`, `delete_wireframe`, `delete_project`, plus `wirefragma://` resources.
- **Personal MCP tokens** in Settings → MCP access: `read` / `write` / `delete` scopes (delete is
  opt-in), expiry (30 d / 90 d / 1 y / never), current password required, shown once, stored as
  SHA-256 only, revocable immediately.
- Optimistic concurrency for agents: `update_wireframe` needs `baseRevision`; a stale write returns
  a `conflict` with the current document — there is no force option over MCP.
- Documents sent by agents are validated against the JSON Schema generated from the TypeScript
  model (`npm run mcp:resources`); unknown fields are preserved exactly.
- The signed-in editor **notices changes made elsewhere** (another device or an agent) by polling
  the project tree: clean wireframes reload ("Updated elsewhere"), unsaved edits go through the
  conflict banner, remote creates/renames/deletes appear in the panel.
- `npm run build:deploy` adds `dist/mcp` (Composer, PHP 8.1+); `npm run build` stays
  Composer-free.
- Public documentation site at `/docs/`.

### Editor
- **Canvas** and **Drawing** scene elements (palette group "Custom"): model, rendering and export
  (Canvas: ASCII sketch, primitive list, relationships; Drawing: LLM description only). The popup
  scene editor is not wired up yet.

### Server
- Project and wireframe persistence moved from `api/index.php` into the shared
  `api/lib/projects.php` (used by the browser API and MCP).
- Documents are stored losslessly: `{}` no longer turns into `[]` on rename, duplicate or save.
- New table `wf_mcp_tokens` (created on demand; `schema.sql` updated).

## 1.1.0 — 2026-09-27

### Editor
- **Nested elements** (Unity-style): drop an element onto another in the Layers tree to put it
  inside. Children always draw in front of their parent and move, hide, lock, copy and delete with
  it. Multi-selections can be dragged into a parent in one step.
- **Layer "…" menu** with *Export layer…*: export only one layer (optionally cropped to its
  content) to explain a single form to an LLM.
- **WIREFRAGMA schema** export tab: LLM-ready instructions (with an example and a JSON Schema) so a
  chat model can *generate* a project; Import accepts the answer as-is (`ui-project` / `json`
  fence or JSON in prose).
- Resizable Projects / Add / Layers panels; Projects and Layers collapse to identical rails.
- UI in **8 languages** (EN, RU, DE, FR, ES, SR, JA, ZH) and a **dark / system theme**. The
  Markdown export stays English.

### Accounts (optional backend)
- Sign-up with captcha, email confirmation and privacy-policy consent; sign-in, password reset,
  profile settings (name, language, theme, password), account deletion — or continue without an
  account.
- Projects panel: projects with wireframes, instant switching with per-wireframe undo history,
  autosave to MySQL with conflict detection, import into a chosen project.
- Plain PHP + MySQL (`server/`), deployable on ordinary shared hosting; see
  `docs/deployment.md` and `docs/accounts.md`.

### Fixes (from a code audit)
- Notes containing ``` code fences no longer break re-import; unreadable saved data is never
  overwritten; a second touch can no longer corrupt undo history; Cmd+Z mid-drag is ignored;
  canvas size / font size can be typed; the Grid button repaints; dialogs close on Escape and block
  editor shortcuts; Layers rows are keyboard-accessible; huge canvases no longer blank out.

## 1.0.0 — 2026-09-23

Initial open-source release.
