# Deployment

## Build

```bash
npm install
npm run build        # tsc --noEmit && vite build
npm run preview      # optional local check of the built output
```

Output: `dist/`

```text
dist/index.html
dist/assets/index-<hash>.css      (~14 kB, ~4 kB gzip)
dist/assets/index-<hash>.js       (~252 kB, ~81 kB gzip)
dist/wf_logo_w_white.png          (copied verbatim from public/)
dist/brand/                       (sign-in logos, from public/brand/)
dist/api/                         (optional PHP accounts backend, copied from server/api/)
```

`vite.config.ts` sets:

```ts
base: "./"                 // relative asset paths -> works from any sub-directory
build.outDir: "dist"
build.sourcemap: false
build.chunkSizeWarningLimit: 800
define: { __WIREFRAGMA_BUILD_ID__, __WIREFRAGMA_BUILD_TIME__ }
```

Relative paths mean the same `dist/` can be served from a domain root, a sub-directory or a static
file host without configuration.

## Runtime characteristics

| Aspect | Reality |
| --- | --- |
| Backend | none for the editor; the optional accounts API is PHP (`dist/api/`) — see below |
| Database | none, or MySQL / MariaDB for accounts |
| Authentication | none, or the optional accounts backend |
| Network calls | one `api/index.php?action=status` probe; nothing else unless signed in (Turnstile only if configured) |
| Secrets/config | none for static hosting; `wirefragma-config.php` for accounts |
| Persistence | `localStorage`, per origin, one autosaved slot |
| Interchange | `.md` (with the `ui-project` block) and `.json` downloads/uploads |

The app is a single static page; the only dynamic behaviour is client-side.

## Hosting requirements

* serve static files over HTTP(S);
* no server-side routing is needed (there is exactly one HTML entry point and no client router);
* correct MIME types for `.js`, `.css`, `.png` (any static host does this by default).

Typical targets that work as-is: any static host, a CDN bucket, GitHub Pages, Netlify/Vercel-style
static deployments, an internal nginx/Apache directory, or `file://` for a quick look. **No
vendor-specific config is committed** — do not add one unless the project actually adopts that
vendor.

Note: opening the built file directly over `file://` works for the editor itself, but the OS
clipboard may be restricted there; the internal copy/paste (Cmd/Ctrl+C/V) does not depend on it.

## Deploying with accounts on Namecheap shared hosting (cPanel)

Everything runs on a standard Stellar / cPanel plan: PHP 7.4+ (8.x recommended), MySQL/MariaDB,
Apache with `.htaccess`, `mail()`. No Node.js, SSH or Composer is needed on the server.

1. **Build locally:** `npm install && npm run build`. Upload the **contents** of `dist/` (including
   the hidden `api/.htaccess` and `api/lib/.htaccess`) to `public_html/` (or a sub-folder /
   sub-domain folder) with cPanel **File Manager** (upload a zip, then Extract) or FTP.
2. **PHP version:** cPanel → *Select PHP Version* → 8.1+ with the `pdo_mysql`, `mbstring` and `gd`
   extensions enabled (they are on by default).
3. **Database:** cPanel → *MySQL Databases*: create a database (e.g. `cpuser_wirefragma`) and a
   user with a strong password, then *Add User To Database* with **ALL PRIVILEGES**. Open
   *phpMyAdmin*, select the database → *Import* → `server/schema.sql`.
4. **Mailbox:** cPanel → *Email Accounts*: create `no-reply@yourdomain.com`. Either keep
   `'transport' => 'mail'`, or (better deliverability) use `'smtp'` with host
   `mail.yourdomain.com`, port 465, `secure` `ssl` and that mailbox's credentials. Make sure the
   domain has SPF/DKIM enabled (cPanel → *Email Deliverability*).
5. **Config:** copy `server/api/config.sample.php` to **`/home/CPUSER/wirefragma-config.php`**
   (one level above `public_html`, so it can never be downloaded) and fill in `db`, `app_url`
   (e.g. `https://yourdomain.com/` — with a trailing slash), `mail`, `privacy`. Keep `debug` false.
   If the app lives in a sub-folder (`public_html/wf/`), put the file two levels above `api/`
   (i.e. in `public_html/`) — or anywhere, and point the `WIREFRAGMA_CONFIG` environment variable
   at it.
6. **HTTPS:** enable AutoSSL / the free SSL for the domain (secure cookies depend on it) and force
   HTTPS (cPanel → *Domains* → *Force HTTPS Redirect*).
7. **Check:** open `https://yourdomain.com/api/index.php?action=status` — it must return JSON with
   `"enabled":true`. `503 not_configured` = the config file was not found; `db_unavailable` = wrong
   DB credentials. Then open the site, create an account and confirm the email.
8. **Optional captcha upgrade:** create a free Cloudflare Turnstile widget for the domain and set
   `'captcha' => ['provider' => 'turnstile', 'turnstile_site_key' => …, 'turnstile_secret' => …]`.

Updating later: rebuild and re-upload `dist/` (the config lives outside it and is untouched). The
schema file is idempotent; re-importing it is harmless.

Without step 5 the uploaded site is simply the guest editor — the probe gets `503` and the app
starts without the sign-in screen.

## Storage behaviour after deployment

`localStorage` is scoped to the origin, so:

* `http://localhost:5173` (dev) and `https://example.com` (prod) hold **different** projects;
* changing the host or the port looks like an empty workspace;
* `https` vs `http` on the same host are different origins too;
* clearing site data, or using a private window, loses the document — export first.

Invariant: the **guest** editor never relies on a server for state — everything that must
survive a deployment or a device change travels in the exported Markdown/JSON. Signed-in
wireframes live in the account database instead (see [accounts.md](./accounts.md)).

## Cache busting

Hashed asset filenames and `__WIREFRAGMA_BUILD_ID__` / `__WIREFRAGMA_BUILD_TIME__` are injected at
build time. With `?inputdebug=1` (dev builds) the app logs a `[Wirefragma build]` line and shows a
debug strip, which makes a stale tab easy to spot.

## Related documents

* [persistence-and-migrations.md](./persistence-and-migrations.md) — storage keys and origin scoping.
* [testing.md](./testing.md) — what to run before shipping.
