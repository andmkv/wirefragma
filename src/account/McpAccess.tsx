import { useEffect, useRef, useState, type FormEvent } from "react";
import { usePreferences, type Locale } from "../i18n";
import { copyText } from "../utils/clipboard";
import { api, type McpEndpointInfo, type McpScope, type McpToken } from "./api";
import { errorMessage } from "./errors";

/** Offered token lifetimes in days (null = never); must match WF_MCP_EXPIRY_DAYS on the server. */
const EXPIRY_OPTIONS = [30, 90, 365, null] as const;
const DEFAULT_EXPIRY = 90;

/** Server timestamps are UTC "YYYY-MM-DD HH:MM:SS". */
export function parseServerDate(value: string): Date | null {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: string | null, locale: Locale): string {
  const date = value ? parseServerDate(value) : null;
  if (!date) return "";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale, { dateStyle: "medium" }).format(date);
}

/**
 * Settings → MCP access: the endpoint, the user's personal MCP tokens, creating (password
 * required) and revoking them.
 *
 * The raw token exists in this component's state only between "Create" and closing Settings:
 * it is never written to localStorage, never logged, and the server never returns it again.
 */
export function McpAccessSection() {
  const { t, locale } = usePreferences();
  const [info, setInfo] = useState<McpEndpointInfo | null>(null);
  const [tokens, setTokens] = useState<McpToken[] | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .mcpTokens()
      .then((result) => {
        if (cancelled) return;
        setInfo(result.mcp);
        setTokens(result.tokens);
      })
      .catch((error) => !cancelled && setStatus({ kind: "error", text: errorMessage(t, error) }));
    return () => {
      cancelled = true;
    };
    // Loaded once per Settings opening.
  }, []);

  const copyEndpoint = async (text: string) => {
    if (await copyText(text)) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  };

  const revoke = async (id: number) => {
    setStatus(null);
    try {
      setTokens((await api.revokeMcpToken(id)).tokens);
      setRevoking(null);
      setStatus({ kind: "ok", text: t("settings.mcpRevoked") });
    } catch (error) {
      setStatus({ kind: "error", text: errorMessage(t, error) });
    }
  };

  const scopeLabel = (scope: McpScope) => t(`settings.mcpScope.${scope}`);

  return (
    <section className="settings-section mcp-access">
      <h3>{t("settings.mcp")}</h3>
      <p className="hint">
        {t("settings.mcpIntro")}{" "}
        <a href="docs/mcp.html" target="_blank" rel="noopener">
          {t("settings.mcpDocs")}
        </a>
      </p>

      {info && !info.available ? <p className="hint mcp-unavailable">{t("settings.mcpUnavailable")}</p> : null}

      {info ? (
        <div className="field">
          <span className="field-label">{t("settings.mcpEndpoint")}</span>
          <div className="mcp-copy-row">
            <input value={info.endpoint} readOnly onFocus={(event) => event.currentTarget.select()} aria-label={t("settings.mcpEndpoint")} />
            <button type="button" onClick={() => void copyEndpoint(info.endpoint)}>
              {copied ? t("settings.mcpCopied") : t("common.copy")}
            </button>
          </div>
          <span className="hint">{t("settings.mcpEndpointHint")}</span>
        </div>
      ) : null}

      <div className="mcp-tokens-header">
        <span className="field-label">{t("settings.mcpTokens")}</span>
        {!formOpen && !freshToken ? (
          <button type="button" onClick={() => setFormOpen(true)} disabled={tokens === null}>
            {t("settings.mcpCreate")}
          </button>
        ) : null}
      </div>

      {freshToken ? <FreshToken token={freshToken} onDone={() => setFreshToken(null)} /> : null}

      {formOpen ? (
        <CreateTokenForm
          onCancel={() => setFormOpen(false)}
          onCreated={(token, list) => {
            setFreshToken(token);
            setTokens(list);
            setFormOpen(false);
            setStatus(null);
          }}
        />
      ) : null}

      {tokens === null ? null : tokens.length === 0 ? (
        <p className="hint">{t("settings.mcpNoTokens")}</p>
      ) : (
        <ul className="mcp-token-list">
          {tokens.map((token) => (
            <li key={token.id} className={token.expired ? "expired" : undefined}>
              <div className="mcp-token-main">
                <span className="mcp-token-name">{token.name}</span>
                <code className="mcp-token-prefix">{token.prefix}…</code>
                <span className="mcp-token-scopes">{token.scopes.map(scopeLabel).join(", ")}</span>
              </div>
              <div className="mcp-token-meta hint">
                {[
                  t("settings.mcpCreated", { date: formatDate(token.createdAt, locale) }),
                  token.lastUsedAt ? t("settings.mcpLastUsed", { date: formatDate(token.lastUsedAt, locale) }) : t("settings.mcpNeverUsed"),
                  token.expired
                    ? t("settings.mcpExpired")
                    : token.expiresAt
                      ? t("settings.mcpExpires", { date: formatDate(token.expiresAt, locale) })
                      : t("settings.mcpNoExpiry")
                ].join(" · ")}
              </div>
              {revoking === token.id ? (
                <span className="mcp-token-actions">
                  <button type="button" onClick={() => setRevoking(null)}>
                    {t("common.cancel")}
                  </button>
                  <button type="button" className="danger" onClick={() => void revoke(token.id)}>
                    {t("settings.mcpRevokeConfirm")}
                  </button>
                </span>
              ) : (
                <span className="mcp-token-actions">
                  <button type="button" onClick={() => setRevoking(token.id)}>
                    {t("settings.mcpRevoke")}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {status ? (
        <p className={status.kind === "error" ? "auth-error" : "hint"} role="status">
          {status.text}
        </p>
      ) : null}
    </section>
  );
}

/**
 * The raw token, shown once where the form was: scrolled into view and pre-selected, so it can be
 * copied even when the Clipboard API is unavailable (then the hint asks for ⌘C / Ctrl+C).
 */
function FreshToken({ token, onDone }: { token: string; onDone: () => void }) {
  const { t } = usePreferences();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    input.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    input.current?.focus();
    input.current?.select();
  }, []);

  const copy = async () => {
    const ok = await copyText(token);
    setState(ok ? "copied" : "failed");
    if (!ok) {
      input.current?.focus();
      input.current?.select();
    }
  };

  return (
    <div className="mcp-fresh-token" role="status">
      <strong>{t("settings.mcpNewToken")}</strong>
      <div className="mcp-copy-row">
        <input
          ref={input}
          value={token}
          readOnly
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
          aria-label={t("settings.mcpNewToken")}
        />
        <button type="button" className="primary" onClick={() => void copy()}>
          {state === "copied" ? t("settings.mcpCopied") : t("settings.mcpCopyToken")}
        </button>
      </div>
      <span className={state === "failed" ? "hint mcp-copy-failed" : "hint"}>
        {state === "failed" ? t("settings.mcpCopyFailed") : t("settings.mcpNewTokenHint")}
      </span>
      <div className="button-row">
        <button type="button" onClick={onDone}>
          {t("settings.mcpDone")}
        </button>
      </div>
    </div>
  );
}

function CreateTokenForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (token: string, tokens: McpToken[]) => void }) {
  const { t } = usePreferences();
  const [name, setName] = useState("");
  const [write, setWrite] = useState(true);
  const [remove, setRemove] = useState(false);
  const [expiry, setExpiry] = useState<number | null>(DEFAULT_EXPIRY);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const scopes: McpScope[] = ["read"];
    if (write) scopes.push("write");
    if (remove) scopes.push("delete");
    try {
      const result = await api.createMcpToken({ name: name.trim(), scopes, expiresInDays: expiry, password });
      setPassword("");
      onCreated(result.token, result.tokens);
    } catch (reason) {
      setError(errorMessage(t, reason));
      setBusy(false);
    }
  };

  return (
    <form className="mcp-create-form" onSubmit={submit}>
      <label className="field">
        <span className="field-label">{t("settings.mcpTokenName")}</span>
        <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={t("settings.mcpTokenNamePlaceholder")} autoFocus required />
      </label>
      <fieldset className="mcp-scopes">
        <legend className="field-label">{t("settings.mcpPermissions")}</legend>
        <label className="checkbox-row">
          <input type="checkbox" checked disabled />
          {t("settings.mcpScope.read")}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />
          {t("settings.mcpScope.write")}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={remove} onChange={(event) => setRemove(event.target.checked)} />
          {t("settings.mcpScope.delete")}
        </label>
        {remove ? <span className="hint">{t("settings.mcpScopeDeleteHint")}</span> : null}
      </fieldset>
      <label className="field">
        <span className="field-label">{t("settings.mcpExpiration")}</span>
        <select value={expiry === null ? "never" : String(expiry)} onChange={(event) => setExpiry(event.target.value === "never" ? null : Number(event.target.value))}>
          {EXPIRY_OPTIONS.map((days) => (
            <option key={String(days)} value={days === null ? "never" : String(days)}>
              {t(days === null ? "settings.mcpExpiry.never" : `settings.mcpExpiry.${days}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="field-label">{t("settings.currentPassword")}</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
      </label>
      {error ? <p className="auth-error">{error}</p> : null}
      <div className="button-row">
        <button type="button" onClick={onCancel}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="primary" disabled={busy || !name.trim() || !password}>
          {t("settings.mcpCreateButton")}
        </button>
      </div>
    </form>
  );
}
