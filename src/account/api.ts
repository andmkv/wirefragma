/**
 * Client for the optional PHP accounts backend (`server/api/index.php`).
 *
 * The editor is a static app first: when the backend is missing (GitHub Pages, `file://`, a host
 * without PHP) `fetchStatus` resolves to `null` and the app simply runs in guest mode.
 */

import type { WireframeProject } from "../model/project";

export interface AccountSettings {
  language?: string;
  theme?: string;
}

export interface AccountUser {
  id: number;
  email: string;
  displayName: string;
  createdAt: string;
  /** Interface preferences stored with the account (validated server-side). */
  settings?: AccountSettings;
}

/** Names for the starter project, in the user's language. */
export interface StarterNames {
  project: string;
  wireframe: string;
}

export interface ServerStatus {
  enabled: true;
  user: AccountUser | null;
  csrf: string;
  captcha: { provider: "builtin" | "turnstile"; siteKey: string | null };
  registrationOpen: boolean;
  privacy: { version: string; operator: string; contactEmail: string };
}

export interface WireframeSummary {
  id: number;
  title: string;
  revision: number;
  updatedAt: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  updatedAt: string;
  wireframes: WireframeSummary[];
}

export interface WireframeRecord extends WireframeSummary {
  projectId: number;
  data: unknown;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly payload: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Relative to the page, so the app works from a domain root or any sub-directory. */
export const API_ENDPOINT = "api/index.php";

let csrfToken = "";

export function setCsrf(token: string | undefined): void {
  if (token) csrfToken = token;
}

async function request<T>(action: string, options: { body?: unknown; query?: Record<string, string | number>; keepalive?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const params = new URLSearchParams({ action });
  for (const [key, value] of Object.entries(options.query ?? {})) params.set(key, String(value));
  const isPost = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`${API_ENDPOINT}?${params.toString()}`, {
      method: isPost ? "POST" : "GET",
      credentials: "same-origin",
      headers: isPost ? { "Content-Type": "application/json", "X-CSRF-Token": csrfToken } : {},
      body: isPost ? JSON.stringify(options.body) : undefined,
      keepalive: options.keepalive,
      signal: options.signal
    });
  } catch {
    throw new ApiError(0, "network", "Cannot reach the server. Check your connection.");
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new ApiError(response.status, "bad_response", "The server returned an unexpected response.");
  }
  if (typeof payload.csrf === "string") setCsrf(payload.csrf);
  if (!response.ok) {
    throw new ApiError(
      response.status,
      typeof payload.error === "string" ? payload.error : "error",
      typeof payload.message === "string" ? payload.message : "Request failed.",
      payload
    );
  }
  return payload as T;
}

/** Probe the backend. `null` = no accounts backend here → guest-only app. */
export async function fetchStatus(timeoutMs = 4000): Promise<ServerStatus | null> {
  if (typeof window === "undefined" || window.location.protocol === "file:") return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const status = await request<ServerStatus | { enabled: false }>("status", { signal: controller.signal });
    return status.enabled ? status : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

type Ok = { ok: true };
type Session = Ok & { user: AccountUser; csrf: string };

export const api = {
  captcha: () => request<{ image: string | null; question: string | null }>("captcha"),
  register: (body: { email: string; password: string; displayName: string; captcha: string; acceptPrivacy: boolean; website: string }) =>
    request<Ok & { pending: true; mailSent?: boolean }>("register", { body }),
  verify: (token: string, starter?: StarterNames) => request<Session>("verify", { body: { token, starter } }),
  resend: (email: string) => request<Ok>("resend", { body: { email } }),
  login: (email: string, password: string) => request<Session>("login", { body: { email, password } }),
  logout: () => request<Ok>("logout", { body: {} }),
  forgot: (email: string, captcha: string) => request<Ok>("forgot", { body: { email, captcha } }),
  reset: (token: string, password: string, starter?: StarterNames) =>
    request<Session>("reset", { body: { token, password, starter } }),
  deleteAccount: (password: string) => request<Ok>("delete-account", { body: { password } }),
  saveSettings: (settings: { displayName?: string; language?: string; theme?: string }) =>
    request<Ok & { user: AccountUser }>("settings-save", { body: settings }),
  changePassword: (current: string, next: string) => request<Ok>("password-change", { body: { current, next } }),

  projects: () => request<{ projects: ProjectSummary[] }>("projects"),
  createProject: (name: string, wireframeTitle?: string) =>
    request<Ok & { projectId: number; wireframeId: number | null; projects: ProjectSummary[] }>("project-create", {
      body: { name, wireframeTitle }
    }),
  renameProject: (id: number, name: string) => request<Ok & { projects: ProjectSummary[] }>("project-rename", { body: { id, name } }),
  deleteProject: (id: number) => request<Ok & { projects: ProjectSummary[] }>("project-delete", { body: { id } }),

  wireframe: (id: number) => request<{ wireframe: WireframeRecord }>("wireframe", { query: { id } }),
  createWireframe: (projectId: number, title: string, data?: WireframeProject) =>
    request<Ok & { wireframeId: number; projects: ProjectSummary[] }>("wireframe-create", { body: { projectId, title, data } }),
  saveWireframe: (
    id: number,
    data: WireframeProject,
    baseRevision: number,
    options: { force?: boolean; keepalive?: boolean } = {}
  ) =>
    request<Ok & { revision: number; title: string }>("wireframe-save", {
      body: { id, data, title: data.title, baseRevision, force: options.force === true },
      keepalive: options.keepalive
    }),
  renameWireframe: (id: number, title: string) =>
    request<Ok & { revision: number; projects: ProjectSummary[] }>("wireframe-rename", { body: { id, title } }),
  duplicateWireframe: (id: number) =>
    request<Ok & { wireframeId: number; projects: ProjectSummary[] }>("wireframe-duplicate", { body: { id } }),
  deleteWireframe: (id: number) => request<Ok & { projects: ProjectSummary[] }>("wireframe-delete", { body: { id } })
};
