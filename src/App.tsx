import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUILD_ID, INPUT_DEBUG_ENABLED, VITE_MODE } from "./buildIdentity";
import { AppToolbar } from "./components/AppToolbar";
import { CanvasEditor } from "./components/CanvasEditor";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { ElementPalette } from "./components/ElementPalette";
import { ExportDialog } from "./components/ExportDialog";
import { ImportDialog } from "./components/ImportDialog";
import { LayersPanel } from "./components/LayersPanel";
import { LeftPanel } from "./components/LeftPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import {
  CANVAS_PRESETS,
  ELEMENT_DEFAULTS,
  createBlankProject,
  createElement,
} from "./model/defaults";
import {
  MAX_CANVAS_SIZE,
  MIN_CANVAS_SIZE,
  addElement,
  addLayer,
  bringToFront,
  deleteLayer,
  duplicateElement,
  duplicateElements,
  effectiveLocked,
  effectiveVisible,
  findElement,
  findLayer,
  layerName,
  moveElement,
  moveLayer,
  reorderElement,
  sendToBack,
  updateElement,
  updateLayer,
  type CanvasMode,
  type ElementType,
  type WireframeElement,
  type WireframeProject
} from "./model/project";
import { copySelection, pasteClipboard, type WirefragmaClipboard } from "./model/clipboard";
import {
  EMPTY_SELECTION,
  deletableSelection,
  movableSelection,
  normalizeSelectionState,
  selectionEquals,
  selectionOf,
  singleSelection,
  toggleInSelection,
  type SelectionState
} from "./model/selection";
import type { Rect } from "./canvas/transform";
import { copyText } from "./utils/clipboard";
import { isEditingTextInput } from "./utils/keyboard";
import {
  beginTransaction,
  canRedo,
  canUndo,
  commit,
  createHistory,
  endTransaction,
  redo,
  resetHistory,
  undo,
  type CommitOptions
} from "./utils/history";
import { projectToLlmMarkdown } from "./utils/markdownExport";
import { projectFromJson, projectFromMarkdown } from "./utils/markdownImport";
import { loadProject, saveProject } from "./utils/storage";
import { clampZoom, zoomStep, type ZoomMode } from "./utils/zoom";

type Dialog = "none" | "export" | "import";

