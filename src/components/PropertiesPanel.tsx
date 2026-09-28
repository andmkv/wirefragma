import { useEffect, useRef, useState, type ReactNode } from "react";
import { createDiagramData } from "../model/diagram";
import { createDrawingData, hasDrawingDescription } from "../model/drawing";
import { useT } from "../i18n";
import {
  MAX_CANVAS_SIZE,
  MAX_CONTENT_SIZE,
  MAX_FONT_SIZE,
  MIN_CANVAS_SIZE,
  MIN_CONTENT_SIZE,
  MIN_FONT_SIZE,
  childrenOf,
  contentSizeOf,
  effectiveLocked,
  mergeTextStyle,
  parentOf,
  textStyleOf,
  type TextAlign,
  type TextStyle,
  type WireframeElement,
  type WireframeProject
} from "../model/project";
import { DraftNumberInput } from "./DraftNumberInput";
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
  /** Move the selected element out of its parent (it stays in front of that parent). */
  onUnnest: () => void;
  /** Rendered at the bottom of the panel in every state (guest language / theme switcher). */
  footer?: ReactNode;
  /** Open the Canvas / Drawing popup for the selected element. */
  onEditScene: () => void;
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
  const t = useT();
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
      title={t(`props.${key}`)}
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
      title={t(value === "left" ? "props.alignLeft" : value === "center" ? "props.alignCenter" : "props.alignRight")}
      onClick={() => patch({ align: value }, "text-align")}
    >
      {t(value === "left" ? "props.alignLeft" : value === "center" ? "props.alignCenter" : "props.alignRight")}
    </button>
  );

  return (
    <>
      <div className="section-label">{t("props.typography")}</div>
      <div className="field">
        <span className="field-label">{t("props.size")}</span>
        <DraftNumberInput
          min={MIN_FONT_SIZE}
          max={MAX_FONT_SIZE}
          value={style.fontSize}
          disabled={disabled}
          aria-label={t("props.fontSize")}
          onCommit={(value) => patch({ fontSize: value }, "text-size")}
        />
      </div>
      <div className="field">
        <span className="field-label">{t("props.style")}</span>
        <div className="toggle-group" role="group" aria-label={t("props.textStyle")}>
          {toggle("bold")}
          {toggle("italic")}
          {toggle("underline")}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t("props.alignment")}</span>
        <div className="toggle-group" role="group" aria-label={t("props.textAlignment")}>
          {(["left", "center", "right"] as TextAlign[]).map(align)}
        </div>
      </div>
    </>
  );
}

