import { useEffect, useMemo, useRef, useState } from "react";
import { markdownFilename, projectToJson, projectToLlmMarkdown, projectToMarkdown } from "../utils/markdownExport";
import { copyText, downloadText } from "../utils/clipboard";
import { findLayer, type WireframeProject } from "../model/project";
import { projectForLayer } from "../model/layerExport";
import { wirefragmaSchemaMarkdown } from "../utils/schemaExport";
import { useT } from "../i18n";

interface ExportDialogProps {
  project: WireframeProject;
  /** When set, only this layer's elements are exported (Layers panel → "…" → Export layer). */
  layerId?: string | null;
  onClose: () => void;
}

type Tab = "markdown" | "llm" | "json" | "schema";

export function ExportDialog({ project, layerId = null, onClose }: ExportDialogProps) {
  const t = useT();
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
    flash(t(ok ? "export.copied" : "export.copyFailed"));
  };

  const handleDownload = () => {
    if (tab === "json") {
      downloadText(markdownFilename(scoped, "json"), json, "application/json");
    } else if (tab === "schema") {
      downloadText("wirefragma-schema.md", schema, "text/markdown");
    } else {
      downloadText(markdownFilename(scoped), content, "text/markdown");
    }
    flash(t("export.downloadStarted"));
  };

  const title = layer ? t("export.layerTitle", { name: layer.name }) : t("export.title");

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("common.close")}>
            ✕
          </button>
        </div>

        <div className="tab-bar">
          <button type="button" className={tab === "markdown" ? "active" : ""} onClick={() => setTab("markdown")}>
            {t("export.tab.markdown")}
          </button>
          <button type="button" className={tab === "llm" ? "active" : ""} onClick={() => setTab("llm")}>
            {t("export.tab.llm")}
          </button>
          <button type="button" className={tab === "json" ? "active" : ""} onClick={() => setTab("json")}>
            {t("export.tab.json")}
          </button>
          <button type="button" className={tab === "schema" ? "active" : ""} onClick={() => setTab("schema")}>
            {t("export.tab.schema")}
          </button>
        </div>

        {layer && tab !== "schema" ? (
          <div className="modal-note export-scope">
            <span>{t("export.layerScope", { count: scoped.elements.length, layer: layer.name })}</span>
            <label className="inline-check">
              <input type="checkbox" checked={crop} onChange={(event) => setCrop(event.target.checked)} />
              {t("export.crop")}
            </label>
          </div>
        ) : null}

        {tab === "schema" ? (
          <p className="modal-note">{t("export.schemaNote")}</p>
        ) : (
          <p className="modal-note">{t("export.note")}</p>
        )}

        <textarea className="export-output" readOnly value={content} spellCheck={false} />

        <div className="modal-footer">
          <span className="status">{status}</span>
          <div className="modal-actions">
            <button type="button" onClick={handleDownload}>
              {t("export.download", { ext: tab === "json" ? ".json" : ".md" })}
            </button>
            <button type="button" className="primary" onClick={handleCopy}>
              {t("common.copy")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
