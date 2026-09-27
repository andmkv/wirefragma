import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, type AccountUser, type ServerStatus, type StarterNames } from "./api";
import { LOCALES, usePreferences, type Locale } from "../i18n";

/** Compact language menu for the sign-in screen (the theme lives in the editor / settings). */
function LanguageSelect({ className }: { className: string }) {
  const { locale, setLocale, t } = usePreferences();
  return (
    <label className={className}>
      <span className="visually-hidden">{t("settings.language")}</span>
      <span aria-hidden="true">🌐</span>
      <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)} aria-label={t("settings.language")}>
        {LOCALES.map((entry) => (
          <option key={entry.code} value={entry.code}>
            {entry.name}
          </option>
        ))}
      </select>
    </label>
  );
}
import { Captcha } from "./Captcha";
import { PrivacyPolicy } from "./PrivacyPolicy";
import { errorMessage } from "./errors";
import { useT } from "../i18n";

/**
 * Confirmation tokens are single-use. Effects may run twice (React StrictMode, remounts), so the
 * request is shared per token instead of being sent again and failing as "already used".
 */
const verifications = new Map<string, ReturnType<typeof api.verify>>();
function verifyOnce(token: string, starter: StarterNames): ReturnType<typeof api.verify> {
  let pending = verifications.get(token);
  if (!pending) {
    pending = api.verify(token, starter);
    verifications.set(token, pending);
  }
  return pending;
}

export type AuthMode = "signin" | "register" | "forgot" | "reset" | "sent" | "verifying";

interface AuthScreenProps {
  status: ServerStatus;
  initialMode: AuthMode;
  /** Token from an emailed link (`?verify=` or `?reset=`). */
  token: string | null;
  /** Shown once on arrival, e.g. "Your session has ended". */
  initialMessage?: string;
  onSignedIn: (user: AccountUser) => void;
  onGuest: () => void;
}

/**
 * Sign-in / registration: the large Wirefragma mark on a drafting-paper grid on the left, the
 * form on the right. Also handles the emailed links (confirm address, reset password).
 */
