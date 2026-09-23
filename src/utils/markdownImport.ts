import { normalizeProject, type WireframeProject } from "../model/project";
import { PROJECT_FENCE } from "./markdownExport";

export class MarkdownImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownImportError";
  }
}

/**
 * Find the fenced `ui-project` block that carries the canonical project JSON.
 * The ASCII section is never used for reconstruction.
 */
export function extractProjectSource(markdown: string): string {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new MarkdownImportError("The import is empty. Paste a Markdown export that contains a ui-project block.");
  }

  const pattern = new RegExp("```+\\s*" + PROJECT_FENCE + "[^\\n]*\\n([\\s\\S]*?)```+", "i");
  const match = pattern.exec(markdown);
  if (!match) {
    throw new MarkdownImportError(
      "No ```" + PROJECT_FENCE + " block was found. Export the wireframe from Wirefragma and import that Markdown."
    );
  }

  const body = match[1].trim();
  if (!body) {
    throw new MarkdownImportError("The ui-project block is empty.");
  }
  return body;
}

export function projectFromMarkdown(markdown: string): WireframeProject {
  const source = extractProjectSource(markdown);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new MarkdownImportError(`The ui-project block is not valid JSON: ${(error as Error).message}`);
  }

  try {
    return normalizeProject(parsed);
  } catch (error) {
    throw new MarkdownImportError(`The ui-project data is not a usable project: ${(error as Error).message}`);
  }
}

export function projectFromJson(json: string): WireframeProject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new MarkdownImportError(`That is not valid JSON: ${(error as Error).message}`);
  }
  try {
    return normalizeProject(parsed);
  } catch (error) {
    throw new MarkdownImportError(`The JSON is not a usable project: ${(error as Error).message}`);
  }
}
