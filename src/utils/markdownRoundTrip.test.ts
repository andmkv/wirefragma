import { describe, expect, it } from "vitest";
import { createSampleProject } from "../model/defaults";
import {
  ELEMENT_TYPES,
  PROJECT_VERSION,
  createLayer,
  normalizeProject,
  type WireframeProject
} from "../model/project";
import { CANVAS_PRESETS, ELEMENT_DEFAULTS, createElement, emptyProject } from "../model/defaults";
import { projectToJson, projectToMarkdown } from "./markdownExport";
import { MarkdownImportError, extractProjectSource, projectFromMarkdown } from "./markdownImport";
import { renderAsciiLines } from "./asciiRenderer";

const LAYER = createLayer("Default", { id: "layer_default" });

function tinyProject(): WireframeProject {
  return {
    version: 2,
    title: "Round Trip",
    canvas: { mode: "mobile", width: 390, height: 844 },
    layers: [LAYER],
    elements: [
      {
        id: "el_save",
        type: "button",
        name: "saveButton",
        label: "Save",
        note: "Saves changes but stays on the screen.",
        x: 24,
        y: 700,
        width: 160,
        height: 40,
        layerId: LAYER.id,
        visible: true,
        locked: false,
        zIndex: 0
      },
      {
        id: "el_tabs",
        type: "tabs",
        name: "sectionTabs",
        label: "",
        note: "",
        x: 24,
        y: 80,
        width: 320,
        height: 36,
        layerId: LAYER.id,
        visible: true,
        locked: false,
        zIndex: 1,
        items: ["General", "Appearance", "Advanced"]
      }
    ]
  };
}

describe("markdown round trip", () => {
  it("reconstructs the project from the embedded ui-project block", () => {
    const original = tinyProject();
    const markdown = projectToMarkdown(original);
    const restored = projectFromMarkdown(markdown);

    expect(restored).toEqual(original);
  });

  it("keeps the sample project intact through a round trip", () => {
    const original = createSampleProject();
    const restored = projectFromMarkdown(projectToMarkdown(original));
    expect(restored).toEqual(original);
  });

  it("produces byte-identical markdown for the same project", () => {
    const original = tinyProject();
    expect(projectToMarkdown(original)).toBe(projectToMarkdown(original));
  });

  it("includes all four important sections", () => {
    const markdown = projectToMarkdown(tinyProject());
    expect(markdown).toContain("## ASCII Wireframe");
    expect(markdown).toContain("## UI Elements");
    expect(markdown).toContain("## Spatial Summary");
    expect(markdown).toContain("## Editable Project Source");
    expect(markdown).toContain("```ui-project");
    expect(markdown).toContain("saveButton");
    expect(markdown).toContain("Saves changes but stays on the screen.");
  });

  it("adds layer context only when the screen has several layers", () => {
    const single = projectToMarkdown(tinyProject());
    expect(single).toContain("Layers (front to back): Default");
    expect(single).not.toContain("- Layer: ");
    const multi = projectToMarkdown(createSampleProject());
    expect(multi).toContain("- Layer: Controls");
  });

  it("keeps each element compact: fields as a list, no label echoed as content", () => {
    const markdown = projectToMarkdown(createSampleProject());
    expect(markdown).toContain("### `saveButton`\n\n- Type: Button\n- Label: Save\n- Bounds: x=");
    expect(markdown).not.toContain("Visible content:");
    expect(markdown).toContain("Items:\n- General\n- Appearance\n- Advanced");
  });

  it("writes the ui-project source one element per line and still round-trips", () => {
    const project = createSampleProject();
    const markdown = projectToMarkdown(project);
    const source = markdown.slice(markdown.indexOf("```ui-project"));
    const elementLines = source.split("\n").filter((line) => line.startsWith('    { "id": '));
    expect(elementLines.length).toBe(project.elements.length + project.layers.length);
    expect(projectFromMarkdown(markdown)).toEqual(project);
  });

  it("embeds complete JSON as the canonical source", () => {
    const original = createSampleProject();
    const source = extractProjectSource(projectToMarkdown(original));
    const parsed = JSON.parse(source) as WireframeProject;
    expect(parsed.elements).toHaveLength(original.elements.length);
    expect(parsed.canvas).toEqual(original.canvas);
    expect(parsed.layers).toEqual(original.layers);
    expect(parsed.version).toBe(PROJECT_VERSION);
    expect(projectToJson(original)).toContain('"saveButton"');
  });

  it("can still be rendered after a round trip", () => {
    const original = createSampleProject();
    const restored = projectFromMarkdown(projectToMarkdown(original));
    expect(renderAsciiLines(restored).join("\n")).toBe(renderAsciiLines(original).join("\n"));
  });

  it("keeps layers, order, visibility and locking through a round trip", () => {
    const original = createSampleProject();
    original.layers = original.layers.map((layer) =>
      layer.name === "Content" ? { ...layer, locked: true } : layer
    );
    original.elements = original.elements.map((element) =>
      element.name === "teamList" ? { ...element, visible: false } : element
    );

    const markdown = projectToMarkdown(original);
    const restored = projectFromMarkdown(markdown);

    expect(restored).toEqual(original);
    expect(restored.layers.map((layer) => layer.name)).toEqual(["Controls", "Content", "Layout"]);
  });

  it("omits hidden elements from the human spec but keeps them in the source", () => {
    const original = createSampleProject();
    original.elements = original.elements.map((element) =>
      element.name === "teamList" ? { ...element, visible: false } : element
    );

    const markdown = projectToMarkdown(original);
    const ascii = renderAsciiLines(original).join("\n");
    const humanSections = markdown.split("## Editable Project Source")[0];

    expect(markdown).toContain("Hidden elements omitted: 1");
    expect(ascii).not.toContain("Anna Kovacs");
    expect(humanSections).not.toContain("Read-only list of team members");
    expect(humanSections).not.toContain("teamList");
    expect(markdown).toContain('"name": "teamList"');
    expect(markdown).toContain('"visible": false');
  });

  it("omits a hidden layer from the human spec but keeps it in the source", () => {
    const original = createSampleProject();
    original.layers = original.layers.map((layer) =>
      layer.name === "Layout" ? { ...layer, visible: false } : layer
    );

    const markdown = projectToMarkdown(original);
    const ascii = renderAsciiLines(original).join("\n");
    const humanSections = markdown.split("## Editable Project Source")[0];

    expect(ascii).not.toContain("Sections");
    expect(humanSections).not.toContain("Main navigation");
    expect(markdown).toContain('"name": "Layout"');
    expect(markdown).toContain('"visible": false');
  });
});

