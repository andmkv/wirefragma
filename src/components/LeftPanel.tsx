import type { ReactNode } from "react";
import { CaretIcon } from "./icons";

interface LeftPanelProps {
  addPanel: ReactNode;
  layersPanel: ReactNode;
  layersOpen: boolean;
  onToggleLayers: () => void;
}

/**
 * Left side of the workspace: the element palette and the layer hierarchy are separate,
 * simultaneously visible columns. The layers column can be collapsed to give the canvas
 * more room.
 */
export function LeftPanel({ addPanel, layersPanel, layersOpen, onToggleLayers }: LeftPanelProps) {
  return (
    <>
      <aside className="panel palette">
        <div className="panel-header">Add</div>
        <div className="panel-body">{addPanel}</div>
      </aside>

      <aside className={layersOpen ? "panel layers-column" : "panel layers-column collapsed"}>
        <div className="panel-header">
          Layers
          <button
            type="button"
            className="panel-collapse"
            onClick={onToggleLayers}
            title={layersOpen ? "Collapse the layers panel" : "Show the layers panel"}
            aria-label={layersOpen ? "Collapse the layers panel" : "Show the layers panel"}
          >
            <CaretIcon open={!layersOpen} />
          </button>
        </div>
        {layersOpen ? <div className="panel-body">{layersPanel}</div> : null}
      </aside>
    </>
  );
}
