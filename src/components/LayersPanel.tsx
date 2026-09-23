import { useState, type DragEvent } from "react";
import {
  ELEMENT_TYPE_LABEL,
  effectiveLocked,
  effectiveVisible,
  elementsOfLayer,
  findLayer,
  type WireframeElement,
  type WireframeProject
} from "../model/project";
import { CaretIcon, DuplicateIcon, EyeIcon, LockIcon, TrashIcon } from "./icons";

type DragPayload = { kind: "layer" | "element"; id: string };
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
  onMoveLayer: (id: string, targetId: string, placeAbove: boolean) => void;
  onMoveElement: (
    id: string,
    targetLayerId: string,
    targetElementId: string | null,
    placeAbove: boolean
  ) => void;
}

function verticalSplit(event: DragEvent, element: HTMLElement): DropPosition {
  const rect = element.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / Math.max(1, rect.height);
  return ratio < 0.5 ? "above" : "below";
}

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
  onMoveLayer,
  onMoveElement
}: LayersPanelProps) {
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
      onMoveElement(drag.id, layerId, null, true);
    }
    clearDrag();
  };

  const dropOnElement = (event: DragEvent, target: WireframeElement) => {
    event.preventDefault();
    event.stopPropagation();
    const position = dropTarget?.kind === "element" && dropTarget.id === target.id ? dropTarget.position : "into";
    if (!drag) return clearDrag();

    if (drag.kind === "element") {
      if (drag.id !== target.id) onMoveElement(drag.id, target.layerId, target.id, position !== "below");
    } else {
      onMoveLayer(drag.id, target.layerId, position !== "below");
    }
    clearDrag();
  };

  return (
    <div className="layers-panel">
      <div className="layers-toolbar">
        <button type="button" className="layer-add" onClick={onAddLayer}>
          + Layer
        </button>
        <span className="layers-count">
          {project.layers.length} layer{project.layers.length === 1 ? "" : "s"}
        </span>
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
                  setDrag({ kind: "layer", id: layer.id });
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
                  aria-label={isOpen ? "Collapse layer" : "Expand layer"}
                >
                  <CaretIcon open={isOpen} />
                </button>

                {renamingId === layer.id ? (
                  <input
                    className="layer-rename"
                    value={draftName}
                    autoFocus
                    onChange={(event) => setDraftName(event.target.value)}
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
                    title={`${layer.name} — click to make active, double-click to rename, drag to reorder`}
                    onClick={() => onActivateLayer(layer.id)}
                    onDoubleClick={() => {
                      setRenamingId(layer.id);
                      setDraftName(layer.name);
                    }}
                  >
                    {layer.name}
                  </button>
                )}

                <span className="row-count">{elements.length}</span>
                <button
                  type="button"
                  className={layer.visible ? "row-icon" : "row-icon off"}
                  title={layer.visible ? "Hide layer" : "Show layer"}
                  onClick={() => onToggleLayerVisible(layer.id)}
                >
                  <EyeIcon off={!layer.visible} />
                </button>
                <button
                  type="button"
                  className={layer.locked ? "row-icon on" : "row-icon"}
                  title={layer.locked ? "Unlock layer" : "Lock layer"}
                  onClick={() => onToggleLayerLocked(layer.id)}
                >
                  <LockIcon locked={layer.locked} />
                </button>
                <button
                  type="button"
                  className="row-icon danger-icon"
                  title={`Delete layer "${layer.name}"`}
                  onClick={() => onDeleteLayer(layer.id)}
                >
                  <TrashIcon />
                </button>
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
                    <div className="layer-empty">Drop elements here</div>
                  ) : (
                    elements.map((element) => {
                      const isSelected = selectedIds.includes(element.id);
                      const hidden = !effectiveVisible(project, element);
                      const locked = effectiveLocked(project, element);
                      const inheritedLock = locked && !element.locked;
                      const elementDrop =
                        dropTarget?.kind === "element" && dropTarget.id === element.id
                          ? dropTarget.position
                          : null;

                      return (
                        <div
                          key={element.id}
                          className={[
                            "element-row",
                            isSelected ? "selected" : "",
                            hidden ? "hidden-row" : "",
                            elementDrop ? `drop-${elementDrop}` : ""
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          draggable
                          title={`${element.name} · ${ELEMENT_TYPE_LABEL[element.type]}${
                            element.label ? ` · "${element.label}"` : ""
                          }`}
                          onDragStart={(event) => {
                            setDrag({ kind: "element", id: element.id });
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", element.id);
                          }}
                          onDragEnd={clearDrag}
                          onDragOver={(event) => {
                            if (!drag) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setDropTarget({
                              kind: "element",
                              id: element.id,
                              position: verticalSplit(event, event.currentTarget)
                            });
                          }}
                          onDrop={(event) => dropOnElement(event, element)}
                          onClick={(event) => {
                            onActivateLayer(layer.id);
                            onSelectElement(
                              element.id,
                              event.shiftKey || event.metaKey || event.ctrlKey
                            );
                          }}
                        >
                          <span className="element-name">{element.name}</span>
                          <button
                            type="button"
                            className={element.visible ? "row-icon" : "row-icon off"}
                            title={element.visible ? "Hide element" : "Show element"}
                            onClick={(event) => {
                              event.stopPropagation();
                              onToggleElementVisible(element.id);
                            }}
                          >
                            <EyeIcon off={!element.visible} />
                          </button>
                          <button
                            type="button"
                            className={
                              inheritedLock ? "row-icon on inherited" : element.locked ? "row-icon on" : "row-icon"
                            }
                            title={
                              inheritedLock
                                ? `Locked by layer "${findLayer(project, element.layerId)?.name ?? ""}"`
                                : element.locked
                                  ? "Unlock element"
                                  : "Lock element"
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
                            title={`Duplicate ${element.name} in this layer`}
                            aria-label={`Duplicate ${element.name}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onDuplicateElement(element.id);
                            }}
                          >
                            <DuplicateIcon />
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <p className="palette-hint">
        Top of the list is drawn in front. Drag rows to reorder them, or drop an element on another
        layer to move it. Double-click a layer name to rename it.
      </p>
    </div>
  );
}
