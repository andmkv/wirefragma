import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { errorMessage } from "./errors";
import { useT } from "../i18n";

interface CaptchaProps {
  provider: "builtin" | "turnstile";
  siteKey: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Bumped by the parent after a failed submit: the server consumed the old challenge. */
  refreshKey: number;
}

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TURNSTILE_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("turnstile")));
    if (!existing) {
      script.src = TURNSTILE_SRC;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/** Built-in image captcha, or a Cloudflare Turnstile widget when the server is configured for it. */
export function Captcha({ provider, siteKey, value, onChange, refreshKey }: CaptchaProps) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const [image, setImage] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    onChange("");
    try {
      const challenge = await api.captcha();
      setImage(challenge.image);
      setQuestion(challenge.question);
    } catch (reason) {
      setError(errorMessage(tRef.current, reason));
    }
  }, [onChange]);

  useEffect(() => {
    if (provider === "builtin") void reload();
  }, [provider, refreshKey, reload]);

  useEffect(() => {
    if (provider !== "turnstile" || !siteKey) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !widgetRef.current || !window.turnstile) return;
        if (widgetId.current) window.turnstile.remove(widgetId.current);
        widgetId.current = window.turnstile.render(widgetRef.current, {
          sitekey: siteKey,
          callback: (token: string) => onChange(token),
          "expired-callback": () => onChange(""),
          "error-callback": () => onChange("")
        });
      })
      .catch(() => setError(tRef.current("captcha.turnstileFailed")));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [onChange, provider, refreshKey, siteKey]);

  if (provider === "turnstile") {
    return (
      <div className="auth-captcha">
        <div ref={widgetRef} className="turnstile-slot" />
        {error ? <p className="auth-field-error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="auth-captcha">
      <span className="auth-label">{t("captcha.label")}</span>
      <div className="captcha-row">
        {image ? (
          <img className="captcha-image" src={image} alt={t("captcha.alt")} width={220} height={72} />
        ) : (
          <div className="captcha-image captcha-question">{question ?? "…"}</div>
        )}
        <button type="button" className="captcha-refresh" onClick={() => void reload()} title={t("captcha.refresh")} aria-label={t("captcha.refresh")}>
          ↻
        </button>
      </div>
      <input
        className="auth-input captcha-input"
        value={value}
        onChange={(event) => onChange(event.target.value.toUpperCase())}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={12}
        required
        aria-label={t("captcha.answer")}
        placeholder={question ? t("captcha.answerPlaceholder") : "ABCDE"}
      />
      {error ? <p className="auth-field-error">{error}</p> : null}
    </div>
  );
}