describe("version 1 compatibility", () => {
  const legacyProject = {
    version: 1,
    title: "Legacy",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    elements: [
      {
        id: "el_1",
        type: "button",
        name: "saveButton",
        label: "Save",
        note: "Keeps the old note.",
        x: 10,
        y: 20,
        width: 120,
        height: 40,
        zIndex: 0
      },
      {
        id: "el_2",
        type: "text",
        name: "heading",
        label: "Hello",
        note: "",
        x: 10,
        y: 80,
        width: 200,
        height: 30,
        zIndex: 1
      }
    ]
  };

  const legacyMarkdown = [
    "# UI Wireframe: Legacy",
    "",
    "## Editable Project Source",
    "",
    "```ui-project",
    JSON.stringify(legacyProject, null, 2),
    "```",
    ""
  ].join("\n");

  it("migrates a version 1 project into a Default layer", () => {
    const migrated = normalizeProject(legacyProject);

    expect(migrated.version).toBe(2);
    expect(migrated.layers).toHaveLength(1);
    expect(migrated.layers[0].name).toBe("Default");
    expect(migrated.layers[0].visible).toBe(true);
    expect(migrated.layers[0].locked).toBe(false);
    expect(migrated.elements).toHaveLength(2);
    for (const element of migrated.elements) {
      expect(element.layerId).toBe(migrated.layers[0].id);
      expect(element.visible).toBe(true);
      expect(element.locked).toBe(false);
    }
    expect(migrated.elements.map((element) => element.zIndex)).toEqual([0, 1]);
    expect(migrated.elements.map((element) => element.name)).toEqual(["saveButton", "heading"]);
  });

  it("imports version 1 Markdown", () => {
    const imported = projectFromMarkdown(legacyMarkdown);
    expect(imported.version).toBe(2);
    expect(imported.layers[0].name).toBe("Default");
    expect(imported.elements[1].note).toBe("");
    expect(imported.elements[0].label).toBe("Save");
  });

  it("re-exports migrated projects as version 2 Markdown", () => {
    const migrated = projectFromMarkdown(legacyMarkdown);
    const markdown = projectToMarkdown(migrated);
    expect(markdown).toContain('"version": 2');
    expect(markdown).toContain('"layers"');
    expect(projectFromMarkdown(markdown)).toEqual(migrated);
  });
});

