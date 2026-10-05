import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { PreferencesProvider, isDictionaryLoaded, loadDictionary, loadPreferences } from "./i18n";
import { INPUT_DEBUG_ENABLED, logBuildIdentity } from "./buildIdentity";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing from index.html");
const reactRoot = createRoot(container);

// Build/input diagnostics need the ?inputdebug=1 flag and a development build.
if (import.meta.env.DEV && INPUT_DEBUG_ENABLED) logBuildIdentity();

/**
 * The UI languages other than English are lazy chunks (1.3.5). The stored language is fetched
 * *before* the first render, so a non-English user never sees a frame of untranslated text.
 */
async function boot(): Promise<void> {
  const { locale } = loadPreferences();
  if (!isDictionaryLoaded(locale)) {
    try {
      await loadDictionary(locale);
    } catch {
      /* the English fallback in `translate` keeps the app usable */
    }
  }
  reactRoot.render(
    <StrictMode>
      <PreferencesProvider>
        <Root />
      </PreferencesProvider>
    </StrictMode>
  );
}

void boot();

// Development-only harnesses, never part of a production build:
//   ?selftest=1 / ?selftest=2  interaction self-test
//   ?measure=1                 responsive layout measurements (D7)
if (import.meta.env.DEV) {
  const params = new URLSearchParams(window.location.search);
  const selftest = params.get("selftest");
  if (selftest) {
    void import("./dev/selfTest").then((module) => module.runSelfTest(Number(selftest) || 1));
  }
  if (params.get("measure")) {
    void import("./dev/measureLayout").then((module) => module.runLayoutMeasure());
  }
}
