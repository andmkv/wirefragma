/**
 * Internal clipboard for wireframe objects. Core copy/paste never depends on the OS clipboard,
 * so `Cmd/Ctrl+C` / `V` stays reliable regardless of browser clipboard permissions.
 */

import {
  cloneElement,
  createId,
  findElement,
  findLayer,
  reindexLayers,
  uniqueName,
  withDescendants,
  type WireframeElement,
  type WireframeProject
} from "./project";
import { selectedElements } from "./selection";

export const CLIPBOARD_OFFSET = 16;

export interface WirefragmaClipboard {
  elements: WireframeElement[];
}

/** Copy the selection together with everything nested inside it (subtrees travel whole). */
export function copySelection(project: WireframeProject, ids: string[]): WirefragmaClipboard | null {
  const elements = selectedElements(project, withDescendants(project, ids)).map(cloneElement);
  return elements.length > 0 ? { elements } : null;
}

export interface PasteOptions {
  /** 1 for the first paste, 2 for the next… drives the cascade offset. */
  pasteIndex: number;
  activeLayerId: string | null;
}

/**
 * Paste a clipboard payload: new ids, unique names, layer preserved when it still exists,
 * cascade offset (16 px per paste), and the pasted set selected afterwards.
 */
export function pasteClipboard(
  project: WireframeProject,
  clipboard: WirefragmaClipboard,
  options: PasteOptions
): { project: WireframeProject; newIds: string[] } {
  if (clipboard.elements.length === 0) return { project, newIds: [] };

  const fallbackLayerId =
    (options.activeLayerId && findLayer(project, options.activeLayerId)?.id) || project.layers[0]?.id || "";
  const offset = CLIPBOARD_OFFSET * Math.max(1, options.pasteIndex);
  const minX = Math.min(...clipboard.elements.map((element) => element.x));
  const minY = Math.min(...clipboard.elements.map((element) => element.y));

  // Parent links inside the payload are re-pointed at the new copies. A copied root keeps its
  // parent only when that parent still exists in the document (e.g. pasting inside a Container).
  const idMap = new Map(clipboard.elements.map((source) => [source.id, createId(source.type)]));

  let next = project;
  const newIds: string[] = [];
  for (const source of clipboard.elements) {
    const layerId = findLayer(project, source.layerId) ? source.layerId : fallbackLayerId;
    const copy: WireframeElement = {
      ...cloneElement(source),
      id: idMap.get(source.id)!,
      name: uniqueName(next, source.name),
      layerId,
      x: Math.round(source.x - minX) + minX + offset,
      y: Math.round(source.y - minY) + minY + offset
    };
    const parentId = source.parentId;
    if (parentId !== undefined && idMap.has(parentId)) copy.parentId = idMap.get(parentId);
    else if (parentId !== undefined && findElement(project, parentId)) copy.parentId = parentId;
    else delete copy.parentId;
    // Only the pasted roots become the selection; their children come along with them.
    if (parentId === undefined || !idMap.has(parentId)) newIds.push(copy.id);
    next = { ...next, elements: [...next.elements, copy] };
  }
  return { project: reindexLayers(next), newIds };
}
