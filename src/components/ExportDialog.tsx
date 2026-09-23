import { useMemo, useState } from "react";
import { markdownFilename, projectToJson, projectToLlmMarkdown, projectToMarkdown } from "../utils/markdownExport";
import { copyText, downloadText } from "../utils/clipboard";
import type { WireframeProject } from "../model/project";

interface ExportDialogProps {
  project: WireframeProject;
  onClose: () => void;
}

type Tab = "markdown" | "llm" | "json";

export function ExportDialog({ project, onClose }: ExportDialogProps) {
  const [tab, setTab] = useState<Tab>("markdown");
  const [status, setStatus] = useState<string | null>(null);

  const markdown = useMemo(() => projectToMarkdown(project), [project]);
  const llmMarkdown = useMemo(() => projectToLlmMarkdown(project), [project]);
  const json = useMemo(() => projectToJson(project), [project]);

  const content = tab === "markdown" ? markdown : tab === "llm" ? llmMarkdown : json;

  const flash = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2200);
  };

  const handleCopy = async () => {
    const ok = await copyText(content);
    flash(ok ? "Copied to clipboard." : "Copy failed — select the text and copy manually.");
  };

  const handleDownload = () => {
    if (tab === "json") {
      downloadText(markdownFilename(project, "json"), json, "application/json");
    } else {
      downloadText(markdownFilename(project), content, "text/markdown");
    }
    flash("Download started.");
  };

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label="Export">
        <div className="modal-header">
          <h2>Export</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tab-bar">
          <button type="button" className={tab === "markdown" ? "active" : ""} onClick={() => setTab("markdown")}>
            Markdown
          </button>
          <button type="button" className={tab === "llm" ? "active" : ""} onClick={() => setTab("llm")}>
            Copy for LLM
          </button>
          <button type="button" className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>
            Project JSON
          </button>
        </div>

        <p className="modal-note">
          The Markdown contains the ASCII wireframe, the semantic element list, your LLM notes and the
          canonical <code>ui-project</code> block used for re-importing.
        </p>

        <textarea className="export-output" readOnly value={content} spellCheck={false} />

        <div className="modal-footer">
          <span className="status">{status}</span>
          <div className="modal-actions">
            <button type="button" onClick={handleDownload}>
              Download {tab === "json" ? ".json" : ".md"}
            </button>
            <button type="button" className="primary" onClick={handleCopy}>
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
