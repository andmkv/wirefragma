# Changelog

## 1.2.0 — unreleased

### Editor
- **Viewport panning**: middle-mouse drag, `Space` + left drag (grab cursor) and — on touch — a
  two-finger drag that pans while a pinch zooms, anchored at the gesture centre. Panning only moves
  the scroll offset of the canvas viewport: no history entry, nothing serialized, and a pan can
  never start or cancel an element drag. The browser's middle-click autoscroll and paste are
  suppressed, one-finger touch keeps the marquee semantic.
- **Clipboard across wireframes**: the internal copy/paste payload moved out of `App` into a
  module-level store that survives switching wireframes, and is mirrored into `localStorage` so it
  also works between tabs of the same origin. Pasting into a project whose layer ids do not exist
  matches a layer by **name** first and otherwise uses the active layer — layers are never created.
  Copy/paste inside one wireframe behaves exactly as before (same cascade offset).
- **New shortcuts**: `Cmd/Ctrl+A` selects every visible, unlocked element, `Cmd/Ctrl+X` cuts
  (copy + delete in one undo step, locked members skipped) and `F2` jumps to the Name field in
  Properties. All of them are ignored while a text field has focus. The canvas hint lists them.

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
