import { useState, type DragEvent } from "react";
import {
  childrenOf,
  effectiveLocked,
  effectiveVisible,
  elementsOfLayer,
  findLayer,
  isInSubtree,
  type WireframeElement,
  type WireframeProject
} from "../model/project";
import { CaretIcon, DuplicateIcon, EyeIcon, LockIcon, TrashIcon } from "./icons";
import { EmojiTextField } from "./EmojiTextField";
import { RowMenu } from "./RowMenu";
import { useT } from "../i18n";

type DragPayload = { kind: "layer" | "element"; id: string; ids: string[] };
type DropPosition = "above" | "below" | "into";
type DropTarget = { kind: "layer" | "element"; id: string; position: DropPosition };

export interface LayersPanelProps {
  project: WireframeProject;
  activeLayerId: string | null;
  /** Every selected element id; rows highlight when they are in the set. */
  selectedIds: string[];
  /** `additive` is true for Shift / Cmd / Ctrl row clicks (toggle membership). */
  onSelectElement: (id: string, additive: boolean) => void;
  /** Duplicate one element in place (same layer, offset, copy becomes selected). */
  onDuplicateElement: (id: string) => void;
  onActivateLayer: (id: string) => void;
  onAddLayer: () => void;
  onRenameLayer: (id: string, name: string) => void;
  onToggleLayerVisible: (id: string) => void;
  onToggleLayerLocked: (id: string) => void;
  onToggleElementVisible: (id: string) => void;
  onToggleElementLocked: (id: string) => void;
  onDeleteLayer: (id: string) => void;
  /** Open the Export dialog scoped to this layer's elements only. */
  onExportLayer: (id: string) => void;
  onMoveLayer: (id: string, targetId: string, placeAbove: boolean) => void;
  /**
   * Drop next to an element row / onto a layer. `ids` is the dragged row, or the whole selection
   * when the dragged row is part of a multi-selection.
   */
  onMoveElements: (ids: string[], targetLayerId: string, targetElementId: string | null, placeAbove: boolean) => void;
  /** Drop "into" an element row: nest the dragged element(s) inside that element. */
  onNestElements: (ids: string[], parentId: string) => void;
}

function verticalSplit(event: DragEvent, element: HTMLElement): DropPosition {
  const rect = element.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  return ratio < 0.5 ? "above" : "below";
}

/** Element rows: top quarter = in front of, bottom quarter = behind, middle = nest inside. */
function elementDropSplit(event: DragEvent, element: HTMLElement): DropPosition {
  const rect = element.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  if (ratio < 0.28) return "above";
  if (ratio > 0.72) return "below";
  return "into";
}

/** Indentation per nesting level in the element tree, in CSS px. */
const TREE_INDENT_PX = 12;

