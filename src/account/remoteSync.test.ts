import { describe, expect, it } from "vitest";
import { createBlankProject } from "../model/defaults";
import { commit } from "../utils/history";
import type { ProjectSummary, WireframeRecord } from "./api";
import {
  POLL_INTERVAL_MS,
  POLL_MAX_BACKOFF_MS,
  isDirty,
  nextPollDelay,
  planRemoteSync,
  toEntry,
  type CachedState
} from "./remoteSync";

function tree(...wireframes: Array<[id: number, revision: number]>): ProjectSummary[] {
  return [
    {
      id: 1,
      name: "App",
      updatedAt: "2026-09-28 10:00:00",
      wireframes: wireframes.map(([id, revision]) => ({ id, revision, title: `W${id}`, updatedAt: "2026-09-28 10:00:00" }))
    }
  ];
}

function cached(revision: number, overrides: Partial<CachedState> = {}): CachedState {
  return { revision, dirty: false, saving: false, conflicted: false, ...overrides };
}

function record(revision: number, data: unknown = createBlankProject()): WireframeRecord {
  return { id: 42, projectId: 1, title: "Settings", revision, updatedAt: "2026-09-28 10:00:00", data };
}

describe("planRemoteSync — what the workspace does after a poll", () => {
  it("reloads the open wireframe when it is clean and the server has a newer revision", () => {
    expect(planRemoteSync(tree([42, 18]), new Map([[42, cached(17)]]), 42)).toEqual([{ kind: "reload", id: 42, revision: 18 }]);
  });

  it("never overwrites local edits: a dirty open wireframe goes through the conflict path", () => {
    expect(planRemoteSync(tree([42, 18]), new Map([[42, cached(17, { dirty: true })]]), 42)).toEqual([
      { kind: "conflict", id: 42, revision: 18 }
    ]);
  });

  it("does not re-trigger a conflict that is already showing", () => {
    expect(planRemoteSync(tree([42, 19]), new Map([[42, cached(17, { dirty: true, conflicted: true })]]), 42)).toEqual([]);
  });

  it("does nothing while that wireframe's own save is in flight", () => {
    // Our save moved the server to 18 before its response arrived; that is not a remote change.
    expect(planRemoteSync(tree([42, 18]), new Map([[42, cached(17, { saving: true })]]), 42)).toEqual([]);
  });

  it("ignores equal or older server revisions (a poll that predates our own save)", () => {
    expect(planRemoteSync(tree([42, 18]), new Map([[42, cached(18)]]), 42)).toEqual([]);
    expect(planRemoteSync(tree([42, 17]), new Map([[42, cached(18)]]), 42)).toEqual([]);
  });

  it("evicts outdated clean wireframes that are not open, and keeps dirty ones", () => {
    const cache = new Map([
      [7, cached(1)],
      [8, cached(1, { dirty: true })]
    ]);
    expect(planRemoteSync(tree([7, 2], [8, 2], [42, 3]), cache, 42)).toEqual([{ kind: "evict", id: 7 }]);
  });

  it("reports wireframes deleted elsewhere, flagging the open one", () => {
    const cache = new Map([
      [42, cached(3)],
      [7, cached(1)]
    ]);
    expect(planRemoteSync(tree([9, 1]), cache, 42)).toEqual([
      { kind: "removed", id: 42, current: true },
      { kind: "removed", id: 7, current: false }
    ]);
  });

  it("a wireframe created elsewhere needs no action: it simply appears in the new tree", () => {
    expect(planRemoteSync(tree([42, 3], [99, 1]), new Map([[42, cached(3)]]), 42)).toEqual([]);
  });
});

describe("loading a server revision cannot cause a save loop", () => {
  it("a freshly loaded entry is clean, so the editor never autosaves it back", () => {
    const entry = toEntry(record(18));
    expect(isDirty(entry)).toBe(false);
    expect(entry.revision).toBe(18);
  });

  it("stays clean even when the stored document is not in normalized form (e.g. written over MCP)", () => {
    const raw = { version: 2, title: "Old title", canvas: { mode: "desktop", width: 1200, height: 800 }, layers: [{ id: "l", name: "L" }], elements: [] };
    const entry = toEntry(record(5, raw));
    expect(isDirty(entry)).toBe(false);
    // The panel title wins over the title inside the document.
    expect(entry.history.present.title).toBe("Settings");
  });

  it("after the reload the next poll is a no-op (revision matches)", () => {
    const entry = toEntry(record(18));
    const state = new Map([[42, cached(entry.revision, { dirty: isDirty(entry) })]]);
    expect(planRemoteSync(tree([42, 18]), state, 42)).toEqual([]);
  });

  it("a real local edit on top of the loaded revision is dirty", () => {
    const entry = toEntry(record(18));
    entry.history = commit(entry.history, { ...entry.history.present, title: "Edited" });
    expect(isDirty(entry)).toBe(true);
  });
});

describe("poll back-off", () => {
  it("returns to the base interval after a success and doubles up to a ceiling after failures", () => {
    expect(nextPollDelay(POLL_INTERVAL_MS, true)).toBe(POLL_INTERVAL_MS);
    expect(nextPollDelay(POLL_INTERVAL_MS, false)).toBe(POLL_INTERVAL_MS * 2);
    expect(nextPollDelay(POLL_MAX_BACKOFF_MS, false)).toBe(POLL_MAX_BACKOFF_MS);
    expect(nextPollDelay(POLL_MAX_BACKOFF_MS, true)).toBe(POLL_INTERVAL_MS);
  });
});
