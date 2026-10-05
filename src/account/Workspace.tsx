import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import App from "../App";
import { EditorErrorBoundary } from "../components/ErrorBoundary";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ImportDialog, type ImportDestination } from "../components/ImportDialog";
import { RowMenu } from "../components/RowMenu";
import { normalizeProject, type WireframeProject } from "../model/project";
import { createHistory, type History } from "../utils/history";
import { projectFromText } from "../utils/markdownImport";
import { ApiError, api, type AccountUser, type ProjectSummary, type WireframeRecord } from "./api";
import { ProjectsPanel, type PanelRenaming, type SaveState } from "./ProjectsPanel";
import { SettingsDialog } from "./SettingsDialog";
import { errorMessage } from "./errors";
import { usePreferences, type TranslationKey, type TranslationParams } from "../i18n";

interface CacheEntry {
  projectId: number;
  history: History<WireframeProject>;
  /** Server revision the current local copy is based on. */
  revision: number;
  /** JSON of the last document the server confirmed — dirty check without a deep compare. */
  savedJson: string;
}

interface WorkspaceProps {
  user: AccountUser;
  onSignedOut: (message?: string) => void;
}

/** Autosave debounce after the last edit. */
const SAVE_DELAY_MS = 700;
/** Retry delay after a network failure. */
const RETRY_DELAY_MS = 5000;

const COLLAPSED_KEY = "wirefragma.projectsCollapsed";
const lastOpenedKey = (userId: number) => `wirefragma.lastWireframe.${userId}`;

function readLocal(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* per-browser convenience only */
  }
}

function toEntry(record: WireframeRecord): CacheEntry {
  const project = normalizeProject(record.data);
  // The panel title is the source of truth for the document title.
  const document = project.title === record.title ? project : { ...project, title: record.title };
  return {
    projectId: record.projectId,
    history: createHistory(document),
    revision: record.revision,
    savedJson: JSON.stringify(document)
  };
}

