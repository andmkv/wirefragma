import { useEffect, useRef, useState } from "react";
import { CaretIcon, FolderIcon, ImportIcon, PlusIcon, ScreenIcon } from "../components/icons";
import { CollapsedRail, PanelToggle } from "../components/LeftPanel";
import { PanelResizeHandle, usePanelWidth } from "../components/PanelResize";
import { RowMenu } from "../components/RowMenu";
import type { ProjectSummary } from "./api";
import { useT } from "../i18n";

export type SaveState = "saved" | "saving" | "pending" | "offline" | "conflict";

interface ProjectsPanelProps {
  projects: ProjectSummary[];
  currentWireframeId: number | null;
  collapsed: boolean;
  saveState: SaveState;
  onToggleCollapsed: () => void;
  onOpenWireframe: (id: number) => void;
  /** Warm the cache when the pointer rests on a row, so the click switches instantly. */
  onPrefetchWireframe: (id: number) => void;
  onCreateProject: () => void;
  onCreateWireframe: (projectId: number) => void;
  onRenameProject: (id: number, name: string) => void;
  onDeleteProject: (id: number) => void;
  onRenameWireframe: (id: number, title: string) => void;
  onDuplicateWireframe: (id: number) => void;
  onDeleteWireframe: (id: number) => void;
  onImport: () => void;
  /**
   * Panel UI state lives in the workspace: the panel is rendered inside the editor, which is
   * re-keyed per wireframe, so local state here would reset on every switch.
   */
  closedProjects: Set<number>;
  onToggleProject: (id: number) => void;
  renaming: PanelRenaming | null;
  onRenamingChange: (renaming: PanelRenaming | null) => void;
}

export type PanelRenaming = { kind: "project" | "wireframe"; id: number };

/** "3m", "5h", "2d" — compact age like the Codex / Claude Code sidebars. */
export function relativeAge(utc: string, now = Date.now()): string {
  const time = Date.parse(utc.replace(" ", "T") + "Z");
  if (!Number.isFinite(time)) return "";
  const seconds = Math.max(0, Math.round((now - time) / 1000));
  if (seconds < 60) return "now"; // rendered through t("projects.age.now") by the panel
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}

function InlineRename({ value, onCommit, onCancel }: { value: string; onCommit: (value: string) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      className="projects-rename"
      value={draft}
      autoFocus
      maxLength={160}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        if (event.key === "Escape") onCancel();
      }}
    />
  );
}

/**
 * Signed-in sidebar: projects as folders, their wireframes as rows. Collapsible to a thin rail.
 */
