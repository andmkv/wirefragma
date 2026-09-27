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
  revision still matches and returns `revision + 1`. A mismatch (another tab/device) returns 409
  with the server copy; the banner offers **Keep my version** (`force: true`) or **Load the other
  version** (replaces the cache entry and remounts the editor).
* Network errors / 5xx / 429 retry every 5 s; the panel footer shows the save state.
* A 401 anywhere (session expired, account deleted elsewhere) returns to the sign-in screen.

## Projects panel

Codex / Claude Code style: projects are folders, wireframes are rows with a compact age ("5m",
"2h"). New project (header **+**, opens in rename mode), new wireframe (row **+**), inline rename
(double-click or **…** → Rename), duplicate, delete (confirmed), **Import** in the footer (the dialog
asks for the destination project — current by default — and the wireframe title, default
"New Wireframe N"; parsed with `projectFromText`), collapse to a rail (remembered per browser). The last opened wireframe is remembered per user.

## Server (`server/api/index.php`)

Plain PHP 7.4+ with PDO MySQL, no Composer, no `mod_rewrite`: one front controller routed by
`?action=`. `vite build` copies `server/api` to `dist/api` (never `config.php` or logs).

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
| `projects` | GET | the tree: projects with wireframe summaries |
| `project-create` / `-rename` / `-delete` | POST | a new project gets one blank "Screen 1" |
| `wireframe` | GET | one wireframe with its document |
| `wireframe-create` / `-save` / `-rename` / `-duplicate` / `-delete` | POST | `save` = optimistic concurrency, see above |

Security measures:

* sessions: `HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS, strict mode, 30-day lifetime;
* CSRF: a per-session token, required as `X-CSRF-Token` on every POST;
* passwords: `password_hash(PASSWORD_DEFAULT)`, rehash on login, ≥ 8 characters, constant-work
  check for unknown emails;
* email tokens: 32 random bytes, only the SHA-256 is stored, single use, one live token per purpose;
* rate limits in MySQL (`wf_rate_limits`, fixed windows) for captcha, register, login (per IP and
  per email), resend, forgot, reset and writes;
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
`wf_rate_limits`. `utf8mb4`, InnoDB, MySQL 5.7+ / MariaDB 10.2+.

## Testing

* `npm test` covers the client helpers (`src/account/projectsPanel.test.ts`).
* `server/tests/api-smoke.sh` drives the whole API (register → verify → save/conflict → logout →
  login → reset → delete) against a **local** `npm run dev:api` server with the `log` mail
  transport. It reads the captcha answer from the PHP session file, so it cannot run against a
  real deployment.
* Local development: `npm run dev:api` (PHP built-in server on :8787) + `npm run dev` (Vite
  proxies `/api` to it).

## Known limitations

* A wireframe is saved as a whole document (no operational merge); concurrent edits resolve by
  choosing one version.
* Projects and wireframes cannot be reordered or moved between projects yet.
* A guest project in `localStorage` is not migrated into the account automatically — export it and
  use **Import** in the projects panel.
* The privacy policy text is generic; the operator should review it (`PrivacyPolicy.tsx`, and
  `privacy` in the server config).
