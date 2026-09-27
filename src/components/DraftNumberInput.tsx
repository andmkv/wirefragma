import { useEffect, useState, type InputHTMLAttributes } from "react";

interface DraftNumberInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}

/**
 * A number input that can actually be typed into: the text is a local draft while focused, and a
 * value is committed only once it is inside [min, max]. Out-of-range drafts ("1" on the way to
 * "1500") are never clamped mid-typing; on blur the field shows the committed value again.
 */
export function DraftNumberInput({ value, min, max, onCommit, onFocus, onBlur, ...rest }: DraftNumberInputProps) {
  const rounded = Math.round(value);
  const [draft, setDraft] = useState(String(rounded));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(rounded));
  }, [rounded, focused]);

  return (
    <input
      {...rest}
      type="number"
      min={min}
      max={max}
      value={draft}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        setDraft(String(rounded));
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        if (raw.trim() === "") return;
        const parsed = Math.round(Number(raw));
        if (!Number.isFinite(parsed) || parsed < min || parsed > max) return;
        if (parsed !== rounded) onCommit(parsed);
      }}
    />
  );
}
