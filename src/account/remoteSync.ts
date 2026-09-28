/**
 * Noticing changes made elsewhere — another tab, another device, or an MCP agent.
 *
 * The signed-in workspace polls the lightweight project tree (`GET ?action=projects`: ids, titles,
 * revisions; no documents). This module holds the pure rules that turn "server tree + local
 * cache" into actions; `Workspace.tsx` only schedules the poll and performs the actions.
 *
 * Invariants (see docs/accounts.md → "Changes made elsewhere"):
 * - a clean cached wireframe is replaced by the newer server revision; unsaved local edits are
 *   never overwritten — the dirty case goes through the ordinary save, whose 409 opens the
 *   existing conflict banner;
 * - a wireframe loaded from the server is clean by construction (`savedJson` is the JSON of the
 *   normalized document that becomes `history.present`), so loading it never triggers an
 *   autosave — no remote update → reload → save → revision + 1 → reload loop;
 * - nothing is decided while that wireframe's own save is in flight.
 */

import { normalizeProject, type WireframeProject } from "../model/project";
import { createHistory, type History } from "../utils/history";
import type { ProjectSummary, WireframeRecord } from "./api";

export interface CacheEntry {
  projectId: number;
  history: History<WireframeProject>;
  /** Server revision the current local copy is based on. */
  revision: number;
  /** JSON of the last document the server confirmed — dirty check without a deep compare. */
  savedJson: string;
}

/** A server wireframe as a clean cache entry: `history.present`, `savedJson` and `revision` agree. */
export function toEntry(record: WireframeRecord): CacheEntry {
  const project = normalizeProject(record.data);
  // The panel title is the source of truth for the document title.
  const document = project.title === record.title ? project : { ...project, title: record.title };
  return {
    projectId: record.projectId,
    history: createHistory(document),
    revision: record.revision,
    savedJson: JSON.stringify(document)
  };
}

/** Local edits the server has not confirmed yet. */
export function isDirty(entry: CacheEntry): boolean {
  return JSON.stringify(entry.history.present) !== entry.savedJson;
}

/** What the planner needs to know about one cached wireframe. */
export interface CachedState {
  revision: number;
  dirty: boolean;
  /** A save request for this wireframe is in flight. */
  saving: boolean;
  /** A conflict banner is already open for it (do not re-trigger every poll). */
  conflicted: boolean;
}

export type RemoteAction =
  /** The open wireframe changed elsewhere and has no local edits: load the new revision. */
  | { kind: "reload"; id: number; revision: number }
  /** The open wireframe changed elsewhere AND has local edits: save now so the server answers 409. */
  | { kind: "conflict"; id: number; revision: number }
  /** A cached, clean, not-open wireframe is outdated: drop it, it reloads on the next open. */
  | { kind: "evict"; id: number }
  /** The wireframe no longer exists on the server. */
  | { kind: "removed"; id: number; current: boolean };

/** Every wireframe id → revision in a project tree. */
export function treeRevisions(tree: ProjectSummary[]): Map<number, number> {
  const revisions = new Map<number, number>();
  for (const project of tree) for (const wireframe of project.wireframes) revisions.set(wireframe.id, wireframe.revision);
  return revisions;
}

export function planRemoteSync(tree: ProjectSummary[], cache: Map<number, CachedState>, currentId: number | null): RemoteAction[] {
  const revisions = treeRevisions(tree);
  const actions: RemoteAction[] = [];
  for (const [id, state] of cache) {
    if (state.saving) continue;
    const serverRevision = revisions.get(id);
    const current = id === currentId;
    if (serverRevision === undefined) {
      actions.push({ kind: "removed", id, current });
      continue;
    }
    if (serverRevision <= state.revision) continue;
    if (current) {
      if (!state.dirty) actions.push({ kind: "reload", id, revision: serverRevision });
      else if (!state.conflicted) actions.push({ kind: "conflict", id, revision: serverRevision });
    } else if (!state.dirty) {
      actions.push({ kind: "evict", id });
    }
  }
  return actions;
}

/** Poll cadence while the page is visible, and the ceiling of the back-off after failures. */
export const POLL_INTERVAL_MS = 5000;
export const POLL_MAX_BACKOFF_MS = 60000;

export function nextPollDelay(previous: number, ok: boolean): number {
  return ok ? POLL_INTERVAL_MS : Math.min(Math.max(previous, POLL_INTERVAL_MS) * 2, POLL_MAX_BACKOFF_MS);
}
