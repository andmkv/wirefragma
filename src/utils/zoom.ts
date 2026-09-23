/**
 * Zoom is editor view state only: it never touches project coordinates or canvas size.
 *
 * The editor separates
 *   - the logical canvas size (from the project),
 *   - the fit scale (canvas fitted into the viewport, recalculated on resize),
 *   - the manual scale (chosen by the user),
 * and applies whichever one the current zoom mode selects.
 */

export type ZoomMode = "fit" | "manual";

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** Percentages offered in the zoom menu / used by the +/- buttons. */
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

export const ZOOM_PADDING = 56;

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Scale that fits the logical canvas into the viewport, never magnifying past 100%. */
export function fitScale(
  viewport: { width: number; height: number },
  canvas: { width: number; height: number },
  padding = ZOOM_PADDING
): number {
  const availableWidth = Math.max(120, viewport.width - padding);
  const availableHeight = Math.max(120, viewport.height - padding);
  const scale = Math.min(availableWidth / canvas.width, availableHeight / canvas.height, 1);
  return clampZoom(scale);
}

export function scaleForMode(mode: ZoomMode, manualScale: number, automaticScale: number): number {
  return clampZoom(mode === "fit" ? automaticScale : manualScale);
}

/** Next / previous preset step (falls back to a 1.25× nudge between presets). */
export function zoomStep(current: number, direction: 1 | -1): number {
  const epsilon = 1e-6;
  if (direction > 0) {
    const next = ZOOM_PRESETS.find((step) => step > current + epsilon);
    return clampZoom(next ?? current * 1.25);
  }
  const previous = [...ZOOM_PRESETS].reverse().find((step) => step < current - epsilon);
  return clampZoom(previous ?? current / 1.25);
}

/** Trackpad pinch / Cmd+wheel: exponential so the feel is uniform across scales. */
export function zoomFromWheel(current: number, deltaY: number, sensitivity = 0.0022): number {
  return clampZoom(current * Math.exp(-deltaY * sensitivity));
}

export function formatZoom(scale: number): string {
  return `${Math.round(scale * 100)}%`;
}

/** Nearest preset, used to highlight the current zoom in the menu. */
export function nearestPreset(scale: number): number | null {
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const preset of ZOOM_PRESETS) {
    const distance = Math.abs(preset - scale);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = preset;
    }
  }
  return bestDistance <= 0.005 ? best : null;
}

/** Canvas coordinate currently under a pointer offset inside the scroll viewport. */
export function contentPointAt(
  scrollOffset: number,
  pointerOffset: number,
  scale: number,
  contentOffset: number
): number {
  return (scrollOffset + pointerOffset - contentOffset) / scale;
}

/** Scroll offset that puts `contentPoint` back under the same pointer offset. */
export function scrollOffsetToKeepPoint(
  contentPoint: number,
  pointerOffset: number,
  scale: number,
  contentOffset: number
): number {
  return Math.max(0, contentPoint * scale + contentOffset - pointerOffset);
}
