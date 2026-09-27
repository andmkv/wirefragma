import { CANVAS_MODES, MAX_CANVAS_SIZE, MIN_CANVAS_SIZE, type CanvasMode, type WireframeProject } from "../model/project";
import { DraftNumberInput } from "./DraftNumberInput";
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
}

const MODE_LABEL: Record<CanvasMode, string> = {
  desktop: "Desktop 1200×800",
  mobile: "Mobile portrait 390×844",
  mobileLandscape: "Mobile landscape 844×390",
  custom: "Custom…"
};

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
  onToggleLayers
}: AppToolbarProps) {
  const isCustom = project.canvas.mode === "custom";

  return (
    <header className="app-toolbar">
      <div className="toolbar-brand">
        <img className="brand-mark" src="./wf_logo_w_white.png" alt="" aria-hidden="true" />
        <span className="brand-name">Wirefragma</span>
        <span className="brand-tag">wireframe → LLM spec</span>
      </div>

      <div className="toolbar-group">
        <label className="field inline">
          <span className="field-label">Canvas</span>
          <select
            value={project.canvas.mode}
            onChange={(event) => onModeChange(event.target.value as CanvasMode)}
          >
            {CANVAS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {MODE_LABEL[mode]}
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
              aria-label="Canvas width"
            />
            <span className="times">×</span>
            <DraftNumberInput
              min={MIN_CANVAS_SIZE}
              max={MAX_CANVAS_SIZE}
              step={10}
              value={project.canvas.height}
              onCommit={(value) => onCanvasSizeChange(project.canvas.width, value)}
              aria-label="Canvas height"
            />
          </div>
        ) : null}

        <button
          type="button"
          className={showGrid ? "toggle-button active" : "toggle-button"}
          onClick={onToggleGrid}
          title="Show or hide the grid"
        >
          Grid
        </button>
        <button
          type="button"
          className={snapToGrid ? "toggle-button active" : "toggle-button"}
          onClick={onToggleSnap}
          title="Snap position and size to the grid"
        >
          Snap
        </button>
        <select
          className="grid-size"
          value={gridSize}
          onChange={(event) => onGridSizeChange(Number(event.target.value))}
          title="Grid size"
        >
          {[4, 8, 16, 20].map((size) => (
            <option key={size} value={size}>
              {size}px
            </option>
          ))}
        </select>

        <div className="zoom-group">
          <button type="button" onClick={onZoomOut} title="Zoom out (Cmd/Ctrl -)" aria-label="Zoom out">
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
            title="Zoom level"
          >
            <option value="fit">Fit ({formatZoom(zoomScale)})</option>
            {ZOOM_PRESETS.map((preset) => (
              <option key={preset} value={String(preset)}>
                {formatZoom(preset)}
              </option>
            ))}
          </select>
          <button type="button" onClick={onZoomIn} title="Zoom in (Cmd/Ctrl +)" aria-label="Zoom in">
            +
          </button>
          <button
            type="button"
            className={zoomMode === "fit" ? "toggle-button active" : "toggle-button"}
            onClick={onZoomFit}
            title="Fit the canvas to the window"
          >
            Fit
          </button>
          <span className="zoom-readout">{formatZoom(zoomScale)}</span>
        </div>
      </div>

      <div className="toolbar-actions">
        <button type="button" onClick={onUndo} disabled={!canUndo} title="Undo (Cmd/Ctrl+Z)">
          Undo
        </button>
        <button type="button" onClick={onRedo} disabled={!canRedo} title="Redo (Cmd/Ctrl+Shift+Z)">
          Redo
        </button>
        <span className="divider" />
        <button type="button" onClick={onNew} title="Start a new blank project">
          New
        </button>
        <button
          type="button"
          className={layersOpen ? "toggle-button active" : "toggle-button"}
          onClick={onToggleLayers}
          title="Show or hide the layers panel"
        >
          Layers
        </button>
        <button type="button" onClick={onImport} title="Import Markdown or JSON">
          Import
        </button>
        <button type="button" onClick={onCopyForLlm} title="Copy the Markdown export for an LLM">
          Copy for LLM
        </button>
        <button type="button" className="primary" onClick={onExport} title="Export Markdown">
          Export
        </button>
      </div>
    </header>
  );
}
