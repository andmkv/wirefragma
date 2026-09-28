/**
 * Static files the PHP MCP server serves, generated from the TypeScript model.
 *
 * The MCP endpoint (`server/mcp/`) runs on plain PHP and cannot execute this code, but it must
 * describe exactly the project format the editor understands. So there is one source of truth —
 * `schemaExport.ts` — and `npm run mcp:resources` (scripts/generate-mcp-resources.mjs) writes its
 * output into `server/mcp/resources/`. `mcpResources.test.ts` fails when the committed files are
 * stale, so a model change cannot silently leave the MCP schema behind.
 */

import { projectJsonSchema, wirefragmaSchemaMarkdown } from "./schemaExport";

/** Directory of the generated files, relative to the repository root. */
export const MCP_RESOURCES_DIR = "server/mcp/resources";

/** File name → content. */
export function mcpResourceFiles(): Record<string, string> {
  return {
    // `wirefragma://schema`: LLM-readable instructions for writing a project over MCP.
    "wirefragma-schema.md": wirefragmaSchemaMarkdown("mcp"),
    // JSON Schema the server validates MCP-supplied documents against (and `wirefragma://schema/json`).
    "project-schema.json": `${JSON.stringify(projectJsonSchema(), null, 2)}\n`
  };
}