export function ProjectsPanel({
  projects,
  currentWireframeId,
  collapsed,
  saveState,
  onToggleCollapsed,
  onOpenWireframe,
  onPrefetchWireframe,
  onCreateProject,
  onCreateWireframe,
  onRenameProject,
  onDeleteProject,
  onRenameWireframe,
  onDuplicateWireframe,
  onDeleteWireframe,
  onImport,
  closedProjects: closed,
  onToggleProject: toggle,
  renaming,
  onRenamingChange: setRenaming
}: ProjectsPanelProps) {
  const t = useT();
  const saveLabel = t(`projects.save.${saveState}`);
  const age = (utc: string) => {
    const value = relativeAge(utc);
    return value === "now" ? t("projects.age.now") : value;
  };
  const [, setTick] = useState(0);
  const size = usePanelWidth("wirefragma.panel.projects", 248, 180, 480);

  // Keep the relative ages fresh.
  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const currentProjectId =
    projects.find((project) => project.wireframes.some((wireframe) => wireframe.id === currentWireframeId))?.id ?? null;

  if (collapsed) {
    return (
      <CollapsedRail label={t("panel.projects")} onExpand={onToggleCollapsed}>
        <button
          type="button"
          className="projects-icon-button"
          onClick={() => currentProjectId !== null && onCreateWireframe(currentProjectId)}
          disabled={currentProjectId === null}
          title={t("projects.newWireframeCurrent")}
          aria-label={t("projects.newWireframe")}
        >
          <PlusIcon />
        </button>
        <button type="button" className="projects-icon-button" onClick={onImport} title={t("projects.importCurrent")} aria-label={t("toolbar.import")}>
          <ImportIcon />
        </button>
        <span className={`projects-save-dot rail-dot ${saveState}`} title={saveLabel} />
      </CollapsedRail>
    );
  }

  return (
    <aside className="projects-panel" aria-label={t("panel.projects")} style={{ width: size.width }}>
      <div className="projects-header">
        <span className="projects-heading">{t("panel.projects")}</span>
        <button type="button" className="projects-icon-button" onClick={onCreateProject} title={t("projects.new")} aria-label={t("projects.new")}>
          <PlusIcon />
        </button>
        <PanelToggle open label={t("panel.projects")} onToggle={onToggleCollapsed} />
      </div>

      <nav className="projects-list">
        {projects.length === 0 ? (
          <div className="projects-empty">
            {t("projects.empty")}
            <button type="button" className="auth-link" onClick={onCreateProject}>
              {t("projects.createOne")}
            </button>
          </div>
        ) : null}

        {projects.map((project) => {
          const open = !closed.has(project.id);
          return (
            <div key={project.id} className={project.id === currentProjectId ? "projects-group current" : "projects-group"}>
              <div
                className="projects-row project"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={() => toggle(project.id)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(project.id);
                  }
                }}
              >
                <span className="projects-caret">
                  <CaretIcon open={open} />
                </span>
                <FolderIcon open={open} className="projects-folder" />
                {renaming?.kind === "project" && renaming.id === project.id ? (
                  <InlineRename
                    value={project.name}
                    onCommit={(name) => {
                      setRenaming(null);
                      onRenameProject(project.id, name);
                    }}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className="projects-name" title={project.name}>
                    {project.name}
                  </span>
                )}
                <span className="projects-row-actions">
                  <button
                    type="button"
                    className="row-icon"
                    title={t("projects.newWireframeIn", { name: project.name })}
                    aria-label={t("projects.newWireframeIn", { name: project.name })}
                    onClick={(event) => {
                      event.stopPropagation();
                      onCreateWireframe(project.id);
                    }}
                  >
                    <PlusIcon />
                  </button>
                  <RowMenu
                    label={t("projects.moreProject", { name: project.name })}
                    items={[
                      { label: t("projects.newWireframe"), onSelect: () => onCreateWireframe(project.id) },
                      { label: t("common.rename"), onSelect: () => setRenaming({ kind: "project", id: project.id }) },
                      { label: t("projects.deleteProject"), danger: true, onSelect: () => onDeleteProject(project.id) }
                    ]}
                  />
                </span>
              </div>

              {open ? (
                <div className="projects-children">
                  {project.wireframes.length === 0 ? <div className="projects-empty small">{t("projects.emptyProject")}</div> : null}
                  {project.wireframes.map((wireframe) => {
                    const active = wireframe.id === currentWireframeId;
                    return (
                      <div
                        key={wireframe.id}
                        className={active ? "projects-row wireframe active" : "projects-row wireframe"}
                        role="button"
                        tabIndex={0}
                        aria-current={active ? "page" : undefined}
                        onClick={() => onOpenWireframe(wireframe.id)}
                        onPointerEnter={() => onPrefetchWireframe(wireframe.id)}
                        onFocus={() => onPrefetchWireframe(wireframe.id)}
                        onDoubleClick={() => setRenaming({ kind: "wireframe", id: wireframe.id })}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onOpenWireframe(wireframe.id);
                          }
                        }}
                      >
                        <ScreenIcon className="projects-screen" />
                        {renaming?.kind === "wireframe" && renaming.id === wireframe.id ? (
                          <InlineRename
                            value={wireframe.title}
                            onCommit={(title) => {
                              setRenaming(null);
                              onRenameWireframe(wireframe.id, title);
                            }}
                            onCancel={() => setRenaming(null)}
                          />
                        ) : (
                          <span className="projects-name" title={wireframe.title}>
                            {wireframe.title}
                          </span>
                        )}
                        <span className="projects-age">{age(wireframe.updatedAt)}</span>
                        <span className="projects-row-actions">
                          <RowMenu
                            label={t("projects.moreWireframe", { name: wireframe.title })}
                            items={[
                              { label: t("common.rename"), onSelect: () => setRenaming({ kind: "wireframe", id: wireframe.id }) },
                              { label: t("common.duplicate"), onSelect: () => onDuplicateWireframe(wireframe.id) },
                              { label: t("projects.deleteWireframe"), danger: true, onSelect: () => onDeleteWireframe(wireframe.id) }
                            ]}
                          />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="projects-footer">
        <button type="button" className="projects-import" onClick={onImport} title={t("projects.importTitle")}>
          <ImportIcon />
          {t("toolbar.import")}
        </button>
        <span className={`projects-save ${saveState}`}>
          <span className={`projects-save-dot ${saveState}`} />
          {saveLabel}
        </span>
      </div>
      <PanelResizeHandle label={t("panel.resize", { panel: t("panel.projects") })} {...size} onResize={size.setWidth} onReset={size.reset} />
    </aside>
  );
}
