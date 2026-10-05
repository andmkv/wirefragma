# MCP server (remote, for coding agents)

Sources: [`server/mcp/`](../server/mcp/), [`server/api/lib/projects.php`](../server/api/lib/projects.php),
[`server/api/lib/mcp_tokens.php`](../server/api/lib/mcp_tokens.php),
[`src/account/McpAccess.tsx`](../src/account/McpAccess.tsx),
[`src/account/remoteSync.ts`](../src/account/remoteSync.ts),
[`src/utils/mcpResources.ts`](../src/utils/mcpResources.ts),
[`server/tests/mcp-smoke.sh`](../server/tests/mcp-smoke.sh).

## Purpose

Wirefragma's signed-in mode stores wireframes on the server. The MCP endpoint lets an
authenticated coding agent or LLM client (Claude Code, Codex, Cursor, the MCP Inspector, …) work
with those same wireframes **structurally**, while a human edits them **visually** in the browser:

* discover the user's projects and wireframes;
* read a wireframe's canonical document;
* create projects and wireframes, replace a wireframe's document, rename, duplicate;
* delete — only with a token that explicitly carries the `delete` permission.

MCP is just another client of the account storage. There is no second database, no MCP-specific
document format, no synchronisation between stores, and **no AI inside Wirefragma**: the agent is
the external LLM; Wirefragma only stores and validates JSON.

```text
                        Wirefragma account
                               │
                        MySQL (wf_projects, wf_wireframes)
                               │
                  canonical WireframeProject JSON + revision
                               │
                   server/api/lib/projects.php   ← one persistence layer
                ┌──────────────┴──────────────┐
                │                             │
     api/index.php (browser)          mcp/index.php (MCP)
     PHP session + CSRF               Bearer wf_mcp_… token
                │                             │
          Workspace / App               LLM / coding agent
```

Guest projects (browser `localStorage`) have no server identity and are **not** reachable over
MCP. A guest who wants MCP access signs in and imports the project (projects panel → Import).

## Endpoint

```text
https://<your host>/mcp/          e.g. https://wire.smallhall.net/mcp/
```

* Transport: **Streamable HTTP** (official `mcp/sdk` for PHP), one POST per JSON-RPC message.
* Both protocol eras are served from the same URL: handshake-era clients (`initialize`,
  `Mcp-Session-Id`, revisions up to `2025-11-25`) and stateless `2026-07-28` clients (per-request
  `_meta` envelope + `Mcp-Method` / `Mcp-Name` headers). The SDK classifies each request.
* Settings shows the URL, built from the server's `app_url` (or `mcp.endpoint` in the config), so
  a local setup shows the local endpoint.

## Authentication: personal MCP tokens (v1)

The browser API keeps its PHP session + HttpOnly cookie + CSRF. MCP never accepts that session,
and the browser API never accepts MCP tokens.

| Aspect | Behaviour |
| --- | --- |
| Format | `wf_mcp_` + 43 URL-safe characters (32 random bytes) |
| Storage | `wf_mcp_tokens.token_hash` = SHA-256 of the whole token; the raw value is never stored |
| Shown | exactly once, in the Settings dialog right after creation (component state only; never in `localStorage`) |
| Listing | name, prefix (`wf_mcp_a1b2c…`), scopes, created, expires, last used — never the secret or hash |
| Transport | `Authorization: Bearer wf_mcp_…` on every request |
| Creation | signed-in Settings → MCP access, **current password required**, 10 creations / hour / user, max 25 active tokens |
| Expiry | 30 days, **90 days (default)**, 1 year, never |
| Revocation | immediate: the next request with that token gets 401 |
| Account deletion | cascades to the account's tokens (foreign key) |
| `last_used_at` | refreshed at most once a minute, so a busy agent does not write on every call |

Validation (`TokenValidator` → `wf_mcp_token_resolve`): format check → SHA-256 → active row
(`revoked_at IS NULL`, not expired) joined to a verified user → user id + scopes. The identity
lives in a request-scoped `Identity` object; it is **never** written to the MCP protocol session,
so a session id presented with another token acts as that other token's user.

Why a small `BearerAuthMiddleware` instead of the SDK's `AuthorizationMiddleware`: the SDK's
middleware is an OAuth 2.1 resource server whose 401 must advertise RFC 9728 protected-resource
metadata naming an authorization server. Personal tokens have none, and advertising one would send
clients into an OAuth flow that cannot succeed. Our middleware keeps the same contract — it calls an
`AuthorizationTokenValidatorInterface` and answers 401/403 with a `WWW-Authenticate: Bearer`
challenge — so OAuth can be added later without touching tools (see *Future: OAuth*).

