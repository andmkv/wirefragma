import { useEffect, useRef, useState } from "react";
import {
  ELEMENT_TYPE_LABEL,
  MAX_CANVAS_SIZE,
  MAX_CONTENT_SIZE,
  MAX_FONT_SIZE,
  MIN_CANVAS_SIZE,
  MIN_CONTENT_SIZE,
  MIN_FONT_SIZE,
  contentSizeOf,
  effectiveLocked,
  mergeTextStyle,
  textStyleOf,
  type TextAlign,
  type TextStyle,
  type WireframeElement,
  type WireframeProject
} from "../model/project";
import { EmojiPicker } from "./EmojiPicker";

interface ChangeOptions {
  transient?: boolean;
  coalesceKey?: string | null;
}

interface PropertiesPanelProps {
  project: WireframeProject;
  /** The primary selected element, or null when nothing is selected. */
  element: WireframeElement | null;
  /** Every selected id — more than one switches the panel into its group view. */
  selectedIds: string[];
  layerName: string | null;
  /** Effective lock: the element itself or its layer. */
  locked: boolean;
  onChangeElement: (patch: Partial<WireframeElement>, options?: ChangeOptions) => void;
  /** Same, but the patch is derived from the element's current state (see the typography toggles). */
  onUpdateElement: (
    updater: (element: WireframeElement) => Partial<WireframeElement>,
    options?: ChangeOptions
  ) => void;
  onChangeProject: (patch: { title?: string; width?: number; height?: number }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onCommit
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const rounded = Math.round(value);
  const [draft, setDraft] = useState(String(rounded));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(rounded));
  }, [rounded, focused]);

  return (
    <label className={disabled ? "field disabled" : "field"}>
      <span className="field-label">{label}</span>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setDraft(String(rounded));
        }}
        onChange={(event) => {
          if (disabled) return;
          const raw = event.target.value;
          setDraft(raw);
          if (raw.trim() === "") return;
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return;
          let next = parsed;
          if (typeof min === "number") next = Math.max(min, next);
          if (typeof max === "number") next = Math.min(max, next);
          onCommit(next);
        }}
      />
    </label>
  );
}

function TypographySection({
  element,
  disabled,
  onUpdateElement
}: {
  element: WireframeElement;
  disabled: boolean;
  onUpdateElement: (
    updater: (current: WireframeElement) => Partial<WireframeElement>,
    options?: ChangeOptions
  ) => void;
}) {
  const style = textStyleOf(element);
  // Toggles read the previous value, so the patch is computed inside the document updater.
  const patch = (next: Partial<TextStyle>, key: string) =>
    onUpdateElement((current) => ({ textStyle: mergeTextStyle(current, next) }), { coalesceKey: key });

  const toggle = (key: "bold" | "italic" | "underline") => (
    <button
      type="button"
      className={style[key] ? "toggle-button active" : "toggle-button"}
      aria-pressed={style[key]}
      disabled={disabled}
      title={key}
      onClick={() => patch({ [key]: !style[key] }, `text-${key}`)}
    >
      {key === "bold" ? <strong>B</strong> : key === "italic" ? <em>I</em> : <span className="underline">U</span>}
    </button>
  );

  const align = (value: TextAlign) => (
    <button
      key={value}
      type="button"
      className={style.align === value ? "toggle-button active" : "toggle-button"}
      aria-pressed={style.align === value}
      disabled={disabled}
      title={`Align ${value}`}
      onClick={() => patch({ align: value }, "text-align")}
    >
      {value === "left" ? "Left" : value === "center" ? "Center" : "Right"}
    </button>
  );

  return (
    <>
      <div className="section-label">Typography</div>
      <div className="field">
        <span className="field-label">Size</span>
        <input
          type="number"
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={style.fontSize}
          disabled={disabled}
          aria-label="Font size"
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (!Number.isFinite(parsed)) return;
            patch({ fontSize: Math.round(parsed) }, "text-size");
          }}
        />
      </div>
      <div className="field">
        <span className="field-label">Style</span>
        <div className="toggle-group" role="group" aria-label="Text style">
          {toggle("bold")}
          {toggle("italic")}
          {toggle("underline")}
        </div>
      </div>
      <div className="field">
        <span className="field-label">Alignment</span>
        <div className="toggle-group" role="group" aria-label="Text alignment">
          {(["left", "center", "right"] as TextAlign[]).map(align)}
        </div>
      </div>
    </>
  );
}

