import type { ReactNode } from "react";
import { CANVAS_MODES, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, type CanvasMode, type WireframeProject } from "../model/project";
import { DraftNumberInput } from "./DraftNumberInput";
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

  return (
    <header className="app-toolbar">
      <div className="toolbar-brand">
        <img className="brand-mark" src="./wf_logo_w_white.png" alt="" aria-hidden="true" />
        <span className="brand-name">Wirefragma</span>
        <span className="brand-tag">{t("toolbar.tagline")}</span>
      </div>

      <div className="toolbar-group">
        <label className="field inline">
          <span className="field-label">{t("toolbar.canvas")}</span>
          <select
            value={project.canvas.mode}
            onChange={(event) => onModeChange(event.target.value as CanvasMode)}
          >
            {CANVAS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {t(`toolbar.mode.${mode}`)}
              </option>
            ))}
          </select>
        </label>

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

        <button
          type="button"
          className={showGrid ? "toggle-button active" : "toggle-button"}
          onClick={onToggleGrid}
          title={t("toolbar.gridTitle")}
        >
          {t("toolbar.grid")}
        </button>
        <button
          type="button"
          className={snapToGrid ? "toggle-button active" : "toggle-button"}
          onClick={onToggleSnap}
          title={t("toolbar.snapTitle")}
        >
          {t("toolbar.snap")}
        </button>
        <select
          className="grid-size"
          value={gridSize}
          onChange={(event) => onGridSizeChange(Number(event.target.value))}
          title={t("toolbar.gridSize")}
        >
          {[4, 8, 16, 20].map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>

        <div className="zoom-group">
          <button type="button" onClick={onZoomOut} title={t("toolbar.zoomOutTitle")} aria-label={t("toolbar.zoomOut")}>
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
          >
            <option value="fit">{t("toolbar.fitWith", { zoom: formatZoom(zoomScale) })}</option>
            {ZOOM_PRESETS.map((preset) => (
              <option key={preset} value={String(preset)}>
                {formatZoom(preset)}
              </option>
            ))}
          </select>
          <button type="button" onClick={onZoomIn} title={t("toolbar.zoomInTitle")} aria-label={t("toolbar.zoomIn")}>
            +
          </button>
          <button
            type="button"
            className={zoomMode === "fit" ? "toggle-button active" : "toggle-button"}
            onClick={onZoomFit}
            title={t("toolbar.fitTitle")}
          >
            {t("toolbar.fit")}
          </button>
          <span className="zoom-readout">{formatZoom(zoomScale)}</span>
        </div>
      </div>

      <div className="toolbar-actions">
        <button type="button" onClick={onUndo} disabled={!canUndo} title={t("toolbar.undoTitle")}>
          {t("toolbar.undo")}
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title={t("toolbar.redoTitle")}>
          {t("toolbar.redo")}
        </button>
        <span className="divider" />
        <button type="button" onClick={onNew} title={newTitle ?? t("toolbar.newTitle")}>
          {t("toolbar.new")}
        </button>
        <button
          type="button"
          className={layersOpen ? "toggle-button active" : "toggle-button"}
          onClick={onToggleLayers}
          title={t("toolbar.layersTitle")}
        >
          {t("toolbar.layers")}
        </button>
        {showImport ? (
          <button type="button" onClick={onImport} title={t("toolbar.importTitle")}>
            {t("toolbar.import")}
          </button>
        ) : null}
        <button type="button" onClick={onCopyForLlm} title={t("toolbar.copyForLlmTitle")}>
          {t("toolbar.copyForLlm")}
        </button>
        <button type="button" className="primary" onClick={onExport} title={t("toolbar.exportTitle")}>
          {t("toolbar.export")}
        </button>
        {accountSlot}
      </div>
    </header>
  );
}
