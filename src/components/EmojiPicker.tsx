import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { usePreferences, useT } from "../i18n";
import {
  EMOJI_CATEGORIES,
  emojiByCategory,
  loadEmojiCatalog,
  searchEmoji,
  type EmojiCategory,
  type EmojiEntry
} from "../model/emoji";
import { loadRecentEmoji, rememberEmoji } from "../model/emojiRecent";

interface EmojiPickerProps {
  /** Current value, used to highlight the active cell. */
  value: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
  /**
   * Everything inside this element also counts as "the picker" for outside-click detection, so
   * the toggle button beside the popover closes it instead of immediately reopening it.
   */
  anchorRef?: RefObject<HTMLElement | null>;
}

/** The picker's first tab, shown only while there is something in it. */
const RECENT = "Recent";

/** Inset kept between the popover and the viewport edges, in CSS px. */
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 6;

/**
 * Emoji popover for every text field and for the Icon / Image label.
 *
 * The glyph list and the names of the active language are **lazy chunks**, loaded when the picker
 * opens. Search always covers the current UI language plus English, ignores case and accents, and
 * the "Recent" tab (first, when non-empty) lists the last picks from `localStorage`.
 *
 * The popover is `position: fixed` and flips/clamps to stay inside the viewport (D4): Escape or a
 * click outside closes it and the caller returns focus to the field.
 */
export function EmojiPicker({ value, onPick, onClose, anchorRef }: EmojiPickerProps) {
  const t = useT();
  const { locale } = usePreferences();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EmojiCategory | typeof RECENT>(() =>
    loadRecentEmoji().length > 0 ? RECENT : EMOJI_CATEGORIES[0]
  );
  const [catalog, setCatalog] = useState<EmojiEntry[] | null>(null);
  const [recent, setRecent] = useState<string[]>(() => loadRecentEmoji());
  const rootRef = useRef<HTMLDivElement>(null);

  // Load the glyph + name chunks for the active language (one chunk per language).
  useEffect(() => {
    let cancelled = false;
    loadEmojiCatalog({ language: locale })
      .then((entries) => {
        if (!cancelled) setCatalog(entries);
      })
      .catch(() => {
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const results = useMemo(() => {
    if (!catalog) return [];
    if (query.trim() !== "") return searchEmoji(catalog, query);
    if (category === RECENT) {
      const byEmoji = new Map(catalog.map((entry) => [entry.emoji, entry]));
      return recent.map((emoji) => byEmoji.get(emoji)).filter((entry): entry is EmojiEntry => !!entry);
    }
    return emojiByCategory(catalog, category);
  }, [catalog, category, query, recent]);

  const pick = useCallback(
    (emoji: string) => {
      setRecent(rememberEmoji(emoji));
      onPick(emoji);
    },
    [onPick]
  );

  /* --------------------------------------------------------- positioning */

  const place = useCallback(() => {
    const root = rootRef.current;
    const anchor = anchorRef?.current;
    if (!root) return;
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    const rect = anchor
      ? anchor.getBoundingClientRect()
      : { left: VIEWPORT_MARGIN, top: VIEWPORT_MARGIN, bottom: VIEWPORT_MARGIN };

    let left = rect.left;
    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - VIEWPORT_MARGIN - width;
    }
    left = Math.max(VIEWPORT_MARGIN, left);

    let top = rect.bottom + ANCHOR_GAP;
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      const above = rect.top - ANCHOR_GAP - height;
      top =
        above >= VIEWPORT_MARGIN
          ? above
          : Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - height);
    }
    root.style.left = `${Math.round(left)}px`;
    root.style.top = `${Math.round(top)}px`;
  }, [anchorRef]);

  // Re-place on every content change (search results, tab switch, chunk load) and on resize.
  useLayoutEffect(place);
  useEffect(() => {
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [place]);

  /* ------------------------------------------------------------ dismissal */

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

  const tabs: (EmojiCategory | typeof RECENT)[] =
    recent.length > 0 ? [RECENT, ...EMOJI_CATEGORIES] : EMOJI_CATEGORIES;

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
          {tabs.map((entry) => (
            <button
              key={entry}
              type="button"
              className={entry === category ? "emoji-category active" : "emoji-category"}
              onClick={() => setCategory(entry)}
            >
              {entry === RECENT ? t("emoji.recent") : t(`emoji.category.${entry}`)}
            </button>
          ))}
        </div>
      ) : (
        <div className="emoji-results-label">{t("emoji.matches", { count: results.length })}</div>
      )}

      {catalog === null ? (
        <div className="emoji-empty">{t("common.loading")}</div>
      ) : results.length === 0 ? (
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
              onClick={() => pick(entry.emoji)}
            >
              {entry.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
