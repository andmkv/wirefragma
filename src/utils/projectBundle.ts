/**
 * `.wfproj` — a whole project in one file: its name and every wireframe (title + canonical
 * `WireframeProject` document), in panel order.
 *
 * It is a plain JSON envelope around the same documents the editor, the `ui-project` block, the
 * database and MCP use — no second document format. Exported documents are the stored JSON as is
 * (unknown fields survive); imported ones go through `normalizeProject` like every other import.
 *
 * Import has two flows: the whole file as a new project (signed in), or one wireframe picked from
 * it (signed in or guest).
 */

import { normalizeProject, type WireframeProject } from "../model/project";

export const BUNDLE_FORMAT = "wirefragma-project";
export const BUNDLE_VERSION = 1;
export const BUNDLE_EXTENSION = ".wfproj";

export interface BundleWireframe {
  title: string;
  data: WireframeProject;
}

export interface ProjectBundle {
  format: typeof BUNDLE_FORMAT;
  version: number;
  name: string;
  exportedAt: string;
  wireframes: BundleWireframe[];
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

/** Documents are taken as given (the stored JSON), so nothing the server kept is dropped. */
export function createBundle(name: string, wireframes: { title: string; data: unknown }[], now = new Date()): ProjectBundle {
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    name: name.trim() || "Project",
    exportedAt: now.toISOString(),
    wireframes: wireframes.map((wireframe) => ({ title: wireframe.title, data: wireframe.data as WireframeProject }))
  };
}

export function bundleToText(bundle: ProjectBundle): string {
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** File name for a project: a readable slug plus `.wfproj`. */
export function bundleFilename(name: string): string {
  const slug = name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "project"}${BUNDLE_EXTENSION}`;
}

/** Cheap check used to route a pasted/uploaded file to the project flow. */
export function looksLikeBundle(text: string): boolean {
  const start = text.trimStart();
  if (!start.startsWith("{")) return false;
  try {
    const value = JSON.parse(start) as { format?: unknown };
    return value !== null && typeof value === "object" && value.format === BUNDLE_FORMAT;
  } catch {
    return false;
  }
}

/**
 * Parse and validate a `.wfproj`. Every document is normalized (repairing what can be repaired);
 * a wireframe that cannot be read at all fails the whole file with its title in the message, so
 * nothing is half-imported.
 */
export function parseBundle(text: string): ProjectBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BundleError("This is not a Wirefragma project file (.wfproj): the content is not valid JSON.");
  }
  if (raw === null || typeof raw !== "object" || (raw as { format?: unknown }).format !== BUNDLE_FORMAT) {
    throw new BundleError("This is not a Wirefragma project file (.wfproj).");
  }
  const value = raw as Record<string, unknown>;
  const version = typeof value.version === "number" ? value.version : 0;
  if (version < 1 || version > BUNDLE_VERSION) {
    throw new BundleError(`This project file uses format version ${String(value.version)}, which this Wirefragma cannot read.`);
  }
  if (!Array.isArray(value.wireframes) || value.wireframes.length === 0) {
    throw new BundleError("The project file contains no wireframes.");
  }
  const wireframes = value.wireframes.map((entry, index): BundleWireframe => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const fallback = `Screen ${index + 1}`;
    const title = typeof item.title === "string" && item.title.trim() ? item.title.trim() : fallback;
    try {
      const data = normalizeProject(item.data);
      return { title, data: { ...data, title } };
    } catch (error) {
      throw new BundleError(`Wireframe “${title}” in the project file is invalid: ${(error as Error).message}`);
    }
  });
  return {
    format: BUNDLE_FORMAT,
    version,
    name: typeof value.name === "string" && value.name.trim() ? value.name.trim() : "Imported project",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    wireframes
  };
}
