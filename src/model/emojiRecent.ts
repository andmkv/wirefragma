/**
 * Recently used emoji (1.3.5).
 *
 * A picker convenience, stored per browser in `localStorage` — never in the project, never in the
 * cloud. Reads are defensive: anything that is not a list of plausible emoji strings is ignored.
 */

import type { StorageLike } from "../utils/storage";

export const EMOJI_RECENT_KEY = "wirefragma.emoji.recent";

/** How many recent emoji the picker remembers. */
export const MAX_RECENT_EMOJI = 24;

/** Longest string accepted as one emoji (the longest ZWJ family glyph is well under this). */
const MAX_EMOJI_LENGTH = 16;

/** Validate an untrusted value into a deduplicated, capped list of emoji strings. */
export function parseRecentEmoji(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const emoji = item.trim();
    if (emoji.length === 0 || emoji.length > MAX_EMOJI_LENGTH) continue;
    if (seen.has(emoji)) continue;
    seen.add(emoji);
    result.push(emoji);
    if (result.length >= MAX_RECENT_EMOJI) break;
  }
  return result;
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Read the list; unreadable or hostile data yields an empty list. */
export function loadRecentEmoji(storage: StorageLike | null = browserStorage()): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(EMOJI_RECENT_KEY);
    if (!raw) return [];
    return parseRecentEmoji(JSON.parse(raw));
  } catch {
    return [];
  }
}

/**
 * Pure list update: the picked emoji moves to the front, duplicates collapse, the list is capped.
 */
export function withRecentEmoji(list: string[], emoji: string): string[] {
  const trimmed = emoji.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_EMOJI_LENGTH) return list;
  return parseRecentEmoji([trimmed, ...list.filter((item) => item !== trimmed)]);
}

/** Remember a picked emoji and return the new list. Storage failures are ignored. */
export function rememberEmoji(
  emoji: string,
  storage: StorageLike | null = browserStorage()
): string[] {
  const next = withRecentEmoji(loadRecentEmoji(storage), emoji);
  try {
    storage?.setItem(EMOJI_RECENT_KEY, JSON.stringify(next));
  } catch {
    /* recents are a convenience, never a requirement */
  }
  return next;
}
