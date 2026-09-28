# Import and export

Sources: [`src/utils/markdownExport.ts`](../src/utils/markdownExport.ts),
[`src/utils/markdownImport.ts`](../src/utils/markdownImport.ts),
[`src/components/ExportDialog.tsx`](../src/components/ExportDialog.tsx),
[`src/components/ImportDialog.tsx`](../src/components/ImportDialog.tsx),
[`src/App.tsx`](../src/App.tsx).

## The contract

```text
Markdown document      = human/LLM readable sections (advisory)
    ui-project block   = canonical, lossless, machine-readable project source
```

Import **always** reconstructs from the `ui-project` JSON block. The ASCII drawing, the semantic
element list and the spatial summary are never parsed back into the model.

Invariant: the `ui-project` fence name and the project format version are part of the public
contract. Do not rename the fence, and do not bump the version for additive, optional fields.

## Export

### Entry points

| Trigger | Function | Result |
| --- | --- | --- |
| Toolbar **Export** | `ExportDialog` -> `projectToMarkdown` | Markdown tab, with Copy and Download `.md` |
| Export dialog -> **Copy for LLM** tab | `projectToLlmMarkdown` | the same document prefixed with `LLM_PREAMBLE` and a `---` separator |
| Export dialog -> **Project JSON** tab | `projectToJson` | raw `{ version, title, canvas, layers, elements }`, downloaded as `.json` |
| Export dialog -> **WIREFRAGMA schema** tab | `wirefragmaSchemaMarkdown` | LLM instructions for generating an importable project (see below) |
| Layers panel -> layer **…** -> **Export layer…** | `projectForLayer` -> the same three tabs | only that layer's elements, as a standalone project (see below) |
| Toolbar **Copy for LLM** | `copyText(projectToLlmMarkdown(project))` | straight to the OS clipboard, with a toast |
| Export dialog -> Project JSON -> **Download .wfproj** | `createBundle` | the current wireframe as a one-wireframe project file |
| Projects panel -> project **…** -> **Export project (.wfproj)** | `Workspace.exportProject` | every wireframe of the project in one file (signed in) |

### Project files (`.wfproj`)

[`src/utils/projectBundle.ts`](../src/utils/projectBundle.ts): a JSON envelope
`{ "format": "wirefragma-project", "version": 1, "name", "exportedAt", "wireframes": [{ "title", "data" }] }`
where each `data` is the canonical `WireframeProject` — no second document format. Export writes
the documents as stored (a clean wireframe is fetched from the server, so unknown fields survive;
a wireframe with unsaved edits contributes its current local document). Import validates the
envelope and runs `normalizeProject` on every document; one unreadable wireframe fails the whole
file with its title in the message, so nothing is half-imported. `projectBundle.test.ts` covers
round trips, title handling, rejects and file names.

### WIREFRAGMA schema (for generating projects with an LLM)

The Export dialog's **WIREFRAGMA schema** tab shows `wirefragmaSchemaMarkdown()`
(`src/utils/schemaExport.ts`): instructions that teach a chat model the project JSON format so it
can *write* a wireframe — output rules, the coordinate system, the document shape, a table of all
element types (generated from `ELEMENT_TYPES` / `ELEMENT_DEFAULTS` plus the typed `TYPE_GUIDE`
record, so a new type without a description is a compile error), layers/stacking/nesting, text
and symbol rules, note-writing guidance, what the importer repairs, a complete example project
(`schemaExampleProject()`, pinned by tests to import unchanged) and a JSON Schema
(`projectJsonSchema()`). It does not depend on the current document. Download:
`wirefragma-schema.md`.

