/**
 * Layer-scoped export: turn one layer of a project into a standalone project, so a single form
 * or panel can be explained to an LLM without the rest of the screen.
 *
 * Pure and non-mutating. The result is an ordinary `WireframeProject`, so every existing
 * serializer (Markdown, ASCII, spatial summary, `ui-project` JSON) works on it unchanged, and the
 * exported document re-imports as a normal project.
 */

import {
  MAX_CANVAS_SIZE,
  MIN_CANVAS_SIZE,
  findLayer,
  reindexLayers,
  type WireframeElement,
  type WireframeProject
} from "./project";

/** Empty space kept around the layer content when the canvas is cropped. */
export const LAYER_EXPORT_PADDING = 16;

export interface LayerExportOptions {
  /**
   * Shrink the canvas to the layer's content (plus padding) and shift the elements so the
   * content starts near the origin. Gives a much denser ASCII sketch for a small form.
   */
  crop?: boolean;
}

function contentBounds(elements: WireframeElement[]) {
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.width));
  const maxY = Math.max(...elements.map((element) => element.y + element.height));
  return { minX, minY, maxX, maxY };
}

/**
 * The given layer as a standalone project, or `null` when the layer does not exist.
 *
 * The layer is always exported as visible (exporting a hidden layer is an explicit request to
 * see it); element-level visibility is kept as is.
 */
export function projectForLayer(
  project: WireframeProject,
  layerId: string,
  options: LayerExportOptions = {}
): WireframeProject | null {
  const layer = findLayer(project, layerId);
  if (!layer) return null;

  let elements = project.elements.filter((element) => element.layerId === layerId);
  let canvas = { ...project.canvas };

  const measured = elements.filter((element) => element.visible);
  const basis = measured.length > 0 ? measured : elements;
  if (options.crop && basis.length > 0) {
    const bounds = contentBounds(basis);
    const width = Math.min(
      MAX_CANVAS_SIZE,
      Math.max(MIN_CANVAS_SIZE, Math.round(bounds.maxX - bounds.minX + LAYER_EXPORT_PADDING * 2))
    );
    const height = Math.min(
      MAX_CANVAS_SIZE,
      Math.max(MIN_CANVAS_SIZE, Math.round(bounds.maxY - bounds.minY + LAYER_EXPORT_PADDING * 2))
    );
    const dx = LAYER_EXPORT_PADDING - Math.round(bounds.minX);
    const dy = LAYER_EXPORT_PADDING - Math.round(bounds.minY);
    elements = elements.map((element) => ({ ...element, x: element.x + dx, y: element.y + dy }));
    canvas = { mode: "custom", width, height };
  }

  return reindexLayers({
    ...project,
    title: `${project.title} — ${layer.name}`,
    canvas,
    layers: [{ ...layer, visible: true }],
    elements
  });
}
