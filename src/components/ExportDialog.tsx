import { useEffect, useMemo, useRef, useState } from "react";
import { markdownFilename, projectToJson, projectToLlmMarkdown, projectToMarkdown } from "../utils/markdownExport";
import { copyText, downloadText } from "../utils/clipboard";
import { findLayer, type WireframeProject } from "../model/project";
import { projectForLayer } from "../model/layerExport";
import { wirefragmaSchemaMarkdown } from "../utils/schemaExport";

interface ExportDialogProps {
  project: WireframeProject;
  /** When set, only this layer's elements are exported (Layers panel → "…" → Export layer). */
  layerId?: string | null;
  onClose: () => void;
}

type Tab = "markdown" | "llm" | "json" | "schema";

export function ExportDialog({ project, layerId = null, onClose }: ExportDialogProps) {
  const [tab, setTab] = useState<Tab>("markdown");
  const [status, setStatus] = useState<string | null>(null);
  const [crop, setCrop] = useState(true);
  const statusTimer = useRef<number | null>(null);

  const layer = layerId ? findLayer(project, layerId) : null;
  const scoped = useMemo(
    () => (layerId ? projectForLayer(project, layerId, { crop }) : null) ?? project,
    [crop, layerId, project]
  );

  const markdown = useMemo(() => projectToMarkdown(scoped), [scoped]);
  const llmMarkdown = useMemo(() => projectToLlmMarkdown(scoped), [scoped]);
  const json = useMemo(() => projectToJson(scoped), [scoped]);
  const schema = useMemo(() => wirefragmaSchemaMarkdown(), []);

  const content =
    tab === "markdown" ? markdown : tab === "llm" ? llmMarkdown : tab === "json" ? json : schema;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    };
  }, [onClose]);

  const flash = (message: string) => {
    setStatus(message);
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 2200);
  };

  const handleCopy = async () => {
    const ok = await copyText(content);
    flash(ok ? "Copied to clipboard." : "Copy failed — select the text and copy manually.");
  };

  const handleDownload = () => {
    if (tab === "json") {
      downloadText(markdownFilename(scoped, "json"), json, "application/json");
    } else if (tab === "schema") {
      downloadText("wirefragma-schema.md", schema, "text/markdown");
    } else {
      downloadText(markdownFilename(scoped), content, "text/markdown");
    }
    flash("Download started.");
  };

  const title = layer ? `Export layer “${layer.name}”` : "Export";

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
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
          <button type="button" className={tab === "schema" ? "active" : ""} onClick={() => setTab("schema")}>
            WIREFRAGMA schema
          </button>
        </div>

        {layer && tab !== "schema" ? (
          <div className="modal-note export-scope">
            <span>
              Only the <strong>{scoped.elements.length}</strong> element
              {scoped.elements.length === 1 ? "" : "s"} of layer <strong>{layer.name}</strong> are exported.
            </span>
            <label className="inline-check">
              <input type="checkbox" checked={crop} onChange={(event) => setCrop(event.target.checked)} />
              Crop canvas to the layer content
            </label>
          </div>
        ) : null}

        {tab === "schema" ? (
          <p className="modal-note">
            LLM-ready instructions for the Wirefragma JSON format. Paste them into a chat together with a
            description of the screen you want; the model answers with a <code>ui-project</code> block that
            you can paste into <strong>Import</strong> to get an editable wireframe.
          </p>
        ) : (
          <p className="modal-note">
            The Markdown contains the ASCII wireframe, the semantic element list, your LLM notes and the
            canonical <code>ui-project</code> block used for re-importing.
          </p>
        )}

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
