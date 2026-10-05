import { describe, expect, it } from "vitest";
import { insertEmojiAtSelection } from "./emojiInsert";

describe("insertEmojiAtSelection", () => {
  it("inserts at the caret", () => {
    expect(insertEmojiAtSelection("Hello world", { start: 5, end: 5 }, "🚀")).toEqual({
      value: "Hello🚀 world",
      caret: 7
    });
  });

  it("replaces the selected range", () => {
    expect(insertEmojiAtSelection("Hello world", { start: 6, end: 11 }, "🌍")).toEqual({
      value: "Hello 🌍",
      caret: 8
    });
  });

  it("appends when the selection is missing or unknown", () => {
    expect(insertEmojiAtSelection("Hi", { start: null, end: null }, "🙂")).toEqual({
      value: "Hi🙂",
      caret: 4
    });
    expect(insertEmojiAtSelection("Hi", { start: 99, end: 120 }, "🙂")).toEqual({
      value: "Hi🙂",
      caret: 4
    });
  });

  it("normalises a reversed selection", () => {
    // "⭐" is a single UTF-16 unit, so the caret lands one position after the range start.
    expect(insertEmojiAtSelection("abcdef", { start: 4, end: 2 }, "⭐")).toEqual({
      value: "ab⭐ef",
      caret: 3
    });
  });

  it("inserts in the middle of an empty value", () => {
    expect(insertEmojiAtSelection("", { start: 0, end: 0 }, "💳")).toEqual({ value: "💳", caret: 2 });
  });

  it("treats a multi-codepoint emoji as one unit (UTF-16 length)", () => {
    // A ZWJ family glyph is 8 UTF-16 units; the caret lands after all of them.
    const family = "👨‍👩‍👧";
    expect(family.length).toBe(8);
    const result = insertEmojiAtSelection("ab", { start: 1, end: 1 }, family);
    expect(result.value).toBe(`a${family}b`);
    expect(result.caret).toBe(9);
  });

  it("handles a flag and a variation-selector glyph", () => {
    expect(insertEmojiAtSelection("x", { start: 1, end: 1 }, "🇷🇸").value).toBe("x🇷🇸");
    expect(insertEmojiAtSelection("x", { start: 1, end: 1 }, "⚠️").value).toBe("x⚠️");
  });

  it("round-trips the caret against slicing", () => {
    const value = "one two";
    const { value: next, caret } = insertEmojiAtSelection(value, { start: 3, end: 3 }, "➕");
    expect(next.slice(0, caret)).toBe("one➕");
    expect(next.slice(caret)).toBe(" two");
  });

  it("is a no-op for an empty emoji", () => {
    expect(insertEmojiAtSelection("abc", { start: 1, end: 1 }, "")).toEqual({ value: "abc", caret: 1 });
  });
});
