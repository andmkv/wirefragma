import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BUILD_ID, INPUT_DEBUG_ENABLED, VITE_MODE } from "./buildIdentity";
import { AppToolbar } from "./components/AppToolbar";
import { CanvasEditor } from "./components/CanvasEditor";
import { ChartEditor } from "./components/ChartEditor";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DiagramEditor } from "./components/DiagramEditor";
import { DrawingEditor } from "./components/DrawingEditor";
import { ElementPalette } from "./components/ElementPalette";
import { EditorErrorBoundary } from "./components/ErrorBoundary";
import { ExportDialog } from "./components/ExportDialog";
import { ImportDialog } from "./components/ImportDialog";
import { LayersPanel } from "./components/LayersPanel";
import { LeftPanel } from "./components/LeftPanel";
import { usePanelFlag } from "./components/PanelResize";
import { useT, type TranslationKey, type TranslationParams } from "./i18n";
import { PROPERTIES_NAME_FIELD_ID, PropertiesPanel } from "./components/PropertiesPanel";
import {
  CANVAS_PRESETS,
  ELEMENT_DEFAULTS,
  createBlankProject,
  createElement,
  findCanvasPreset,
  flipCanvas,
} from "./model/defaults";
import { elementsOutsideCanvas } from "./model/canvasSize";
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
  moveElements,
  moveLayer,
  nestElements,
  removeElements,
  reorderElement,
  sendToBack,
  unnestElement,
  updateElement,
  updateLayer,
  withDescendants,
  type CanvasMode,
  type ElementType,
  type WireframeElement,
  type WireframeProject
} from "./model/project";
import { createChartData } from "./model/chart";
import { createDiagramData } from "./model/diagram";
import { createDrawingData } from "./model/drawing";
import { copySelection, pasteClipboard } from "./model/clipboard";
import { clipboardStore } from "./model/clipboardStore";
import {
  EMPTY_SELECTION,
  deletableSelection,
  movableSelection,
  normalizeSelectionState,
  selectableElements,
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
  type CommitOptions,
  type History
} from "./utils/history";
import { projectToLlmMarkdown } from "./utils/markdownExport";
import { projectFromText } from "./utils/markdownImport";
import { loadProject, saveProject } from "./utils/storage";
import { usesOverlayDrawers } from "./utils/layoutMode";
import { useLayoutMode } from "./utils/useMediaQuery";
import { clampZoom, zoomStep, type ZoomMode } from "./utils/zoom";

type Dialog = "none" | "export" | "import";

/** Overlay-layout panel drawers; at most one is open, and the state is never remembered. */
type Drawer = "none" | "add" | "layers" | "properties" | "projects";

/**
 * Signed-in mode: the document comes from (and goes back to) the account workspace instead of
 * the single localStorage slot. Without a host the editor behaves exactly as the guest editor.
 */
export interface EditorHost {
  /** History to open with (restored when switching back to a wireframe keeps its undo stack). */
  initialHistory: History<WireframeProject>;
  /** Every history change, so the host can cache it and autosave `history.present`. */
  onHistoryChange: (history: History<WireframeProject>) => void;
  /** The projects panel, rendered as the first workspace column. */
  sidebar: ReactNode;
  /** Account controls at the right end of the toolbar. */
  accountSlot: ReactNode;
  /** Toolbar "New": create a new wireframe in the current project. */
  onNewWireframe: () => void;
  /** Transient message from the host (saving errors, conflicts) shown in the notice banner. */
  notice?: ReactNode;
}

