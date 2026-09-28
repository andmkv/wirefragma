import type { ReactNode } from "react";
import { CANVAS_MODES, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, type CanvasMode, type WireframeProject } from "../model/project";
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
  /** False when Import lives in the projects panel (signed-in mode). */
  showImport?: boolean;
  /** Tooltip of the New button (signed-in mode creates a wireframe in the current project). */
  newTitle?: string;
  /** Extra controls at the far right (the account menu). */
  accountSlot?: ReactNode;
}


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
  showImport = true,
  newTitle,
  accountSlot
}: AppToolbarProps) {
  const t = useT();
  const isCustom = project.canvas.mode === "custom";

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

  return (
    <header className="app-toolbar">
      <div className="toolbar-brand">
        <img className="brand-mark" src="./wf_logo_w_white.png" alt="" aria-hidden="true" />
        <span className="brand-name">Wirefragma</span>
        <span className="brand-tag">{t("toolbar.tagline")}</span>
      </div>

      <div className="toolbar-group">
        <select
          className="canvas-mode"
          value={project.canvas.mode}
          onChange={(event) => onModeChange(event.target.value as CanvasMode)}
          title={t("toolbar.canvas")}
          aria-label={t("toolbar.canvas")}
        >
          {CANVAS_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`toolbar.mode.${mode}`)}
            </option>
          ))}
        </select>

        {isCustom ? (
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
        ) : null}

        <span className="divider" />
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

        <span className="divider" />
        <div className="zoom-group">
          <button type="button" className="icon-tool" onClick={onZoomOut} title={t("toolbar.zoomOutTitle")} aria-label={t("toolbar.zoomOut")}>
            −
          </button>
          <select
            className="zoom-select"
            value={zoomMode === "fit" ? "fit" : String(zoomScale)}
            onChange={(event) => {
              const value = event.target.value;
              if (value === "fit") onZoomFit();
              else onZoomPreset(Number(value));
            }}
            title={t("toolbar.zoomLevel")}
            aria-label={t("toolbar.zoomLevel")}
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
          {iconButton(t("toolbar.fit"), t("toolbar.fitTitle"), <FitIcon />, onZoomFit, { active: zoomMode === "fit" })}
        </div>
      </div>

      <div className="toolbar-actions">
        {iconButton(t("toolbar.undo"), t("toolbar.undoTitle"), <UndoIcon />, onUndo, { disabled: !canUndo })}
        {iconButton(t("toolbar.redo"), t("toolbar.redoTitle"), <RedoIcon />, onRedo, { disabled: !canRedo })}
        <span className="divider" />
        {iconButton(t("toolbar.new"), newTitle ?? t("toolbar.newTitle"), <NewFileIcon />, onNew)}
        {iconButton(t("toolbar.layers"), t("toolbar.layersTitle"), <LayersIcon />, onToggleLayers, { active: layersOpen })}
        {showImport ? iconButton(t("toolbar.import"), t("toolbar.importTitle"), <ImportFileIcon />, onImport) : null}
        {iconButton(t("toolbar.copyForLlm"), t("toolbar.copyForLlmTitle"), <CopyLlmIcon />, onCopyForLlm)}
        <button type="button" className="primary export-button" onClick={onExport} title={t("toolbar.exportTitle")}>
          <ExportIcon />
          <span>{t("toolbar.export")}</span>
        </button>
        {accountSlot}
      </div>
    </header>
  );
}
