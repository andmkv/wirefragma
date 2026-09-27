import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useT } from "../i18n";
import { EMOJI_CATEGORIES, emojiByCategory, searchEmoji, type EmojiCategory } from "../model/emoji";

interface EmojiPickerProps {
  /** Current label, shown as the search seed when present. */
  value: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /**
   * Everything inside this element also counts as "the picker" for outside-click detection, so
   * the toggle button beside the popover closes it instead of immediately reopening it.
   */
  anchorRef?: RefObject<HTMLElement | null>;
}

/**
 * Compact emoji popover for Icon / Image labels.
 *
 * Uses the local curated catalog (`model/emoji.ts`) — no emoji dependency, no network. Escape or
 * a click outside closes it, and picking an emoji writes it straight into the element's label.
 */
export function EmojiPicker({ value, onPick, onClose, anchorRef }: EmojiPickerProps) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EmojiCategory>(EMOJI_CATEGORIES[0]);
  const rootRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    if (query.trim() !== "") return searchEmoji(query);
    return emojiByCategory(category);
  }, [category, query]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [anchorRef, onClose]);

  return (
    <div className="emoji-picker" ref={rootRef} role="dialog" aria-label={t("emoji.picker")}>
      <div className="emoji-search">
        <input
          type="search"
          value={query}
          placeholder={t("emoji.search")}
          autoFocus
          aria-label={t("emoji.search")}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {query.trim() === "" ? (
        <div className="emoji-categories">
          {EMOJI_CATEGORIES.map((entry) => (
            <button
              key={entry}
              type="button"
              className={entry === category ? "emoji-category active" : "emoji-category"}
              onClick={() => setCategory(entry)}
            >
              {t(`emoji.category.${entry}`)}
            </button>
          ))}
        </div>
      ) : (
        <div className="emoji-results-label">
          {t("emoji.matches", { count: results.length })}
        </div>
      )}

      {results.length === 0 ? (
        <div className="emoji-empty">{t("emoji.noResults", { query })}</div>
      ) : (
        <div className="emoji-grid">
          {results.map((entry) => (
            <button
              key={`${entry.category}-${entry.emoji}-${entry.name}`}
              type="button"
              className={entry.emoji === value.trim() ? "emoji-cell active" : "emoji-cell"}
              title={entry.name}
              aria-label={entry.name}
              onClick={() => onPick(entry.emoji)}
            >
              {entry.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
