import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ELEMENT_TYPES } from "../model/project";
import { projectFromText } from "./markdownImport";
import { MCP_RESOURCES_DIR, mcpResourceFiles } from "./mcpResources";
import { schemaExampleProject, wirefragmaSchemaMarkdown } from "./schemaExport";

describe("MCP resources generated from the TypeScript model", () => {
  it("the committed files in server/mcp/resources are up to date (run `npm run mcp:resources`)", () => {
    for (const [name, content] of Object.entries(mcpResourceFiles())) {
      const committed = readFileSync(resolve(MCP_RESOURCES_DIR, name), "utf8");
      expect(committed, `${MCP_RESOURCES_DIR}/${name} is stale`).toBe(content);
    }
  });

  it("the MCP schema describes every element type and the tool workflow", () => {
    const doc = wirefragmaSchemaMarkdown("mcp");
    for (const type of ELEMENT_TYPES) expect(doc).toContain(`| \`${type}\` |`);
    for (const tool of ["get_wireframe", "update_wireframe", "create_wireframe", "baseRevision", "conflict"]) {
      expect(doc).toContain(tool);
    }
    expect(doc).not.toContain("Answer with exactly one fenced code block");
  });

  it("the MCP schema still carries an importable example", () => {
    expect(projectFromText(wirefragmaSchemaMarkdown("mcp"))).toEqual(schemaExampleProject());
  });

  it("the chat schema is unchanged by the MCP variant", () => {
    const chat = wirefragmaSchemaMarkdown();
    expect(chat).toContain("Answer with exactly one fenced code block");
    expect(chat).not.toContain("update_wireframe");
  });

  it("the JSON Schema file parses and enumerates the real element types", () => {
    const schema = JSON.parse(mcpResourceFiles()["project-schema.json"]);
    expect(schema.properties.elements.items.properties.type.enum).toEqual([...ELEMENT_TYPES]);
  });
});
