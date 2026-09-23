/**
 * THE hit test. Deterministic, geometry-based, shared by the running editor and the tests.
 *
 * Resolution order (NEVERCAT's tool layer, adapted to Wirefragma's simpler model):
 *   1. resize handles of the current selection (screen-pixel tolerance converted to world
 *      units), so a handle always beats the element body it sits on;
 *   2. elements front to back -- the first semantic hit region wins, so a Button rendered above
 *      a Dialog is selected even though the pointer is geometrically inside the Dialog;
 *   3. nothing (the canvas itself).
 */

import type { WireframeProject } from "../model/project";
import {
  handleHitTolerancePx,
  isElementLocked,
  visibleGeometries,
  type ElementGeometry,
  type ResizeEdge
} from "./geometry";
import { rectContains, screenPxToWorld, type Point, type ViewTransform } from "./transform";

export type HitTarget =
  | { kind: "handle"; elementId: string; edge: ResizeEdge }
  | { kind: "element"; elementId: string }
  | { kind: "none" };

export interface HitOptions {
  /**
   * The element whose resize handles are live. Handles exist only for a single-object
   * selection, so the editor passes `null` while several objects are selected.
   */
  handleElementId?: string | null;
  /** Older name for `handleElementId`, kept because the tests and tools use it. */
  selectedId?: string | null;
  /** Elements that must not be hit (locked by their own flag or by their layer). */
  isSelectable?: (elementId: string) => boolean;
}

export function hitTestGeometries(
  world: Point,
  geometries: ElementGeometry[],
  transform: ViewTransform,
  options: HitOptions = {}
): HitTarget {
  const { isSelectable = () => true } = options;
  const selectedId = options.handleElementId ?? options.selectedId ?? null;

  if (selectedId && isSelectable(selectedId)) {
    const selected = geometries.find((geometry) => geometry.elementId === selectedId);
    if (selected) {
      const tolerance = screenPxToWorld(
        transform,
        handleHitTolerancePx(
          selected.bounds.width * transform.scale,
          selected.bounds.height * transform.scale
        )
      );
      let best: { edge: ResizeEdge; distance: number } | null = null;
      for (const handle of selected.resizeHandles) {
        const dx = handle.world.x - world.x;
        const dy = handle.world.y - world.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { edge: handle.edge, distance };
        }
      }
      if (best) return { kind: "handle", elementId: selectedId, edge: best.edge };
    }
  }

  for (let index = geometries.length - 1; index >= 0; index -= 1) {
    const geometry = geometries[index];
    if (!isSelectable(geometry.elementId)) continue;
    if (geometry.hitRegions.some((region) => rectContains(region, world.x, world.y))) {
      return { kind: "element", elementId: geometry.elementId };
    }
  }

  return { kind: "none" };
}

/** Convenience wrapper used by the editor and by tests: project -> hit target. */
export function hitTestProject(
  world: Point,
  project: WireframeProject,
  transform: ViewTransform,
  options: HitOptions = {}
): HitTarget {
  // The project-level entry point owns the document rules: hidden elements are already gone
  // (visibleGeometries) and locked ones are never selectable on the canvas.
  const isSelectable =
    options.isSelectable ??
    ((elementId: string) => {
      const element = project.elements.find((candidate) => candidate.id === elementId);
      return !!element && !isElementLocked(project, element);
    });
  return hitTestGeometries(world, visibleGeometries(project, transform), transform, {
    ...options,
    isSelectable
  });
}
