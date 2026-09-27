import { useCallback, useEffect, useState } from "react";
import App from "./App";
import { AuthScreen, type AuthMode } from "./account/AuthScreen";
import { fetchStatus, type AccountUser, type ServerStatus } from "./account/api";
import { Workspace } from "./account/Workspace";
import { PreferencesControl } from "./components/PreferencesControl";
import { useT } from "./i18n";

/** Remembered choice "use without an account" (per browser). */
const GUEST_KEY = "wirefragma.mode";

type View =
  | { kind: "loading" }
  | { kind: "guest"; status: ServerStatus | null }
  | { kind: "auth"; status: ServerStatus; mode: AuthMode; token: string | null; message?: string }
  | { kind: "account"; status: ServerStatus; user: AccountUser };

function rememberGuest(value: boolean): void {
  try {
    if (value) window.localStorage.setItem(GUEST_KEY, "guest");
    else window.localStorage.removeItem(GUEST_KEY);
  } catch {
    /* convenience only */
  }
}

function prefersGuest(): boolean {
  try {
    return window.localStorage.getItem(GUEST_KEY) === "guest";
  } catch {
    return false;
  }
}

/** Read and strip the emailed-link parameters (?verify=, ?reset=, ?forgot=1). */
function takeLinkParams(): { mode: AuthMode; token: string | null } | null {
  const params = new URLSearchParams(window.location.search);
  const verify = params.get("verify");
  const reset = params.get("reset");
  const forgot = params.get("forgot");
  if (!verify && !reset && !forgot) return null;
  for (const key of ["verify", "reset", "forgot"]) params.delete(key);
  const query = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  if (verify) return { mode: "verifying", token: verify };
  if (reset) return { mode: "reset", token: reset };
  return { mode: "forgot", token: null };
}

/** Read exactly once per page load (effects may run twice; the URL is cleaned on the first read). */
const LINK_PARAMS = typeof window === "undefined" ? null : takeLinkParams();

/**
 * Entry point. Without an accounts backend (static hosting, `file://`) this is exactly the old
 * guest editor. With one, it shows the sign-in screen (or the signed-in workspace), and guests
 * can still skip it.
 */
export function Root() {
  const t = useT();
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const link = LINK_PARAMS;
    fetchStatus().then((status) => {
      if (cancelled) return;
      if (!status) return setView({ kind: "guest", status: null });
      if (status.user && !link) return setView({ kind: "account", status, user: status.user });
      if (link) return setView({ kind: "auth", status, mode: link.mode, token: link.token });
      if (prefersGuest()) return setView({ kind: "guest", status });
      setView({ kind: "auth", status, mode: "signin", token: null });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signedIn = useCallback(
    (user: AccountUser) => {
      rememberGuest(false);
      setView((current) => (current.kind === "auth" ? { kind: "account", status: current.status, user } : current));
    },
    []
  );

  const signedOut = useCallback((message?: string) => {
    // Refresh the status: the CSRF token and captcha settings belong to the new session.
    fetchStatus().then((status) => {
      if (status) setView({ kind: "auth", status, mode: "signin", token: null, message });
      else setView({ kind: "guest", status: null });
    });
  }, []);

  if (view.kind === "loading") {
    return (
      <div className="boot-screen" aria-label={t("auth.loading")}>
        <img src="./brand/wf_logo_square.png" alt="" className="boot-logo" />
      </div>
    );
  }

  if (view.kind === "auth") {
    return (
      <AuthScreen
        key={`${view.mode}:${view.token ?? ""}`}
        status={view.status}
        initialMode={view.mode}
        token={view.token}
        initialMessage={view.message}
        onSignedIn={signedIn}
        onGuest={() => {
          rememberGuest(true);
          setView({ kind: "guest", status: view.status });
        }}
      />
    );
  }

  if (view.kind === "account") {
    return <Workspace key={view.user.id} user={view.user} onSignedOut={signedOut} />;
  }

  const status = view.status;
  return (
    <App
      preferencesSlot={
        <div className="properties-preferences">
          <div className="section-label">{t("props.preferences")}</div>
          <PreferencesControl compact />
        </div>
      }
      guestSlot={
        status ? (
          <span className="account-slot">
            <span className="divider" />
            <button
              type="button"
              className="account-signin"
              onClick={() => setView({ kind: "auth", status, mode: "signin", token: null })}
              title={t("toolbar.signInTitle")}
            >
              {t("toolbar.signIn")}
            </button>
          </span>
        ) : undefined
      }
    />
  );
}
