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

  // The canonical block is the LAST opening fence: the export always ends with it, while an LLM
  // note may legitimately contain an earlier look-alike. Fences at the start of a line win; an
  // inline opener is only used when there is no line-start one at all.
  const lineStart = [...markdown.matchAll(new RegExp("^[ \\t]*```+[ \\t]*" + PROJECT_FENCE + "[^\\n]*\\n", "gim"))];
  const openers =
    lineStart.length > 0 ? lineStart : [...markdown.matchAll(new RegExp("```+\\s*" + PROJECT_FENCE + "[^\\n]*\\n", "gi"))];
  const opener = openers.length > 0 ? openers[openers.length - 1] : null;
  const rest = opener ? markdown.slice((opener.index ?? 0) + opener[0].length) : "";
  const close = opener ? (/^[ \t]*```+[ \t]*$/m.exec(rest) ?? /```+/.exec(rest)) : null;
  if (!opener || !close) {
    throw new MarkdownImportError(
      "No ```" + PROJECT_FENCE + " block was found. Export the wireframe from Wirefragma and import that Markdown."
    );
  }

  const body = rest.slice(0, close.index).trim();
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

/**
 * Import whatever a user (or an LLM following the WIREFRAGMA schema) pasted:
 *  1. a Markdown document with a `ui-project` block (the canonical export);
 *  2. raw project JSON;
 *  3. a ```json fenced block, e.g. a chat answer that used the wrong fence name;
 *  4. prose around a single JSON object (first `{` to last `}`).
 */
export function projectFromText(text: string): WireframeProject {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed === "") {
    throw new MarkdownImportError("The import is empty. Paste a Markdown export or project JSON.");
  }
  if (new RegExp("```+\\s*" + PROJECT_FENCE, "i").test(trimmed)) return projectFromMarkdown(trimmed);
  if (trimmed.startsWith("{")) return projectFromJson(trimmed);

  const jsonFence = /```+\s*json[^\n]*\n([\s\S]*?)```+/i.exec(trimmed);
  if (jsonFence) return projectFromJson(jsonFence[1].trim());

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first !== -1 && last > first) return projectFromJson(trimmed.slice(first, last + 1));

  // Nothing JSON-like at all: report the canonical expectation.
  return projectFromMarkdown(trimmed);
}
