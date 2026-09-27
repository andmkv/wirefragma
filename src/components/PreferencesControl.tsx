import { LOCALES, usePreferences, type Locale, type ThemePreference } from "../i18n";

interface PreferencesControlProps {
  /** Smaller inline variant (sign-in screen, Properties panel footer). */
  compact?: boolean;
  /** Called after a change — the signed-in workspace also stores it with the account. */
  onChange?: (change: { locale?: Locale; theme?: ThemePreference }) => void;
}

const THEMES: ThemePreference[] = ["light", "dark", "system"];

/** Language menu + Light / Dark / System theme switch. */
export function PreferencesControl({ compact = false, onChange }: PreferencesControlProps) {
  const { locale, theme, setLocale, setTheme, t } = usePreferences();

  return (
    <div className={compact ? "preferences compact" : "preferences"}>
      <label className="field preferences-field">
        <span className="field-label">{t("settings.language")}</span>
        <select
          value={locale}
          onChange={(event) => {
            const next = event.target.value as Locale;
            setLocale(next);
            onChange?.({ locale: next });
          }}
        >
          {LOCALES.map((entry) => (
            <option key={entry.code} value={entry.code}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      <div className="field preferences-field">
        <span className="field-label">{t("settings.theme")}</span>
        <div className="segmented" role="radiogroup" aria-label={t("settings.theme")}>
          {THEMES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={theme === value}
              className={theme === value ? "active" : ""}
              onClick={() => {
                setTheme(value);
                onChange?.({ theme: value });
              }}
            >
              {t(`settings.theme.${value}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