export function AuthScreen({ status, initialMode, token, initialMessage, onSignedIn, onGuest }: AuthScreenProps) {
  const t = useT();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(initialMessage ?? null);
  const [sentKind, setSentKind] = useState<"verify" | "reset">("verify");
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [unverified, setUnverified] = useState(false);

  const onCaptchaChange = useCallback((value: string) => setCaptcha(value), []);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setInfo(null);
    setUnverified(false);
    setPassword("");
  };

  // Emailed confirmation link: confirm and sign in straight away.
  useEffect(() => {
    if (initialMode !== "verifying" || !token) return;
    let cancelled = false;
    verifyOnce(token, { project: t("projects.firstName"), wireframe: t("projects.screenName", { n: 1 }) })
      .then((session) => {
        if (!cancelled) onSignedIn(session.user);
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setMode("signin");
        setError(errorMessage(t, reason));
      });
    return () => {
      cancelled = true;
    };
  }, [initialMode, onSignedIn, token]);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await task();
    } catch (reason) {
      const apiError = reason as ApiError;
      setError(errorMessage(t, apiError));
      if (apiError.code === "unverified") setUnverified(true);
      // The server consumed the captcha challenge; show a fresh one.
      if (mode === "register" || mode === "forgot") setCaptchaKey((key) => key + 1);
    } finally {
      setBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (mode === "signin") {
      void run(async () => {
        const session = await api.login(email, password);
        onSignedIn(session.user);
      });
    } else if (mode === "register") {
      if (!acceptPrivacy) {
        setError(t("auth.acceptPrivacyError"));
        return;
      }
      void run(async () => {
        await api.register({ email, password, displayName, captcha, acceptPrivacy, website: honeypot });
        setSentKind("verify");
        setMode("sent");
      });
    } else if (mode === "forgot") {
      void run(async () => {
        await api.forgot(email, captcha);
        setSentKind("reset");
        setMode("sent");
      });
    } else if (mode === "reset" && token) {
      void run(async () => {
        const session = await api.reset(token, password, {
          project: t("projects.firstName"),
          wireframe: t("projects.screenName", { n: 1 })
        });
        onSignedIn(session.user);
      });
    }
  };

  const resend = () =>
    void run(async () => {
      await api.resend(email);
      setUnverified(false);
      setInfo(t("auth.resent"));
    });

  const title = t(`auth.title.${mode}`);
  const subtitle: ReactNode = mode === "sent" ? null : t(`auth.subtitle.${mode}`);

  const passwordField = (autoComplete: string, label = t("auth.password")) => (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      <span className="auth-password">
        <input
          className="auth-input"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete={autoComplete}
          minLength={autoComplete === "new-password" ? 8 : undefined}
          required
        />
        <button
          type="button"
          className="auth-reveal"
          onClick={() => setShowPassword((value) => !value)}
          aria-label={t(showPassword ? "auth.hidePassword" : "auth.showPassword")}
        >
          {t(showPassword ? "auth.hide" : "auth.show")}
        </button>
      </span>
    </label>
  );

  const emailField = (
    <label className="auth-field">
      <span className="auth-label">{t("auth.email")}</span>
      <input
        className="auth-input"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        autoComplete="email"
        required
        autoFocus
      />
    </label>
  );

  return (
    <div className="auth-screen">
      <section className="auth-hero">
        <div className="auth-hero-grid" aria-hidden="true" />
        <div className="auth-hero-sketch" aria-hidden="true">
          <span className="sketch-box sketch-bar" />
          <span className="sketch-box sketch-side" />
          <span className="sketch-box sketch-card" />
          <span className="sketch-box sketch-button" />
          <span className="sketch-box sketch-line" />
          <span className="sketch-box sketch-line short" />
        </div>
        <LanguageSelect className="auth-language hero" />
        <div className="auth-hero-content">
          <img className="auth-logo" src="./brand/wf_logo_wide.png" alt="" />
          <p className="auth-tagline">{t("auth.tagline")}</p>
          <ul className="auth-points">
            <li>{t("auth.point1")}</li>
            <li>{t("auth.point2")}</li>
            <li>{t("auth.point3")}</li>
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <img className="auth-mobile-logo" src="./brand/wf_logo_wide.png" alt="Wirefragma" />
          <LanguageSelect className="auth-language mobile" />

          {mode === "signin" || mode === "register" ? (
            <div className="auth-switch" role="tablist" aria-label={t("auth.switchLabel")}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={mode === "signin" ? "active" : ""}
                onClick={() => switchMode("signin")}
              >
                {t("auth.tab.signin")}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "active" : ""}
                onClick={() => switchMode("register")}
                disabled={!status.registrationOpen}
                title={status.registrationOpen ? undefined : t("auth.registrationClosed")}
              >
                {t("auth.tab.register")}
              </button>
            </div>
          ) : null}

          <h1 className="auth-title">{title}</h1>
          {subtitle ? <p className="auth-subtitle">{subtitle}</p> : null}

          {mode === "sent" ? (
            <div className="auth-sent">
              <div className="auth-sent-icon" aria-hidden="true">✉</div>
              <p>
                {t(sentKind === "verify" ? "auth.sentVerify" : "auth.sentReset", { email })}
              </p>
              <p className="auth-hint">{t("auth.spam")}</p>
              <button type="button" className="auth-secondary" onClick={() => switchMode("signin")}>
                {t("auth.backToSignin")}
              </button>
            </div>
          ) : mode === "verifying" ? (
            <div className="auth-spinner" aria-label={t("common.loading")} />
          ) : (
            <form className="auth-form" onSubmit={submit} noValidate={false}>
              {mode === "register" ? (
                <label className="auth-field">
                  <span className="auth-label">
                    {t("auth.name")} <span className="auth-optional">{t("auth.optional")}</span>
                  </span>
                  <input
                    className="auth-input"
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    autoComplete="name"
                    maxLength={80}
                  />
                </label>
              ) : null}

              {mode !== "reset" ? emailField : null}

              {mode === "signin" ? passwordField("current-password") : null}
              {mode === "register" ? passwordField("new-password") : null}
              {mode === "reset" ? passwordField("new-password", t("auth.newPassword")) : null}

              {mode === "register" ? (
                // Honeypot for bots: visually hidden, skipped by keyboard and screen readers.
                <input
                  className="auth-honeypot"
                  tabIndex={-1}
                  autoComplete="off"
                  aria-hidden="true"
                  name="website"
                  value={honeypot}
                  onChange={(event) => setHoneypot(event.target.value)}
                />
              ) : null}

              {mode === "register" || mode === "forgot" ? (
                <Captcha
                  provider={status.captcha.provider}
                  siteKey={status.captcha.siteKey}
                  value={captcha}
                  onChange={onCaptchaChange}
                  refreshKey={captchaKey}
                />
              ) : null}

              {mode === "register" ? (
                <label className="auth-consent">
                  <input
                    type="checkbox"
                    checked={acceptPrivacy}
                    onChange={(event) => setAcceptPrivacy(event.target.checked)}
                    required
                  />
                  <span>
                    {t("auth.consentBefore")}{" "}
                    <button type="button" className="auth-link" onClick={() => setPrivacyOpen(true)}>
                      {t("auth.consentLink")}
                    </button>
                    {t("auth.consentAfter")}
                  </span>
                </label>
              ) : null}

              {error ? (
                <div className="auth-error" role="alert">
                  {error}
                  {unverified ? (
                    <button type="button" className="auth-link" onClick={resend} disabled={busy || !email}>
                      {t("auth.sendAgain")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {info ? <div className="auth-info">{info}</div> : null}

              <button type="submit" className="auth-primary" disabled={busy}>
                {busy ? t("auth.wait") : t(`auth.submit.${mode as "signin" | "register" | "forgot" | "reset"}`)}
              </button>

              {mode === "signin" ? (
                <button type="button" className="auth-link auth-forgot" onClick={() => switchMode("forgot")}>
                  {t("auth.forgot")}
                </button>
              ) : null}
              {mode === "forgot" || mode === "reset" ? (
                <button type="button" className="auth-link auth-forgot" onClick={() => switchMode("signin")}>
                  {t("auth.backToSignin")}
                </button>
              ) : null}
            </form>
          )}

          <div className="auth-divider">
            <span>{t("auth.or")}</span>
          </div>
          <button type="button" className="auth-guest" onClick={onGuest}>
            {t("auth.guest")}
          </button>
          <p className="auth-hint auth-guest-hint">{t("auth.guestHint")}</p>
        </div>

        <footer className="auth-footer">
          <button type="button" className="auth-link" onClick={() => setPrivacyOpen(true)}>
            {t("auth.privacy")}
          </button>
          <span>·</span>
          <a href="https://github.com/andmkv/wirefragma" target="_blank" rel="noreferrer">
            {t("auth.github")}
          </a>
        </footer>
      </section>

      {privacyOpen ? (
        <PrivacyPolicy
          operator={status.privacy.operator}
          contactEmail={status.privacy.contactEmail}
          version={status.privacy.version}
          onClose={() => setPrivacyOpen(false)}
        />
      ) : null}
    </div>
  );
}
