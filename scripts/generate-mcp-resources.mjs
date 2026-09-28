#!/usr/bin/env node
/**
 * Writes server/mcp/resources/* from the TypeScript model (src/utils/mcpResources.ts).
 *
 * The PHP MCP server serves these files; they are generated, committed, and checked for
 * staleness by src/utils/mcpResources.test.ts. The TypeScript is executed through Vite's SSR
 * loader, so the generator code is the very code the editor ships — nothing is re-implemented.
 *
 *   npm run mcp:resources           write the files
 *   npm run mcp:resources -- --check exit 1 if a committed file differs
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const vite = await createServer({
  root: ROOT,
  configFile: false,
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false, watch: null }
});

let stale = 0;
try {
  const { MCP_RESOURCES_DIR, mcpResourceFiles } = await vite.ssrLoadModule("/src/utils/mcpResources.ts");
  const dir = resolve(ROOT, MCP_RESOURCES_DIR);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(mcpResourceFiles())) {
    const path = resolve(dir, name);
    const current = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (current === content) continue;
    if (check) {
      console.error(`stale: ${MCP_RESOURCES_DIR}/${name}`);
      stale++;
    } else {
      writeFileSync(path, content);
      console.log(`wrote ${MCP_RESOURCES_DIR}/${name}`);
    }
  }
} finally {
  await vite.close();
}
if (stale) {
  console.error("Run `npm run mcp:resources` and commit the result.");
  process.exit(1);
}
