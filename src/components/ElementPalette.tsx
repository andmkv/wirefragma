import { ELEMENT_TYPE_LABEL, type ElementType } from "../model/project";
import { PALETTE_GROUPS } from "../model/defaults";

interface ElementPaletteProps {
  onAdd: (type: ElementType) => void;
  activeLayerName: string;
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
  dialog: "▣"
};

/** Contents of the "Add" tab of the left panel. */
export function ElementPalette({ onAdd, activeLayerName }: ElementPaletteProps) {
  return (
    <>
      {PALETTE_GROUPS.map((group) => (
        <div className="palette-group" key={group.title}>
          <div className="palette-group-title">{group.title}</div>
          <div className="palette-items">
            {group.types.map((type) => (
              <button
                key={type}
                type="button"
                className="palette-item"
                onClick={() => onAdd(type)}
                title={`Add ${ELEMENT_TYPE_LABEL[type]} to layer "${activeLayerName}"`}
              >
                <span className="palette-glyph" aria-hidden="true">
                  {GLYPH[type]}
                </span>
                <span>{ELEMENT_TYPE_LABEL[type]}</span>
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
