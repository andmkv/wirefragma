import { Component, type ErrorInfo, type ReactNode } from "react";
import { useT } from "../i18n";
import { projectToJson } from "../utils/markdownExport";
import { downloadText } from "../utils/clipboard";
import type { WireframeProject } from "../model/project";

interface BoundaryProps {
  children: ReactNode;
  /** Current document, offered as a JSON download while the editor is broken. */
  project?: WireframeProject | null;
  /** Extra label under the title (e.g. the wireframe the user was editing). */
  context?: string;
  onReset?: () => void;
  title: string;
  message: string;
  retryLabel: string;
  exportLabel: string;
  exportHint: string;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Class error boundary (React requires a class for `componentDidCatch`).
 *
 * It renders a localized, non-destructive fallback: "Try again" simply drops the error state, so
 * the editor keeps its document, its undo history and its autosave state; "Export what I have"
 * downloads the current project with the existing JSON export helpers, so a render error can never
 * cost the user work.
 */
class EditorErrorBoundaryView extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the details in the console for a bug report; the UI stays calm and localized.
    console.error("Wirefragma editor error:", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  private download = () => {
    const project = this.props.project;
    if (!project) return;
    const slug = project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    downloadText(`${slug || "wireframe"}.json`, projectToJson(project), "application/json");
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-boundary" role="alert">
        <h2>{this.props.title}</h2>
        <p>{this.props.message}</p>
        {this.props.context ? <p className="error-boundary-context">{this.props.context}</p> : null}
        <pre className="error-boundary-detail">{error.message}</pre>
        <div className="button-row">
          <button type="button" className="primary" onClick={this.retry}>
            {this.props.retryLabel}
          </button>
          {this.props.project ? (
            <button type="button" onClick={this.download}>
              {this.props.exportLabel}
            </button>
          ) : null}
        </div>
        {this.props.project ? <p className="hint">{this.props.exportHint}</p> : null}
      </div>
    );
  }
}

/**
 * Localized error boundary for the editor. Wrap the editor (not the whole app) so a render error
 * cannot unmount the component that owns the history — and so `onReset` can simply carry on.
 */
export function EditorErrorBoundary({
  children,
  project,
  onReset
}: {
  children: ReactNode;
  project?: WireframeProject | null;
  onReset?: () => void;
}) {
  const t = useT();
  const context = project ? t("error.boundaryContext", { title: project.title }) : undefined;
  return (
    <EditorErrorBoundaryView
      project={project}
      context={context}
      onReset={onReset}
      title={t("error.boundaryTitle")}
      message={t("error.boundaryMessage")}
      retryLabel={t("error.boundaryRetry")}
      exportLabel={t("error.boundaryExport")}
      exportHint={t("error.boundaryExportHint")}
    >
      {children}
    </EditorErrorBoundaryView>
  );
}
