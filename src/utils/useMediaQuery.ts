import { useEffect, useState } from "react";
import { layoutModeForWidth, type LayoutMode } from "./layoutMode";

/** `window.matchMedia` with a live subscription; SSR/tests report `false`. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** The active layout mode, derived from the same breakpoints the stylesheet uses. */
export function useLayoutMode(): LayoutMode {
  const desktop = useMediaQuery(`(min-width: 1100px)`);
  const tablet = useMediaQuery(`(min-width: 768px)`);
  if (desktop) return "desktop";
  if (tablet) return "tablet";
  // A media-query-less environment (tests, very old browsers) falls back to the window width.
  if (typeof window === "undefined" || !window.matchMedia) {
    return layoutModeForWidth(typeof window === "undefined" ? 1280 : window.innerWidth);
  }
  return "phone";
}

/** True for a finger/stylus pointer: hit targets and handle tolerances grow. */
export function useCoarsePointer(): boolean {
  return useMediaQuery("(pointer: coarse)");
}
