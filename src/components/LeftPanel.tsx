import type { ReactNode } from "react";
import { SidebarIcon } from "./icons";
import { PanelResizeHandle, usePanelWidth } from "./PanelResize";

interface LeftPanelProps {
  addPanel: ReactNode;
  layersPanel: ReactNode;
  layersOpen: boolean;
  onToggleLayers: () => void;
}

/** The collapse / expand control shared by every collapsible side panel (Projects, Layers). */
export function PanelToggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  const text = open ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`;
  return (
    <button type="button" className="panel-toggle" onClick={onToggle} title={text} aria-label={text} aria-expanded={open}>
      <SidebarIcon />
    </button>
  );
}

/** What a collapsed side panel turns into: a narrow rail with the toggle and a vertical title. */
export function CollapsedRail({ label, onExpand, children }: { label: string; onExpand: () => void; children?: ReactNode }) {
  return (
    <aside className="panel panel-rail" aria-label={label}>
      <PanelToggle open={false} label={label} onToggle={onExpand} />
      <button type="button" className="panel-rail-label" onClick={onExpand} tabIndex={-1}>
        {label}
      </button>
      {children}
    </aside>
  );
}

/**
 * Left side of the workspace: the element palette and the layer hierarchy are separate,
 * simultaneously visible columns. Both can be resized from their right edge; the layers column
 * can also collapse to a rail.
 */
export function LeftPanel({ addPanel, layersPanel, layersOpen, onToggleLayers }: LeftPanelProps) {
  const add = usePanelWidth("wirefragma.panel.add", 190, 150, 360);
  const layers = usePanelWidth("wirefragma.panel.layers", 236, 180, 520);

  return (
    <>
      <aside className="panel palette resizable" style={{ width: add.width }}>
        <div className="panel-header">Add</div>
        <div className="panel-body">{addPanel}</div>
        <PanelResizeHandle label="Resize the Add panel" {...add} onResize={add.setWidth} onReset={add.reset} />
      </aside>

      {layersOpen ? (
        <aside className="panel layers-column resizable" style={{ width: layers.width }}>
          <div className="panel-header">
            Layers
            <PanelToggle open label="Layers" onToggle={onToggleLayers} />
          </div>
          <div className="panel-body">{layersPanel}</div>
          <PanelResizeHandle label="Resize the Layers panel" {...layers} onResize={layers.setWidth} onReset={layers.reset} />
        </aside>
      ) : (
        <CollapsedRail label="Layers" onExpand={onToggleLayers} />
      )}
    </>
  );
}
