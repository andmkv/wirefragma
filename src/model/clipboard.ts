/**
 * Internal clipboard for wireframe objects. Core copy/paste never depends on the OS clipboard,
 * so `Cmd/Ctrl+C` / `V` stays reliable regardless of browser clipboard permissions.
 */

import {
  addElement,
  createId,
  findLayer,
  uniqueName,
  type WireframeElement,
  type WireframeProject
} from "./project";
import { selectedElements } from "./selection";

export const CLIPBOARD_OFFSET = 16;

export interface WirefragmaClipboard {
  elements: WireframeElement[];
}

export function copySelection(project: WireframeProject, ids: string[]): WirefragmaClipboard | null {
  const elements = selectedElements(project, ids).map((element) => ({ ...element, items: element.items ? [...element.items] : undefined, columns: element.columns ? [...element.columns] : undefined, textStyle: element.textStyle ? { ...element.textStyle } : undefined }));
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

  let next = project;
  const newIds: string[] = [];
  for (const source of clipboard.elements) {
    const layerId = findLayer(project, source.layerId) ? source.layerId : fallbackLayerId;
    const copy: WireframeElement = {
      ...source,
      id: createId(source.type),
      name: uniqueName(next, source.name),
      layerId,
      x: Math.round(source.x - minX) + minX + offset,
      y: Math.round(source.y - minY) + minY + offset,
      items: source.items ? [...source.items] : undefined,
      columns: source.columns ? [...source.columns] : undefined,
      textStyle: source.textStyle ? { ...source.textStyle } : undefined
    };
    newIds.push(copy.id);
    next = addElement(next, copy);
  }
  return { project: next, newIds };
}
