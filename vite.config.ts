import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  // Evaluated once when this Vite process starts. This makes a stale tab/server immediately
  // distinguishable from the source tree currently being investigated.
  const buildTime = new Date().toISOString();
  const buildId = `${buildTime.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${mode}`;

  return {
    plugins: [react()],
    base: "./",
    define: {
      __WIREFRAGMA_BUILD_ID__: JSON.stringify(buildId),
      __WIREFRAGMA_BUILD_TIME__: JSON.stringify(buildTime)
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      // Single-page static tool: React + Konva in one intentional chunk.
      chunkSizeWarningLimit: 800
    },
    test: {
      environment: "node",
      globals: true,
      include: ["src/**/*.test.ts"]
    }
  };
});