describe("new element types", () => {
  const NEW_TYPES = [
    "dialog",
    "bottomNav",
    "table",
    "icon",
    "avatar",
    "badge",
    "textarea",
    "radio",
    "slider",
    "progress",
    "iconButton"
  ] as const;

  it("has defaults and palette entries for every new type", () => {
    for (const type of NEW_TYPES) {
      expect(ELEMENT_TYPES).toContain(type);
      expect(ELEMENT_DEFAULTS[type]).toBeDefined();
    }
    expect(ELEMENT_DEFAULTS.textarea.width).toBe(260);
    expect(ELEMENT_DEFAULTS.textarea.height).toBe(96);
    expect(ELEMENT_DEFAULTS.dialog.width).toBe(360);
    expect(ELEMENT_DEFAULTS.dialog.height).toBe(240);
    expect(ELEMENT_DEFAULTS.bottomNav.width).toBe(360);
    expect(ELEMENT_DEFAULTS.bottomNav.height).toBe(64);
    expect(ELEMENT_DEFAULTS.bottomNav.items).toEqual(["Home", "Search", "Profile"]);
    expect(ELEMENT_DEFAULTS.table.columns).toEqual(["Name", "Status", "Size"]);
    expect(ELEMENT_DEFAULTS.icon.label).toBe("★");
    expect(ELEMENT_DEFAULTS.avatar.label).toBe("AB");
  });

  it("round-trips every new type through Markdown", () => {
    let project = emptyProject("desktop", "New Types");
    NEW_TYPES.forEach((type, index) => {
      const element = createElement(type, project, {
        x: 40 + index * 12,
        y: 40 + index * 12,
        layerId: project.layers[0].id
      });
      project = { ...project, elements: [...project.elements, element] };
    });

    const restored = projectFromMarkdown(projectToMarkdown(project));
    expect(restored.elements.map((element) => element.type)).toEqual([...NEW_TYPES]);
    expect(restored.elements.map((element) => element.name)).toEqual(
      project.elements.map((element) => element.name)
    );
    expect(restored).toEqual(normalizeProject(project));
  });

  it("validates every new type on import", () => {
    const normalized = normalizeProject({
      version: 2,
      title: "Validation",
      canvas: { width: 1200, height: 800 },
      elements: NEW_TYPES.map((type, index) => ({
        id: `el_${type}`,
        type,
        x: index * 10,
        y: index * 10,
        width: 100,
        height: 40
      }))
    });
    expect(normalized.elements).toHaveLength(NEW_TYPES.length);
  });

  it("keeps table columns and rows in the semantic export", () => {
    const project = emptyProject("desktop", "Table");
    const table = createElement("table", project, {
      x: 20,
      y: 20,
      layerId: project.layers[0].id,
      name: "membersTable",
      items: ["Anna | Owner | Active", "Milo | Admin | Paused"],
      columns: ["Name", "Role", "Status"]
    });
    const withTable: WireframeProject = { ...project, elements: [table] };
    const markdown = projectToMarkdown(withTable);

    expect(markdown).toContain("Type: Table");
    expect(markdown).toContain("Columns:");
    expect(markdown).toContain("- Name");
    expect(markdown).toContain("Rows:");
    expect(markdown).toContain("- Anna | Owner | Active");
    expect(projectFromMarkdown(markdown)).toEqual(normalizeProject(withTable));
  });

  it("keeps older projects unchanged when no new type is used", () => {
    const project = createSampleProject();
    const restored = projectFromMarkdown(projectToMarkdown(project));
    expect(restored).toEqual(project);
    expect(restored.elements.some((element) => NEW_TYPES.includes(element.type as never))).toBe(false);
  });

  it("does not bump the project version", () => {
    expect(PROJECT_VERSION).toBe(2);
  });
});

