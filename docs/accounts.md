# Accounts and projects (optional backend)

Sources: [`src/Root.tsx`](../src/Root.tsx), [`src/account/`](../src/account/),
[`server/api/`](../server/api/), [`server/schema.sql`](../server/schema.sql).

Wirefragma is still a static, client-side editor first. The accounts backend is **optional**: a
small PHP + MySQL API that adds sign-up, sign-in and a projects panel whose wireframes are stored
in the database. Where the backend is missing (GitHub Pages, `file://`, any static host, or a
PHP host without `config.php`) the app behaves exactly as before.

## Modes

`Root` decides on start-up (`fetchStatus()` → `GET api/index.php?action=status`, 4 s timeout):

| Situation | What the user sees |
| --- | --- |
| no backend (request fails, non-JSON, 503 `not_configured`, DB down) | the guest editor, unchanged |
| backend, signed in (session cookie) | `Workspace`: projects panel + editor |
| backend, not signed in | `AuthScreen` (sign in / create account) |
| backend, "Continue without an account" chosen earlier | guest editor + a **Sign in** button in the toolbar (`localStorage["wirefragma.mode"] = "guest"`) |
| URL `?verify=` / `?reset=` / `?forgot=1` (email links) | `AuthScreen` in that mode; the parameters are stripped from the URL once, at module load |

Guest mode keeps using the single `localStorage` slot (see
[persistence-and-migrations.md](./persistence-and-migrations.md)). Signed-in documents **never**
touch that slot.

## Editor integration (`EditorHost`)

`App` takes an optional `host` prop. Without it, nothing changed. With it:

* the document comes from `host.initialHistory` (not `localStorage`) and every history change is
  reported through `host.onHistoryChange`; guest autosave is disabled;
* `host.sidebar` (the projects panel) is rendered as the first workspace column
  (`.workspace.with-projects`);
* the avatar menu has **Settings…** (profile, language, theme, password, MCP access tokens, delete account — see
  [i18n-and-theming.md](./i18n-and-theming.md)) and **Sign out**;
* the toolbar hides **Import** (it moves to the projects panel), **New** creates a wireframe in the
  current project, and `host.accountSlot` (avatar menu) is appended;
* `host.notice` shows save errors / conflicts in a banner.

`Workspace` renders `<App key={wireframeId:epoch} host=…>`: each wireframe gets a fresh editor.
The panel's own UI state (collapsed projects, inline rename) therefore lives in `Workspace`, not
in `ProjectsPanel`.

## Fast switching and autosave

* Every opened wireframe keeps its **whole undo history** in an in-memory cache
  (`Map<id, { history, revision, savedJson, projectId }>`); switching back is instant and undo still
  works.
* Rows are **prefetched** on hover/focus, so a click usually opens from the cache.
* Edits save **700 ms** after the last change (one request in flight at a time, mid-gesture states
  skipped). On `pagehide` a pending save is sent with `fetch(..., { keepalive: true })`.
* **Optimistic concurrency:** each save sends `baseRevision`; the server only updates when the
  revision still matches and returns `revision + 1`. A mismatch (another tab/device, or an MCP
  agent) returns 409 with the server copy; the banner offers **Keep my version** (`force: true`) or
  **Load the other version** (fetches the latest server copy, replaces the cache entry and
  remounts the editor).
* Network errors / 5xx / 429 retry every 5 s; the panel footer shows the save state.
* A 401 anywhere (session expired, account deleted elsewhere) returns to the sign-in screen.

## Changes made elsewhere (revision polling)

Another tab, another device or an MCP agent ([mcp.md](./mcp.md)) can change the same account.
`Workspace` polls `GET ?action=projects` (the metadata tree: ids, titles, revisions) and applies
the pure rules in [`src/account/remoteSync.ts`](../src/account/remoteSync.ts):

* every 5 s while the page is visible, at once on window focus / `visibilitychange → visible`,
  paused while hidden, no overlapping requests, back-off up to 60 s after failures;
* the open wireframe, clean, newer on the server → loaded and the editor remounted, with a brief
  "Updated elsewhere" notice. The loaded copy becomes `history.present`, `savedJson` and
  `revision` at once, so it is clean and is never autosaved back (no save loop);
* the open wireframe with unsaved edits → saved immediately so the server answers 409 → the conflict
  banner above; local edits are never overwritten;
* other cached wireframes that are outdated are dropped from the cache; deleted ones too — if the
  open one was deleted, a neighbour opens and a notice says so;
* projects/wireframes created, renamed, duplicated or deleted elsewhere appear in the panel;
* a poll that started before a local tree change is discarded, so it cannot undo that change.

## Projects panel

Codex / Claude Code style: projects are folders, wireframes are rows with a compact age ("5m",
"2h"). New project (header **+**, opens in rename mode), new wireframe (row **+**), inline rename
(double-click or **…** → Rename), duplicate, delete (confirmed), **Export project (.wfproj)** in a
project's **…** menu (every wireframe in one file), **Import** in the footer (a wireframe, or a whole
`.wfproj` as a new project — see [import-export.md](./import-export.md#project-files-wfproj); the dialog
asks for the destination project — current by default — and the wireframe title, default
"New Wireframe N"; parsed with `projectFromText`), collapse to a rail (remembered per browser). The last opened wireframe is remembered per user.

## Server (`server/api/index.php`)

