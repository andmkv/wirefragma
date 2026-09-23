import { useRef, useState } from "react";

interface ImportDialogProps {
  onClose: () => void;
  /** Returns an error message, or null when the import succeeded. */
  onImport: (text: string, sourceName: string) => string | null;
}

export function ImportDialog({ onClose, onImport }: ImportDialogProps) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const runImport = (value: string, name: string) => {
    if (value.trim() === "") {
      setError("Nothing to import yet. Paste Markdown or choose a .md file.");
      return;
    }
    const message = onImport(value, name);
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
      <div className="modal wide" role="dialog" aria-label="Import">
        <div className="modal-header">
          <h2>Import</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <p className="modal-note">
          Paste a Markdown export (or raw project JSON). The importer reads the <code>ui-project</code>{" "}
          block, so the ASCII drawing is not used for reconstruction. Importing replaces the current
          project and clears the undo history.
        </p>

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
