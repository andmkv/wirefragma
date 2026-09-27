import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Root } from "./Root";
import { INPUT_DEBUG_ENABLED, logBuildIdentity } from "./buildIdentity";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("Root container #root is missing from index.html");

// Build/input diagnostics need the ?inputdebug=1 flag and a development build.
if (import.meta.env.DEV && INPUT_DEBUG_ENABLED) logBuildIdentity();

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>
);

// Development-only interaction harness: open the dev server with ?selftest=1 / ?selftest=2.
if (import.meta.env.DEV) {
  const selftest = new URLSearchParams(window.location.search).get("selftest");
  if (selftest) {
    void import("./dev/selfTest").then((module) => module.runSelfTest(Number(selftest) || 1));
  }
}