### Scopes

| Scope | Allows |
| --- | --- |
| `read` | `list_projects`, `get_wireframe`, `get_wirefragma_schema`, all resources. Every token has it. |
| `write` | `create_project`, `rename_project`, `create_wireframe`, `update_wireframe`, `rename_wireframe`, `duplicate_wireframe` |
| `delete` | `delete_wireframe`, `delete_project` (never implied by `write`; opt-in, off by default) |

New tokens default to `read` + `write`. A tool without its scope returns `forbidden_scope`.

## Tools

The document is the API: there is no `add_button` / `move_element` family. Every tool is a thin
adapter over `lib/projects.php` — the exact functions the browser API calls — so name limits,
blank documents, positions, duplicate naming and title synchronisation are identical.

| Tool | Scope | Arguments | Result |
| --- | --- | --- | --- |
| `list_projects` | read | — | `{projects: [{id, name, updatedAt, wireframes: [{id, title, revision, updatedAt}]}]}` — metadata only |
| `get_wirefragma_schema` | read | — | `{schema}`: the project format for writing documents (Markdown, see *Schema*) |
| `get_wireframe` | read | `wireframeId` | `{id, projectId, title, revision, updatedAt, data}` — `data` exactly as stored |
| `create_project` | write | `name`, `withWireframe?` (true), `wireframeTitle?` ("Screen 1") | `{projectId, name, wireframeId, wireframe}` |
| `rename_project` | write | `projectId`, `name` | `{projectId, name}` |
| `create_wireframe` | write | `projectId`, `title`, `data?` | `{wireframeId, projectId, title, revision: 1, updatedAt}` |
| `update_wireframe` | write | `wireframeId`, `baseRevision`, `data`, `title?` | `{revision, title}` or a `conflict` error |
| `rename_wireframe` | write | `wireframeId`, `title` | `{revision, projectId, title, updatedAt}` |
| `duplicate_wireframe` | write | `wireframeId`, `title?` | `{wireframeId, sourceWireframeId, title, revision, …}` — default title "`<title> copy`" |
| `delete_wireframe` | delete | `wireframeId`, `confirmTitle` | `{deletedWireframeId, title}` |
| `delete_project` | delete | `projectId`, `confirmName` | `{deletedProjectId, name, deletedWireframes}` — **cascades to all its wireframes** |

Details that matter:

* Names: project ≤ 120 characters, wireframe title ≤ 160, trimmed; empty → `bad_name`.
* `create_wireframe` / `update_wireframe`: the wireframe title is written into `data.title` (the
  panel and the document never disagree). `update_wireframe` uses `title`, else `data.title`, else
  the current title.
* Deletes require the exact current title/name as confirmation (`confirmation_mismatch`
  otherwise, nothing deleted).
* Tool annotations mark reads `readOnlyHint`, deletes and `update_wireframe` `destructiveHint`.
* Results: the JSON payload as text content, plus the same object as `structuredContent` —
  except results that contain a whole document (`get_wireframe`, `get_wirefragma_schema`, the
  document inside a conflict), which are text-only to avoid doubling up to 2 MB.

### Errors

Failures the model should see and recover from are **tool errors** (`isError: true`) with a
JSON body `{"error": "<code>", "message": "…", …}`:

| Code | When |
| --- | --- |
| `unauthorized` | (HTTP 401 before any tool runs) missing, malformed, unknown, revoked or expired token |
| `forbidden_scope` | the token lacks the tool's scope |
| `not_found` | the project/wireframe does not exist **or belongs to another user** (no IDOR oracle) |
| `bad_name` / `bad_request` | empty name, invalid argument |
| `bad_document` | `data` is not an object, or fails the generated JSON Schema (`problems` lists up to 5 JSON pointers) |
| `too_large` | the encoded document exceeds 2 MB |
| `conflict` | `baseRevision` is stale — see below; carries `current` |
| `confirmation_mismatch` | delete confirmation did not match |
| `rate_limited` | a limit below was hit (HTTP 429 when it is the per-token request limit) |
| `server_error` | anything unexpected — logged server-side (message only), generic to the client |

Invalid JSON-RPC / arguments that violate the tool's `inputSchema` are JSON-RPC errors produced by
the SDK. No SQL, file paths, stack traces or configuration ever reach the client.

## Revisions and conflicts

The server keeps one JSON document per wireframe and a `revision` counter shared by every client.

```text
get_wireframe            → revision N
edit data locally (agent)
update_wireframe(baseRevision = N)
        ├── server still at N → stored, revision N+1
        └── server at M > N   → conflict, nothing written, returns current {revision M, data, …}
```

