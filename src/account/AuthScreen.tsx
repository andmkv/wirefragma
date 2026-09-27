import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, api, type AccountUser, type ServerStatus } from "./api";
import { Captcha } from "./Captcha";
import { PrivacyPolicy } from "./PrivacyPolicy";

/**
 * Confirmation tokens are single-use. Effects may run twice (React StrictMode, remounts), so the
 * request is shared per token instead of being sent again and failing as "already used".
 */
const verifications = new Map<string, ReturnType<typeof api.verify>>();
function verifyOnce(token: string): ReturnType<typeof api.verify> {
  let pending = verifications.get(token);
  if (!pending) {
    pending = api.verify(token);
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
    verifyOnce(token)
      .then((session) => {
        if (!cancelled) onSignedIn(session.user);
      })
      .catch((reason: Error) => {
        if (cancelled) return;
        setMode("signin");
        setError(reason.message);
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
      setError(apiError.message);
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
        setError("Please accept the privacy policy to create an account.");
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
        const session = await api.reset(token, password);
        onSignedIn(session.user);
      });
    }
  };

  const resend = () =>
    void run(async () => {
      await api.resend(email);
      setUnverified(false);
      setInfo("If that address has an unconfirmed account, a new confirmation link is on its way.");
    });

  const title: Record<AuthMode, string> = {
    signin: "Welcome back",
    register: "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password",
    sent: "Check your inbox",
    verifying: "Confirming your email…"
  };
  const subtitle: Record<AuthMode, ReactNode> = {
    signin: "Sign in to keep your projects and wireframes in the cloud.",
    register: "Projects and wireframes are saved to your account and follow you across devices.",
    forgot: "Enter your email and we will send you a link to set a new password.",
    reset: "Pick a password with at least 8 characters.",
    sent: null,
    verifying: "One moment, please."
  };

  const passwordField = (autoComplete: string, label = "Password") => (
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
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );

  const emailField = (
    <label className="auth-field">
      <span className="auth-label">Email</span>
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
      <section className="auth-hero" aria-hidden="true">
        <div className="auth-hero-grid" />
        <div className="auth-hero-sketch">
          <span className="sketch-box sketch-bar" />
          <span className="sketch-box sketch-side" />
          <span className="sketch-box sketch-card" />
          <span className="sketch-box sketch-button" />
          <span className="sketch-box sketch-line" />
          <span className="sketch-box sketch-line short" />
        </div>
        <div className="auth-hero-content">
          <img className="auth-logo" src="./brand/wf_logo_wide.png" alt="" />
          <p className="auth-tagline">Sketch the screen. Hand the spec to your LLM.</p>
          <ul className="auth-points">
            <li>Wireframes with LLM notes on every element</li>
            <li>Markdown export an agent can read and rebuild</li>
            <li>Projects synced to your account</li>
          </ul>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <img className="auth-mobile-logo" src="./brand/wf_logo_wide.png" alt="Wirefragma" />

          {mode === "signin" || mode === "register" ? (
            <div className="auth-switch" role="tablist" aria-label="Sign in or create an account">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                className={mode === "signin" ? "active" : ""}
                onClick={() => switchMode("signin")}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={mode === "register" ? "active" : ""}
                onClick={() => switchMode("register")}
                disabled={!status.registrationOpen}
                title={status.registrationOpen ? undefined : "Registration is closed on this server"}
              >
                Create account
              </button>
            </div>
          ) : null}

          <h1 className="auth-title">{title[mode]}</h1>
          {subtitle[mode] ? <p className="auth-subtitle">{subtitle[mode]}</p> : null}

          {mode === "sent" ? (
            <div className="auth-sent">
              <div className="auth-sent-icon" aria-hidden="true">✉</div>
              <p>
                {sentKind === "verify" ? (
                  <>
                    We sent a confirmation link to <strong>{email}</strong>. Open it to activate your
                    account — it is valid for 48 hours.
                  </>
                ) : (
                  <>
                    If <strong>{email}</strong> has an account, a password reset link is on its way. It is
                    valid for 1 hour.
                  </>
                )}
              </p>
              <p className="auth-hint">No email after a few minutes? Check the spam folder.</p>
              <button type="button" className="auth-secondary" onClick={() => switchMode("signin")}>
                Back to sign in
              </button>
            </div>
          ) : mode === "verifying" ? (
            <div className="auth-spinner" aria-label="Loading" />
          ) : (
            <form className="auth-form" onSubmit={submit} noValidate={false}>
              {mode === "register" ? (
                <label className="auth-field">
                  <span className="auth-label">
                    Name <span className="auth-optional">optional</span>
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
              {mode === "reset" ? passwordField("new-password", "New password") : null}

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
                    I have read and accept the{" "}
                    <button type="button" className="auth-link" onClick={() => setPrivacyOpen(true)}>
                      privacy policy
                    </button>
                    .
                  </span>
                </label>
              ) : null}

              {error ? (
                <div className="auth-error" role="alert">
                  {error}
                  {unverified ? (
                    <button type="button" className="auth-link" onClick={resend} disabled={busy || !email}>
                      Send the link again
                    </button>
                  ) : null}
                </div>
              ) : null}
              {info ? <div className="auth-info">{info}</div> : null}

              <button type="submit" className="auth-primary" disabled={busy}>
                {busy
                  ? "Please wait…"
                  : mode === "signin"
                    ? "Sign in"
                    : mode === "register"
                      ? "Create account"
                      : mode === "forgot"
                        ? "Send reset link"
                        : "Save password and sign in"}
              </button>

              {mode === "signin" ? (
                <button type="button" className="auth-link auth-forgot" onClick={() => switchMode("forgot")}>
                  Forgot password?
                </button>
              ) : null}
              {mode === "forgot" || mode === "reset" ? (
                <button type="button" className="auth-link auth-forgot" onClick={() => switchMode("signin")}>
                  Back to sign in
                </button>
              ) : null}
            </form>
          )}

          <div className="auth-divider">
            <span>or</span>
          </div>
          <button type="button" className="auth-guest" onClick={onGuest}>
            Continue without an account
          </button>
          <p className="auth-hint auth-guest-hint">Your work stays in this browser only.</p>
        </div>

        <footer className="auth-footer">
          <button type="button" className="auth-link" onClick={() => setPrivacyOpen(true)}>
            Privacy policy
          </button>
          <span>·</span>
          <a href="https://github.com/andmkv/wirefragma" target="_blank" rel="noreferrer">
            Open source on GitHub
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