export function LayersPanel({
  project,
  activeLayerId,
  selectedIds,
  onSelectElement,
  onDuplicateElement,
  onActivateLayer,
  onAddLayer,
  onRenameLayer,
  onToggleLayerVisible,
  onToggleLayerLocked,
  onToggleElementVisible,
  onToggleElementLocked,
  onDeleteLayer,
  onExportLayer,
  onMoveLayer,
  onMoveElements,
  onNestElements
}: LayersPanelProps) {
  const t = useT();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const toggleCollapsed = (layerId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  };

  const startRename = (layerId: string, name: string) => {
    setRenamingId(layerId);
    setDraftName(name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const name = draftName.trim();
    if (name) onRenameLayer(renamingId, name);
    setRenamingId(null);
  };

  const clearDrag = () => {
    setDrag(null);
    setDropTarget(null);
  };

  const dropOnLayer = (event: DragEvent, layerId: string, position: DropPosition) => {
    event.preventDefault();
    event.stopPropagation();
    if (!drag) return clearDrag();

    if (drag.kind === "layer") {
      if (position !== "into" && drag.id !== layerId) onMoveLayer(drag.id, layerId, position === "above");
    } else {
      // Dropping an element on a layer row puts it on top of that layer.
      onMoveElements(drag.ids, layerId, null, true);
    }
    clearDrag();
  };

  const dropOnElement = (event: DragEvent, target: WireframeElement) => {
    event.preventDefault();
    event.stopPropagation();
    const position = dropTarget?.kind === "element" && dropTarget.id === target.id ? dropTarget.position : "into";
    if (!drag) return clearDrag();

    if (drag.kind === "element") {
      // Dropping onto (or next to) something inside a dragged element's own subtree is a no-op.
      if (!drag.ids.some((id) => isInSubtree(project, target.id, id))) {
        if (position === "into") onNestElements(drag.ids, target.id);
        else onMoveElements(drag.ids, target.layerId, target.id, position !== "below");
      }
    } else {
      onMoveLayer(drag.id, target.layerId, position !== "below");
    }
    clearDrag();
  };

  /** One level of the element tree (front-most first), each row followed by its open subtree. */
  const renderTree = (layerId: string, parentId: string | null, depth: number): JSX.Element[] =>
    childrenOf(project, layerId, parentId, { frontFirst: true }).map((element) => {
      const children = childrenOf(project, layerId, element.id);
      const hasChildren = children.length > 0;
      const isOpen = !collapsed.has(element.id);
      return (
        <div key={element.id} className="element-node">
          {renderElementRow(element, depth, hasChildren, isOpen)}
          {hasChildren && isOpen ? renderTree(layerId, element.id, depth + 1) : null}
        </div>
      );
    });

  const renderElementRow = (element: WireframeElement, depth: number, hasChildren: boolean, isOpen: boolean) => {
    const isSelected = selectedIds.includes(element.id);
    const hidden = !effectiveVisible(project, element);
    const locked = effectiveLocked(project, element);
    const inheritedLock = locked && !element.locked;
    const elementDrop =
      dropTarget?.kind === "element" && dropTarget.id === element.id ? dropTarget.position : null;

    return (
      <div
        className={[
          "element-row",
          isSelected ? "selected" : "",
          hidden ? "hidden-row" : "",
          elementDrop ? `drop-${elementDrop}` : ""
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: 3 + depth * TREE_INDENT_PX }}
        role="treeitem"
        aria-selected={isSelected}
        aria-level={depth + 1}
        aria-expanded={hasChildren ? isOpen : undefined}
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onActivateLayer(element.layerId);
            onSelectElement(element.id, event.shiftKey || event.metaKey || event.ctrlKey);
          } else if (hasChildren && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
            event.preventDefault();
            event.stopPropagation();
            if ((event.key === "ArrowRight") !== isOpen) toggleCollapsed(element.id);
          }
        }}
        draggable
        title={`${element.name} · ${t(`type.${element.type}`)}${
          element.label ? ` · "${element.label}"` : ""
        }`}
        onDragStart={(event) => {
          event.stopPropagation();
          // Dragging a row of a multi-selection drags the whole selection.
          const ids = selectedIds.length > 1 && selectedIds.includes(element.id) ? selectedIds : [element.id];
          setDrag({ kind: "element", id: element.id, ids });
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", element.id);
        }}
        onDragEnd={clearDrag}
        onDragOver={(event) => {
          if (!drag) return;
          event.preventDefault();
          event.stopPropagation();
          const position =
            drag.kind === "element" ? elementDropSplit(event, event.currentTarget) : verticalSplit(event, event.currentTarget);
          setDropTarget({ kind: "element", id: element.id, position });
        }}
        onDrop={(event) => dropOnElement(event, element)}
        onClick={(event) => {
          onActivateLayer(element.layerId);
          onSelectElement(element.id, event.shiftKey || event.metaKey || event.ctrlKey);
        }}
      >
        {hasChildren ? (
          <button
            type="button"
            className="tree-toggle element-toggle"
            onClick={(event) => {
              event.stopPropagation();
              toggleCollapsed(element.id);
            }}
            aria-label={t(isOpen ? "layers.element.collapse" : "layers.element.expand", { name: element.name })}
          >
            <CaretIcon open={isOpen} />
          </button>
        ) : (
          <span className="tree-spacer" aria-hidden="true" />
        )}
        <span className="element-name">{element.name}</span>
        <button
          type="button"
          className={element.visible ? "row-icon" : "row-icon off"}
          title={t(element.visible ? "layers.element.hide" : "layers.element.show")}
          onClick={(event) => {
            event.stopPropagation();
            onToggleElementVisible(element.id);
          }}
        >
          <EyeIcon off={!element.visible} />
        </button>
        <button
          type="button"
          className={inheritedLock ? "row-icon on inherited" : element.locked ? "row-icon on" : "row-icon"}
          title={
            inheritedLock
              ? element.parentId
                ? t("layers.element.lockedByParent")
                : t("layers.element.lockedByLayer", { name: findLayer(project, element.layerId)?.name ?? "" })
              : element.locked
                ? t("layers.element.unlock")
                : t("layers.element.lock")
          }
          onClick={(event) => {
            event.stopPropagation();
            onToggleElementLocked(element.id);
          }}
        >
          <LockIcon locked={locked} />
        </button>
        <button
          type="button"
          className="row-icon"
          title={t("layers.element.duplicate", { name: element.name })}
          aria-label={t("layers.element.duplicate", { name: element.name })}
          onClick={(event) => {
            event.stopPropagation();
            onDuplicateElement(element.id);
          }}
        >
          <DuplicateIcon />
        </button>
      </div>
    );
  };

  return (
    <div className="layers-panel">
      <div className="layers-toolbar">
        <button type="button" className="layer-add" onClick={onAddLayer}>
          {t("layers.add")}
        </button>
        <span className="layers-count">{t("layers.count", { count: project.layers.length })}</span>
      </div>

      <div className="layer-list">
        {project.layers.map((layer) => {
          const isActive = layer.id === activeLayerId;
          const isOpen = !collapsed.has(layer.id);
          const elements = elementsOfLayer(project, layer.id, { frontFirst: true });
          const layerDrop = dropTarget?.kind === "layer" && dropTarget.id === layer.id ? dropTarget.position : null;

          return (
            <div key={layer.id} className={isActive ? "layer-group active-layer" : "layer-group"}>
              <div
                className={[
                  "layer-row",
                  layerDrop ? `drop-${layerDrop}` : "",
                  drag?.kind === "element" && layerDrop === "into" ? "drop-into" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                draggable={renamingId !== layer.id}
                onDragStart={(event) => {
                  setDrag({ kind: "layer", id: layer.id, ids: [] });
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", layer.id);
                }}
                onDragEnd={clearDrag}
                onDragOver={(event) => {
                  if (!drag) return;
                  event.preventDefault();
                  const position: DropPosition =
                    drag.kind === "element" ? "into" : verticalSplit(event, event.currentTarget);
                  setDropTarget({ kind: "layer", id: layer.id, position });
                }}
                onDrop={(event) => {
                  const position: DropPosition =
                    drag?.kind === "element" ? "into" : verticalSplit(event, event.currentTarget);
                  dropOnLayer(event, layer.id, position);
                }}
              >
                <button
                  type="button"
                  className="tree-toggle"
                  onClick={() => toggleCollapsed(layer.id)}
                  aria-label={t(isOpen ? "layers.collapse" : "layers.expand")}
                >
                  <CaretIcon open={isOpen} />
                </button>

                {renamingId === layer.id ? (
                  <EmojiTextField
                    className="layer-rename"
                    value={draftName}
                    autoFocus
                    ariaLabel={t("common.rename")}
                    onChange={setDraftName}
                    onBlur={commitRename}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitRename();
                      if (event.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    className="layer-name"
                    title={t("layers.nameTitle", { name: layer.name })}
                    onClick={() => onActivateLayer(layer.id)}
                    onDoubleClick={() => startRename(layer.id, layer.name)}
                  >
                    {layer.name}
                  </button>
                )}

                <span className="row-count">{elements.length}</span>
                <button
                  type="button"
                  className={layer.visible ? "row-icon" : "row-icon off"}
                  title={t(layer.visible ? "layers.hide" : "layers.show")}
                  onClick={() => onToggleLayerVisible(layer.id)}
                >
                  <EyeIcon off={!layer.visible} />
                </button>
                <button
                  type="button"
                  className={layer.locked ? "row-icon on" : "row-icon"}
                  title={t(layer.locked ? "layers.unlock" : "layers.lock")}
                  onClick={() => onToggleLayerLocked(layer.id)}
                >
                  <LockIcon locked={layer.locked} />
                </button>
                <button
                  type="button"
                  className="row-icon danger-icon"
                  title={t("layers.delete", { name: layer.name })}
                  onClick={() => onDeleteLayer(layer.id)}
                >
                  <TrashIcon />
                </button>
                <RowMenu
                  label={t("layers.moreActions", { name: layer.name })}
                  items={[
                    { label: t("layers.menu.export"), onSelect: () => onExportLayer(layer.id) },
                    { label: t("layers.menu.rename"), onSelect: () => startRename(layer.id, layer.name) },
                    { label: t("layers.menu.delete"), danger: true, onSelect: () => onDeleteLayer(layer.id) }
                  ]}
                />
              </div>

              {isOpen ? (
                <div
                  className={
                    drag?.kind === "element" && layerDrop === "into" ? "element-rows drop-into" : "element-rows"
                  }
                  onDragOver={(event) => {
                    if (drag?.kind !== "element") return;
                    event.preventDefault();
                    setDropTarget({ kind: "layer", id: layer.id, position: "into" });
                  }}
                  onDrop={(event) => dropOnLayer(event, layer.id, "into")}
                >
                  {elements.length === 0 ? (
                    <div className="layer-empty">{t("layers.empty")}</div>
                  ) : (
                    renderTree(layer.id, null, 0)
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="palette-hint">{t("layers.hint")}</p>
    </div>
  );
}