* MCP has **no force option**. The browser's "Keep my version" (`force: true`) exists only in
  the browser API, behind an explicit user click.
* A conflict result contains `current` (id, projectId, title, revision, updatedAt, **data**) and
  a `hint`. The agent re-applies its intended change to `current.data` and retries with
  `baseRevision = current.revision`; it must not resend the stale document.
* `rename_wireframe` increments the revision too (the title lives inside the document).

### Browser ↔ MCP: noticing changes made elsewhere

The browser caches opened wireframes with their revision. `Workspace` polls the lightweight tree
(`GET api/index.php?action=projects`: ids, titles, revisions — no documents):

* every **5 s** while the page is visible; immediately on window `focus` and on
  `visibilitychange → visible`; **paused while hidden**; never overlapping; exponential back-off
  up to 60 s after network/5xx/429 failures; never in guest mode;
* a poll response that started before a local tree change is discarded (it could otherwise undo a
  wireframe the user just created or deleted);
* per cached wireframe (`planRemoteSync`, pure and unit-tested):
  * open + clean + newer server revision → fetch it, replace the cache entry
    (`history.present`, `savedJson` and `revision` from the same server copy), remount the editor,
    flash **"Updated elsewhere"**. Loading cannot trigger an autosave: the entry is clean by
    construction, so there is no reload → save → reload loop;
  * open + dirty + newer revision → the pending edit is saved now; the server answers 409 and the
    existing conflict banner appears (**Keep my version** / **Load the other version**, which
    always fetches the latest copy). Local edits are never overwritten silently;
  * not open + clean + outdated → dropped from the cache (reloaded on next open);
  * deleted on the server → dropped; if it was open, the editor switches to a neighbour (or the
    empty state) and says "“…” was deleted elsewhere";
  * nothing is decided while that wireframe's own save is in flight;
* new/renamed/duplicated/deleted projects and wireframes simply appear in the panel.

The wording is "elsewhere", never "by MCP": another tab or device looks the same.

No WebSockets, CRDT, operational transforms or presence — whole-document optimistic locking is the
model, and polling is enough for shared hosting.

## Resources

| URI | MIME | Content |
| --- | --- | --- |
| `wirefragma://schema` | `text/markdown` | same as `get_wirefragma_schema` |
| `wirefragma://schema/project.json` | `application/schema+json` | the JSON Schema documents are validated against |
| `wirefragma://projects` | `application/json` | same as `list_projects` |
| `wirefragma://wireframes/{id}` (template) | `application/json` | same as `get_wireframe` |

Resources are read-only views; the tools are the primary interface (many clients never read
resources on their own). No subscriptions.

## Schema: one source of truth

The PHP server contains **no** description of the project format. Both files in
`server/mcp/resources/` are generated from the TypeScript model:

* `wirefragma-schema.md` — `wirefragmaSchemaMarkdown("mcp")` from
  [`src/utils/schemaExport.ts`](../src/utils/schemaExport.ts): the same generator as the in-app
  "WIREFRAGMA schema" export, with MCP output rules and the editing rules instead of "answer with
  a fenced block";
* `project-schema.json` — `projectJsonSchema()`.

```bash
npm run mcp:resources            # regenerate (runs the TS through Vite's SSR loader)
npm run mcp:resources -- --check # fail if stale (build:deploy does this)
```

`src/utils/mcpResources.test.ts` fails when the committed files differ from the generator, so a
model change cannot leave MCP behind. `create_wireframe` / `update_wireframe` validate `data`
against `project-schema.json` with `opis/json-schema` (a dependency of the SDK). The schema allows
unknown extra fields, so additive data passes through untouched. Documents stored by the browser
are not re-validated; the browser keeps running `normalizeProject` on everything it loads.

There is deliberately no PHP port of the ASCII sketch, semantic sections or spatial summary: MCP
transports the canonical JSON, which is the complete information. The Markdown export stays a
browser feature.

## Lossless documents

`json_decode($json, true)` cannot tell `{}` from `[]` and turns `{"0": …}` into a list. Two
measures keep documents byte-for-byte meaningful:

* `lib/projects.php` handles documents as `stdClass` trees (browser saves read `data` through
  `wf_input_object_field`, rename/duplicate decode stored JSON with objects);
* the SDK decodes JSON-RPC as arrays, so MCP tools re-read the `data` argument from the raw request
  body (matched by JSON-RPC id) with objects preserved — `Documents::rawArgument`.

`mcp-smoke.sh` checks that `{}`, `{"0": "a"}`, `1.0` and unknown top-level/element fields survive a
write and a read through both APIs.