describe("mobile landscape preset", () => {
  it("is available next to portrait", () => {
    expect(CANVAS_PRESETS.mobile).toEqual({ width: 390, height: 844 });
    expect(CANVAS_PRESETS.mobileLandscape).toEqual({ width: 844, height: 390 });
  });

  it("round-trips through Markdown", () => {
    const project = emptyProject("mobileLandscape", "Landscape");
    const restored = projectFromMarkdown(projectToMarkdown(project));
    expect(restored.canvas).toEqual({ mode: "mobileLandscape", width: 844, height: 390 });
  });

  it("does not reinterpret an existing mobile project", () => {
    const portrait = normalizeProject({
      version: 2,
      canvas: { mode: "mobile", width: 390, height: 844 },
      elements: []
    });
    expect(portrait.canvas.mode).toBe("mobile");
    expect(portrait.canvas.height).toBe(844);
  });

  it("names the canvas mode in the Screen section", () => {
    // Regression: every non-desktop, non-portrait mode used to be reported as "Custom".
    const screenType = (project: WireframeProject) =>
      /^Type: (.+)$/m.exec(projectToMarkdown(project))?.[1] ?? null;

    expect(screenType(emptyProject("desktop"))).toBe("Desktop");
    expect(screenType(emptyProject("mobile"))).toBe("Mobile");
    expect(screenType(emptyProject("mobileLandscape"))).toBe("Mobile landscape");

    const custom: WireframeProject = {
      ...emptyProject("desktop"),
      canvas: { mode: "custom", width: 1000, height: 700 }
    };
    expect(screenType(custom)).toBe("Custom");
  });

  it("keeps the mode in the canonical source, not only in the Screen prose", () => {
    const project = emptyProject("mobileLandscape", "Landscape");
    const source = JSON.parse(extractProjectSource(projectToMarkdown(project))) as WireframeProject;
    expect(source.canvas.mode).toBe("mobileLandscape");
  });

  it("still imports documents whose Screen section said Custom for a landscape canvas", () => {
    // The label is prose only, so older exports keep working: the mode comes from ui-project.
    const project = emptyProject("mobileLandscape", "Landscape");
    const legacy = projectToMarkdown(project).replace("Type: Mobile landscape", "Type: Custom");
    const restored = projectFromMarkdown(legacy);
    expect(restored.canvas).toEqual({ mode: "mobileLandscape", width: 844, height: 390 });
  });
});

describe("invalid import", () => {
  it("reports a controlled error when the fence is missing", () => {
    expect(() => projectFromMarkdown("# Just a document\n\nno project here")).toThrow(MarkdownImportError);
    expect(() => projectFromMarkdown("")).toThrow(/empty/i);
  });

  it("reports a controlled error for malformed JSON", () => {
    const broken = "```ui-project\n{ this is not json }\n```";
    expect(() => projectFromMarkdown(broken)).toThrow(/not valid JSON/i);
  });

  it("reports a controlled error for an unsupported element type", () => {
    const payload = {
      version: 1,
      title: "Bad",
      canvas: { mode: "desktop", width: 1200, height: 800 },
      elements: [{ id: "a", type: "hologram", x: 0, y: 0, width: 10, height: 10, zIndex: 0 }]
    };
    expect(() => normalizeProject(payload)).toThrow(/unsupported type/i);
  });

  it("reports a controlled error for invalid canvas dimensions", () => {
    const payload = {
      version: 1,
      title: "Bad",
      canvas: { mode: "desktop", width: 0, height: 800 },
      elements: []
    };
    expect(() => normalizeProject(payload)).toThrow(/at least/i);
    expect(() => normalizeProject({ version: 1, canvas: { width: "wide" }, elements: [] })).toThrow(
      /must be numbers/i
    );
  });

  it("reports a controlled error for a wrong version", () => {
    expect(() =>
      normalizeProject({ version: 99, canvas: { width: 800, height: 600 }, elements: [] })
    ).toThrow(/version/i);
  });

  it("repairs recoverable data instead of failing", () => {
    const repaired = normalizeProject({
      version: 1,
      title: "  ",
      canvas: { width: 800, height: 600 },
      elements: [
        { id: "dup", type: "button", name: "ok", x: "12", y: 8, width: -5, height: 40, zIndex: 5 },
        { id: "dup", type: "text", label: "Hello", x: 4, y: 4, width: 100, height: 20 }
      ]
    });

    expect(repaired.title).toBe("Untitled");
    expect(repaired.elements[0].width).toBeGreaterThan(0);
    expect(repaired.elements[0].x).toBe(0);
    expect(repaired.elements[1].id).not.toBe("dup");
    expect(repaired.elements.map((element) => element.zIndex)).toEqual([0, 1]);
    expect(repaired.canvas.mode).toBe("custom");
    expect(repaired.layers.map((layer) => layer.name)).toEqual(["Default"]);
    expect(repaired.layers[0].id).toBe(repaired.elements[0].layerId);
    expect(
      normalizeProject({
        version: 1,
        canvas: { width: 390, height: 844 },
        elements: []
      }).canvas.mode
    ).toBe("mobile");
    expect(
      normalizeProject({
        version: 1,
        canvas: { width: 1200, height: 800 },
        elements: []
      }).canvas.mode
    ).toBe("desktop");
  });

  it("knows every declared element type", () => {
    for (const type of ELEMENT_TYPES) {
      const project = normalizeProject({
        version: 1,
        canvas: { width: 800, height: 600 },
        elements: [{ id: `x_${type}`, type, x: 0, y: 0, width: 40, height: 20, zIndex: 0 }]
      });
      expect(project.elements[0].type).toBe(type);
    }
  });
});