export default function App() {
  const boot = useMemo(() => {
    const { project, error, migrated } = loadProject();
    const bootProject = project ?? createBlankProject();
    return { project: bootProject, error, migrated, freshStart: project === null };
  }, []);

  const [history, setHistory] = useState(() => createHistory<WireframeProject>(boot.project));
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  /**
   * Internal clipboard — core copy/paste never depends on OS clipboard permissions, and it is a
   * ref rather than state so Cmd+C and Cmd+V stay correct even when they land in the same task
   * (nothing in the UI renders from the clipboard).
   */
  const clipboardRef = useRef<WirefragmaClipboard | null>(null);
  /** How many times the current clipboard payload has been pasted (drives the cascade). */
  const pasteCounterRef = useRef(0);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(boot.project.layers[0]?.id ?? null);
  const [dialog, setDialog] = useState<Dialog>("none");
  const [pendingLayerDelete, setPendingLayerDelete] = useState<string | null>(null);
  const [pendingNewProject, setPendingNewProject] = useState(false);
  const [layersOpen, setLayersOpen] = useState(true);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [manualScale, setManualScale] = useState(1);
  const [zoomView, setZoomView] = useState({ scale: 1, fit: 1 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(8);
  const [notice, setNotice] = useState<string | null>(boot.error);
  const [status, setStatus] = useState<string | null>(() => {
    if (boot.error) return null;
    if (boot.migrated) return "Loaded your project from the previous UI Sketch version.";
    if (boot.freshStart) return "Blank canvas — pick an element from the palette to start.";
    return null;
  });

  const project = history.present;
  const selectedIds = selection.ids;
  const selectedElement = findElement(project, selection.primary);
  const selectedLocked = selectedElement ? effectiveLocked(project, selectedElement) : false;
  const historyCanUndo = canUndo(history);
  const historyCanRedo = canRedo(history);
  const activeLayer = findLayer(project, activeLayerId) ?? project.layers[0] ?? null;

  const flash = useCallback((message: string) => setStatus(message), []);

  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(null), 3600);
    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const error = saveProject(project);
      if (error) setNotice(error);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [project]);

  // Keep the active layer valid and never keep a hidden element selected.
  useEffect(() => {
    if (!findLayer(project, activeLayerId)) setActiveLayerId(project.layers[0]?.id ?? null);

    setSelection((current) => {
      if (current.ids.length === 0) return current;
      const kept = current.ids.filter((id) => {
        const element = findElement(project, id);
        return !!element && effectiveVisible(project, element);
      });
      return kept.length === current.ids.length ? current : normalizeSelectionState(project, { ids: kept, primary: current.primary });
    });
  }, [activeLayerId, project]);

  // Narrow windows start with the layers panel collapsed so the canvas keeps its room.
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth < 1024) setLayersOpen(false);
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const mutate = useCallback(
    (updater: (current: WireframeProject) => WireframeProject, options: CommitOptions = {}) => {
      setHistory((current) => {
        const next = updater(current.present);
        if (next === current.present) return current;
        return commit(current, next, options);
      });
    },
    []
  );

  const snapValue = useCallback(
    (value: number) => (snapToGrid ? Math.round(value / gridSize) * gridSize : Math.round(value)),
    [gridSize, snapToGrid]
  );

  /* -------------------------------------------------------------- zoom */

  const applyZoom = useCallback((next: number) => {
    setZoomMode("manual");
    setManualScale(clampZoom(next));
  }, []);

  const handleZoomIn = useCallback(() => applyZoom(zoomStep(zoomView.scale, 1)), [applyZoom, zoomView.scale]);
  const handleZoomOut = useCallback(() => applyZoom(zoomStep(zoomView.scale, -1)), [applyZoom, zoomView.scale]);
  const handleZoomFit = useCallback(() => setZoomMode("fit"), []);
  const handleScaleChange = useCallback((scale: number, fit: number) => {
    setZoomView({ scale, fit });
  }, []);

  /* ------------------------------------------------------------ elements */

  const handleAdd = useCallback(
    (type: ElementType) => {
      const targetLayer = findLayer(project, activeLayerId) ?? project.layers[0];
      if (!targetLayer) return;
      const defaults = ELEMENT_DEFAULTS[type];
      const x = snapValue((project.canvas.width - defaults.width) / 2);
      const y = snapValue((project.canvas.height - defaults.height) / 2);
      const element = createElement(type, project, { x, y, layerId: targetLayer.id });
      mutate((current) => addElement(current, element), { coalesceKey: null });
      setSelection(singleSelection(element.id));

      if (!targetLayer.visible || targetLayer.locked) {
        flash(
          `Added to ${targetLayer.visible ? "locked" : "hidden"} layer "${targetLayer.name}" — unlock/show it in the Layers panel to edit.`
        );
      }
    },
    [activeLayerId, flash, mutate, project, snapValue]
  );

  const handleElementChange = useCallback(
    (
      id: string,
      patch: Partial<WireframeElement>,
      options?: { transient?: boolean; coalesceKey?: string | null }
    ) => {
      mutate((current) => updateElement(current, id, patch), {
        transient: options?.transient,
        coalesceKey:
          options?.transient === true
            ? null
            : (options?.coalesceKey ?? `${id}:${Object.keys(patch).join(",")}`)
      });
    },
    [mutate]
  );

  const handleSelectedElementChange = useCallback(
    (
      patch: Partial<WireframeElement>,
      options?: { transient?: boolean; coalesceKey?: string | null }
    ) => {
      if (!selection.primary) return;
      handleElementChange(selection.primary, patch, options);
    },
    [handleElementChange, selection.primary]
  );

  /**
   * Update the selected element from a function of its *current* state.
   *
   * Several controls (the typography toggles) derive their next value from the previous one, and
   * a user can click them faster than React re-renders. Deriving the patch inside the updater —
   * instead of from the element prop — keeps such clicks cumulative instead of last-wins.
   */
  const handleSelectedElementUpdate = useCallback(
    (
      updater: (element: WireframeElement) => Partial<WireframeElement>,
      options?: { transient?: boolean; coalesceKey?: string | null }
    ) => {
      const id = selection.primary;
      if (!id) return;
      mutate(
        (current) => {
          const element = findElement(current, id);
          if (!element) return current;
          const patch = updater(element);
          return Object.keys(patch).length === 0 ? current : updateElement(current, id, patch);
        },
        {
          transient: options?.transient,
          coalesceKey:
            options?.transient === true
              ? null
              : (options?.coalesceKey ?? null)
        }
      );
    },
    [mutate, selection.primary]
  );

  /* ----------------------------------------------------------- selection */

  /** Canvas gestures own the whole selection state (single, toggle, multi, marquee). */
  const handleCanvasSelect = useCallback((next: SelectionState) => {
    setSelection((current) => (selectionEquals(current, next) ? current : next));
  }, []);

  /** Layers rows: plain click selects one, Shift/Cmd click toggles membership. */
  const handleSelectFromLayers = useCallback((id: string, additive: boolean) => {
    setSelection((current) => (additive ? toggleInSelection(current, id) : singleSelection(id)));
  }, []);

  const clearSelection = useCallback(() => setSelection(EMPTY_SELECTION), []);

  /* ----------------------------------------------------- delete / duplicate */

  const handleDelete = useCallback(() => {
    if (selection.ids.length === 0) return;
    const removable = deletableSelection(project, selection.ids);
    if (removable.length === 0) {
      flash(
        selection.ids.length === 1
          ? "That element is locked — unlock it before deleting."
          : "All selected objects are locked — unlock them before deleting."
      );
      return;
    }
    if (removable.length < selection.ids.length) {
      flash(
        `Deleted ${removable.length} of ${selection.ids.length} objects — the locked ones stay.`
      );
    }
    const doomed = new Set(removable);
    // One delete = one undo step, however many objects it covers.
    mutate((current) => ({ ...current, elements: current.elements.filter((element) => !doomed.has(element.id)) }), {
      coalesceKey: null
    });
    setSelection(EMPTY_SELECTION);
  }, [flash, mutate, project, selection.ids]);

  /** Cmd/Ctrl+D and the Properties Duplicate button: the copies become the selection. */
  const handleDuplicate = useCallback(() => {
    if (selection.ids.length === 0) return;
    const duplicable = deletableSelection(project, selection.ids);
    if (duplicable.length === 0) {
      flash("Locked objects cannot be duplicated — unlock them first.");
      return;
    }
    const result = duplicateElements(project, duplicable);
    if (result.newIds.length === 0) return;
    mutate(() => result.project, { coalesceKey: null });
    setSelection(selectionOf(result.newIds));
  }, [flash, mutate, project, selection.ids]);

  /** Layers row action: duplicate a single element in place and select the copy. */
  const handleDuplicateElement = useCallback(
    (id: string) => {
      const element = findElement(project, id);
      if (!element) return;
      if (effectiveLocked(project, element)) {
        flash("That element is locked — unlock it before duplicating.");
        return;
      }
      const result = duplicateElement(project, id);
      if (!result.newId) return;
      mutate(() => result.project, { coalesceKey: null });
      setSelection(singleSelection(result.newId));
    },
    [flash, mutate, project]
  );

  /* ---------------------------------------------------------- clipboard */

  const handleCopy = useCallback(() => {
    const payload = copySelection(project, selection.ids);
    if (!payload) return;
    clipboardRef.current = payload;
    pasteCounterRef.current = 0;
    flash(
      `Copied ${payload.elements.length} object${payload.elements.length === 1 ? "" : "s"} — ⌘/Ctrl+V to paste.`
    );
  }, [flash, project, selection.ids]);

  const handlePaste = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.elements.length === 0) return;
    // Each paste cascades one step further, so repeated pastes never land on top of each other.
    const pasteIndex = pasteCounterRef.current + 1;
    pasteCounterRef.current = pasteIndex;
    const result = pasteClipboard(project, clipboard, { pasteIndex, activeLayerId });
    if (result.newIds.length === 0) return;
    mutate(() => result.project, { coalesceKey: null });
    setSelection(selectionOf(result.newIds));
    flash(
      `Pasted ${result.newIds.length} object${result.newIds.length === 1 ? "" : "s"} into ${
        findLayer(result.project, activeLayerId)?.name ?? "the active layer"
      }.`
    );
  }, [activeLayerId, flash, mutate, project]);

  /* --------------------------------------------------- canvas gesture commits */

  /**
   * A finished drag: every moved element lands in ONE document update, and because the engine
   * opened a transaction at pointerdown the whole gesture is a single undo step.
   */
  const handleMoveMany = useCallback(
    (moves: { elementId: string; x: number; y: number }[]) => {
      if (moves.length === 0) return;
      const byId = new Map(moves.map((move) => [move.elementId, move]));
      mutate(
        (current) => {
          const elements = current.elements.map((element) => {
            const move = byId.get(element.id);
            return move ? { ...element, x: move.x, y: move.y } : element;
          });
          return { ...current, elements };
        },
        { transient: true }
      );
    },
    [mutate]
  );

  const handleResizeElement = useCallback(
    (elementId: string, bounds: Rect) => {
      mutate(
        (current) =>
          updateElement(current, elementId, {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height
          }),
        { transient: true }
      );
    },
    [mutate]
  );

  const handleReorder = useCallback(
    (direction: "forward" | "backward") => {
      if (!selection.primary) return;
      const id = selection.primary;
      mutate((current) => reorderElement(current, id, direction), { coalesceKey: null });
    },
    [mutate, selection.primary]
  );

  const handleBringToFront = useCallback(() => {
    if (!selection.primary) return;
    const id = selection.primary;
    mutate((current) => bringToFront(current, id), { coalesceKey: null });
  }, [mutate, selection.primary]);

  const handleSendToBack = useCallback(() => {
    if (!selection.primary) return;
    const id = selection.primary;
    mutate((current) => sendToBack(current, id), { coalesceKey: null });
  }, [mutate, selection.primary]);

  const handleToggleElementVisible = useCallback(
    (id: string) => {
      mutate(
        (current) => {
          const element = findElement(current, id);
          if (!element) return current;
          return updateElement(current, id, { visible: !element.visible });
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  const handleToggleElementLocked = useCallback(
    (id: string) => {
      mutate(
        (current) => {
          const element = findElement(current, id);
          if (!element) return current;
          return updateElement(current, id, { locked: !element.locked });
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  const handleMoveElement = useCallback(
    (id: string, targetLayerId: string, targetElementId: string | null, placeAbove: boolean) => {
      mutate((current) => moveElement(current, id, targetLayerId, targetElementId, placeAbove), {
        coalesceKey: null
      });
    },
    [mutate]
  );

  /* -------------------------------------------------------------- layers */

  const handleAddLayer = useCallback(() => {
    const result = addLayer(project);
    mutate(() => result.project, { coalesceKey: null });
    setActiveLayerId(result.layer.id);
    flash(`Layer "${result.layer.name}" created — new elements go there.`);
  }, [flash, mutate, project]);

  const handleRenameLayer = useCallback(
    (id: string, name: string) => {
      mutate((current) => updateLayer(current, id, { name }), { coalesceKey: `layer-name:${id}` });
    },
    [mutate]
  );

  const handleToggleLayerVisible = useCallback(
    (id: string) => {
      mutate(
        (current) => {
          const layer = findLayer(current, id);
          if (!layer) return current;
          return updateLayer(current, id, { visible: !layer.visible });
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  const handleToggleLayerLocked = useCallback(
    (id: string) => {
      mutate(
        (current) => {
          const layer = findLayer(current, id);
          if (!layer) return current;
          return updateLayer(current, id, { locked: !layer.locked });
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  const handleMoveLayer = useCallback(
    (id: string, targetId: string, placeAbove: boolean) => {
      mutate((current) => moveLayer(current, id, targetId, placeAbove), { coalesceKey: null });
    },
    [mutate]
  );

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      const layer = findLayer(project, layerId);
      if (!layer) return;
      const count = project.elements.filter((element) => element.layerId === layerId).length;
      const message =
        count > 0
          ? `This will also permanently delete ${count} element${count === 1 ? "" : "s"} in this layer.`
          : "This layer is empty.";
      setPendingLayerDelete(layerId);
      flash(`Delete layer "${layer.name}"? ${message}`);
    },
    [flash, project]
  );

  const confirmDeleteLayer = useCallback(() => {
    const layerId = pendingLayerDelete;
    setPendingLayerDelete(null);
    if (!layerId) return;
    const layer = findLayer(project, layerId);
    if (!layer) return;

    const result = deleteLayer(project, layerId);
    mutate(() => result.project, { coalesceKey: null });
    setSelection((current) => {
      const remaining = current.ids.filter((id) => !result.removedElementIds.includes(id));
      return remaining.length === current.ids.length ? current : selectionOf(remaining, current.primary);
    });
    if (activeLayerId === layerId) {
      const nextLayer = result.project.layers[0];
      setActiveLayerId(nextLayer ? nextLayer.id : null);
    }
    flash(
      `Deleted layer "${layer.name}"${result.removedElementIds.length ? ` and ${result.removedElementIds.length} element(s)` : ""}.`
    );
  }, [activeLayerId, flash, mutate, pendingLayerDelete, project]);

  const pendingDeleteLayer = findLayer(project, pendingLayerDelete);
  const pendingDeleteCount = pendingLayerDelete
    ? project.elements.filter((element) => element.layerId === pendingLayerDelete).length
    : 0;

  /* ------------------------------------------------------------- project */

  const handleProjectChange = useCallback(
    (patch: { title?: string; width?: number; height?: number }) => {
      mutate(
        (current) => ({
          ...current,
          title: patch.title ?? current.title,
          canvas: {
            ...current.canvas,
            mode: patch.width !== undefined || patch.height !== undefined ? "custom" : current.canvas.mode,
            width:
              patch.width === undefined
                ? current.canvas.width
                : Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, Math.round(patch.width))),
            height:
              patch.height === undefined
                ? current.canvas.height
                : Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, Math.round(patch.height)))
          }
        }),
        { coalesceKey: `project:${Object.keys(patch).join(",")}` }
      );
    },
    [mutate]
  );

  const handleModeChange = useCallback(
    (mode: CanvasMode) => {
      mutate(
        (current) => {
          if (mode === "custom") {
            return current.canvas.mode === "custom"
              ? current
              : { ...current, canvas: { ...current.canvas, mode: "custom" } };
          }
          return { ...current, canvas: { mode, ...CANVAS_PRESETS[mode] } };
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  const handleUndo = useCallback(() => setHistory((current) => undo(current)), []);
  const handleRedo = useCallback(() => setHistory((current) => redo(current)), []);

  /** `New` produces exactly the same empty project a first launch shows. */
  const startBlankProject = useCallback(() => {
    const next = createBlankProject();
    setHistory(resetHistory(next));
    setSelection(EMPTY_SELECTION);
    clipboardRef.current = null;
    pasteCounterRef.current = 0;
    setActiveLayerId(next.layers[0]?.id ?? null);
    setDialog("none");
    flash("New blank project created.");
  }, [flash]);

  const handleNew = useCallback(() => {
    if (project.elements.length === 0) {
      startBlankProject();
      return;
    }
    setPendingNewProject(true);
  }, [project.elements.length, startBlankProject]);

  const handleImportText = useCallback(
    (text: string, sourceName: string): string | null => {
      try {
        const imported = text.trim().startsWith("{") ? projectFromJson(text) : projectFromMarkdown(text);
        setHistory(resetHistory(imported));
        setSelection(EMPTY_SELECTION);
        clipboardRef.current = null;
        pasteCounterRef.current = 0;
        setActiveLayerId(imported.layers[0]?.id ?? null);
        flash(
          `Imported ${imported.elements.length} element${imported.elements.length === 1 ? "" : "s"} in ${imported.layers.length} layer${imported.layers.length === 1 ? "" : "s"} from ${sourceName}.`
        );
        return null;
      } catch (error) {
        return (error as Error).message;
      }
    },
    [flash]
  );

  const handleCopyForLlm = useCallback(async () => {
    const ok = await copyText(projectToLlmMarkdown(project));
    flash(ok ? "LLM-ready Markdown copied to the clipboard." : "Copy failed — use Export instead.");
  }, [flash, project]);

  const beginInteraction = useCallback(() => setHistory((current) => beginTransaction(current)), []);
  const endInteraction = useCallback(
    () => setHistory((current) => endTransaction(current, current.present)),
    []
  );

  const moveSelected = useCallback(
    (dx: number, dy: number) => {
      const movable = movableSelection(project, selection.ids);
      if (movable.length === 0) return;
      const moving = new Set(movable);
      mutate(
        (current) => {
          let changed = false;
          const elements = current.elements.map((element) => {
            if (!moving.has(element.id)) return element;
            changed = true;
            return { ...element, x: element.x + dx, y: element.y + dy };
          });
          return changed ? { ...current, elements } : current;
        },
        { coalesceKey: `move:${movable.join(",")}` }
      );
    },
    [mutate, project, selection.ids]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Never steal shortcuts while the user is typing in a field, textarea or contentEditable.
      if (isEditingTextInput(event.target)) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key;

      if (mod && (key === "+" || key === "=")) {
        event.preventDefault();
        handleZoomIn();
        return;
      }
      if (mod && (key === "-" || key === "_")) {
        event.preventDefault();
        handleZoomOut();
        return;
      }
      if (mod && key === "0") {
        event.preventDefault();
        handleZoomFit();
        return;
      }
      if (mod && key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (mod && key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
        return;
      }
      if (mod && key.toLowerCase() === "d") {
        event.preventDefault();
        if (selectedLocked) {
          flash("That element is locked — unlock it before duplicating.");
          return;
        }
        handleDuplicate();
        return;
      }
      if (mod && key.toLowerCase() === "c") {
        // Internal clipboard: no navigator.clipboard permission is required.
        if (selectedIds.length === 0) return;
        event.preventDefault();
        handleCopy();
        return;
      }
      if (mod && key.toLowerCase() === "v") {
        event.preventDefault();
        handlePaste();
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        if (selectedIds.length === 0) return;
        event.preventDefault();
        handleDelete();
        return;
      }
      if (key === "Escape") {
        clearSelection();
        return;
      }
      if (key.startsWith("Arrow")) {
        if (selectedIds.length === 0 || selectedLocked) return;
        const step = event.shiftKey ? Math.max(1, gridSize) : 1;
        const delta: Record<string, [number, number]> = {
          ArrowLeft: [-step, 0],
          ArrowRight: [step, 0],
          ArrowUp: [0, -step],
          ArrowDown: [0, step]
        };
        const move = delta[key];
        if (!move) return;
        event.preventDefault();
        moveSelected(move[0], move[1]);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    clearSelection,
    flash,
    gridSize,
    handleCopy,
    handleDelete,
    handleDuplicate,
    handlePaste,
    handleRedo,
    handleUndo,
    handleZoomFit,
    handleZoomIn,
    handleZoomOut,
    moveSelected,
    selectedIds,
    selectedLocked
  ]);

  return (
    <div className="app">
      <AppToolbar
        project={project}
        canUndo={historyCanUndo}
        canRedo={historyCanRedo}
        showGrid={showGrid}
        snapToGrid={snapToGrid}
        gridSize={gridSize}
        zoomMode={zoomMode}
        zoomScale={zoomView.scale}
        layersOpen={layersOpen}
        onModeChange={handleModeChange}
        onCanvasSizeChange={(width, height) => handleProjectChange({ width, height })}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onNew={handleNew}
        onImport={() => setDialog("import")}
        onExport={() => setDialog("export")}
        onCopyForLlm={() => void handleCopyForLlm()}
        onToggleGrid={() => setShowGrid((value) => !value)}
        onToggleSnap={() => setSnapToGrid((value) => !value)}
        onGridSizeChange={setGridSize}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onZoomPreset={applyZoom}
        onToggleLayers={() => setLayersOpen((value) => !value)}
      />

      {notice ? (
        <div className="notice-banner">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ) : null}

      {/*
        Diagnostics are strictly opt-in: they need the ?inputdebug=1 flag AND a development
        build, so plain `npm run dev` is quiet and production builds can never show the banner
        (the whole block is also dropped from production output by the bundler).
      */}
      {import.meta.env.DEV && INPUT_DEBUG_ENABLED ? (
        <div className="debug-build-strip" data-testid="debug-build-identity">
          <strong>DEBUG BUILD: {BUILD_ID}</strong>
          <span>URL: {window.location.href}</span>
          <span>mode: {VITE_MODE}</span>
          <span>title: {document.title}</span>
          <span>DPR: {window.devicePixelRatio}</span>
          <span>zoom: {zoomMode}</span>
          <span>fit: {Math.round(zoomView.fit * 100)}%</span>
          <span>manual: {Math.round(manualScale * 100)}%</span>
          <span>displayed: {Math.round(zoomView.scale * 100)}%</span>
        </div>
      ) : null}

      <main className={layersOpen ? "workspace" : "workspace layers-collapsed"}>
        <LeftPanel
          layersOpen={layersOpen}
          onToggleLayers={() => setLayersOpen((value) => !value)}
          addPanel={<ElementPalette onAdd={handleAdd} activeLayerName={activeLayer?.name ?? "Default"} />}
          layersPanel={
            <LayersPanel
              project={project}
              activeLayerId={activeLayer?.id ?? null}
              selectedIds={selectedIds}
              onSelectElement={handleSelectFromLayers}
              onDuplicateElement={handleDuplicateElement}
              onActivateLayer={setActiveLayerId}
              onAddLayer={handleAddLayer}
              onRenameLayer={handleRenameLayer}
              onToggleLayerVisible={handleToggleLayerVisible}
              onToggleLayerLocked={handleToggleLayerLocked}
              onDeleteLayer={handleDeleteLayer}
              onToggleElementVisible={handleToggleElementVisible}
              onToggleElementLocked={handleToggleElementLocked}
              onMoveLayer={handleMoveLayer}
              onMoveElement={handleMoveElement}
            />
          }
        />

        <section className="canvas-column">
          <div className="canvas-status">
            <span>
              {project.title} · {Math.round(project.canvas.width)} × {Math.round(project.canvas.height)}
            </span>
            <span>
              {project.elements.length} element{project.elements.length === 1 ? "" : "s"}
              {selectedIds.length > 1
                ? ` · ${selectedIds.length} selected`
                : selectedElement
                  ? ` · selected: ${selectedElement.name}`
                  : ""}
              {activeLayer ? ` · layer: ${activeLayer.name}` : ""}
            </span>
          </div>
          <CanvasEditor
            project={project}
            selection={selection}
            showGrid={showGrid}
            snapToGrid={snapToGrid}
            gridSize={gridSize}
            zoomMode={zoomMode}
            manualScale={manualScale}
            onSelect={handleCanvasSelect}
            onMove={handleMoveMany}
            onResize={handleResizeElement}
            onBeginInteraction={beginInteraction}
            onEndInteraction={endInteraction}
            onScaleChange={handleScaleChange}
            onUserZoom={applyZoom}
          />
          <div className="canvas-hint">
            Click to select · Shift/⌘-click to add · drag empty canvas to marquee · drag any selected object
            to move the set · handles resize · ⌘/Ctrl+C/V copy-paste · ⌘/Ctrl+D duplicate · Del deletes ·
            arrows nudge (Shift = {gridSize}px) · ⌘/Ctrl+Z undo
          </div>
        </section>

        <PropertiesPanel
          project={project}
          element={selectedElement}
          selectedIds={selectedIds}
          layerName={selectedElement ? layerName(project, selectedElement.layerId) : null}
          locked={selectedLocked}
          onChangeElement={handleSelectedElementChange}
          onUpdateElement={handleSelectedElementUpdate}
          onChangeProject={handleProjectChange}
          onDelete={handleDelete}
          onDuplicate={handleDuplicate}
          onBringForward={() => handleReorder("forward")}
          onSendBackward={() => handleReorder("backward")}
          onBringToFront={handleBringToFront}
          onSendToBack={handleSendToBack}
        />
      </main>

      {dialog === "export" ? <ExportDialog project={project} onClose={() => setDialog("none")} /> : null}
      {dialog === "import" ? (
        <ImportDialog onClose={() => setDialog("none")} onImport={handleImportText} />
      ) : null}

      {pendingDeleteLayer ? (
        <ConfirmDialog
          title={`Delete layer "${pendingDeleteLayer.name}"?`}
          message={
            pendingDeleteCount > 0
              ? `This will also permanently delete ${pendingDeleteCount} element${
                  pendingDeleteCount === 1 ? "" : "s"
                } in this layer.`
              : "This layer is empty."
          }
          confirmLabel="Delete Layer"
          onConfirm={confirmDeleteLayer}
          onCancel={() => setPendingLayerDelete(null)}
        />
      ) : null}

      {pendingNewProject ? (
        <ConfirmDialog
          title="Start a new blank project?"
          message="Unsaved work in the current project will be replaced."
          confirmLabel="New Project"
          onConfirm={() => {
            setPendingNewProject(false);
            startBlankProject();
          }}
          onCancel={() => setPendingNewProject(false)}
        />
      ) : null}

      {status ? <div className="toast">{status}</div> : null}
    </div>
  );
}
