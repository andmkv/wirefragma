export const BUILD_ID = __WIREFRAGMA_BUILD_ID__;
export const BUILD_TIME = __WIREFRAGMA_BUILD_TIME__;
export const VITE_MODE = import.meta.env.MODE;

export const INPUT_DEBUG_ENABLED =
  new URLSearchParams(window.location.search).get("inputdebug") === "1";

export function logBuildIdentity(): void {
  console.info("[Wirefragma build]", {
    buildId: BUILD_ID,
    buildTime: BUILD_TIME,
    viteMode: VITE_MODE,
    href: window.location.href,
    title: document.title,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    visualViewportScale: window.visualViewport?.scale ?? null
  });
}
