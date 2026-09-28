import type { ElementType } from "../model/project";
import { useT } from "../i18n";
import { PALETTE_GROUPS } from "../model/defaults";

interface ElementPaletteProps {
  onAdd: (type: ElementType) => void;
  activeLayerName: string;
  /** The collapsed Add panel: a two-column grid of glyph buttons. */
  compact?: boolean;
}

const GLYPH: Record<ElementType, string> = {
  container: "▢",
  text: "T",
  button: "▭",
  input: "▯",
  textarea: "▤",
  checkbox: "☑",
  radio: "◉",
  toggle: "⚉",
  dropdown: "▾",
  slider: "⟷",
  progress: "▰",
  iconButton: "⊕",
  tabs: "▥",
  list: "≡",
  table: "▦",
  image: "▨",
  icon: "★",
  avatar: "◍",
  badge: "⬭",
  divider: "—",
  toolbar: "▬",
  sidebar: "▮",
  bottomNav: "⊞",
  dialog: "▣",
  diagram: "◇",
  drawing: "✎"
};

/**
 * Contents of the Add panel. `compact` is the collapsed panel: MS Paint-style glyph buttons in two
 * columns under (truncated) group titles, with the element name as tooltip.
 */
export function ElementPalette({ onAdd, activeLayerName, compact = false }: ElementPaletteProps) {
  const t = useT();
  const groupTitle = (title: string) => t(`palette.group.${title as "Layout" | "Content" | "Controls" | "Custom"}`);
  if (compact) {
    return (
      <>
        {PALETTE_GROUPS.map((group) => (
          <div className="palette-group compact" key={group.title}>
            <div className="palette-group-title" title={groupTitle(group.title)}>
              {groupTitle(group.title)}
            </div>
            <div className="palette-grid">
              {group.types.map((type) => (
                <button
                  key={type}
                  type="button"
                  className="palette-tile"
                  onClick={() => onAdd(type)}
                  title={t("palette.addTo", { type: t(`type.${type}`), layer: activeLayerName })}
                  aria-label={t("palette.addTo", { type: t(`type.${type}`), layer: activeLayerName })}
                >
                  <span aria-hidden="true">{GLYPH[type]}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      {PALETTE_GROUPS.map((group) => (
        <div className="palette-group" key={group.title}>
          <div className="palette-group-title" title={groupTitle(group.title)}>
            {groupTitle(group.title)}
          </div>
          <div className="palette-items">
            {group.types.map((type) => (
              <button
                key={type}
                type="button"
                className="palette-item"
                onClick={() => onAdd(type)}
                title={t("palette.addTo", { type: t(`type.${type}`), layer: activeLayerName })}
              >
                <span className="palette-glyph" aria-hidden="true">
                  {GLYPH[type]}
                </span>
                <span className="palette-label">{t(`type.${type}`)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="palette-hint">
        New elements are added to <strong>{activeLayerName}</strong>. Click an element to drop it in the
        middle of the canvas, then drag to move and use the handles to resize.
      </p>
    </>
  );
}
