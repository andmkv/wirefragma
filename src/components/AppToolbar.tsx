import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CANVAS_MODES,
  MAX_CANVAS_SIZE,
  MIN_CANVAS_SIZE,
  isCanvasMode,
  type CanvasMode,
  type WireframeProject
} from "../model/project";
import { CANVAS_DEVICE_PRESETS, CANVAS_PRESET_GROUPS } from "../model/defaults";
import { DraftNumberInput } from "./DraftNumberInput";
import {
  CopyLlmIcon,
  ExportIcon,
  FitIcon,
  GridIcon,
  ImportFileIcon,
  LayersIcon,
  MagnetIcon,
  NewFileIcon,
  RedoIcon,
  UndoIcon
} from "./icons";
import { useT } from "../i18n";
import { ZOOM_PRESETS, formatZoom, type ZoomMode } from "../utils/zoom";
import type { LayoutMode } from "../utils/layoutMode";

interface AppToolbarProps {
  project: WireframeProject;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  snapToGrid: boolean;
  gridSize: number;
  zoomMode: ZoomMode;
  zoomScale: number;
  layersOpen: boolean;
  onModeChange: (mode: CanvasMode) => void;
  /** Pick a device preset from the catalog (stored as `mode: "custom"` + `preset`). */
  onPresetChange: (presetId: string) => void;
  /** Portrait ↔ landscape for the current size. */
  onFlipCanvas: () => void;
  onCanvasSizeChange: (width: number, height: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onNew: () => void;
  onImport: () => void;
  onExport: () => void;
  onCopyForLlm: () => void;
  onToggleGrid: () => void;
  onToggleSnap: () => void;
  onGridSizeChange: (size: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  onZoomPreset: (scale: number) => void;
  onToggleLayers: () => void;
  /** Active layout breakpoint: desktop keeps today's toolbar, phone collapses it (1.3.5). */
  layout: LayoutMode;
  /** Add / Properties drawers (overlay layouts only). */
  addOpen?: boolean;
  onToggleAdd?: () => void;
  propertiesOpen?: boolean;
  onToggleProperties?: () => void;
  /** Signed-in projects drawer (overlay layouts only). */
  projectsOpen?: boolean;
  onToggleProjects?: () => void;
  /** False when Import lives in the projects panel (signed-in mode). */
  showImport?: boolean;
  /** Tooltip of the New button (signed-in mode creates a wireframe in the current project). */
  newTitle?: string;
  /** Extra controls at the far right (the account menu). */
  accountSlot?: ReactNode;
}

/**
 * The application toolbar.
 *
 * `layout` decides how much of it is visible:
 *
 *  - `desktop` (≥ 1100 px): today's single row with every control, unchanged;
 *  - `tablet` (768–1099 px): the same controls plus Add / Layers / Properties **drawer** buttons;
 *  - `phone` (< 768 px): a compact bar — undo, redo, zoom / fit, Export and a "⋯" menu holding
 *    everything else (New, Import, Copy for LLM, Grid, Snap, grid size, canvas size / preset).
 *    Nothing becomes unreachable, and the drawer buttons stay visible because editing needs them.
 */
export function AppToolbar({
  project,
  canUndo,
  canRedo,
  showGrid,
  snapToGrid,
  gridSize,
  zoomMode,
  zoomScale,
  layersOpen,
  onModeChange,
  onPresetChange,
  onFlipCanvas,
  onCanvasSizeChange,
  onUndo,
  onRedo,
  onNew,
  onImport,
  onExport,
  onCopyForLlm,
  onToggleGrid,
  onToggleSnap,
  onGridSizeChange,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  onZoomPreset,
  onToggleLayers,
  layout,
  addOpen = false,
  onToggleAdd,
  propertiesOpen = false,
  onToggleProperties,
  projectsOpen = false,
  onToggleProjects,
  showImport = true,
  newTitle,
  accountSlot
}: AppToolbarProps) {
  const t = useT();
  const isCustom = project.canvas.mode === "custom";
  const compact = layout === "phone";
  const overlay = layout !== "desktop";
  const showZoomFitButton = layout === "desktop";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!compact) setMenuOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  /* ------------------------------------------------------ reusable controls */

  const canvasSelect = (
    <select
      value={project.canvas.preset ?? project.canvas.mode}
      aria-label={t("toolbar.canvas")}
      onChange={(event) => {
        const value = event.target.value;
        if (isCanvasMode(value)) {
          onModeChange(value);
          return;
        }
        onPresetChange(value);
      }}
    >
      <optgroup label={t("canvas.group.classic")}>
        {CANVAS_MODES.filter((mode) => mode !== "custom").map((mode) => (
          <option key={mode} value={mode}>
            {t(`toolbar.mode.${mode}`)}
          </option>
        ))}
      </optgroup>
      {CANVAS_PRESET_GROUPS.map((group) => (
        <optgroup key={group} label={t(`canvas.group.${group}`)}>
          {CANVAS_DEVICE_PRESETS.filter((preset) => preset.group === group).map((preset) => (
            <option key={preset.id} value={preset.id}>
              {t(`canvas.preset.${preset.id}`)} · {preset.width}×{preset.height}
            </option>
          ))}
        </optgroup>
      ))}
      <option value="custom">{t("toolbar.mode.custom")}</option>
    </select>
  );

  const flipButton = (
    <button
      type="button"
      className="canvas-flip"
      onClick={onFlipCanvas}
      title={t("toolbar.flipCanvas")}
      aria-label={t("toolbar.flipCanvas")}
    >
      ⇄
    </button>
  );

  const sizeInputs = isCustom ? (
    <div className="size-inputs">
      <DraftNumberInput
        min={MIN_CANVAS_SIZE}
        max={MAX_CANVAS_SIZE}
        step={10}
        value={project.canvas.width}
        onCommit={(value) => onCanvasSizeChange(value, project.canvas.height)}
        aria-label={t("toolbar.canvasWidth")}
      />
      <span className="times">×</span>
      <DraftNumberInput
        min={MIN_CANVAS_SIZE}
        max={MAX_CANVAS_SIZE}
        step={10}
        value={project.canvas.height}
        onCommit={(value) => onCanvasSizeChange(project.canvas.width, value)}
        aria-label={t("toolbar.canvasHeight")}
      />
    </div>
  ) : null;

  // Icon buttons: the label lives in the tooltip and the accessible name, so the toolbar stays on
  // one row on laptop screens in every language.
  const iconButton = (
    label: string,
    title: string,
    icon: ReactNode,
    onClick: () => void,
    options: { active?: boolean; disabled?: boolean; className?: string } = {}
  ) => (
    <button
      type="button"
      className={[
        "icon-tool",
        options.active === undefined ? "" : options.active ? "toggle-button active" : "toggle-button",
        options.className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={onClick}
      disabled={options.disabled}
      title={title}
      aria-label={label}
      aria-pressed={options.active}
    >
      {icon}
    </button>
  );

  const gridButtons = (
    <>
      {iconButton(t("toolbar.grid"), t("toolbar.gridTitle"), <GridIcon />, onToggleGrid, { active: showGrid })}
      {iconButton(t("toolbar.snap"), t("toolbar.snapTitle"), <MagnetIcon />, onToggleSnap, { active: snapToGrid })}
      <select
        className="grid-size"
        value={gridSize}
        onChange={(event) => onGridSizeChange(Number(event.target.value))}
        title={t("toolbar.gridSize")}
        aria-label={t("toolbar.gridSize")}
      >
        {[4, 8, 16, 20].map((size) => (
          <option key={size} value={size}>
            {size}px
          </option>
        ))}
      </select>
    </>
  );

  const zoomButtons = (
    <div className="zoom-group">
      <button type="button" className="icon-tool" onClick={onZoomOut} title={t("toolbar.zoomOutTitle")} aria-label={t("toolbar.zoomOut")}>
        −
      </button>
      <select
        className="zoom-select"
        value={zoomMode === "fit" ? "fit" : String(zoomScale)}
        title={t("toolbar.zoomLevel")}
        aria-label={t("toolbar.zoomLevel")}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "fit") onZoomFit();
          else onZoomPreset(Number(value));
        }}
      >
        <option value="fit">{t("toolbar.fitWith", { zoom: formatZoom(zoomScale) })}</option>
        {ZOOM_PRESETS.map((preset) => (
          <option key={preset} value={String(preset)}>
            {formatZoom(preset)}
          </option>
        ))}
      </select>
      <button type="button" className="icon-tool" onClick={onZoomIn} title={t("toolbar.zoomInTitle")} aria-label={t("toolbar.zoomIn")}>
        +
      </button>
      {showZoomFitButton
        ? iconButton(t("toolbar.fit"), t("toolbar.fitTitle"), <FitIcon />, onZoomFit, { active: zoomMode === "fit" })
        : null}
    </div>
  );