Plain PHP 7.4+ with PDO MySQL, no Composer, no `mod_rewrite`: one front controller routed by
`?action=`. `vite build` copies `server/api` to `dist/api` (never `config.php` or logs).

`index.php` only parses requests and checks the session; project and wireframe persistence lives
in [`lib/projects.php`](../server/api/lib/projects.php) (ownership checks, name limits, blank
documents, positions, revision/conflict handling, title synchronisation, duplicate naming). The
MCP endpoint calls the **same** functions — there is one implementation for both clients.
Documents are handled as `stdClass` trees, so `{}` stays `{}` and unknown fields survive exactly.

| Action | Method | Notes |
| --- | --- | --- |
| `status` | GET | backend on?, current user, CSRF token, captcha provider, privacy info |
| `captcha` | GET | new built-in challenge (PNG data URL, or an arithmetic question without GD) |
| `register` | POST | captcha + privacy consent + honeypot; always answers "check your inbox" (no account enumeration) |
| `verify` | POST | consumes the emailed token, marks the email verified, creates a starter project, signs in |
| `resend` | POST | new confirmation link for an unverified address |
| `login` / `logout` | POST | unverified accounts are refused; session id regenerated on sign-in |
| `forgot` / `reset` | POST | captcha on `forgot`; reset link valid 1 h; always a generic answer |
| `delete-account` | POST | password required; foreign keys cascade to projects, wireframes and tokens |
| `settings-save` | POST | display name and interface preferences (`language`, `theme`), validated against fixed lists |
| `password-change` | POST | current password required; invalidates pending reset links |
| `projects` | GET | the tree: projects with wireframe summaries |
| `project-create` / `-rename` / `-delete` | POST | a new project gets one blank "Screen 1" |
| `wireframe` | GET | one wireframe with its document |
| `wireframe-create` / `-save` / `-rename` / `-duplicate` / `-delete` | POST | `save` = optimistic concurrency, see above |
| `mcp-tokens` | GET | the MCP endpoint URL (`app_url` + `mcp/`), whether it is installed, the user's tokens (never secrets or hashes) |
| `mcp-token-create` | POST | `name`, `scopes` (`read` required, `write`, `delete`), `expiresInDays` (30/90/365/null), **current `password`**; returns the raw token once; 10/hour |
| `mcp-token-revoke` | POST | `id`; immediate |

Security measures:

* sessions: `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, strict mode, 30-day lifetime;
* CSRF: a per-session token, required as `X-CSRF-Token` on every POST;
* passwords: `password_hash(PASSWORD_DEFAULT)`, rehash on login, ≥ 8 characters, constant-work
  check for unknown emails;
* email tokens: 32 random bytes, only the SHA-256 is stored, single use, one live token per purpose;
* rate limits in MySQL (`wf_rate_limits`, fixed windows) for captcha, register, login (per IP and
  per email), resend, forgot, reset, writes and MCP token creation;
* MCP tokens: only the SHA-256 is stored, the raw token is shown once; they authenticate the MCP
  endpoint only, never this API (see [mcp.md](./mcp.md));
* captcha: built-in distorted PNG (answer only in the session, single use, 10 min) or Cloudflare
  Turnstile verified server-side; plus a honeypot field;
* every query is a prepared statement; every wireframe/project query is scoped by `user_id`;
* documents must be JSON objects with an `elements` array, max 2 MB; the client runs
  `normalizeProject` on everything it loads;
* `display_errors` off, errors go to the server log; `.htaccess` denies `lib/`, `config.php`,
  `*.log`, `*.sql`.

Configuration: see `server/api/config.sample.php` and [deployment.md](./deployment.md).

## Database

`server/schema.sql` (idempotent, `IF NOT EXISTS`): `wf_users`, `wf_email_tokens`, `wf_projects`,
`wf_wireframes` (the document is the same JSON as the `ui-project` block, in a `MEDIUMTEXT`),
`wf_rate_limits`, `wf_user_settings` (preferences) and `wf_mcp_tokens` (personal MCP tokens).
The last two are also created on demand by the API, so databases from earlier releases need no
migration step. `utf8mb4`, InnoDB, MySQL 5.7+ / MariaDB 10.2+.

## Testing

* `npm test` covers the client helpers (`src/account/projectsPanel.test.ts`) and the polling rules
  (`src/account/remoteSync.test.ts`).
* `server/tests/api-smoke.sh` drives the whole API (register → verify → save/conflict → logout →
  login → reset → delete) against a **local** `npm run dev:api` server with the `log` mail
  transport. It reads the captcha answer from the PHP session file, so it cannot run against a
  real deployment. `server/tests/mcp-smoke.sh` does the same for MCP tokens and the MCP endpoint.
* Local development: `npm run dev:api` (PHP built-in server on :8787) + `npm run dev` (Vite
  proxies `/api` to it).

## Known limitations

* A wireframe is saved as a whole document (no operational merge); concurrent edits resolve by
  choosing one version. Changes made elsewhere arrive by polling (up to ~5 s), not push.
* Projects and wireframes cannot be reordered or moved between projects yet.
* A guest project in `localStorage` is not migrated into the account automatically — export it and
  use **Import** in the projects panel.
* The privacy policy text is generic; the operator should review it (`PrivacyPolicy.tsx`, and
  `privacy` in the server config).