### Canvas and Drawing elements

`diagram` ("Canvas": structured shapes in `element.diagram`) and `drawing` (freehand strokes +
`description` in `element.drawing`) are ordinary fields of the canonical document, described by the
generated schema. MCP reads and writes them like everything else and never strips raw stroke data.
Agents and the browser's popup editors write the same fields, so a Canvas drawn by an agent opens
in the browser editor and vice versa. A compact MCP representation that omits Drawing
strokes (for token efficiency) may be added later; it is not needed yet.

### Chart elements and canvas presets

`chart` elements (`element.chart`: `kind`, `title?`, `categories[]`, `series[{name, values[]}]`,
`options?`) are described by the same generated schema: the `chart` type is in the `type` enum and
the dataset has its limits spelled out (≤ 24 categories, ≤ 8 series, names ≤ 40 characters, title ≤
80 characters; values are numbers, numeric strings or `null` for a gap). An agent can therefore
create a Chart by writing plain JSON — the example in `get_wirefragma_schema` shows one — and the
browser draws it; the PHP server needs no change because it only checks for a JSON object with an
`elements` array plus this schema.

The optional `canvas.preset` (a device id such as `phone-iphone-15`, paired with `mode: "custom"`)
is not described by the schema on purpose: it is cosmetic, the schema allows unknown fields, and the
browser drops an id that is unknown or disagrees with the stored `width` × `height`. Agents should
simply choose a `mode` and a size.

Every model change that adds element types or documented fields must be followed by
`npm run mcp:resources`; `src/utils/mcpResources.test.ts` and `build:deploy` fail on stale files
(1.3.5 regenerated them for `chart`).

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| Document | 2 MB of JSON (same as the browser) | `WF_MAX_DOCUMENT_BYTES` |
| HTTP body | 2 × 2 MB + 256 KB (a client may `\u`-escape every non-ASCII character) → 413 above | `Endpoint::MAX_BODY_BYTES` |
| Requests | 3000 / hour / token (all MCP traffic) → HTTP 429 | `TokenValidator` |
| Writes | 600 / hour / user (all write and delete tools) → `rate_limited` | `Tools::WRITES_PER_HOUR` |
| Failed authentications | 300 / 10 min / IP (valid tokens are never IP-limited) | `TokenValidator` |
| Token creation | 10 / hour / user | browser API |

Limits reuse the MySQL fixed-window table `wf_rate_limits`; no IP limits apply to valid tokens,
so hosted clients sharing egress IPs are not penalised. PHP's `post_max_size` must be at least
the HTTP body limit (cPanel defaults are larger).

## Example agent workflows

Create:

```text
User:  Create a Settings wireframe in my "My App" project.
Agent: list_projects()                          → project "My App" = 12
       get_wirefragma_schema()                  → format, example, rules
       create_wireframe(projectId=12, title="Settings", data={…})
       → {"wireframeId": 52, "revision": 1, …}
```

Modify:

```text
User:  Add a destructive "Delete account" button.
Agent: get_wireframe(52)                        → revision 4, data
       add one element to data.elements, keep everything else as is
       update_wireframe(wireframeId=52, baseRevision=4, data={…})
       → {"revision": 5}
```

Conflict:

```text
Agent reads revision 5; the user edits in the browser → revision 6.
Agent: update_wireframe(52, baseRevision=5, …)
       → {"error": "conflict", "current": {"revision": 6, "data": {…}}, "hint": "…"}
Agent: re-applies its change to current.data → update_wireframe(52, baseRevision=6, …) → 7
Browser: the next poll sees 7 > 6 and loads it ("Updated elsewhere").
```

## Connecting a client

Create a token in **Settings → MCP access**, then add the endpoint with the header
`Authorization: Bearer <token>`.

MCP Inspector (verified with `@modelcontextprotocol/inspector` 2.8.0):

```bash
npx @modelcontextprotocol/inspector --cli https://wire.smallhall.net/mcp/ --transport http \
  --header "Authorization: Bearer wf_mcp_…" --method tools/list
npx @modelcontextprotocol/inspector --cli http://localhost:5173/mcp/ --transport http \
  --header "Authorization: Bearer wf_mcp_…" --method tools/call --tool-name list_projects
```

Without `--cli` the Inspector opens its web UI: choose transport *Streamable HTTP*, enter the URL,
and add the `Authorization` header under authentication/custom headers.

Typical client configurations (syntax belongs to each client and changes; check its docs):

```bash
# Claude Code
claude mcp add --transport http wirefragma https://wire.smallhall.net/mcp/ \
  --header "Authorization: Bearer wf_mcp_…"
```

