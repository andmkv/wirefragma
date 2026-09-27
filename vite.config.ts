import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Optional accounts backend: `server/api` (plain PHP) is copied to `dist/api` so one upload of
 * `dist/` deploys both. Local secrets (`config.php`) and logs are never copied.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));

function copyPhpApi(): Plugin {
  return {
    name: "wirefragma-copy-php-api",
    apply: "build",
    closeBundle() {
      const source = resolve(ROOT, "server/api");
      if (!existsSync(source)) return;
      cpSync(source, resolve(ROOT, "dist/api"), {
        recursive: true,
        filter: (path: string) => !/(^|[\\/])config\.php$|\.log$/.test(path)
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  // Evaluated once when this Vite process starts. This makes a stale tab/server immediately
  // distinguishable from the source tree currently being investigated.
  const buildTime = new Date().toISOString();
  const buildId = `${buildTime.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}-${mode}`;

  return {
    plugins: [react(), copyPhpApi()],
    server: {
      // `npm run dev:api` serves server/ with PHP's built-in server; the editor reaches it here.
      proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } }
    },
    base: "./",
    define: {
      __WIREFRAGMA_BUILD_ID__: JSON.stringify(buildId),
      __WIREFRAGMA_BUILD_TIME__: JSON.stringify(buildTime)
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      // Single-page static tool: React + the Canvas 2D engine in one intentional chunk.
      chunkSizeWarningLimit: 800
    },
    test: {
      environment: "node",
      globals: true,
      include: ["src/**/*.test.ts"]
    }
  };
});
