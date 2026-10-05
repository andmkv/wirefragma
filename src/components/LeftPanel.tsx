import type { ReactNode } from "react";
import { SidebarIcon } from "./icons";
import { PanelResizeHandle, usePanelFlag, usePanelWidth } from "./PanelResize";
import { useT } from "../i18n";

interface LeftPanelProps {
  /** The Add panel's content; `compact` when the panel is collapsed to its glyph grid. */
  addPanel: (compact: boolean) => ReactNode;
  layersPanel: ReactNode;
  layersOpen: boolean;
  onToggleLayers: () => void;
  /** Overlay layout (tablet / phone): both columns become slide-in drawers instead (1.2). */
  overlay?: boolean;
  /** Which drawer is open; only `add` and `layers` belong to this component. */
  openDrawer?: string;
  onCloseDrawer?: () => void;
}

/** The collapse / expand control shared by every collapsible side panel (Projects, Layers). */
export function PanelToggle({ open, label, onToggle }: { open: boolean; label: string; onToggle: () => void }) {
  const t = useT();
  const text = t(open ? "panel.hide" : "panel.show", { panel: label });
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
 * simultaneously visible columns. Both can be resized from their right edge. The layers column
 * collapses to a rail; the Add column collapses to a narrow two-column grid of glyph buttons
 * (still usable), both remembered per browser.
 */
export function LeftPanel({
  addPanel,
  layersPanel,
  layersOpen,
  onToggleLayers,
  overlay = false,
  openDrawer = "none",
  onCloseDrawer
}: LeftPanelProps) {
  const t = useT();
  const add = usePanelWidth("wirefragma.panel.add", 190, 150, 360);
  const layers = usePanelWidth("wirefragma.panel.layers", 236, 180, 520);
  const [addOpen, setAddOpen] = usePanelFlag("wirefragma.panel.addOpen", true);

  const closeButton = (
    <button type="button" className="drawer-close" onClick={onCloseDrawer} aria-label={t("common.close")} title={t("common.close")}>
      ✕
    </button>
  );

  /**
   * Overlay layout: the canvas owns the full width and both columns slide in over it. The panel
   * widths / collapse flags are ignored here — the drawer CSS decides, and the state is never
   * remembered (an open drawer is deliberately transient).
   */
  if (overlay) {
    return (
      <>
        <aside
          className={openDrawer === "add" ? "panel palette drawer drawer-left open" : "panel palette drawer drawer-left"}
          data-drawer="add"
        >
          <div className="panel-header">
            {t("panel.add")}
            {closeButton}
          </div>
          <div className="panel-body">{addPanel(false)}</div>
        </aside>
        <aside
          className={openDrawer === "layers" ? "panel layers-column drawer drawer-left open" : "panel layers-column drawer drawer-left"}
          data-drawer="layers"
        >
          <div className="panel-header">
            {t("panel.layers")}
            {closeButton}
          </div>
          <div className="panel-body">{layersPanel}</div>
        </aside>
      </>
    );
  }

  return (
    <>
      {addOpen ? (
        <aside className="panel palette resizable" data-drawer="add" style={{ width: add.width }}>
          <div className="panel-header">
            {t("panel.add")}
            <PanelToggle open label={t("panel.add")} onToggle={() => setAddOpen(false)} />
          </div>
          <div className="panel-body">{addPanel(false)}</div>
          <PanelResizeHandle label={t("panel.resize", { panel: t("panel.add") })} {...add} onResize={add.setWidth} onReset={add.reset} />
        </aside>
      ) : (
        <aside className="panel palette palette-compact" data-drawer="add" aria-label={t("panel.add")}>
          <div className="panel-header">
            <PanelToggle open={false} label={t("panel.add")} onToggle={() => setAddOpen(true)} />
          </div>
          <div className="panel-body">{addPanel(true)}</div>
        </aside>
      )}

      {layersOpen ? (
        <aside className="panel layers-column resizable" data-drawer="layers" style={{ width: layers.width }}>
          <div className="panel-header">
            {t("panel.layers")}
            <PanelToggle open label={t("panel.layers")} onToggle={onToggleLayers} />
          </div>
          <div className="panel-body">{layersPanel}</div>
          <PanelResizeHandle label={t("panel.resize", { panel: t("panel.layers") })} {...layers} onResize={layers.setWidth} onReset={layers.reset} />
        </aside>
      ) : (
        <CollapsedRail label={t("panel.layers")} onExpand={onToggleLayers} />
      )}
    </>
  );
}
