import { describe, expect, it } from "vitest";
import { ELEMENT_TYPES, normalizeProject } from "../model/project";
import { projectFromText } from "./markdownImport";
import { projectJsonSchema, schemaExampleProject, wirefragmaSchemaMarkdown } from "./schemaExport";

describe("WIREFRAGMA schema export", () => {
  const doc = wirefragmaSchemaMarkdown();

  it("documents every element type", () => {
    for (const type of ELEMENT_TYPES) expect(doc).toContain(`| \`${type}\` |`);
  });

  it("ships an example that imports unchanged", () => {
    const example = schemaExampleProject();
    expect(normalizeProject(JSON.parse(JSON.stringify(example)))).toEqual(example);
  });

  it("the whole instruction document imports as the example project", () => {
    // A model that echoes the document back (or pastes it by mistake) still yields a valid project.
    expect(projectFromText(doc)).toEqual(schemaExampleProject());
  });

  it("the JSON Schema enumerates the real types", () => {
    const schema = projectJsonSchema();
    expect(schema.properties.elements.items.properties.type.enum).toEqual([...ELEMENT_TYPES]);
  });
});

describe("projectFromText (lenient import for LLM answers)", () => {
  const json = JSON.stringify(schemaExampleProject());

  it("accepts raw JSON, a json fence and JSON wrapped in prose", () => {
    const expected = schemaExampleProject();
    expect(projectFromText(json)).toEqual(expected);
    expect(projectFromText("Here you go:\n```json\n" + json + "\n```\nEnjoy!")).toEqual(expected);
    expect(projectFromText("Sure! " + json + " Hope it helps.")).toEqual(expected);
  });

  it("still reports a helpful error for text without any project", () => {
    expect(() => projectFromText("just words")).toThrow(/ui-project/);
    expect(() => projectFromText("   ")).toThrow(/empty/);
  });
});
