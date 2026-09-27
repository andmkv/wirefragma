import { useEffect, useRef, useState } from "react";

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
}

/** "New Wireframe N" with the smallest N not used in that project yet. */
export function nextWireframeTitle(existing: string[]): string {
  const taken = new Set(existing.map((title) => title.trim().toLowerCase()));
  let counter = 1;
  while (taken.has(`new wireframe ${counter}`)) counter += 1;
  return `New Wireframe ${counter}`;
}

export function ImportDialog({ onClose, onImport, target = "replace", projects = [], defaultProjectId = null }: ImportDialogProps) {
  const [projectId, setProjectId] = useState<number | null>(defaultProjectId ?? projects[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const defaultTitle = nextWireframeTitle(projects.find((project) => project.id === projectId)?.wireframeTitles ?? []);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const runImport = (value: string, name: string) => {
    if (value.trim() === "") {
      setError("Nothing to import yet. Paste Markdown or choose a .md file.");
      return;
    }
    const destination =
      target === "project" && projectId !== null ? { projectId, title: title.trim() || defaultTitle } : undefined;
    const message = onImport(value, name, destination);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    onClose();
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const content = await file.text();
      setText(content);
      runImport(content, file.name);
    } catch {
      setError("That file could not be read.");
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Import">
        <div className="modal-header">
          <h2>Import</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="modal-note">
          Paste a Markdown export, raw project JSON, or an LLM answer generated from the WIREFRAGMA
          schema (Export → WIREFRAGMA schema). The importer reads the <code>ui-project</code> block, so
          the ASCII drawing is not used for reconstruction.{" "}
          {target === "project"
            ? "The import becomes a new wireframe in the chosen project."
            : "Importing replaces the current project and clears the undo history."}
        </p>

        {target === "project" && projects.length > 0 ? (
          <div className="import-destination">
            <label className="field">
              <span className="field-label">Project</span>
              <select value={projectId ?? ""} onChange={(event) => setProjectId(Number(event.target.value))}>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">Wireframe title</span>
              <input value={title} placeholder={defaultTitle} maxLength={160} onChange={(event) => setTitle(event.target.value)} />
            </label>
          </div>
        ) : null}

        <textarea
          className="import-input"
          value={text}
          spellCheck={false}
          placeholder={"# UI Wireframe: Settings\n\n...\n\n```ui-project\n{ ... }\n```"}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
        />

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="modal-footer">
          <div className="modal-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt,.json,text/markdown,application/json"
              style={{ display: "none" }}
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <button type="button" onClick={() => fileInputRef.current?.click()}>
              Upload .md
            </button>
            <button type="button" className="primary" onClick={() => runImport(text, "pasted text")}>
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
