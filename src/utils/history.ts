/**
 * Bounded undo/redo history for immutable snapshots.
 *
 * Two extra behaviours keep the history pleasant in a canvas editor:
 *  - `coalesceKey` merges rapid commits (typing in a text field) into one entry;
 *  - transactions (drag / resize) record a single entry for the whole gesture.
 */

export const HISTORY_LIMIT = 80;
export const COALESCE_WINDOW_MS = 700;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  meta: {
    key: string | null;
    time: number;
    base: T | null;
  };
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], meta: { key: null, time: 0, base: null } };
}

export interface CommitOptions {
  /** Rapid commits sharing a key collapse into one history entry. */
  coalesceKey?: string | null;
  /** When true the change is applied without creating a history entry. */
  transient?: boolean;
  now?: number;
  limit?: number;
  coalesceMs?: number;
}

export function commit<T>(history: History<T>, next: T, options: CommitOptions = {}): History<T> {
  const {
    coalesceKey = null,
    transient = false,
    now = Date.now(),
    limit = HISTORY_LIMIT,
    coalesceMs = COALESCE_WINDOW_MS
  } = options;

  // An open transaction swallows every intermediate state.
  if (history.meta.base !== null || transient) {
    return {
      ...history,
      present: next,
      meta: { ...history.meta, key: coalesceKey, time: now }
    };
  }

  const canCoalesce =
    coalesceKey !== null &&
    history.meta.key === coalesceKey &&
    now - history.meta.time <= coalesceMs &&
    history.future.length === 0;

  if (canCoalesce) {
    return {
      ...history,
      present: next,
      meta: { key: coalesceKey, time: now, base: null }
    };
  }

  const past = [...history.past, history.present].slice(-limit);
  return {
    past,
    present: next,
    future: [],
    meta: { key: coalesceKey, time: now, base: null }
  };
}

/** Open a transaction: intermediate `commit(..., { transient: true })` calls are not recorded. */
export function beginTransaction<T>(history: History<T>): History<T> {
  if (history.meta.base !== null) return history;
  return { ...history, meta: { ...history.meta, base: history.present } };
}

export function updateDuringTransaction<T>(history: History<T>, next: T): History<T> {
  return { ...history, present: next };
}

/** Close a transaction, recording exactly one history entry for the gesture. */
export function endTransaction<T>(
  history: History<T>,
  next: T,
  options: { limit?: number } = {}
): History<T> {
  const { limit = HISTORY_LIMIT } = options;
  const base = history.meta.base;
  if (base === null) {
    return { ...history, present: next, meta: { ...history.meta, base: null } };
  }
  if (base === next || JSON.stringify(base) === JSON.stringify(next)) {
    return {
      present: next,
      past: history.past,
      future: history.future,
      meta: { key: null, time: Date.now(), base: null }
    };
  }
  return {
    past: [...history.past, base].slice(-limit),
    present: next,
    future: [],
    meta: { key: null, time: Date.now(), base: null }
  };
}

export function cancelTransaction<T>(history: History<T>): History<T> {
  const base = history.meta.base;
  if (base === null) return history;
  return { ...history, present: base, meta: { ...history.meta, base: null } };
}

export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

export function undo<T>(history: History<T>): History<T> {
  // Mid-gesture (open transaction) undo would silently drop the transaction base.
  if (history.past.length === 0 || history.meta.base !== null) return history;
  const previous = history.past[history.past.length - 1];
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, HISTORY_LIMIT),
    meta: { key: null, time: 0, base: null }
  };
}

export function redo<T>(history: History<T>): History<T> {
  if (history.future.length === 0 || history.meta.base !== null) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: rest,
    meta: { key: null, time: 0, base: null }
  };
}

/** Reset the history to a single state (used by New / Import). */
export function resetHistory<T>(present: T): History<T> {
  return createHistory(present);
}
