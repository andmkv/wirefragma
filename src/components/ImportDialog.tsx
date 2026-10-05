import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n";
import { BUNDLE_EXTENSION, BundleError, looksLikeBundle, parseBundle, type ProjectBundle } from "../utils/projectBundle";

export interface ImportDestination {
  projectId: number;
  title: string;
}

interface ImportDialogProps {
  onClose: () => void;
  /** Returns an error message, or null when the import succeeded. */
  onImport: (text: string, sourceName: string, destination?: ImportDestination) => string | null;
  /** "replace" (guest editor) or "project" (signed-in: add as a new wireframe). */
  target?: "replace" | "project";
  /** Signed-in only: the projects to choose from, and the preselected one. */
  projects?: { id: number; name: string; wireframeTitles: string[] }[];
  defaultProjectId?: number | null;
  /**
   * Signed-in only: import a whole `.wfproj` as a new project. Enables the "Whole project" flow;
   * resolves to an error message or null.
   */
  onImportProject?: (bundle: ProjectBundle, name: string) => Promise<string | null>;
}

type ImportMode = "wireframe" | "project";

/** "New Wireframe N" (in the UI language) with the smallest N not used in that project yet. */
export function nextWireframeTitle(existing: string[], format: (n: number) => string = (n) => `New Wireframe ${n}`): string {
  const taken = new Set(existing.map((title) => title.trim().toLowerCase()));
  let counter = 1;
  while (taken.has(format(counter).toLowerCase())) counter += 1;
  return format(counter);
}

export function ImportDialog({
  onClose,
  onImport,
  target = "replace",
  projects = [],
  defaultProjectId = null,
  onImportProject
}: ImportDialogProps) {
  const t = useT();
  const [mode, setMode] = useState<ImportMode>("wireframe");
  const [busy, setBusy] = useState(false);
  const [projectId, setProjectId] = useState<number | null>(defaultProjectId ?? projects[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const defaultTitle = nextWireframeTitle(
    projects.find((project) => project.id === projectId)?.wireframeTitles ?? [],
    (n) => t("import.defaultTitle", { n })
  );
  const [text, setText] = useState("");
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** A pasted/uploaded `.wfproj`, parsed (null when the text is something else). */
  const bundle = useMemo<ProjectBundle | BundleError | null>(() => {
    if (!looksLikeBundle(text)) return null;
    try {
      return parseBundle(text);
    } catch (reason) {
      return reason instanceof BundleError ? reason : new BundleError(String(reason));
    }
  }, [text]);
  const parsedBundle = bundle instanceof BundleError ? null : bundle;
  const [pickedIndex, setPickedIndex] = useState(0);
  const [projectName, setProjectName] = useState("");
  useEffect(() => {
    setPickedIndex(0);
    setProjectName("");
  }, [text]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runImport = (value: string, name: string) => {
    if (value.trim() === "") {
      setError(t("import.empty"));
      return;
    }
    if (bundle instanceof BundleError) {
      setError(bundle.message);
      return;
    }
    // One wireframe picked out of a .wfproj: import its document like any other project JSON.
    const picked = parsedBundle?.wireframes[pickedIndex];
    const payload = picked ? JSON.stringify(picked.data) : value;
    const fallbackTitle = picked?.title ?? defaultTitle;
    const destination =
      target === "project" && projectId !== null ? { projectId, title: title.trim() || fallbackTitle } : undefined;
    const message = onImport(payload, name, destination);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    onClose();
  };

  const runProjectImport = async () => {
    if (!onImportProject) return;
    if (!parsedBundle) {
      setError(bundle instanceof BundleError ? bundle.message : t("import.needProjectFile"));
      return;
    }
    setBusy(true);
    const message = await onImportProject(parsedBundle, projectName.trim() || parsedBundle.name);
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      setSourceName(file.name);
      setError(null);
      // A .wfproj needs a choice (which wireframe / project name) — never auto-import it.
      if (looksLikeBundle(content)) {
        if (onImportProject) setMode("project");
        return;
      }
      if (mode === "project") {
        setError(t("import.needProjectFile"));
        return;
      }
      runImport(content, file.name);
    } catch {
      setError(t("import.unreadable"));
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={t("import.title")}>
        <div className="modal-header">
          <h2>{t("import.title")}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        {onImportProject ? (
          <div className="tab-bar import-modes" role="tablist">
            <button type="button" role="tab" aria-selected={mode === "wireframe"} className={mode === "wireframe" ? "active" : undefined} onClick={() => setMode("wireframe")}>
              {t("import.modeWireframe")}
            </button>
            <button type="button" role="tab" aria-selected={mode === "project"} className={mode === "project" ? "active" : undefined} onClick={() => setMode("project")}>
              {t("import.modeProject")}
            </button>
          </div>
        ) : null}

        <p className="modal-note">
          {mode === "project"
            ? t("import.noteBundle")
            : `${t("import.note")} ${t(target === "project" ? "import.noteProject" : "import.noteReplace")}`}
        </p>

        {mode === "project" && parsedBundle ? (
          <div className="import-destination">
            <label className="field">
              <span className="field-label">{t("import.projectName")}</span>
              <input value={projectName} placeholder={parsedBundle.name} maxLength={120} onChange={(event) => setProjectName(event.target.value)} />
            </label>
            <p className="hint import-summary">
              {t("import.bundleSummary", { count: parsedBundle.wireframes.length })}: {parsedBundle.wireframes.map((w) => w.title).join(", ")}
            </p>
          </div>
        ) : null}

        {mode === "wireframe" && parsedBundle ? (
          <div className="import-destination">
            <label className="field">
              <span className="field-label">{t("import.pickWireframe")}</span>
              <select value={pickedIndex} onChange={(event) => setPickedIndex(Number(event.target.value))}>
                {parsedBundle.wireframes.map((wireframe, index) => (
                  <option key={index} value={index}>
                    {wireframe.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {mode === "wireframe" && target === "project" && projects.length > 0 ? (
          <div className="import-destination">
            <label className="field">
              <span className="field-label">{t("import.project")}</span>
              <select value={projectId ?? ""} onChange={(event) => setProjectId(Number(event.target.value))}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">{t("import.wireframeTitle")}</span>
              <input
                value={title}
                placeholder={parsedBundle?.wireframes[pickedIndex]?.title ?? defaultTitle}
                maxLength={160}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </div>
        ) : null}

        <textarea
          className="import-input"
          value={text}
          spellCheck={false}
          placeholder={
            mode === "project"
              ? '{ "format": "wirefragma-project", "name": "My App", "wireframes": [ ... ] }'
              : "# UI Wireframe: Settings\n\n...\n\n```ui-project\n{ ... }\n```"
          }
          onChange={(event) => {
            setText(event.target.value);
            setSourceName(null);
            setError(null);
          }}
        />

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="modal-footer">
          <div className="modal-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept={`.md,.markdown,.txt,.json,${BUNDLE_EXTENSION},text/markdown,application/json`}
              style={{ display: "none" }}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              {t("import.upload")}
            </button>
            {mode === "project" ? (
              <button type="button" className="primary" disabled={busy} onClick={() => void runProjectImport()}>
                {t("import.projectButton")}
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => runImport(text, sourceName ?? t("toast.pastedText"))}>
                {t("import.button")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
