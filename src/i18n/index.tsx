import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type MessageKey } from "./en";
import { de } from "./locales/de";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { ja } from "./locales/ja";
import { ru } from "./locales/ru";
import { sr } from "./locales/sr";
import { zh } from "./locales/zh";

/** UI languages, in the order the language menus list them. EN is the default and fallback. */
export const LOCALES = [
  { code: "en", name: "English" },
  { code: "ru", name: "Русский" },
  { code: "de", name: "Deutsch" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "sr", name: "Srpski" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "简体中文" }
] as const;

export type Locale = (typeof LOCALES)[number]["code"];
export type ThemePreference = "light" | "dark" | "system";

/** A translation: every English key (plural locales may add `_few` / `_many` / `_two` forms). */
export type Dictionary = Record<MessageKey, string> & Partial<Record<string, string>>;

export const DICTIONARIES: Record<Locale, Dictionary> = { en, ru, de, fr, es, sr, ja, zh };

/** Keys usable with `t`: every message key, plus the base name of each plural family. */
type PluralBase<K> = K extends `${infer Base}_other` ? Base : never;
export type TranslationKey = MessageKey | PluralBase<MessageKey>;
export type TranslationParams = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((locale) => locale.code === value);
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

const pluralRules = new Map<string, Intl.PluralRules>();
function pluralCategory(locale: Locale, count: number): string {
  let rules = pluralRules.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale === "zh" ? "zh-CN" : locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** Pure translation (also usable outside React). Falls back to English, then to the key. */
export function translate(locale: Locale, key: TranslationKey, params: TranslationParams = {}): string {
  const dictionary = DICTIONARIES[locale] ?? en;
  const english = en as Record<string, string>;
  let template: string | undefined;
  if (typeof params.count === "number" && !(key in english)) {
    const category = pluralCategory(locale, params.count);
    template = dictionary[`${key}_${category}`] ?? dictionary[`${key}_other`];
    template ??= english[`${key}_${pluralCategory("en", params.count)}`] ?? english[`${key}_other`];
  } else {
    template = dictionary[key] ?? english[key];
  }
  if (template === undefined) return key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  );
}

export interface Preferences {
  locale: Locale;
  theme: ThemePreference;
}

const PREFS_KEY = "wirefragma.preferences";

export function loadPreferences(): Preferences {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}") as Record<string, unknown>;
    return {
      locale: isLocale(raw.locale) ? raw.locale : "en",
      theme: isThemePreference(raw.theme) ? raw.theme : "light"
    };
  } catch {
    return { locale: "en", theme: "light" };
  }
}

function savePreferences(preferences: Preferences): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(preferences));
  } catch {
    /* per-browser convenience */
  }
}

interface PreferencesContextValue extends Preferences {
  /** The theme actually shown ("system" resolved). */
  resolvedTheme: "light" | "dark";
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemePreference) => void;
  /** Apply both at once (e.g. the preferences stored with an account after sign-in). */
  applyPreferences: (preferences: Partial<Preferences>) => void;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const PreferencesContext = createContext<PreferencesContextValue | null>(null);

function systemDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

/**
 * Language + theme for the whole app. Guests keep them in localStorage; for signed-in users the
 * workspace additionally stores them with the account and applies them after sign-in.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState<Preferences>(loadPreferences);
  const [prefersDark, setPrefersDark] = useState(systemDark);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const onChange = () => setPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = preferences.theme === "system" ? (prefersDark ? "dark" : "light") : preferences.theme;

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    document.documentElement.lang = preferences.locale === "zh" ? "zh-CN" : preferences.locale;
    savePreferences(preferences);
  }, [preferences]);

  const applyPreferences = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = {
        locale: isLocale(patch.locale) ? patch.locale : current.locale,
        theme: isThemePreference(patch.theme) ? patch.theme : current.theme
      };
      return next.locale === current.locale && next.theme === current.theme ? current : next;
    });
  }, []);

  const value = useMemo<PreferencesContextValue>(
    () => ({
      ...preferences,
      resolvedTheme,
      setLocale: (locale) => applyPreferences({ locale }),
      setTheme: (theme) => applyPreferences({ theme }),
      applyPreferences,
      t: (key, params) => translate(preferences.locale, key, params)
    }),
    [applyPreferences, preferences, resolvedTheme]
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

const fallback: PreferencesContextValue = {
  locale: "en",
  theme: "light",
  resolvedTheme: "light",
  setLocale: () => undefined,
  setTheme: () => undefined,
  applyPreferences: () => undefined,
  t: (key, params) => translate("en", key, params)
};

/** Translation + preferences. Outside a provider (tests, harness) it is English / light. */
export function usePreferences(): PreferencesContextValue {
  return useContext(PreferencesContext) ?? fallback;
}

export function useT() {
  return usePreferences().t;
}
