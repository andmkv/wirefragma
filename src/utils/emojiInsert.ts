/**
 * Pure insertion of an emoji into a text field at the caret (1.3.5).
 *
 * Kept out of the component so it can be unit-tested: every `EmojiTextField` in the editor uses
 * this one function, which is what makes "insert at the caret / replace the selection" behave
 * identically in inputs, textareas and every panel.
 */

export interface TextSelection {
  /** `selectionStart`; null or out of range means "caret at the end". */
  start: number | null;
  /** `selectionEnd`; null means "same as start". */
  end: number | null;
}

export interface EmojiInsertion {
  value: string;
  /** Caret position after the inserted emoji (always right after it). */
  caret: number;
}

function clampIndex(value: number | null, length: number): number {
  if (value === null || !Number.isFinite(value)) return length;
  return Math.min(length, Math.max(0, Math.trunc(value)));
}

/**
 * Insert `emoji` into `value`, replacing the selected range.
 *
 * A reversed selection (end < start) is normalised, and a missing/out-of-range selection appends
 * at the end, so the result is always a valid value + caret pair. Multi-codepoint emoji (ZWJ
 * sequences, flags, variation selectors) are inserted as one unit — `selectionStart`/`End` count
 * UTF-16 units, exactly like the DOM.
 */
export function insertEmojiAtSelection(value: string, selection: TextSelection, emoji: string): EmojiInsertion {
  const length = value.length;
  const rawStart = clampIndex(selection.start, length);
  const rawEnd = clampIndex(selection.end ?? selection.start, length);
  const start = Math.min(rawStart, rawEnd);
  const end = Math.max(rawStart, rawEnd);
  const next = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
  return { value: next, caret: start + emoji.length };
}