/** Canvas / Drawing: open the popup, a one-line summary and the LLM description. */
function SceneSection({
  element,
  locked,
  onEdit,
  onUpdateElement
}: {
  element: WireframeElement;
  locked: boolean;
  onEdit: () => void;
  onUpdateElement: PropertiesPanelProps["onUpdateElement"];
}) {
  const t = useT();
  const drawing = element.type === "drawing";
  const scene = drawing ? element.drawing : element.diagram;
  const description = scene?.description ?? "";
  const summary = drawing
    ? t("scene.drawingSummary", { count: element.drawing?.strokes.length ?? 0, width: scene?.width ?? 0, height: scene?.height ?? 0 })
    : t("scene.diagramSummary", { count: element.diagram?.objects.length ?? 0, width: scene?.width ?? 0, height: scene?.height ?? 0 });

  const describe = (value: string) =>
    onUpdateElement(
      (current) => {
        const text = value === "" ? undefined : value;
        if (current.type === "drawing") return { drawing: { ...(current.drawing ?? createDrawingData()), description: text } };
        return { diagram: { ...(current.diagram ?? createDiagramData()), description: text } };
      },
      { coalesceKey: "sceneDescription" }
    );

  return (
    <div className="scene-section">
      <button type="button" className="primary scene-edit-open" onClick={onEdit} disabled={locked}>
        ✎ {t(drawing ? "scene.editDrawing" : "scene.editCanvas")}
      </button>
      <p className="hint">{summary}</p>
      <label className="field">
        <span className="field-label">{t(drawing ? "scene.description" : "scene.descriptionOptional")}</span>
        <textarea
          rows={3}
          value={description}
          placeholder={t(drawing ? "scene.drawingDescriptionPlaceholder" : "scene.diagramDescriptionPlaceholder")}
          onChange={(event) => describe(event.target.value)}
        />
      </label>
      {drawing && !hasDrawingDescription(element.drawing) ? <p className="scene-warning">⚠ {t("scene.drawingWarning")}</p> : null}
    </div>
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
  onSendToBack,
  onUnnest,
  footer,
  onEditScene
}: PropertiesPanelProps) {
  const t = useT();
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
            {t("panel.properties")}
            <span className="panel-header-sub">{t("props.selection")}</span>
          </div>
          <div className="panel-body">
            <div className="selection-count">
              <strong>{t("props.objectsSelected", { count: selectedCount })}</strong>
            </div>
            <p className="hint">{t("props.multiHint")}</p>
            <div className="button-row">
              <button type="button" onClick={onDuplicate} title="Cmd/Ctrl+D">
                {t("common.duplicate")}
              </button>
              <button type="button" className="danger" onClick={onDelete} title={t("props.deleteTitle")}>
                {t("common.delete")}
              </button>
            </div>
            <p className="hint">{t("props.mixedHint")}</p>
            {footer}
          </div>
        </aside>
      );
    }

    return (
      <aside className="panel properties">
        <div className="panel-header">{t("panel.properties")}</div>
        <div className="panel-body">
          <div className="empty-state">{t("props.nothingSelected")}</div>
          <label className="field">
            <span className="field-label">{t("props.projectTitle")}</span>
            <input
              type="text"
              value={project.title}
              onChange={(event) => onChangeProject({ title: event.target.value })}
            />
          </label>
          <div className="field-row">
            <NumberField
              label={t("props.canvasWidth")}
              value={project.canvas.width}
              min={MIN_CANVAS_SIZE}
              max={MAX_CANVAS_SIZE}
              step={10}
              onCommit={(value) => onChangeProject({ width: value })}
            />
            <NumberField
              label={t("props.canvasHeight")}
              value={project.canvas.height}
              min={MIN_CANVAS_SIZE}
              max={MAX_CANVAS_SIZE}
              step={10}
              onCommit={(value) => onChangeProject({ height: value })}
            />
          </div>
          <p className="hint">
            {t("props.canvasSummary", {
              width: Math.round(project.canvas.width),
              height: Math.round(project.canvas.height),
              count: project.elements.length,
              layers: t("count.layers", { count: project.layers.length })
            })}
          </p>
          <p className="hint">{t("props.selectHint")}</p>
          {footer}
        </div>
      </aside>
    );
  }

  /* -------------------------------------------------------------- one element */

  const parent = parentOf(project, element);

  const hasItems =
    element.type === "tabs" ||
    element.type === "list" ||
    element.type === "sidebar" ||
    element.type === "table" ||
    element.type === "bottomNav";
  const showLabel = element.type !== "tabs" && element.type !== "list" && element.type !== "drawing";
  const isSymbol = element.type === "icon" || element.type === "image";
  const itemsLabel = element.type === "table" ? t("props.rows") : t("props.items");

  return (
    <aside className="panel properties">
      <div className="panel-header">
        {t("panel.properties")}
        <span className="panel-header-sub">{t(`type.${element.type}`)}</span>
      </div>
      <div className="panel-body">
        <p className="hint layer-hint">
          {t("props.layer")} <strong>{layerName ?? "—"}</strong>
          {locked ? <span className="lock-badge">{t("props.locked")}</span> : null}
          {selectedCount > 1 ? <span className="lock-badge">{t("props.selectedBadge", { count: selectedCount })}</span> : null}
        </p>
        {parent ? (
          <p className="hint layer-hint">
            {t("props.inside")} <strong>{parent.name}</strong>
            <button type="button" className="link-button" onClick={onUnnest} title={t("props.moveOutTitle")}>
              {t("props.moveOut")}
            </button>
          </p>
        ) : null}

        {locked ? (
          <div className="locked-banner">{t("props.lockedBanner")}</div>
        ) : null}

        <label className="field">
          <span className="field-label">{t("props.name")}</span>
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
            <span className="field-label">{t("props.label")}</span>
            <div className="label-with-picker">
              <input
                type="text"
                value={element.label}
                placeholder={t(isSymbol ? "props.labelSymbolPlaceholder" : "props.labelPlaceholder")}
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
                  title={t("props.chooseEmoji")}
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

        {element.type === "diagram" || element.type === "drawing" ? (
          <SceneSection element={element} locked={locked} onEdit={onEditScene} onUpdateElement={onUpdateElement} />
        ) : null}

        {isSymbol ? (
          <NumberField
            label={t("props.contentSize")}
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
            <span className="field-label">{t("props.columns")}</span>
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
          <span className="field-label">{t("props.note")}</span>
          <textarea
            rows={5}
            value={element.note}
            placeholder={t("props.notePlaceholder")}
            onChange={(event) =>
              onChangeElement({ note: event.target.value }, { coalesceKey: "note" })
            }
          />
        </label>

        {element.type === "text" ? (
          <TypographySection element={element} disabled={locked} onUpdateElement={onUpdateElement} />
        ) : null}

        <div className="section-label">{t("props.positionSize")}</div>
        <div className="field-row">
          <NumberField
            label={t("props.x")}
            value={element.x}
            disabled={locked}
            onCommit={(value) => onChangeElement({ x: value }, { coalesceKey: "x" })}
          />
          <NumberField
            label={t("props.y")}
            value={element.y}
            disabled={locked}
            onCommit={(value) => onChangeElement({ y: value }, { coalesceKey: "y" })}
          />
        </div>
        <div className="field-row">
          <NumberField
            label={t("props.width")}
            value={element.width}
            min={8}
            disabled={locked}
            onCommit={(value) => onChangeElement({ width: value }, { coalesceKey: "width" })}
          />
          <NumberField
            label={t("props.height")}
            value={element.height}
            min={8}
            disabled={locked}
            onCommit={(value) => onChangeElement({ height: value }, { coalesceKey: "height" })}
          />
        </div>

        <div className="section-label">{t("props.arrange")}</div>
        <div className="button-row">
          <button type="button" onClick={onBringToFront} title={t("props.bringToFrontTitle")}>
            {t("props.bringToFront")}
          </button>
          <button type="button" onClick={onSendToBack} title={t("props.sendToBackTitle")}>
            {t("props.sendToBack")}
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={onBringForward}>
            {t("props.bringForward")}
          </button>
          <button type="button" onClick={onSendBackward}>
            {t("props.sendBackward")}
          </button>
        </div>
        <div className="button-row">
          <button type="button" onClick={onDuplicate} title="Cmd/Ctrl+D">
            {t("common.duplicate")}
          </button>
          <button
            type="button"
            className="danger"
            onClick={onDelete}
            disabled={locked}
            title={t(locked ? "props.deleteLockedTitle" : "props.deleteTitle")}
          >
            {t("common.delete")}
          </button>
        </div>
        <p className="hint">
          {t("props.order", { position: siblingPosition(project, element), total: siblingCount(project, element) })}
          {parent ? ` ${t("props.orderInside", { name: parent.name })}` : ""}
          {lockedCount > 0 ? ` · ${t("props.lockedInSelection", { count: lockedCount })}` : ""}
        </p>
        {footer}
      </div>
    </aside>
  );
}

/** 1-based position among the element's siblings (same layer, same parent), back to front. */
function siblingPosition(project: WireframeProject, element: WireframeElement): number {
  return childrenOf(project, element.layerId, element.parentId ?? null).indexOf(element) + 1;
}

function siblingCount(project: WireframeProject, element: WireframeElement): number {
  return childrenOf(project, element.layerId, element.parentId ?? null).length;
}