The same generator has an MCP variant, `wirefragmaSchemaMarkdown("mcp")`: identical format
description, but the output rules say "pass the project as the `data` argument of
`create_wireframe` / `update_wireframe`" and it adds the rules for editing an existing wireframe
(read → minimal change → write with `baseRevision` → re-apply on conflict). `npm run mcp:resources`
writes it, together with `projectJsonSchema()`, to `server/mcp/resources/` for the MCP server
([mcp.md](./mcp.md#schema-one-source-of-truth)).

### Layer-scoped export

`projectForLayer(project, layerId, { crop })` (`src/model/layerExport.ts`) turns one layer into an
ordinary `WireframeProject`: title `"<project> — <layer>"`, a single layer (forced visible),
only that layer's elements (element-level visibility is kept), `zIndex` recomputed. With **Crop
canvas to the layer content** (on by default) the canvas shrinks to the visible content plus
`LAYER_EXPORT_PADDING = 16` on every side (never below 120 × 120, mode `custom`) and the elements
are shifted by the same offset. Because the result is a normal project, every serializer works
on it unchanged and the exported Markdown re-imports as a standalone project. The source
document is never mutated.

`markdownFilename(project, extension)` slugifies the title
(`"Settings Screen"` -> `settings-screen.md`; an empty slug falls back to `wireframe`).

### What goes into the document

`projectToMarkdown(project)` writes, in order:

1. `# UI Wireframe: <title>` + "Generated by Wirefragma."
2. `## Screen` — canvas mode label, `width × height`, visible element count, omitted-hidden count
   when any, and the layer list front-to-back with `(hidden)` markers.
3. `## ASCII Wireframe` — a ```` ```text ```` block from `renderAscii(project)`.
4. `## UI Elements` — one section per **visible** element (see
   [markdown-format.md](./markdown-format.md)).
5. `## Spatial Summary` — bullets from `buildSpatialSummary(project)`.
6. `## Editable Project Source` — ```` ```ui-project ```` with `projectToJson(project)` (2-space
   indented JSON) followed by a trailing newline.

Only effective-visible elements appear in the human/LLM sections; **everything** stays in the
`ui-project` block, which is what makes the export lossless.

### `projectToJson`

```ts
{ version: PROJECT_VERSION, title, canvas, layers, elements }
```

The payload is assembled explicitly (not by spreading the object), so accidental editor state can
never leak into the export. `version` is written literally as `2`.

## Import

### Entry points

`ImportDialog` has two flows:

* **Wireframe** (guest and signed in) — text pasted or from an uploaded `.md` / `.json` / `.wfproj`
  file. For a `.wfproj` the dialog shows a picker and imports the chosen wireframe's document; the
  guest editor replaces its document, the signed-in workspace adds a new wireframe to a chosen
  project.
* **Whole project** (signed in only) — a `.wfproj` becomes a NEW project (name editable, default
  from the file) with all its wireframes in order (`Workspace.importProject`: `project-create`
  without a starter wireframe, then one `wireframe-create` per wireframe).

The wireframe flow calls `App.handleImportText(text, sourceName)` (or the workspace equivalent),
which runs `projectFromText(text)`
(`src/utils/markdownImport.ts`). It accepts, in this order:

1. Markdown with a `ui-project` fence -> `projectFromMarkdown` (the canonical export);
2. text starting with `{` -> `projectFromJson` (raw project JSON);
3. a ```` ```json ```` fence -> its body as JSON (chat answers that used the wrong fence name);
4. prose around one JSON object -> the slice from the first `{` to the last `}`.

Cases 3–4 exist for LLM answers generated from the WIREFRAGMA schema (below); everything still
goes through `normalizeProject`.

A successful import:

* replaces the document (`setHistory(resetHistory(imported))`) — **the undo history is cleared**;
* clears the selection and the internal clipboard;
* activates the first layer;
* shows a toast such as `Imported 8 elements in 3 layers from file.md`.

### Parsing

```ts
extractProjectSource(markdown): string
  // regex on ```+ ui-project [info string] \n ... ``` (case-insensitive)

projectFromMarkdown(markdown): WireframeProject   // extract -> JSON.parse -> normalizeProject
projectFromJson(json): WireframeProject           // JSON.parse -> normalizeProject
```

Both throw `MarkdownImportError` with a human-readable message; the dialog renders it in an
`.error-banner` and keeps the text so the user can fix it.

### Failure modes (all covered by tests)

| Situation | Message / behaviour |
| --- | --- |
| empty input | `Nothing to import yet. Paste Markdown or choose a .md file.` |
| no `ui-project` fence | `No ```ui-project block was found. Export the wireframe from Wirefragma and import that Markdown.` |
| fenced body is empty | `The ui-project block is empty.` |
| body is not valid JSON | `The ui-project block is not valid JSON: …` |
| invalid JSON in the JSON path | `That is not valid JSON: …` |
| unsupported element type / bad canvas / wrong version | `The ui-project data is not a usable project: …` (from `normalizeProject`) |
| recoverable damage (missing layers, bad `layerId`, duplicate ids, out-of-range style values) | **repaired silently**, import succeeds |

`src/utils/markdownRoundTrip.test.ts` covers the round trips, the version 1 → 2 migration path and
every error case above.

## Round-trip guarantees

```text
project -> projectToMarkdown -> projectFromMarkdown -> project
```

must be lossless for the canonical fields, including:

* layers, their order, visibility and locking;
* element order, `zIndex`, `layerId`, `visible`, `locked`;
* `items`, `columns`, `textStyle`, `contentSize`, labels (including emoji) and notes;
* canvas mode and size, project title.

The tests assert deep equality after a round trip and byte-identical Markdown for the same project.

## Related documents

* [markdown-format.md](./markdown-format.md) — the exact document format.
* [ascii-renderer.md](./ascii-renderer.md) — the advisory ASCII section.
* [persistence-and-migrations.md](./persistence-and-migrations.md) — the other import path
  (`localStorage`).