export default function App({
  host,
  guestSlot,
  preferencesSlot
}: { host?: EditorHost; guestSlot?: ReactNode; preferencesSlot?: ReactNode } = {}) {
  const t = useT();
  // Stable translator for callbacks (toasts), always reading the current language.
  const tRef = useRef(t);
  tRef.current = t;
  const tr = useCallback((key: TranslationKey, params?: TranslationParams) => tRef.current(key, params), []);

  const boot = useMemo(() => {
    if (host) {
      return { project: host.initialHistory.present, error: null, migrated: false, freshStart: false };
    }
    const { project, error, migrated } = loadProject();
    const bootProject = project ?? createBlankProject();
    return { project: bootProject, error, migrated, freshStart: project === null };
    // The host is fixed for the lifetime of this editor (the workspace re-keys it per wireframe).
  }, []);

  const [history, setHistory] = useState(() => host?.initialHistory ?? createHistory<WireframeProject>(boot.project));
  const onHistoryChange = host?.onHistoryChange;
  useEffect(() => {
    onHistoryChange?.(history);
  }, [history, onHistoryChange]);
  const [selection, setSelection] = useState<SelectionState>(EMPTY_SELECTION);
  /**
   * Internal clipboard — core copy/paste never depends on OS clipboard permissions.
   *
   * The payload lives in a module-level store (`model/clipboardStore.ts`) rather than in this
   * component: the signed-in workspace remounts `<App key=…>` per wireframe, so a ref would be
   * lost on every switch. It stays out of React state (nothing in the UI renders from it), and
   * only the cascade counter is per editor — keyed by the payload's token so a fresh copy
   * restarts the cascade exactly like the old per-App ref did.
   */
  const pasteCounterRef = useRef(0);
  const pasteTokenRef = useRef<string | null>(null);
  const [activeLayerId, setActiveLayerId] = useState<string | null>(boot.project.layers[0]?.id ?? null);
  const [dialog, setDialog] = useState<Dialog>("none");
  /** Layer the Export dialog is scoped to (Layers "…" → Export layer), or null for the whole project. */
  const [exportLayerId, setExportLayerId] = useState<string | null>(null);
  const [pendingLayerDelete, setPendingLayerDelete] = useState<string | null>(null);
  /** The Canvas/Drawing element whose scene popup is open (editor state, never serialized). */
  const [sceneEditId, setSceneEditId] = useState<string | null>(null);
  const [pendingNewProject, setPendingNewProject] = useState(false);
  // Remembered per browser, so opening another wireframe (a fresh editor) keeps the layout.
  const [layersOpen, setLayersOpen] = usePanelFlag("wirefragma.panel.layersOpen", true);
  /**
   * Responsive layout (1.2). `desktop` keeps the three-column workspace; `tablet` and `phone`
   * give the canvas the full width and turn Add / Layers / Properties into overlay drawers.
   */
  const layout = useLayoutMode();
  const overlay = usesOverlayDrawers(layout);
  const [drawer, setDrawer] = useState<Drawer>("none");
  const toggleDrawer = useCallback((id: Drawer) => {
    setDrawer((current) => (current === id ? "none" : id));
  }, []);
  const closeDrawer = useCallback(() => setDrawer("none"), []);
  const [zoomMode, setZoomMode] = useState<ZoomMode>("fit");
  const [manualScale, setManualScale] = useState(1);
  const [zoomView, setZoomView] = useState({ scale: 1, fit: 1 });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [gridSize, setGridSize] = useState(8);
  const [notice, setNotice] = useState<string | null>(boot.error);
  const [status, setStatus] = useState<string | null>(() => {
    if (boot.error) return null;
    if (boot.migrated) return tr("toast.migrated");
    if (boot.freshStart) return tr("toast.freshStart");
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

  /**
   * Autosave. When the stored project could not be read (corrupt, or written by a newer build),
   * the blank boot project must not overwrite it: saving starts only after the first real edit,
   * and `saveProject` keeps a one-time backup of the unreadable data.
   */
  const latestProjectRef = useRef(project);
  latestProjectRef.current = project;
  // Signed-in documents are saved by the workspace, never into the guest localStorage slot.
  const autosaveArmedRef = useRef(!boot.error && !host);
  useEffect(() => {
    if (host) return;
    if (!autosaveArmedRef.current) {
      if (project === boot.project) return;
      autosaveArmedRef.current = true;
    }
    const timer = window.setTimeout(() => {
      const error = saveProject(project);
      if (error) setNotice(error);
    }, 350);
    return () => window.clearTimeout(timer);
    // `host` never changes for a mounted editor.
  }, [boot.project, project]);

  // Flush the pending autosave when the tab is hidden or closed (the 350 ms debounce would lose it).
  useEffect(() => {
    const flush = () => {
      if (autosaveArmedRef.current) saveProject(latestProjectRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

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

  // A drawer only exists in the overlay layouts; going back to desktop closes it.
  useEffect(() => {
    if (!overlay) setDrawer("none");
  }, [overlay]);

  // Narrow windows start with the layers panel collapsed so the canvas keeps its room.
  useEffect(() => {
    let wasNarrow = window.innerWidth < 1024;
    if (wasNarrow) setLayersOpen(false);
    // Only crossing the breakpoint collapses the panel, so a panel the user reopened on a narrow
    // screen does not snap shut on every resize (e.g. a mobile URL bar showing/hiding).
    const onResize = () => {
      const narrow = window.innerWidth < 1024;
      if (narrow && !wasNarrow) setLayersOpen(false);
      wasNarrow = narrow;
    };
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
        flash(tr(targetLayer.visible ? "toast.addedToLocked" : "toast.addedToHidden", { layer: targetLayer.name }));
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
          ? tr("toast.deleteLockedOne")
          : tr("toast.deleteLockedAll")
      );
      return;
    }
    if (removable.length < selection.ids.length) {
      flash(
        tr("toast.deletedPartial", { removed: removable.length, total: selection.ids.length })
      );
    }
    // One delete = one undo step, however many objects it covers. Nested children go with
    // their parent, and the remaining elements are re-indexed.
    mutate((current) => removeElements(current, removable), { coalesceKey: null });
    setSelection(EMPTY_SELECTION);
  }, [flash, mutate, project, selection.ids]);

  /** Cmd/Ctrl+D and the Properties Duplicate button: the copies become the selection. */
  const handleDuplicate = useCallback(() => {
    if (selection.ids.length === 0) return;
    const duplicable = deletableSelection(project, selection.ids);
    if (duplicable.length === 0) {
      flash(tr("toast.duplicateLockedAll"));
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
        flash(tr("toast.duplicateLockedOne"));
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
    clipboardStore.set(payload);
    pasteCounterRef.current = 0;
    pasteTokenRef.current = null;
    flash(
      tr("toast.copied", { count: payload.elements.length })
    );
  }, [flash, project, selection.ids]);

  const handlePaste = useCallback(() => {
    const clipboard = clipboardStore.get();
    if (!clipboard || clipboard.elements.length === 0) return;
    // Each paste cascades one step further, so repeated pastes never land on top of each other.
    // A different payload (a new copy, or a copy made in another wireframe/tab) restarts it.
    const pasteIndex = pasteTokenRef.current === clipboard.token ? pasteCounterRef.current + 1 : 1;
    pasteTokenRef.current = clipboard.token;
    pasteCounterRef.current = pasteIndex;
    const result = pasteClipboard(project, clipboard, { pasteIndex, activeLayerId });
    if (result.newIds.length === 0) return;
    mutate(() => result.project, { coalesceKey: null });
    setSelection(selectionOf(result.newIds));
    const layerNames = [
      ...new Set(
        result.newIds
          .map((id) => findElement(result.project, id))
          .map((element) => (element ? findLayer(result.project, element.layerId)?.name : undefined))
          .filter((name): name is string => !!name)
      )
    ];
    flash(
      tr("toast.pasted", {
        count: result.newIds.length,
        layers: layerNames.length > 0 ? layerNames.join(", ") : tr("toast.activeLayer")
      })
    );
  }, [activeLayerId, flash, mutate, project]);

  /**
   * Cmd/Ctrl+X: copy the deletable members of the selection, then delete them. Copying and
   * deleting happen in one pass, so the whole cut is exactly one history step, and locked
   * members are skipped (they stay in the document and outside the payload).
   */
  const handleCut = useCallback(() => {
    if (selection.ids.length === 0) return;
    const removable = deletableSelection(project, selection.ids);
    if (removable.length === 0) {
      flash(selection.ids.length === 1 ? tr("toast.deleteLockedOne") : tr("toast.deleteLockedAll"));
      return;
    }
    const payload = copySelection(project, removable);
    if (!payload) return;
    clipboardStore.set(payload);
    pasteCounterRef.current = 0;
    pasteTokenRef.current = null;
    mutate((current) => removeElements(current, removable), { coalesceKey: null });
    setSelection(EMPTY_SELECTION);
    flash(
      removable.length < selection.ids.length
        ? tr("toast.cutPartial", { copied: payload.elements.length, total: selection.ids.length })
        : tr("toast.cut", { count: payload.elements.length })
    );
  }, [flash, mutate, project, selection.ids]);

  /** Cmd/Ctrl+A: every visible, unlocked element — the same rule the marquee uses. */
  const handleSelectAll = useCallback(() => {
    const ids = selectableElements(project);
    if (ids.length === 0) {
      flash(tr("toast.selectNone"));
      return;
    }
    setSelection(selectionOf(ids));
  }, [flash, project]);

  /** F2: jump to the Name field of the single selected element. */
  const focusNameField = useCallback(() => {
    const input = document.getElementById(PROPERTIES_NAME_FIELD_ID);
    if (!(input instanceof HTMLInputElement)) return;
    input.focus();
    input.select();
  }, []);

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

  const handleMoveElements = useCallback(
    (ids: string[], targetLayerId: string, targetElementId: string | null, placeAbove: boolean) => {
      // One drop = one undo step, however many rows were dragged.
      mutate((current) => moveElements(current, ids, targetLayerId, targetElementId, placeAbove), {
        coalesceKey: null
      });
    },
    [mutate]
  );

  /** Layers panel "drop into": nest an element inside another one (Unity-style). */
  const handleNestElements = useCallback(
    (ids: string[], parentId: string) => {
      mutate((current) => nestElements(current, ids, parentId), { coalesceKey: null });
    },
    [mutate]
  );

  const handleUnnestSelected = useCallback(() => {
    if (!selection.primary) return;
    const id = selection.primary;
    mutate((current) => unnestElement(current, id), { coalesceKey: null });
  }, [mutate, selection.primary]);

  /* -------------------------------------------------------------- layers */

  const handleAddLayer = useCallback(() => {
    const result = addLayer(project);
    mutate(() => result.project, { coalesceKey: null });
    setActiveLayerId(result.layer.id);
    flash(tr("toast.layerCreated", { name: result.layer.name }));
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
      const message = count > 0 ? tr("confirm.deleteLayerWith", { count }) : tr("confirm.deleteLayerEmpty");
      setPendingLayerDelete(layerId);
      flash(`${tr("confirm.deleteLayerTitle", { name: layer.name })} ${message}`);
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
      result.removedElementIds.length
        ? tr("toast.layerDeletedWith", { name: layer.name, count: result.removedElementIds.length })
        : tr("toast.layerDeleted", { name: layer.name })
    );
  }, [activeLayerId, flash, mutate, pendingLayerDelete, project]);

  const pendingDeleteLayer = findLayer(project, pendingLayerDelete);
  const modalOpen = dialog !== "none" || pendingLayerDelete !== null || pendingNewProject || sceneEditId !== null;
  const pendingDeleteCount = pendingLayerDelete
    ? project.elements.filter((element) => element.layerId === pendingLayerDelete).length
    : 0;

  /* ------------------------------------------------------------- project */

  const handleProjectChange = useCallback(
    (patch: { title?: string; width?: number; height?: number }) => {
      mutate(
        (current) => {
          const resizing = patch.width !== undefined || patch.height !== undefined;
          const canvas: WireframeProject["canvas"] = {
            // A manual size is no longer the device preset it started from.
            mode: resizing ? "custom" : current.canvas.mode,
            width:
              patch.width === undefined
                ? current.canvas.width
                : Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, Math.round(patch.width))),
            height:
              patch.height === undefined
                ? current.canvas.height
                : Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, Math.round(patch.height)))
          };
          if (!resizing && current.canvas.preset !== undefined) canvas.preset = current.canvas.preset;
          return { ...current, title: patch.title ?? current.title, canvas };
        },
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
            if (current.canvas.mode === "custom" && current.canvas.preset === undefined) return current;
            // "Custom…" means exactly that: the preset identity is dropped.
            return { ...current, canvas: { mode: "custom", width: current.canvas.width, height: current.canvas.height } };
          }
          return { ...current, canvas: { mode, ...CANVAS_PRESETS[mode] } };
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  /** A device preset: `mode: "custom"` plus the additive `preset` id, one history step. */
  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = findCanvasPreset(presetId);
      if (!preset) return;
      mutate(
        (current) => {
          if (
            current.canvas.preset === preset.id &&
            current.canvas.width === preset.width &&
            current.canvas.height === preset.height
          ) {
            return current;
          }
          return {
            ...current,
            canvas: { mode: "custom", preset: preset.id, width: preset.width, height: preset.height }
          };
        },
        { coalesceKey: null }
      );
    },
    [mutate]
  );

  const handleFlipCanvas = useCallback(() => {
    mutate((current) => ({ ...current, canvas: flipCanvas(current.canvas) }), { coalesceKey: null });
  }, [mutate]);

  /**
   * Canvas edge drag: transient updates while the pointer moves (the gesture opened a history
   * transaction), so the whole drag is ONE undo step. Elements are never moved, scaled or deleted.
   */
  const handleCanvasResize = useCallback(
    (width: number, height: number) => {
      mutate(
        (current) => {
          const next = {
            width: Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, Math.round(width))),
            height: Math.min(MAX_CANVAS_SIZE, Math.max(MIN_CANVAS_SIZE, Math.round(height)))
          };
          if (next.width === current.canvas.width && next.height === current.canvas.height) return current;
          return { ...current, canvas: { mode: "custom", width: next.width, height: next.height } };
        },
        { transient: true }
      );
    },
    [mutate]
  );

  /** Non-blocking report of elements left completely outside the canvas; nothing is deleted. */
  const handleCanvasResizeEnd = useCallback(() => {
    const outside = elementsOutsideCanvas(project.elements, project.canvas.width, project.canvas.height);
    if (outside > 0) flash(tr("toast.canvasShrunk", { count: outside }));
  }, [flash, project]);

  const closeDialog = useCallback(() => setDialog("none"), []);

  /* ------------------------------------------------ Canvas / Drawing popups */

  const openSceneEditor = useCallback((elementId: string) => {
    const element = findElement(project, elementId);
    if (!element || (element.type !== "diagram" && element.type !== "drawing" && element.type !== "chart")) return;
    if (effectiveLocked(project, element)) return;
    setSelection(singleSelection(elementId));
    setSceneEditId(elementId);
  }, [project]);
  const sceneElement = sceneEditId ? findElement(project, sceneEditId) : null;
  /** Done: the whole editing session becomes ONE history step. */
  const commitScene = useCallback(
    (
      elementId: string,
      patch: Pick<WireframeElement, "diagram"> | Pick<WireframeElement, "drawing"> | Pick<WireframeElement, "chart">
    ) => {
      mutate((current) => updateElement(current, elementId, patch), { coalesceKey: null });
      setSceneEditId(null);
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
    // The clipboard deliberately survives New/Import: it is a cross-wireframe clipboard now and
    // behaves like the OS clipboard (replacing a document never empties it). Pasting into a
    // project that has no matching layer falls back to the active layer, so it stays safe.
    setActiveLayerId(next.layers[0]?.id ?? null);
    setDialog("none");
    flash(tr("toast.newProject"));
  }, [flash]);

  const handleNew = useCallback(() => {
    if (host) {
      host.onNewWireframe();
      return;
    }
    if (project.elements.length === 0) {
      startBlankProject();
      return;
    }
    setPendingNewProject(true);
  }, [host, project.elements.length, startBlankProject]);

  const handleImportText = useCallback(
    (text: string, sourceName: string): string | null => {
      try {
        const imported = projectFromText(text);
        setHistory(resetHistory(imported));
        setSelection(EMPTY_SELECTION);
        // See startBlankProject: the cross-wireframe clipboard survives an import.
        setActiveLayerId(imported.layers[0]?.id ?? null);
        flash(
          tr("toast.imported", {
            elements: tr("toast.importedCounts", {
              elements: tr("count.elements", { count: imported.elements.length }),
              layers: tr("count.layers", { count: imported.layers.length })
            }),
            source: sourceName
          })
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
    flash(tr(ok ? "toast.llmCopied" : "toast.copyFailed"));
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
      // A parent always carries its nested children.
      const moving = new Set(withDescendants(project, movable));
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
      // Never steal shortcuts while the user is typing in a field, textarea or contentEditable,
      // and never act on the canvas behind an open modal.
      if (isEditingTextInput(event.target)) return;
      if (modalOpen) return;
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
        // handleDuplicate skips locked members itself (and explains when nothing is left).
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
      if (mod && key.toLowerCase() === "x") {
        // handleCut skips locked members itself and explains when nothing is left.
        if (selectedIds.length === 0) return;
        event.preventDefault();
        handleCut();
        return;
      }
      if (mod && key.toLowerCase() === "a") {
        event.preventDefault();
        handleSelectAll();
        return;
      }
      if (key === "F2") {
        if (selectedIds.length !== 1) return;
        event.preventDefault();
        focusNameField();
        return;
      }
      if (key === "Delete" || key === "Backspace") {
        if (selectedIds.length === 0) return;
        event.preventDefault();
        handleDelete();
        return;
      }
      if (key === "Escape") {
        // An open drawer is the most local thing Escape can dismiss.
        if (drawer !== "none") {
          setDrawer("none");
          return;
        }
        clearSelection();
        return;
      }
      if (key.startsWith("Arrow")) {
        // moveSelected moves the movable members only; locked ones stay put.
        if (selectedIds.length === 0) return;
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
    drawer,
    flash,
    focusNameField,
    gridSize,
    handleCopy,
    handleCut,
    handleDelete,
    handleDuplicate,
    handlePaste,
    handleRedo,
    handleSelectAll,
    handleUndo,
    handleZoomFit,
    handleZoomIn,
    handleZoomOut,
    modalOpen,
    moveSelected,
    selectedIds
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
        layersOpen={overlay ? drawer === "layers" : layersOpen}
        onModeChange={handleModeChange}
        onPresetChange={handlePresetChange}
        onFlipCanvas={handleFlipCanvas}
        onCanvasSizeChange={(width, height) => handleProjectChange({ width, height })}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onNew={handleNew}
        onImport={() => setDialog("import")}
        onExport={() => {
          setExportLayerId(null);
          setDialog("export");
        }}
        onCopyForLlm={() => void handleCopyForLlm()}
        onToggleGrid={() => setShowGrid((value) => !value)}
        onToggleSnap={() => setSnapToGrid((value) => !value)}
        onGridSizeChange={setGridSize}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomFit={handleZoomFit}
        onZoomPreset={applyZoom}
        onToggleLayers={() => (overlay ? toggleDrawer("layers") : setLayersOpen((value) => !value))}
        showImport={!host}
        newTitle={host ? t("toolbar.newWireframeTitle") : undefined}
        accountSlot={host ? host.accountSlot : guestSlot}
        layout={layout}
        addOpen={drawer === "add"}
        onToggleAdd={() => toggleDrawer("add")}
        propertiesOpen={drawer === "properties"}
        onToggleProperties={() => toggleDrawer("properties")}
        projectsOpen={drawer === "projects"}
        onToggleProjects={host && overlay ? () => toggleDrawer("projects") : undefined}
      />

      {host?.notice ? <div className="notice-banner host-notice">{host.notice}</div> : null}

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

      <EditorErrorBoundary project={project}>
      <main
        className={[
          "workspace",
          host ? "with-projects" : "",
          overlay ? "layout-overlay" : "layout-desktop"
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {/*
          Signed-in projects panel: a normal workspace column on desktop, a left drawer in the
          overlay layouts (D1).
        */}
        {host?.sidebar ? (
          overlay ? (
            <div
              className={drawer === "projects" ? "workspace-drawer drawer drawer-left open" : "workspace-drawer drawer drawer-left"}
              data-drawer="projects"
            >
              {host.sidebar}
            </div>
          ) : (
            host.sidebar
          )
        ) : null}
        <LeftPanel
          layersOpen={layersOpen}
          onToggleLayers={() => setLayersOpen((value) => !value)}
          overlay={overlay}
          openDrawer={drawer}
          onCloseDrawer={closeDrawer}
          addPanel={(compact) => (
            <ElementPalette compact={compact} onAdd={handleAdd} activeLayerName={activeLayer?.name ?? "Default"} />
          )}
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
              onExportLayer={(layerId) => {
                setExportLayerId(layerId);
                setDialog("export");
              }}
              onToggleElementVisible={handleToggleElementVisible}
              onToggleElementLocked={handleToggleElementLocked}
              onMoveLayer={handleMoveLayer}
              onMoveElements={handleMoveElements}
              onNestElements={handleNestElements}
            />
          }
        />

        <section className="canvas-column">
          <div className="canvas-status">
            <span>
              {project.title} · {Math.round(project.canvas.width)} × {Math.round(project.canvas.height)}
            </span>
            <span>
              {t("canvas.status", { count: project.elements.length })}
              {selectedIds.length > 1
                ? ` · ${t("canvas.selectedCount", { count: selectedIds.length })}`
                : selectedElement
                  ? ` · ${t("canvas.selectedName", { name: selectedElement.name })}`
                  : ""}
              {activeLayer ? ` · ${t("canvas.layer", { name: activeLayer.name })}` : ""}
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
            onEditScene={openSceneEditor}
            onCanvasResize={handleCanvasResize}
            onCanvasResizeEnd={handleCanvasResizeEnd}
          />
          <div className="canvas-hint">{t("canvas.hint", { grid: gridSize })}</div>
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
          onUnnest={handleUnnestSelected}
          footer={preferencesSlot}
          onEditScene={() => selectedElement && openSceneEditor(selectedElement.id)}
          overlay={overlay}
          open={drawer === "properties"}
          onClose={closeDrawer}
        />
      </main>

      {sceneElement?.type === "diagram" ? (
        <DiagramEditor
          key={sceneElement.id}
          name={sceneElement.label.trim() || sceneElement.name}
          initial={sceneElement.diagram ?? createDiagramData()}
          onDone={(diagram) => commitScene(sceneElement.id, { diagram })}
          onCancel={() => setSceneEditId(null)}
        />
      ) : null}
      {sceneElement?.type === "drawing" ? (
        <DrawingEditor
          key={sceneElement.id}
          name={sceneElement.name}
          initial={sceneElement.drawing ?? createDrawingData()}
          onDone={(drawing) => commitScene(sceneElement.id, { drawing })}
          onCancel={() => setSceneEditId(null)}
        />
      ) : null}
      {sceneElement?.type === "chart" ? (
        <ChartEditor
          key={sceneElement.id}
          name={sceneElement.label.trim() || sceneElement.name}
          initial={sceneElement.chart ?? createChartData()}
          onDone={(chart) => commitScene(sceneElement.id, { chart })}
          onCancel={() => setSceneEditId(null)}
        />
      ) : null}
      {dialog === "export" ? (
        <ExportDialog project={project} layerId={exportLayerId} onClose={closeDialog} />
      ) : null}
      {dialog === "import" ? (
        <ImportDialog onClose={closeDialog} onImport={handleImportText} />
      ) : null}

      {pendingDeleteLayer ? (
        <ConfirmDialog
          title={t("confirm.deleteLayerTitle", { name: pendingDeleteLayer.name })}
          message={
            pendingDeleteCount > 0
              ? t("confirm.deleteLayerWith", { count: pendingDeleteCount })
              : t("confirm.deleteLayerEmpty")
          }
          confirmLabel={t("confirm.deleteLayerButton")}
          onConfirm={confirmDeleteLayer}
          onCancel={() => setPendingLayerDelete(null)}
        />
      ) : null}

      {pendingNewProject ? (
        <ConfirmDialog
          title={t("confirm.newProjectTitle")}
          message={t("confirm.newProjectMessage")}
          confirmLabel={t("confirm.newProjectButton")}
          onConfirm={() => {
            setPendingNewProject(false);
            startBlankProject();
          }}
          onCancel={() => setPendingNewProject(false)}
        />
      ) : null}

      </EditorErrorBoundary>

      {/* The scrim sits under the drawers and closes whatever is open (D1). */}
      {overlay && drawer !== "none" ? (
        <div className="drawer-scrim" onClick={closeDrawer} aria-hidden="true" />
      ) : null}

      {status ? <div className="toast">{status}</div> : null}
    </div>
  );
}