  const drawerButton = (label: string, open: boolean, toggle: (() => void) | undefined, key: string) =>
    toggle ? (
      <button
        key={key}
        type="button"
        data-drawer-toggle={key}
        className={open ? "toggle-button active drawer-toggle" : "toggle-button drawer-toggle"}
        onClick={toggle}
        aria-expanded={open}
        title={t(open ? "panel.hide" : "panel.show", { panel: label })}
      >
        {label}
      </button>
    ) : null;

  const exportButton = (
    <button type="button" className="primary export-button" onClick={onExport} title={t("toolbar.exportTitle")}>
      <ExportIcon />
      <span>{t("toolbar.export")}</span>
    </button>
  );

  return (
    <header className={`app-toolbar layout-${layout}`}>
      <div className="toolbar-brand">
        <img className="brand-mark" src="./wf_logo_w_white.png" alt="" aria-hidden="true" />
        <span className="brand-name">Wirefragma</span>
        <span className="brand-tag">{t("toolbar.tagline")}</span>
      </div>

      {!compact ? (
        <div className="toolbar-group">
          <label className="field inline">
            <span className="field-label">{t("toolbar.canvas")}</span>
            {canvasSelect}
          </label>
          {flipButton}
          {sizeInputs}
          <span className="divider" />
          {gridButtons}
          <span className="divider" />
          {zoomButtons}
        </div>
      ) : (
        <div className="toolbar-group" />
      )}

      <div className="toolbar-actions">
        {overlay ? (
          <>
            {drawerButton(t("panel.add"), addOpen, onToggleAdd, "add")}
            {drawerButton(t("panel.layers"), layersOpen, onToggleLayers, "layers")}
            {drawerButton(t("panel.properties"), propertiesOpen, onToggleProperties, "properties")}
            {onToggleProjects ? drawerButton(t("panel.projects"), projectsOpen, onToggleProjects, "projects") : null}
          </>
        ) : null}

        {iconButton(t("toolbar.undo"), t("toolbar.undoTitle"), <UndoIcon />, onUndo, { disabled: !canUndo })}
        {iconButton(t("toolbar.redo"), t("toolbar.redoTitle"), <RedoIcon />, onRedo, { disabled: !canRedo })}

        {compact ? (
          <>
            {zoomButtons}
            {exportButton}
            <div className="toolbar-menu" ref={menuRef}>
              <button
                type="button"
                className={menuOpen ? "toggle-button active" : "toggle-button"}
                aria-haspopup="true"
                aria-expanded={menuOpen}
                title={t("toolbar.more")}
                aria-label={t("toolbar.more")}
                onClick={() => setMenuOpen((value) => !value)}
              >
                ⋯
              </button>
              {menuOpen ? (
                <div className="toolbar-menu-panel" role="menu">
                  <div className="toolbar-menu-section">
                    <span className="toolbar-menu-label">{t("toolbar.canvas")}</span>
                    {canvasSelect}
                    {flipButton}
                  </div>
                  {sizeInputs ? <div className="toolbar-menu-section">{sizeInputs}</div> : null}
                  <div className="toolbar-menu-section">{gridButtons}</div>
                  <div className="toolbar-menu-section">
                    <button type="button" onClick={onNew} title={newTitle ?? t("toolbar.newTitle")}>
                      {t("toolbar.new")}
                    </button>
                    {showImport ? (
                      <button type="button" onClick={onImport} title={t("toolbar.importTitle")}>
                        {t("toolbar.import")}
                      </button>
                    ) : null}
                    <button type="button" onClick={onCopyForLlm} title={t("toolbar.copyForLlmTitle")}>
                      {t("toolbar.copyForLlm")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <span className="divider" />
            {iconButton(t("toolbar.new"), newTitle ?? t("toolbar.newTitle"), <NewFileIcon />, onNew)}
            {overlay
              ? null
              : iconButton(t("toolbar.layers"), t("toolbar.layersTitle"), <LayersIcon />, onToggleLayers, { active: layersOpen })}
            {showImport ? iconButton(t("toolbar.import"), t("toolbar.importTitle"), <ImportFileIcon />, onImport) : null}
            {iconButton(t("toolbar.copyForLlm"), t("toolbar.copyForLlmTitle"), <CopyLlmIcon />, onCopyForLlm)}
            {exportButton}
          </>
        )}
        {accountSlot}
      </div>
    </header>
  );
}
