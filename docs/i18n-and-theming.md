# Localization, themes and preferences

Sources: [`src/i18n/`](../src/i18n/), [`src/components/PreferencesControl.tsx`](../src/components/PreferencesControl.tsx),
[`src/account/SettingsDialog.tsx`](../src/account/SettingsDialog.tsx), the theme tokens at the top and
bottom of [`src/styles.css`](../src/styles.css).

## Languages

UI languages: **EN** (default and fallback), RU, DE, FR, ES, SR (Latin script), JA, ZH (Simplified
Chinese) — `LOCALES` in `src/i18n/index.tsx`.

* `src/i18n/en.ts` is the source of truth: every message key with its English text. `MessageKey`
  is derived from it, so `t("unknown.key")` is a type error.
* `src/i18n/locales/<code>.ts` are complete dictionaries (`Dictionary` = every English key, plus
  extra plural forms).
* `t(key, params)` fills `{placeholders}`. Plural families are written as `key_one` / `key_other`
  (plus `_few` / `_many` / … where the language needs them); calling `t("key", { count })` picks the
  form with `Intl.PluralRules`. Missing strings fall back to English, then to the key.
* `src/i18n/i18n.test.ts` fails when a locale misses a key, invents a placeholder, has an unknown
  key or lacks a plural category its language uses.

What is **not** translated, on purpose: the Markdown / JSON export, the WIREFRAGMA schema, the
element data (names, labels, notes, the default "Button" label on the canvas) and emails. The
export is the LLM-facing contract and must stay stable; element type names in the export keep
using `ELEMENT_TYPE_LABEL`. Server messages are shown translated when their `error` code has an
`error.<code>` key (`src/account/errors.ts`), otherwise in English.

### Adding a string

1. add the key to `en.ts` (plural → `_one` + `_other`);
2. add it to every file in `src/i18n/locales/` (the test lists what is missing), **no longer than
   the English text**: short strings (≤ 40 characters) may exceed it by 2 characters (but may
   always use 10), sentences by 10 %. `i18n.test.ts` enforces this so buttons and panels keep their
   layout in every language — abbreviate or rephrase rather than overflow;
3. use `const t = useT()` in components; in long-lived callbacks read a ref (see `tr` in `App.tsx`)
   so a language switch does not require re-creating every handler.

### Adding a language

Add `{ code, name }` to `LOCALES`, a `locales/<code>.ts`, the entry in `DICTIONARIES`, and the code in
`WF_LANGUAGES` in `server/api/lib/bootstrap.php`.

## Themes

`light` (default), `dark`, `system` (follows `prefers-color-scheme`). `PreferencesProvider` sets
`<html data-theme="light|dark">` and `color-scheme`. Every UI colour in `styles.css` is a token on
`:root` (`--bg`, `--panel`, `--surface`, `--hover`, `--ink`, `--muted`, `--accent-*`, `--danger-*`,
`--notice-*`, …); `:root[data-theme="dark"]` redefines them. New CSS must use tokens, not literal
colours. The wireframe canvas itself stays light "paper" in both themes; the dark-grey logos are
inverted with `--logo-filter`.

## Where the preferences live

| User | Switcher | Storage |
| --- | --- | --- |
| guest | Properties panel footer ("Preferences"); the sign-in screen has only a language menu (top-left of the logo side, under the logo on phones) | `localStorage["wirefragma.preferences"]` |
| signed in | avatar menu → **Settings…** → Appearance | the account (`wf_user_settings`, via `settings-save`) + the same localStorage key |

After sign-in the account's stored preferences are applied (they win over the browser's guest
choice). The Settings dialog also edits the display name, changes the password
(`password-change`, requires the current one) and holds **Delete account**.

## Lazy dictionaries (1.2)

Only English is part of the base chunk. Every other dictionary is a chunk of its own
(`import("./locales/xx")`) and is fetched **before** the language is applied:

* `main.tsx` preloads the stored language before the first render, so a non-English user never sees
  a frame of English;
* switching the language in Settings keeps the previous language on screen until the chunk has
  arrived, then swaps the whole UI in one frame;
* `translate()` falls back to English for a locale whose chunk has not loaded (or failed), so the
  app stays usable even if a chunk cannot be fetched.

The i18n test suite loads all eight dictionaries explicitly (`loadDictionary`) before comparing
keys, placeholders and plural categories.
