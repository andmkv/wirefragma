import { describe, expect, it } from "vitest";
import { beginTransaction, canRedo, canUndo, commit, createHistory, endTransaction, redo, undo } from "./history";

describe("history", () => {
  it("records and reverses committed states", () => {
    let history = createHistory({ value: 1 });
    history = commit(history, { value: 2 }, { now: 1000 });
    history = commit(history, { value: 3 }, { now: 2000 });

    expect(canUndo(history)).toBe(true);
    expect(history.present.value).toBe(3);

    history = undo(history);
    expect(history.present.value).toBe(2);
    history = undo(history);
    expect(history.present.value).toBe(1);
    expect(canUndo(history)).toBe(false);

    history = redo(history);
    expect(history.present.value).toBe(2);
    expect(canRedo(history)).toBe(true);
  });

  it("coalesces rapid commits that share a key", () => {
    let history = createHistory({ text: "" });
    history = commit(history, { text: "a" }, { coalesceKey: "name", now: 1000 });
    history = commit(history, { text: "ab" }, { coalesceKey: "name", now: 1200 });
    history = commit(history, { text: "abc" }, { coalesceKey: "name", now: 1300 });

    expect(history.past).toHaveLength(1);
    history = undo(history);
    expect(history.present.text).toBe("");
  });

  it("creates a single entry for a drag transaction", () => {
    let history = createHistory({ x: 0 });
    history = beginTransaction(history);
    history = commit(history, { x: 8 }, { transient: true });
    history = commit(history, { x: 40 }, { transient: true });
    history = endTransaction(history, { x: 40 });

    expect(history.past).toEqual([{ x: 0 }]);
    expect(history.present).toEqual({ x: 40 });

    history = undo(history);
    expect(history.present).toEqual({ x: 0 });
  });

  it("ignores a transaction that did not change anything", () => {
    let history = createHistory({ x: 5 });
    history = beginTransaction(history);
    history = endTransaction(history, { x: 5 });
    expect(history.past).toHaveLength(0);
  });

  it("bounds the number of stored entries", () => {
    let history = createHistory({ value: 0 });
    for (let i = 1; i <= 200; i += 1) {
      history = commit(history, { value: i }, { now: 1000 + i, coalesceKey: `k${i}` });
    }
    expect(history.past.length).toBeLessThanOrEqual(80);
  });
});