function initials(user: AccountUser): string {
  const source = user.displayName.trim() || user.email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/**
 * Signed-in mode: the projects panel plus the editor for the open wireframe.
 *
 * Every opened wireframe keeps its whole undo history in an in-memory cache, so switching back
 * and forth is instant and loses nothing; rows are prefetched on hover. Edits autosave after a
 * short pause with optimistic concurrency (a revision number per wireframe).
 */
export function Workspace({ user: initialUser, onSignedOut }: WorkspaceProps) {
  const { t, applyPreferences } = usePreferences();
  const tRef = useRef(t);
  tRef.current = t;
  const tr = useCallback((key: TranslationKey, params?: TranslationParams) => tRef.current(key, params), []);
  const [user, setUser] = useState(initialUser);

  // Preferences stored with the account win over this browser's guest choice.
  useEffect(() => {
    const settings = initialUser.settings ?? {};
    applyPreferences({
      locale: settings.language as never,
      theme: settings.theme as never
    });
  }, [applyPreferences, initialUser.settings]);

  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [currentId, setCurrentId] = useState<number | null>(null);
  /** Bumped to remount the editor when its document is replaced from outside. */
  const [epoch, setEpoch] = useState(0);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(() => readLocal(COLLAPSED_KEY) === "1");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState<ReactNode>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; message: string; label: string; run: () => void } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const cache = useRef(new Map<number, CacheEntry>());
  const loading = useRef(new Map<number, Promise<CacheEntry>>());
  const saveTimer = useRef<number | null>(null);
  const savingId = useRef<number | null>(null);
  const resaveAfter = useRef(false);
  const currentIdRef = useRef<number | null>(null);
  currentIdRef.current = currentId;

  /* ------------------------------------------------------------- errors */

  const handleFatal = useCallback(
    (error: unknown): boolean => {
      if (error instanceof ApiError && error.status === 401) {
        onSignedOut(tr("projects.sessionEnded"));
        return true;
      }
      return false;
    },
    [onSignedOut]
  );

  const report = useCallback(
    (error: unknown) => {
      if (handleFatal(error)) return;
      setNotice(errorMessage(tr, error));
    },
    [handleFatal, tr]
  );

  /* ------------------------------------------------------------- loading */

  const load = useCallback((id: number): Promise<CacheEntry> => {
    const cached = cache.current.get(id);
    if (cached) return Promise.resolve(cached);
    const pending = loading.current.get(id);
    if (pending) return pending;
    const promise = api
      .wireframe(id)
      .then(({ wireframe }) => {
        const entry = toEntry(wireframe);
        cache.current.set(id, entry);
        return entry;
      })
      .finally(() => loading.current.delete(id));
    loading.current.set(id, promise);
    return promise;
  }, []);

  const prefetch = useCallback(
    (id: number) => {
      if (!cache.current.has(id)) load(id).catch(() => undefined);
    },
    [load]
  );

  /* -------------------------------------------------------------- saving */

  const isDirty = (entry: CacheEntry) => JSON.stringify(entry.history.present) !== entry.savedJson;

  const applySaved = useCallback((id: number, revision: number, title: string) => {
    setProjects((current) =>
      current
        ? current.map((project) => ({
            ...project,
            wireframes: project.wireframes.map((wireframe) =>
              wireframe.id === id ? { ...wireframe, revision, title, updatedAt: new Date().toISOString().slice(0, 19).replace("T", " ") } : wireframe
            )
          }))
        : current
    );
  }, []);

  const saveNow = useCallback(
    async (id: number, options: { force?: boolean } = {}): Promise<void> => {
      const entry = cache.current.get(id);
      if (!entry || (!options.force && !isDirty(entry))) {
        if (id === currentIdRef.current && savingId.current === null) setSaveState("saved");
        return;
      }
      if (savingId.current !== null) {
        resaveAfter.current = true;
        return;
      }
      savingId.current = id;
      if (id === currentIdRef.current) setSaveState("saving");
      const document = entry.history.present;
      const json = JSON.stringify(document);
      try {
        const result = await api.saveWireframe(id, document, entry.revision, { force: options.force });
        entry.revision = result.revision;
        entry.savedJson = json;
        applySaved(id, result.revision, result.title);
        if (id === currentIdRef.current) setSaveState(isDirty(entry) ? "pending" : "saved");
      } catch (error) {
        if (handleFatal(error)) return;
        if (error instanceof ApiError && error.code === "conflict") {
          setSaveState("conflict");
          const current = error.payload.current as WireframeRecord | undefined;
          setNotice(
            <span className="conflict-notice">
              {tr("error.conflict")}
              <button type="button" onClick={() => void resolveConflict(id, "mine")}>
                {tr("projects.conflictKeep")}
              </button>
              <button type="button" onClick={() => void resolveConflict(id, "theirs", current)}>
                {tr("projects.conflictLoad")}
              </button>
            </span>
          );
        } else if (error instanceof ApiError && (error.status === 0 || error.status >= 500 || error.status === 429)) {
          setSaveState("offline");
          window.setTimeout(() => void saveNow(id), RETRY_DELAY_MS);
        } else {
          setSaveState("pending");
          setNotice(errorMessage(tRef.current, error));
        }
      } finally {
        savingId.current = null;
        if (resaveAfter.current) {
          resaveAfter.current = false;
          const next = currentIdRef.current;
          if (next !== null) void saveNow(next);
        }
      }
    },
    // resolveConflict (declared below) is only reached from the notice buttons at click time.
    [applySaved, handleFatal]
  );

  const resolveConflict = async (id: number, choice: "mine" | "theirs", theirs?: WireframeRecord) => {
    setNotice(null);
    if (choice === "mine") {
      await saveNow(id, { force: true });
      return;
    }
    const record = theirs ?? (await api.wireframe(id)).wireframe;
    cache.current.set(id, toEntry(record));
    setSaveState("saved");
    if (id === currentIdRef.current) setEpoch((value) => value + 1);
  };

  const scheduleSave = useCallback(
    (id: number) => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void saveNow(id);
      }, SAVE_DELAY_MS);
    },
    [saveNow]
  );

  const flush = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const id = currentIdRef.current;
    if (id !== null) await saveNow(id);
  }, [saveNow]);

  const onHistoryChange = useCallback(
    (history: History<WireframeProject>) => {
      const id = currentIdRef.current;
      if (id === null) return;
      const entry = cache.current.get(id);
      if (!entry || entry.history === history) return;
      entry.history = history;
      // Mid-gesture states are not worth a round trip; the gesture's commit will schedule one.
      if (history.meta.base !== null) return;
      if (isDirty(entry)) {
        setSaveState((state) => (state === "conflict" ? state : "pending"));
        scheduleSave(id);
      }
    },
    [scheduleSave]
  );

  // Closing the tab: send what is pending with keepalive so the request outlives the page.
  useEffect(() => {
    const onPageHide = () => {
      const id = currentIdRef.current;
      const entry = id !== null ? cache.current.get(id) : undefined;
      if (id === null || !entry || !isDirty(entry)) return;
      void api.saveWireframe(id, entry.history.present, entry.revision, { keepalive: true }).catch(() => undefined);
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  /* -------------------------------------------------------------- opening */

  const open = useCallback(
    async (id: number) => {
      if (id === currentIdRef.current) return;
      setOpeningId(id);
      void flush();
      try {
        await load(id);
        setCurrentId(id);
        setSaveState("saved");
        writeLocal(lastOpenedKey(user.id), String(id));
      } catch (error) {
        report(error);
      } finally {
        setOpeningId((value) => (value === id ? null : value));
      }
    },
    [flush, load, report, user.id]
  );

  // First load: the tree, then the last opened (or first) wireframe.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let { projects: list } = await api.projects();
        if (list.length === 0) {
          list = (await api.createProject(tr("projects.firstName"), tr("projects.screenName", { n: 1 }))).projects;
        }
        if (cancelled) return;
        setProjects(list);
        const all = list.flatMap((project) => project.wireframes.map((wireframe) => wireframe.id));
        const remembered = Number(readLocal(lastOpenedKey(user.id)));
        const first = all.includes(remembered) ? remembered : all[0];
        if (first !== undefined) {
          await load(first);
          if (cancelled) return;
          setCurrentId(first);
        }
      } catch (error) {
        if (!cancelled && !handleFatal(error)) setLoadError((error as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [handleFatal, load, user.id]);

  /* ---------------------------------------------------- project actions */

  const [closedProjects, setClosedProjects] = useState<Set<number>>(() => new Set());
  const [renaming, setRenaming] = useState<PanelRenaming | null>(null);
  const toggleProject = useCallback(
    (id: number) =>
      setClosedProjects((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );

  const currentProjectId = useMemo(() => {
    if (currentId === null) return projects?.[0]?.id ?? null;
    return cache.current.get(currentId)?.projectId ?? projects?.[0]?.id ?? null;
  }, [currentId, projects]);

  const createWireframe = useCallback(
    async (projectId: number, data?: WireframeProject) => {
      try {
        const project = projects?.find((candidate) => candidate.id === projectId);
        const title = data?.title?.trim() || tr("projects.screenName", { n: (project?.wireframes.length ?? 0) + 1 });
        const result = await api.createWireframe(projectId, title, data ? { ...data, title } : undefined);
        setProjects(result.projects);
        await open(result.wireframeId);
      } catch (error) {
        report(error);
      }
    },
    [open, projects, report]
  );

  const createProject = useCallback(async () => {
    try {
      const name = tr("projects.newName", { n: (projects?.length ?? 0) + 1 });
      const result = await api.createProject(name, tr("projects.screenName", { n: 1 }));
      setProjects(result.projects);
      if (result.wireframeId) await open(result.wireframeId);
      setRenaming({ kind: "project", id: result.projectId });
    } catch (error) {
      report(error);
    }
  }, [open, projects, report]);

  /** After a delete, open a neighbour (or nothing). */
  const openFallback = useCallback(
    async (list: ProjectSummary[], preferProjectId: number | null) => {
      const preferred = list.find((project) => project.id === preferProjectId)?.wireframes[0];
      const any = list.flatMap((project) => project.wireframes)[0];
      const next = preferred ?? any;
      currentIdRef.current = null;
      setCurrentId(null);
      if (next) await open(next.id);
    },
    [open]
  );

  const deleteWireframe = useCallback(
    (id: number) => {
      const title = projects?.flatMap((project) => project.wireframes).find((wireframe) => wireframe.id === id)?.title ?? "this wireframe";
      setConfirm({
        title: tr("projects.confirmDeleteWireframe", { name: title }),
        message: tr("projects.confirmDeleteWireframeMessage"),
        label: tr("projects.deleteWireframe"),
        run: async () => {
          try {
            const projectId = cache.current.get(id)?.projectId ?? null;
            const result = await api.deleteWireframe(id);
            cache.current.delete(id);
            setProjects(result.projects);
            if (id === currentIdRef.current) await openFallback(result.projects, projectId);
          } catch (error) {
            report(error);
          }
        }
      });
    },
    [openFallback, projects, report]
  );

  const deleteProject = useCallback(
    (id: number) => {
      const project = projects?.find((candidate) => candidate.id === id);
      if (!project) return;
      const count = project.wireframes.length;
      setConfirm({
        title: tr("projects.confirmDeleteProject", { name: project.name }),
        message: tr("projects.confirmDeleteProjectMessage", { count }),
        label: tr("projects.deleteProject"),
        run: async () => {
          try {
            const result = await api.deleteProject(id);
            const containedCurrent = project.wireframes.some((wireframe) => wireframe.id === currentIdRef.current);
            for (const wireframe of project.wireframes) cache.current.delete(wireframe.id);
            setProjects(result.projects);
            if (containedCurrent) await openFallback(result.projects, null);
          } catch (error) {
            report(error);
          }
        }
      });
    },
    [openFallback, projects, report]
  );

  const renameProject = useCallback(
    async (id: number, name: string) => {
      try {
        setProjects((await api.renameProject(id, name)).projects);
      } catch (error) {
        report(error);
      }
    },
    [report]
  );

  const renameWireframe = useCallback(
    async (id: number, title: string) => {
      try {
        const isCurrent = id === currentIdRef.current;
        if (isCurrent) await flush();
        const result = await api.renameWireframe(id, title);
        setProjects(result.projects);
        const entry = cache.current.get(id);
        if (entry) {
          if (isCurrent) {
            // Keep the undo stack; only the present document gets the new title.
            const present = { ...entry.history.present, title };
            entry.history = { ...entry.history, present };
            entry.savedJson = JSON.stringify(present);
            entry.revision = result.revision;
            setEpoch((value) => value + 1);
          } else {
            cache.current.delete(id);
          }
        }
      } catch (error) {
        report(error);
      }
    },
    [flush, report]
  );

  const duplicateWireframe = useCallback(
    async (id: number) => {
      try {
        if (id === currentIdRef.current) await flush();
        const result = await api.duplicateWireframe(id);
        setProjects(result.projects);
        await open(result.wireframeId);
      } catch (error) {
        report(error);
      }
    },
    [flush, open, report]
  );

  /* ------------------------------------------------------------- import */

  const handleImport = useCallback(
    (text: string, _sourceName: string, destination?: ImportDestination): string | null => {
      let imported: WireframeProject;
      try {
        imported = projectFromText(text);
      } catch (error) {
        return (error as Error).message;
      }
      const target = destination?.projectId ?? currentProjectId ?? projects?.[0]?.id ?? null;
      const titled = { ...imported, title: destination?.title || imported.title };
      if (target === null) {
        void (async () => {
          try {
            const created = await api.createProject(tr("projects.firstName"));
            setProjects(created.projects);
            await createWireframe(created.projectId, titled);
          } catch (error) {
            report(error);
          }
        })();
      } else {
        void createWireframe(target, titled);
      }
      return null;
    },
    [createWireframe, currentProjectId, projects, report]
  );

  /* ------------------------------------------------------------ account */

  const signOut = useCallback(async () => {
    await flush().catch(() => undefined);
    try {
      await api.logout();
    } catch {
      /* the session is gone either way */
    }
    onSignedOut();
  }, [flush, onSignedOut]);

  const accountSlot = (
    <span className="account-slot">
      <span className="divider" />
      <RowMenu
        label={t("account.menu", { email: user.email })}
        className="account-button"
        icon={<span className="account-avatar">{initials(user)}</span>}
        items={[
          { label: user.email, disabled: true, onSelect: () => undefined },
          { label: t("account.settings"), onSelect: () => setSettingsOpen(true) },
          { label: t("account.signOut"), onSelect: () => void signOut() }
        ]}
      />
    </span>
  );

  const toggleCollapsed = () =>
    setCollapsed((value) => {
      writeLocal(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });

  const panel = (
    <ProjectsPanel
      projects={projects ?? []}
      currentWireframeId={openingId ?? currentId}
      collapsed={collapsed}
      saveState={saveState}
      closedProjects={closedProjects}
      onToggleProject={toggleProject}
      renaming={renaming}
      onRenamingChange={setRenaming}
      onToggleCollapsed={toggleCollapsed}
      onOpenWireframe={(id) => void open(id)}
      onPrefetchWireframe={prefetch}
      onCreateProject={() => void createProject()}
      onCreateWireframe={(projectId) => void createWireframe(projectId)}
      onRenameProject={(id, name) => void renameProject(id, name)}
      onDeleteProject={deleteProject}
      onRenameWireframe={(id, title) => void renameWireframe(id, title)}
      onDuplicateWireframe={(id) => void duplicateWireframe(id)}
      onDeleteWireframe={deleteWireframe}
      onImport={() => setImportOpen(true)}
    />
  );

  const entry = currentId !== null ? cache.current.get(currentId) : undefined;

  const dialogs = (
    <>
      {importOpen ? (
        <ImportDialog
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
          target="project"
          projects={(projects ?? []).map((project) => ({
            id: project.id,
            name: project.name,
            wireframeTitles: project.wireframes.map((wireframe) => wireframe.title)
          }))}
          defaultProjectId={currentProjectId}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel={confirm.label}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run();
          }}
          onCancel={() => setConfirm(null)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          user={user}
          onClose={() => setSettingsOpen(false)}
          onUserUpdated={setUser}
          onAccountDeleted={() => onSignedOut(t("account.deleted"))}
        />
      ) : null}
    </>
  );

  if (!entry || currentId === null) {
    // No document open yet (first load) or none left: panel + an empty state.
    return (
      <div className="app">
        <main className="workspace with-projects empty-workspace">
          {panel}
          <section className="workspace-empty">
            {loadError ? (
              <p className="auth-error">{loadError}</p>
            ) : projects === null ? (
              <div className="auth-spinner" aria-label={t("projects.loading")} />
            ) : (
              <div className="workspace-empty-card">
                <h2>{t("projects.noWireframe")}</h2>
                <p>{t("projects.noWireframeHint")}</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => (currentProjectId !== null ? void createWireframe(currentProjectId) : void createProject())}
                  >
                    {t("projects.newWireframe")}
                  </button>
                  <button type="button" onClick={() => setImportOpen(true)}>
                    {t("toolbar.import")}
                  </button>
                </div>
                <div className="workspace-empty-account">{accountSlot}</div>
              </div>
            )}
          </section>
        </main>
        {notice ? <div className="notice-banner floating">{notice}</div> : null}
        {dialogs}
      </div>
    );
  }

  return (
    <>
      {/*
        A crash inside App's own render body still has to keep the history cache (a ref on this
        component) and offer a JSON download, so the boundary sits above <App> as well (D6).
      */}
      <EditorErrorBoundary project={entry?.history.present ?? null}>
      <App
        key={`${currentId}:${epoch}`}
        host={{
          initialHistory: entry.history,
          onHistoryChange,
          sidebar: panel,
          accountSlot,
          onNewWireframe: () => {
            if (currentProjectId !== null) void createWireframe(currentProjectId);
          },
          notice: notice ? (
            <span className="host-notice-content">
              {notice}
              <button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label={t("common.dismiss")}>
                ✕
              </button>
            </span>
          ) : null
        }}
      />
      </EditorErrorBoundary>
      {dialogs}
    </>
  );
}
