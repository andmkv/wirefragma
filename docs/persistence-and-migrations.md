# Persistence and migrations

Source: [`src/utils/storage.ts`](../src/utils/storage.ts),
[`src/model/project.ts`](../src/model/project.ts) (`normalizeProject`),
[`src/App.tsx`](../src/App.tsx) (autosave effect).

## Storage keys

```ts
export const STORAGE_KEY = "wirefragma.project.v1";        // current
export const LEGACY_STORAGE_KEY = "ui-sketch.project.v1";  // pre-rename key
export const BACKUP_STORAGE_KEY = "wirefragma.project.v1.unreadable"; // copy of unreadable data
```

Both live in `localStorage` under the page origin. `saveProject` **only** writes
`STORAGE_KEY`; the legacy key is left untouched when it exists.

## Load order

```ts
loadProject() / loadFrom(storage)
  1. read STORAGE_KEY
       - present  -> parse + normalizeProject
       - absent   -> continue
  2. read LEGACY_STORAGE_KEY
       - absent   -> { project: null, error: null, migrated: false }
       - present  -> parse + normalizeProject, then copy the result into STORAGE_KEY
                     and report { migrated: true }
```

`App` uses the result to decide its first-run messaging:

* `project === null` -> `freshStart: true` -> toast *"Blank canvas — pick an element from the
  palette to start."*;
* `migrated: true` -> toast *"Loaded your project from the previous UI Sketch version."*;
* `error` -> a dismissible notice banner, and the editor opens with a blank project.

## Failure behaviour

| Situation | Behaviour |
| --- | --- |
| `localStorage` unavailable (SSR, privacy mode, blocked) | `loadProject()` returns `{ project: null, error: null }`; `saveProject()` returns `null`; the app keeps working in memory |
| JSON.parse fails | notice: *"The saved project data was corrupted and has been ignored."* |
| `normalizeProject` rejects the data | notice: *"The saved project could not be restored (<reason>)…"*; the raw string is copied to `BACKUP_STORAGE_KEY`, and autosave stays **disarmed until the first real edit**, so opening the app never overwrites data a newer build wrote |
| storage write fails (quota/disabled) | notice: *"Could not save to browser storage (it may be full or disabled)."* |
| legacy key unreadable | migration silently skipped |

`src/utils/storage.test.ts` covers the key precedence, migration and the corruption path;
`src/model/startup.test.ts` covers the blank-project boot state.

## Autosave

```ts
useEffect(() => {
  const timer = window.setTimeout(() => {
    const error = saveProject(project);
    if (error) setNotice(error);
  }, 350);
  return () => window.clearTimeout(timer);
}, [project]);
```

Every committed document change (`history.present` identity change) schedules a debounced write
350 ms later (the real effect also skips the untouched boot project after a load error, see
above). A pending write is flushed on `pagehide` and when the tab becomes hidden, so closing the
tab right after an edit does not lose it. View state — zoom, scroll, selection, grid, active layer — never triggers a save
except through a document change, and is never written to storage.

## Fresh start / New

`createBlankProject()` returns the same document a first launch produces:

```text
version 2 · title "Untitled" · canvas desktop 1200×800
one empty layer "Default" (visible, unlocked) · no elements
```

There is **no demo content and no sample project** loaded at startup. `createSampleProject()`
exists only as a fixture for tests and the development showcase pass.

`New` follows this rule: if the document is already empty it resets immediately, otherwise it asks
for confirmation (`ConfirmDialog`) and then replaces the document and clears the history.

## Format versions and migration

| Version | Shape | Status |
| --- | --- | --- |
| 1 | `{ version: 1, title, canvas, elements[] }` — no layers, no `visible`/`locked` | still accepted on import/load, migrated to 2 |
| 2 | current shape (see [data-model.md](./data-model.md)) | current, written by every export |

`normalizeProject`:

* treats a **missing** `version` as 1 (the legacy default);
* rejects anything that is neither 1 nor 2 with `Unsupported project version: … (supported: 1, 2)`;
* migrates version 1 by creating one `Default` layer, pointing every element at it, and setting
  `visible: true`, `locked: false`;
* always returns a version 2 document.

Invariant: **additive, optional fields do not bump the version.** `textStyle`, `contentSize` and
(1.4) `canvas.preset` were added without changing `PROJECT_VERSION`, and the tests assert the
version stays 2 and that v1 data still imports. `canvas.preset` is validated on every read and
dropped when it is unknown or contradicts the stored size, so an old or hand-edited document can
never fail to import because of it. Only a breaking change to existing semantics justifies a bump — and then
the migration must be added to `normalizeProject` and to the round-trip tests.

## Origin scoping

`localStorage` is scoped to the **origin** (scheme + host + port), so projects do not travel
between addresses. For example all of these keep separate documents:

```text
http://localhost:5173
http://127.0.0.1:5173
https://wirefragma.example
file:///Users/you/Downloads/index.html
```

Consequences worth remembering while testing: opening the dev server on `127.0.0.1` instead of
`localhost` looks like a lost project, and a deployed build starts empty on its own origin. Moving
work between origins (or between machines/browsers) is done with the `.md` / `.json` export and
import. There is no sync, no account and no server-side copy.

**Important testing consequence:** the self-test harness and any manual testing that clears or
rewrites `wirefragma.project.v1` destroy the user's current project on that origin. Prefer a
dedicated profile/origin when running destructive checks.

## Related documents

* [data-model.md](./data-model.md) — `normalizeProject` rules in full.
* [import-export.md](./import-export.md) — the file-based path.
* [deployment.md](./deployment.md) — storage behaviour after deployment.
