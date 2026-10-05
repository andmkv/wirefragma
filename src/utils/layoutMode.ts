/**
 * Layout breakpoints (1.2).
 *
 * The three modes drive both CSS and JS:
 *
 * | Mode | Width | Layout |
 * | --- | --- | --- |
 * | `desktop` | ≥ 1100 px | today's three-column workspace |
 * | `tablet` | 768–1099 px | full-width canvas + overlay drawers |
 * | `phone` | < 768 px | overlay drawers + a compact toolbar |
 *
 * `layoutModeForWidth` is pure so the breakpoints can be unit-tested; `useLayoutMode` reads the
 * same thresholds through `matchMedia`, so CSS and JS can never disagree.
 */

export type LayoutMode = "desktop" | "tablet" | "phone";

export const DESKTOP_MIN_WIDTH = 1100;
export const TABLET_MIN_WIDTH = 768;

export function layoutModeForWidth(width: number): LayoutMode {
  if (!Number.isFinite(width)) return "desktop";
  if (width >= DESKTOP_MIN_WIDTH) return "desktop";
  if (width >= TABLET_MIN_WIDTH) return "tablet";
  return "phone";
}

/** True when the layout uses overlay drawers instead of visible side columns. */
export function usesOverlayDrawers(mode: LayoutMode): boolean {
  return mode !== "desktop";
}
