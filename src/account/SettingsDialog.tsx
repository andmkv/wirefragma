import { useEffect, useState, type FormEvent } from "react";
import { PreferencesControl } from "../components/PreferencesControl";
import { useT, type Locale, type ThemePreference } from "../i18n";
import { api, type AccountUser } from "./api";
import { errorMessage } from "./errors";
import { McpAccessSection } from "./McpAccess";

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
}

interface SettingsDialogProps {
  user: AccountUser;
  onClose: () => void;
  /** The server returned the updated profile (display name / preferences). */
  onUserUpdated: (user: AccountUser) => void;
  onAccountDeleted: () => void;
}

/**
 * Account settings: profile, interface language and theme (stored with the account), password,
 * MCP access tokens, and account deletion.
 */
export function SettingsDialog({ user, onClose, onUserUpdated, onAccountDeleted }: SettingsDialogProps) {
  const t = useT();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useEscape(deleteOpen ? () => undefined : onClose);

  const run = async (task: () => Promise<string>) => {
    setBusy(true);
    setStatus(null);
    try {
      setStatus({ kind: "ok", text: await task() });
    } catch (error) {
      setStatus({ kind: "error", text: errorMessage(t, error) });
    } finally {
      setBusy(false);
    }
  };

  const savePreferences = (change: { locale?: Locale; theme?: ThemePreference }) =>
    void run(async () => {
      const result = await api.saveSettings({ language: change.locale, theme: change.theme });
      onUserUpdated(result.user);
      return t("settings.saved");
    });

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const result = await api.saveSettings({ displayName: displayName.trim() });
      onUserUpdated(result.user);
      return t("settings.saved");
    });
  };

  const changePassword = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api.changePassword(currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
      return t("settings.passwordChanged");
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label={t("settings.title")}>
        <div className="modal-header">
          <h2>{t("settings.title")}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3>{t("settings.profile")}</h3>
            <form className="settings-row" onSubmit={saveProfile}>
              <label className="field">
                <span className="field-label">{t("settings.displayName")}</span>
                <input value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <button type="submit" disabled={busy || displayName.trim() === user.displayName}>
                {t("common.save")}
              </button>
            </form>
            <label className="field">
              <span className="field-label">{t("settings.email")}</span>
              <input value={user.email} readOnly disabled />
            </label>
          </section>

          <section className="settings-section">
            <h3>{t("settings.appearance")}</h3>
            <PreferencesControl onChange={savePreferences} />
          </section>

          <section className="settings-section">
            <h3>{t("settings.password")}</h3>
            <form className="settings-grid" onSubmit={changePassword}>
              <label className="field">
                <span className="field-label">{t("settings.currentPassword")}</span>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="field">
                <span className="field-label">{t("settings.newPassword")}</span>
                <input
                  type="password"
                  value={nextPassword}
                  onChange={(event) => setNextPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>
              <button type="submit" disabled={busy || !currentPassword || nextPassword.length < 8}>
                {t("settings.changePassword")}
              </button>
            </form>
          </section>

          <McpAccessSection />

          <section className="settings-section danger-zone">
            <h3>{t("settings.danger")}</h3>
            <div className="settings-row">
              <p className="hint">{t("settings.deleteAccountHint")}</p>
              <button type="button" className="danger" onClick={() => setDeleteOpen(true)}>
                {t("settings.deleteAccount")}
              </button>
            </div>
          </section>
        </div>

        <div className="modal-footer">
          <span className={status?.kind === "error" ? "status settings-error" : "status"} role="status">
            {status?.text}
          </span>
          <div className="modal-actions">
            <button type="button" className="primary" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </div>

      {deleteOpen ? (
        <DeleteAccountDialog email={user.email} onCancel={() => setDeleteOpen(false)} onDeleted={onAccountDeleted} />
      ) : null}
    </div>
  );
}

function DeleteAccountDialog({ email, onCancel, onDeleted }: { email: string; onCancel: () => void; onDeleted: () => void }) {
  const t = useT();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onCancel);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form
        className="modal narrow"
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.deleteTitle")}
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api.deleteAccount(password);
            onDeleted();
          } catch (reason) {
            setError(errorMessage(t, reason));
            setBusy(false);
          }
        }}
      >
        <div className="modal-header">
          <h2>{t("settings.deleteTitle")}</h2>
          <button type="button" className="icon-button" onClick={onCancel} aria-label={t("common.close")}>
            ✕
          </button>
        </div>
        <div className="confirm-message">
          <p>{t("settings.deleteMessage", { email })}</p>
          <label className="field">
            <span className="field-label">{t("settings.confirmPassword")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
              required
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
        </div>
        <div className="modal-footer">
          <div className="modal-actions">
            <button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </button>
            <button type="submit" className="primary danger-solid" disabled={busy || !password}>
              {t("settings.deleteButton")}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
