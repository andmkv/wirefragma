import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { useT } from "../i18n";
import { insertEmojiAtSelection } from "../utils/emojiInsert";
import { EmojiPicker } from "./EmojiPicker";

interface EmojiTextFieldProps {
  value: string;
  /** Receives the new value through the normal `onChange` path (history coalescing unchanged). */
  onChange: (value: string) => void;
  /** Render a `<textarea rows={rows}>` instead of an `<input>`. */
  multiline?: boolean;
  rows?: number;
  id?: string;
  className?: string;
  placeholder?: string;
  title?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Accessible name of the field itself. */
  ariaLabel?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  /**
   * Extra ref for the underlying field, so a caller can keep controlling it (the Canvas popup
   * focuses and selects the label when a text object is created).
   */
  inputRef?: Ref<HTMLInputElement & HTMLTextAreaElement>;
  /** Rendered after the field, inside the same wrapper (e.g. an extra button). */
  trailing?: ReactNode;
}

/**
 * A text field with an emoji button (1.2).
 *
 * One component for every text input in the editor. The button inserts the picked emoji **at the
 * caret, replacing the selection** — never the whole value — through the same `onChange` the user
 * typing would call, so `coalesceKey` history handling is untouched. Focus and the caret return to
 * the field after the pick, Escape closes the popover without touching the value, and the popover
 * clamps/flips inside the viewport.
 *
 * The insertion maths is the pure `insertEmojiAtSelection` in `src/utils/emojiInsert.ts`.
 */
export function EmojiTextField({
  value,
  onChange,
  multiline = false,
  rows = 3,
  id,
  className,
  placeholder,
  title,
  disabled = false,
  autoFocus = false,
  ariaLabel,
  onKeyDown,
  onBlur,
  inputRef,
  trailing
}: EmojiTextFieldProps) {
  const t = useT();
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [open, setOpen] = useState(false);

  // After React has written the new value, put the caret back where the emoji was inserted.
  useEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;
    const node = fieldRef.current;
    if (!node) return;
    node.focus();
    try {
      node.setSelectionRange(caret, caret);
    } catch {
      /* a field type without selection support */
    }
  });

  const close = () => {
    setOpen(false);
    fieldRef.current?.focus();
  };

  const insert = (emoji: string) => {
    const node = fieldRef.current;
    const selection = node
      ? { start: node.selectionStart, end: node.selectionEnd }
      : { start: null, end: null };
    const next = insertEmojiAtSelection(value, selection, emoji);
    pendingCaret.current = next.caret;
    onChange(next.value);
    close();
  };

  /** Both the internal caret ref and the caller's optional ref point at the same node. */
  const setFieldRef = (node: HTMLInputElement | HTMLTextAreaElement | null) => {
    fieldRef.current = node;
    if (typeof inputRef === "function") {
      inputRef(node as HTMLInputElement & HTMLTextAreaElement);
      return;
    }
    if (inputRef) {
      // `RefObject.current` is readonly in React's types; the callers pass `useRef<T>(null)`,
      // which is the mutable variant at runtime.
      (inputRef as { current: HTMLInputElement | HTMLTextAreaElement | null }).current = node;
    }
  };

  const shared = {
    id,
    className: className ? `emoji-field-control ${className}` : "emoji-field-control",
    value,
    placeholder,
    title,
    disabled,
    autoFocus,
    "aria-label": ariaLabel,
    onKeyDown,
    onBlur,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value)
  };

  return (
    <div className="emoji-text-field" ref={wrapperRef}>
      {multiline ? (
        <textarea {...shared} ref={setFieldRef as Ref<HTMLTextAreaElement>} rows={rows} />
      ) : (
        <input {...shared} ref={setFieldRef as Ref<HTMLInputElement>} type="text" />
      )}
      {trailing}
      <button
        type="button"
        className="emoji-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        title={t("props.chooseEmoji")}
        aria-label={t("props.chooseEmoji")}
        onClick={() => setOpen((current) => !current)}
      >
        🙂
      </button>
      {open ? (
        <EmojiPicker value={value} anchorRef={wrapperRef} onPick={insert} onClose={close} />
      ) : null}
    </div>
  );
}