```json
// Cursor (.cursor/mcp.json) and other clients with a url + headers form
{ "mcpServers": { "wirefragma": { "url": "https://wire.smallhall.net/mcp/",
  "headers": { "Authorization": "Bearer wf_mcp_…" } } } }
```

Keep tokens out of committed files; prefer environment variables where the client supports them.

## Local development

```bash
npm run mcp:install      # composer install in server/mcp (Composer + PHP 8.1+ needed once)
npm run dev:api          # php -S 127.0.0.1:8787 -t server  → /api and /mcp
npm run dev              # Vite on :5173 proxies /api and /mcp to the PHP server
```

The endpoint is then `http://localhost:5173/mcp/` (through Vite) or `http://127.0.0.1:8787/mcp/`
(direct). Tests: see [testing.md](./testing.md) (`server/tests/mcp-smoke.sh`, against a throwaway
local database — never production).

Only the MCP endpoint needs Composer. `npm install`, `npm test`, `npm run dev` and `npm run build`
work without it; the Settings section then says the MCP server is not installed on this host.

## Deployment (shared hosting)

Hard constraints: Apache/cPanel, PHP 8.1+, PDO MySQL, plain files — no daemon, Node service,
Redis, Docker or worker. The MCP endpoint is ordinary PHP: one request in, one response out.

* `npm run build:deploy` = schema staleness check → `composer install --no-dev` → `npm run build`
  → `scripts/package-mcp.mjs` copies `server/mcp` (with `vendor/`) to `dist/mcp` and adds a deny-all
  `.htaccess` to `vendor/`. Upload the contents of `dist/` as before.
* `composer.json` pins the platform to PHP 8.1, so the lock file installs on the host's PHP even if
  the build machine runs a newer one. The browser API (`api/`) still runs on PHP 7.4+ and has no
  Composer dependency.
* `mcp/.htaccess` serves `index.php` only; `src/`, `resources/`, `vendor/`, `composer.*` are denied
  (sub-folder `.htaccess` files also override the parent's `index.php` grant). It also forwards the
  `Authorization` header, which some CGI/FastCGI setups drop.
* MCP protocol sessions (handshake era only) are files in `mcp.session_dir` — set it to a private
  folder outside `public_html` (e.g. `/home/USER/.wirefragma-mcp-sessions`); default: system temp
  dir. They expire after 24 h idle and are garbage-collected by the SDK. They are unrelated to the
  PHP login sessions.
* Host validation (DNS rebinding): the SDK middleware stays on; allowed hosts = host of `app_url`
  (+ `mcp.endpoint`, `mcp.allowed_hosts`) + loopback. CORS stays closed (`mcp.allowed_origins` is
  empty; never `*` with bearer credentials).
* Full steps: [deployment.md](./deployment.md#mcp-endpoint).

## Security notes (what was checked)

* tokens: only hashes stored; raw token never logged, never listed, never persisted in the browser;
  the SDK logger is replaced by one that logs errors only and drops context (arguments);
* every query is scoped by the token's user id; other users' ids answer `not_found`;
* scope checks happen in one place (`Identity::requireScope`) before any data access;
* no force-write path in MCP; conflicts return the server copy;
* browser API: CSRF unchanged, token management needs session + CSRF + password;
* `vendor/`, `src/`, `resources/`, composer files and session files are not web-accessible;
  `dist/` never contains `config.php`, `wirefragma-config.php`, logs or sessions;
* all SQL uses prepared statements (the only interpolation is internal table/column constants).

This is a review, not a proof; see [known-limitations.md](./known-limitations.md).

## Future: OAuth

Hosted MCP clients (ChatGPT, Claude.ai connectors) prefer a user-facing OAuth 2.1 flow. The
extension path:

1. run or adopt an authorization server (not part of Wirefragma v1);
2. validate its access tokens with an `AuthorizationTokenValidatorInterface` (e.g. the SDK's
   `JwtTokenValidator`, or a validator that accepts both OAuth and `wf_mcp_` tokens) that fills
   `Identity` with the user id and mapped scopes;
3. swap `BearerAuthMiddleware` for the SDK's `AuthorizationMiddleware` +
   `ProtectedResourceMetadataMiddleware` so clients can discover the authorization server.

Tools, resources, scopes and the persistence layer stay unchanged.

## Not in v1 (deliberately)

Patch-style `apply_changes`, deep links that open a wireframe, resource subscriptions, dynamic
client registration, OAuth, MCP access to guest projects, server-side Markdown/ASCII rendering,
built-in AI, realtime collaboration.
