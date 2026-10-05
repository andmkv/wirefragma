#!/usr/bin/env node
/**
 * Copies the MCP endpoint into dist/mcp for deployment (last step of `npm run build:deploy`).
 *
 * Expects `npm run mcp:install` (composer install --no-dev) to have produced server/mcp/vendor.
 * Everything except index.php is protected by .htaccess files: the root one only grants
 * index.php, and every sub-folder (vendor/, src/, resources/) gets a deny-all file, so library
 * code, composer.json/lock and resources are never downloadable. Secrets, logs and MCP session
 * files are never copied (sessions must live outside the web root anyway, see docs/mcp.md).
 */
import { cpSync, existsSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(ROOT, "server/mcp");
const target = resolve(ROOT, "dist/mcp");

if (!existsSync(resolve(ROOT, "dist/index.html"))) {
  console.error("dist/ is missing — run `npm run build` first.");
  process.exit(1);
}
if (!existsSync(resolve(source, "vendor/autoload.php"))) {
  console.error("server/mcp/vendor is missing — run `npm run mcp:install` (needs Composer).");
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(source, target, {
  recursive: true,
  filter: (path) => !/(^|[\\/])(config\.php|wirefragma-config\.php|\.env[^\\/]*|[^\\/]*\.log|\.wirefragma-mcp-sessions|\.DS_Store)$/.test(path)
});

const deny = readFileSync(resolve(source, "src/.htaccess"), "utf8");
writeFileSync(resolve(target, "vendor/.htaccess"), deny);
for (const dir of ["src", "resources", "vendor"]) {
  if (!existsSync(resolve(target, dir, ".htaccess"))) {
    console.error(`dist/mcp/${dir}/.htaccess is missing`);
    process.exit(1);
  }
}
console.log("dist/mcp ready (index.php public; vendor/, src/, resources/ denied by .htaccess).");