export function PropertiesPanel({
  project,
  element,
  selectedIds,
  layerName,
  locked,
  onChangeElement,
  onUpdateElement,
  onChangeProject,
  onDelete,
  onDuplicate,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack
}: PropertiesPanelProps) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiAnchorRef = useRef<HTMLDivElement>(null);

  // Close the popover whenever the panel switches to another object.
  useEffect(() => {
    setEmojiOpen(false);
  }, [element?.id]);

  const selectedCount = selectedIds.length;
  const selectedElements = selectedCount > 0
    ? project.elements.filter((candidate) => selectedIds.includes(candidate.id))
    : [];
  const lockedCount = selectedElements.filter((candidate) => effectiveLocked(project, candidate)).length;

  /* ------------------------------------------------------------ nothing selected */

  if (selectedCount === 0 || !element) {
    if (selectedCount > 1) {
      return (
        <aside className="panel properties">
          <div className="panel-header">
            Properties
            <span className="panel-header-sub">Selection</span>
          </div>
          <div className="panel-body">
            <div className="selection-count">
              <strong>{selectedCount} objects selected</strong>
            </div>
            <p className="hint">
              Drag any one of them to move the whole set. Shift-click (or ⌘/Ctrl-click) adds and
              removes objects.
            </p>
            <div className="button-row">
              <button type="button" onClick={onDuplicate} title="Cmd/Ctrl+D">
                Duplicate
              </button>
              <button type="button" className="danger" onClick={onDelete} title="Delete / Backspace">
                Delete
              </button>
            </div>
            <p className="hint">
              Mixed values are not editable in this pass — select a single object to change its
              size, label or typography.
            </p>
          </div>
        </aside>
      );
    }

    return (
      <aside className="panel properties">
        <div className="panel-header">Properties</div>
        <div className="panel-body">
          <div className="empty-state">Nothing selected</div>
          <label className="field">
            <span className="field-label">Project title</span>
            <input
              type="text"
              value={project.title}
              onChange={(event) => onChangeProject({ title: event.target.value })}
            />
          </label>
          <div className="field-row">
            <NumberField
              label="Canvas width"
              value={project.canvas.width}
              min={MIN_CANVAS_SIZE}
              max={MAX_CANVAS_SIZE}
              step={10}
              onCommit={(value) => onChangeProject({ width: value })}
            />
            <NumberField
              label="Canvas height"
              value={project.canvas.height}
              min={MIN_CANVAS_SIZE}
              max={MAX_CANVAS_SIZE}
              step={10}
              onCommit={(value) => onChangeProject({ height: value })}
            />
          </div>
          <p className="hint">
            Canvas: {Math.round(project.canvas.width)} × {Math.round(project.canvas.height)} ·{" "}
            {project.elements.length} element{project.elements.length === 1 ? "" : "s"} in{" "}
            {project.layers.length} layer{project.layers.length === 1 ? "" : "s"}
          </p>
          <p className="hint">
            Select an element on the canvas — or in the Layers tab — to edit its name, visible label
            and LLM note.
          </p>
        </div>
      </aside>
    );
  }

  /* -------------------------------------------------------------- one element */

  const hasItems =
    element.type === "tabs" ||
    element.type === "list" ||
    element.type === "sidebar" ||
    element.type === "table" ||
    element.type === "bottomNav";
  const showLabel = element.type !== "tabs" && element.type !== "list";
  const isSymbol = element.type === "icon" || element.type === "image";
  const itemsLabel =
    element.type === "table"
      ? "Rows (cells separated by |)"
      : element.type === "bottomNav"
        ? "Items (one per line)"
        : "Items (one per line)";

  return (
    <aside className="panel properties">
      <div className="panel-header">
        Properties
        <span className="panel-header-sub">{ELEMENT_TYPE_LABEL[element.type]}</span>
      </div>
      <div className="panel-body">
        <p className="hint layer-hint">
          Layer: <strong>{layerName ?? "—"}</strong>
          {locked ? <span className="lock-badge">locked</span> : null}
          {selectedCount > 1 ? <span className="lock-badge">{selectedCount} selected</span> : null}
        </p>

        {locked ? (
          <div className="locked-banner">
            Locked — unlock this element (or its layer) in the Layers tab to move, resize or delete it.
          </div>
        ) : null}

        <label className="field">
          <span className="field-label">Name</span>
          <input
            type="text"
            value={element.name}
            placeholder="saveButton"
            onChange={(event) =>
              onChangeElement({ name: event.target.value }, { coalesceKey: "name" })
            }
          />
        </label>

        {showLabel ? (
          <div className="field" ref={emojiAnchorRef}>
            <span className="field-label">Label</span>
            <div className="label-with-picker">
              <input
                type="text"
                value={element.label}
                placeholder={isSymbol ? "🚀 or a short caption" : "Visible text"}
                onChange={(event) =>
                  onChangeElement({ label: event.target.value }, { coalesceKey: "label" })
                }
              />
              {isSymbol ? (
                <button
                  type="button"
                  className="emoji-open"
                  aria-haspopup="dialog"
                  aria-expanded={emojiOpen}
                  title="Choose an emoji"
                  onClick={() => setEmojiOpen((value) => !value)}
                >
                  🙂
                </button>
              ) : null}
            </div>
            {isSymbol && emojiOpen ? (
              <EmojiPicker
                value={element.label}
                anchorRef={emojiAnchorRef}
                onPick={(emoji) => onChangeElement({ label: emoji }, { coalesceKey: null })}
                onClose={() => setEmojiOpen(false)}
              />
            ) : null}
          </div>
        ) : null}

        {isSymbol ? (
          <NumberField
            label="Content size (px)"
            value={contentSizeOf(element)}
            min={MIN_CONTENT_SIZE}
            max={MAX_CONTENT_SIZE}
            step={2}
            onCommit={(value) => onChangeElement({ contentSize: value }, { coalesceKey: "contentSize" })}
          />
        ) : null}

        {hasItems ? (
          <label className="field">
            <span className="field-label">{itemsLabel}</span>
            <textarea
              rows={element.type === "table" ? 5 : 4}
              value={(element.items ?? []).join("\n")}
              onChange={(event) =>
                onChangeElement(
                  { items: event.target.value.split("\n") },
                  { coalesceKey: "items" }
                )
              }
            />
          </label>
        ) : null}

        {element.type === "table" ? (
          <label className="field">
            <span className="field-label">Columns (one per line)</span>
            <textarea
              rows={3}
              value={(element.columns ?? []).join("\n")}
              onChange={(event) =>
                onChangeElement(
                  { columns: event.target.value.split("\n") },
                  { coalesceKey: "columns" }
                )
              }
            />
          </label>
        ) : null}

        <label className="field">
          <span className="field-label">LLM note</span>
          <textarea
            rows={5}
            value={element.note}
            placeholder="What is this element for? How should it behave?"
            onChange={(event) =>
              onChangeElement({ note: event.target.value }, { coalesceKey: "note" })
            }
          />
        </label>

        {element.type === "text" ? (
          <TypographySection element={element} disabled={locked} onUpdateElement={onUpdateElement} />
        ) : null}

        <div className="section-label">Position &amp; size</div>
        <div className="field-row">
          <NumberField
            label="X"
            value={element.x}
            disabled={locked}
            onCommit={(value) => onChangeElement({ x: value }, { coalesceKey: "x" })}
          />
          <NumberField
            label="Y"
            value={element.y}
            disabled={locked}
            onCommit={(value) => onChangeElement({ y: value }, { coalesceKey: "y" })}
          />
        </div>
        <div className="field-row">
          <NumberField
            label="Width"
            value={element.width}
            min={8}
            disabled={locked}
            onCommit={(value) => onChangeElement({ width: value }, { coalesceKey: "width" })}
          />
          <NumberField
            label="Height"
            value={element.height}
            min={8}
            disabled={locked}
            onCommit={(value) => onChangeElement({ height: value }, { coalesceKey: "height" })}
          />
        </div>

        <div className="section-label">Arrange in layer</div>
        <div className="button-row">
          <button type="button" onClick={onBringToFront} title="Move to the front of its layer">
            Bring to front
          </button>
          <button type="button" onClick={onSendToBack} title="Move to the back of its layer">
            Send to back
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={onBringForward}>
            Bring forward
          </button>
          <button type="button" onClick={onSendBackward}>
            Send backward
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={onDuplicate} title="Cmd/Ctrl+D">
            Duplicate
          </button>
          <button
            type="button"
            className="danger"
            onClick={onDelete}
            disabled={locked}
            title={locked ? "Locked elements cannot be deleted" : "Delete / Backspace"}
          >
            Delete
          </button>
        </div>
        <p className="hint">
          Order {element.zIndex + 1} of {countInLayer(project, element)}
          {lockedCount > 0 ? ` · ${lockedCount} locked in the selection` : ""}
        </p>
      </div>
    </aside>
  );
}

function countInLayer(project: WireframeProject, element: WireframeElement): number {
  return project.elements.filter((candidate) => candidate.layerId === element.layerId).length;
}
