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
  /**
   * Names of the layers the payload was copied from (`layerId` → `layerName`).
   *
   * Ids are meaningless in another wireframe, so a paste that cannot find the original layer
   * falls back to a layer with the same *name* before giving up and using the active layer.
   * Optional, so payloads written before this field existed keep working.
   */
  layerNames?: Record<string, string>;
}

/** Copy the selection together with everything nested inside it (subtrees travel whole). */
export function copySelection(project: WireframeProject, ids: string[]): WirefragmaClipboard | null {
  const elements = selectedElements(project, withDescendants(project, ids)).map(cloneElement);
  if (elements.length === 0) return null;
  const layerNames: Record<string, string> = {};
  for (const element of elements) {
    if (layerNames[element.layerId] !== undefined) continue;
    const layer = findLayer(project, element.layerId);
    if (layer) layerNames[element.layerId] = layer.name;
  }
  const payload: WirefragmaClipboard = { elements };
  if (Object.keys(layerNames).length > 0) payload.layerNames = layerNames;
  return payload;
}

export interface PasteOptions {
  /** 1 for the first paste, 2 for the next… drives the cascade offset. */
  pasteIndex: number;
  activeLayerId: string | null;
}

/**
 * Paste a clipboard payload: new ids, unique names, the layer preserved when it still exists
 * (matched by id first, then by layer name for a payload copied from another wireframe),
 * cascade offset (16 px per paste), and the pasted set selected afterwards.
 *
 * Layers are never created: an unmatched layer falls back to the active one.
 */
export function pasteClipboard(
  project: WireframeProject,
  clipboard: WirefragmaClipboard,
  options: PasteOptions
): { project: WireframeProject; newIds: string[] } {
  if (clipboard.elements.length === 0) return { project, newIds: [] };

  const fallbackLayerId =
    (options.activeLayerId && findLayer(project, options.activeLayerId)?.id) || project.layers[0]?.id || "";
  const layerIdFor = (source: WireframeElement): string => {
    if (findLayer(project, source.layerId)) return source.layerId;
    const name = clipboard.layerNames?.[source.layerId];
    if (name) {
      const byName = project.layers.find((layer) => layer.name === name);
      if (byName) return byName.id;
    }
    return fallbackLayerId;
  };
  const offset = CLIPBOARD_OFFSET * Math.max(1, options.pasteIndex);
  const minX = Math.min(...clipboard.elements.map((element) => element.x));
  const minY = Math.min(...clipboard.elements.map((element) => element.y));

  // Parent links inside the payload are re-pointed at the new copies. A copied root keeps its
  // parent only when that parent still exists in the document (e.g. pasting inside a Container).
  const idMap = new Map(clipboard.elements.map((source) => [source.id, createId(source.type)]));

  let next = project;
  const newIds: string[] = [];
  for (const source of clipboard.elements) {
    const copy: WireframeElement = {
      ...cloneElement(source),
      id: idMap.get(source.id)!,
      name: uniqueName(next, source.name),
      layerId: layerIdFor(source),
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
