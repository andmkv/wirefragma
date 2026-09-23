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
| Backend | none — no server, no API, no WebSocket |
| Database | none |
| Authentication | none |
| Network calls | none at runtime (no fonts, no CDN, no analytics) |
| Secrets/config | none; no environment variables are required |
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

## Storage behaviour after deployment

`localStorage` is scoped to the origin, so:

* `http://localhost:5173` (dev) and `https://example.com` (prod) hold **different** projects;
* changing the host or the port looks like an empty workspace;
* `https` vs `http` on the same host are different origins too;
* clearing site data, or using a private window, loses the document — export first.

Invariant: never rely on a server for state. Everything that must survive a deployment or a device
change has to travel in the exported Markdown/JSON.

## Cache busting

Hashed asset filenames and `__WIREFRAGMA_BUILD_ID__` / `__WIREFRAGMA_BUILD_TIME__` are injected at
build time. With `?inputdebug=1` (dev builds) the app logs a `[Wirefragma build]` line and shows a
debug strip, which makes a stale tab easy to spot.

## Related documents

* [persistence-and-migrations.md](./persistence-and-migrations.md) — storage keys and origin scoping.
* [testing.md](./testing.md) — what to run before shipping.
