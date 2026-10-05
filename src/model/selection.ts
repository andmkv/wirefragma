/**
 * Multi-selection helpers. Selection is editor view state — it is never serialized.
 *
 * The editor keeps a `SelectionState`: an ordered list of element ids plus the *primary*
 * (the one the Properties panel edits and the one drag snapping is measured from).
 */

import { effectiveLocked, effectiveVisible, type WireframeElement, type WireframeProject } from "./project";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SelectionState {
  ids: string[];
  primary: string | null;
}

export const EMPTY_SELECTION: SelectionState = { ids: [], primary: null };

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

/** Build a selection, dropping duplicates and repairing a primary that is not in the set. */
export function selectionOf(ids: string[], primary: string | null = null): SelectionState {
  const unique = uniqueIds(ids);
  if (unique.length === 0) return EMPTY_SELECTION;
  const nextPrimary = primary && unique.includes(primary) ? primary : unique[unique.length - 1];
  return { ids: unique, primary: nextPrimary };
}

export function singleSelection(id: string): SelectionState {
  return { ids: [id], primary: id };
}

export function selectionEquals(a: SelectionState, b: SelectionState): boolean {
  if (a.primary !== b.primary) return false;
  if (a.ids.length !== b.ids.length) return false;
  return a.ids.every((id, index) => id === b.ids[index]);
}

export function selectionHas(selection: SelectionState, id: string): boolean {
  return selection.ids.includes(id);
}

/**
 * Shift/Cmd-click behaviour: remove the id when it is already selected, otherwise add it and
 * make it the primary. Removing the primary promotes the last remaining id.
 */
export function toggleInSelection(selection: SelectionState, id: string): SelectionState {
  if (selection.ids.includes(id)) {
    const ids = selection.ids.filter((candidate) => candidate !== id);
    return selectionOf(ids, selection.primary === id ? null : selection.primary);
  }
  return selectionOf([...selection.ids, id], id);
}

/** Replace the selection with exactly this element. */
export function replaceSelection(selection: SelectionState, id: string): SelectionState {
  return selection.primary === id && selection.ids.length === 1 ? selection : singleSelection(id);
}

/** Keep the same set, but remember which member the gesture/panel is about. */
export function withPrimary(selection: SelectionState, id: string): SelectionState {
  if (!selection.ids.includes(id) || selection.primary === id) return selection;
  return { ids: selection.ids, primary: id };
}

export function unionSelection(a: string[], b: string[]): string[] {
  return uniqueIds([...a, ...b]);
}

/** Add the id when it is missing, remove it otherwise — Shift/Cmd-click behaviour. */
export function toggleSelection(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id];
}

export function normalizeSelection(project: WireframeProject, ids: string[]): string[] {
  const known = new Set(project.elements.map((element) => element.id));
  const seen = new Set<string>();
  return ids.filter((id) => {
    if (!known.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Drop unknown ids and re-point the primary when it disappeared. */
export function normalizeSelectionState(
  project: WireframeProject,
  selection: SelectionState
): SelectionState {
  const ids = normalizeSelection(project, selection.ids);
  if (ids.length === selection.ids.length && (!selection.primary || ids.includes(selection.primary))) {
    return selection;
  }
  return selectionOf(ids, selection.primary);
}

export function selectedElements(project: WireframeProject, ids: string[]): WireframeElement[] {
  const wanted = new Set(ids);
  return project.elements.filter((element) => wanted.has(element.id));
}

export function selectionBounds(project: WireframeProject, ids: string[]): SelectionRect | null {
  const elements = selectedElements(project, ids);
  if (elements.length === 0) return null;
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function rectsOverlap(a: SelectionRect, b: SelectionRect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function elementRect(element: WireframeElement): SelectionRect {
  return { x: element.x, y: element.y, width: element.width, height: element.height };
}

/**
 * Every element a "select all" may pick: visible and unlocked, in document (back-to-front) order.
 * Deliberately the same predicate the marquee uses, so Cmd/Ctrl+A and a rubber band over the whole
 * canvas can never disagree about what is selectable.
 */
export function selectableElements(project: WireframeProject): string[] {
  return project.elements
    .filter((element) => effectiveVisible(project, element) && !effectiveLocked(project, element))
    .map((element) => element.id);
}

/**
 * Marquee selection: every visible, unlocked element whose bounds intersect the rectangle,
 * in document (back-to-front) order.
 */
export function marqueeSelection(project: WireframeProject, marquee: SelectionRect): string[] {
  return project.elements
    .filter((element) => effectiveVisible(project, element) && !effectiveLocked(project, element))
    .filter((element) => rectsOverlap(elementRect(element), marquee))
    .map((element) => element.id);
}

/**
 * Elements a canvas gesture may actually move: they must exist, be visible and be unlocked.
 * Order follows `selection.ids` so the primary can be recognised by its position.
 */
export function movableSelection(project: WireframeProject, ids: string[]): string[] {
  const byId = new Map(project.elements.map((element) => [element.id, element]));
  return ids.filter((id) => {
    const element = byId.get(id);
    return !!element && effectiveVisible(project, element) && !effectiveLocked(project, element);
  });
}

/** Elements that a bulk action may touch: locked ones are always excluded. */
export function deletableSelection(project: WireframeProject, ids: string[]): string[] {
  return selectedElements(project, ids)
    .filter((element) => !effectiveLocked(project, element))
    .map((element) => element.id);
}
