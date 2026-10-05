#!/usr/bin/env node
/**
 * Dev-only: measure the responsive layout (D7) in a real headless browser.
 *
 * Usage:
 *   npm run dev                                   # in one terminal (defaults to port 5173)
 *   node scripts/measure-layout.mjs [--url=…] [--widths=820x900,390x700,1280x900]
 *                                     [--browser=/path/to/chrome]
 *
 * The page runs the DEV-only `?measure=1` harness (`src/dev/measureLayout.ts`), which writes the
 * geometry it read from the DOM into `<pre id="dsh-layout-measure">`; this script reads that back
 * from `--dump-dom`. No dependencies: it drives a plain browser binary.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function arg(name, fallback) {
  const found = process.argv.find((value) => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}

function playwrightHeadlessShell() {
  const base = join(process.env.HOME ?? "", "Library/Caches/ms-playwright");
  if (!existsSync(base)) return null;
  for (const entry of readdirSync(base)) {
    if (!entry.startsWith("chromium_headless_shell")) continue;
    for (const variant of readdirSync(join(base, entry))) {
      const candidate = join(base, entry, variant, "chrome-headless-shell");
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

const candidates = [
  arg("browser", null),
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  playwrightHeadlessShell(),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);

const browser = candidates.find((candidate) => existsSync(candidate));
if (!browser) {
  console.error("No browser found. Pass --browser=/path/to/chrome.");
  process.exit(2);
}

const url = arg("url", "http://localhost:5173/?measure=1");
const widths = arg("widths", "820x900,390x700,1280x900").split(",");
const profile = mkdtempSync(join(tmpdir(), "wirefragma-measure-"));

const results = [];
for (const spec of widths) {
  const [width, height] = spec.split("x").map(Number);
  const dom = execFileSync(
    browser,
    [
      "--headless",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-breakpad",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      "--virtual-time-budget=20000",
      "--dump-dom",
      url
    ],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
  );
  const match = dom.match(/<pre id="dsh-layout-measure"[^>]*>([\s\S]*?)<\/pre>/);
  if (!match) {
    results.push({ requestedWidth: width, requestedHeight: height, error: "no measurement in the DOM" });
    continue;
  }
  results.push(JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")));
}

console.log(JSON.stringify(results, null, 2));
