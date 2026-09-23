import { describe, expect, it } from "vitest";
import { ELEMENT_TYPES, type WireframeElement, type WireframeProject } from "../model/project";
import { getAsciiDimensions, renderAscii, renderAsciiLines } from "./asciiRenderer";

type ElementSeed = Omit<WireframeElement, "layerId" | "visible" | "locked">;

const TEST_LAYER = { id: "layer_test", name: "Default", visible: true, locked: false };

function project(elements: ElementSeed[], width = 1200, height = 800): WireframeProject {
  return {
    version: 2,
    title: "Test",
    canvas: { mode: "desktop", width, height },
    layers: [TEST_LAYER],
    elements: elements.map((element) => ({
      layerId: TEST_LAYER.id,
      visible: true,
      locked: false,
      ...element
    }))
  };
}

describe("ascii renderer", () => {
  it("renders button labels", () => {
    const output = renderAscii(
      project([
        {
          id: "a",
          type: "button",
          name: "saveButton",
          label: "Save",
          note: "",
          x: 40,
          y: 40,
          width: 120,
          height: 40,
          zIndex: 0
        }
      ])
    );
    expect(output).toContain("[ Save ]");
  });

  it("renders input labels with a fill line", () => {
    const output = renderAscii(
      project([
        {
          id: "a",
          type: "input",
          name: "usernameInput",
          label: "Username",
          note: "",
          x: 100,
          y: 200,
          width: 380,
          height: 40,
          zIndex: 0
        }
      ])
    );
    expect(output).toContain("Username");
    expect(output).toContain("_");
  });

  it("reflects element positions", () => {
    const left = renderAsciiLines(
      project([
        {
          id: "a",
          type: "text",
          name: "heading",
          label: "Heading",
          note: "",
          x: 20,
          y: 20,
          width: 200,
          height: 30,
          zIndex: 0
        }
      ])
    );
    const right = renderAsciiLines(
      project([
        {
          id: "a",
          type: "text",
          name: "heading",
          label: "Heading",
          note: "",
          x: 900,
          y: 700,
          width: 200,
          height: 30,
          zIndex: 0
        }
      ])
    );

    const leftLine = left.find((line) => line.includes("Heading")) ?? "";
    const rightLine = right.find((line) => line.includes("Heading")) ?? "";
    expect(leftLine.indexOf("Heading")).toBeLessThan(rightLine.indexOf("Heading"));

    const leftRow = left.findIndex((line) => line.includes("Heading"));
    const rightRow = right.findIndex((line) => line.includes("Heading"));
    expect(leftRow).toBeLessThan(rightRow);
  });

  it("stays inside the configured character grid", () => {
    const dimensions = getAsciiDimensions({ width: 1200, height: 800 });
    const lines = renderAsciiLines(
      project([
        {
          id: "a",
          type: "sidebar",
          name: "sidebar",
          label: "Sections",
          note: "",
          x: 0,
          y: 0,
          width: 1200,
          height: 800,
          zIndex: 0,
          items: ["One", "Two", "Three"]
        },
        {
          id: "b",
          type: "button",
          name: "button",
          label: "A very long button label that should be clipped",
          note: "",
          x: 1150,
          y: 780,
          width: 400,
          height: 200,
          zIndex: 1
        }
      ])
    );

    expect(lines.length).toBeLessThanOrEqual(dimensions.rows);
    for (const line of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(dimensions.cols);
    }
  });

  it("uses a narrower grid for tall canvases", () => {
    const mobile = getAsciiDimensions({ width: 390, height: 844 });
    const desktop = getAsciiDimensions({ width: 1200, height: 800 });
    expect(mobile.cols).toBeLessThan(desktop.cols);
    expect(mobile.rows).toBeGreaterThan(desktop.rows);
  });

  it("is deterministic", () => {
    const elements: ElementSeed[] = [
      {
        id: "a",
        type: "image",
        name: "heroImage",
        label: "Hero",
        note: "",
        x: 300,
        y: 200,
        width: 400,
        height: 240,
        zIndex: 0
      },
      {
        id: "b",
        type: "toggle",
        name: "notificationsToggle",
        label: "Notifications",
        note: "",
        x: 300,
        y: 500,
        width: 260,
        height: 30,
        zIndex: 1
      }
    ];
    expect(renderAscii(project(elements))).toBe(renderAscii(project(elements)));
  });

  it("handles an empty project", () => {
    expect(() => renderAscii(project([]))).not.toThrow();
  });

  it("renders every element type within the character grid", () => {
    const dimensions = getAsciiDimensions({ width: 1200, height: 800 });
    const seeds: ElementSeed[] = ELEMENT_TYPES.map((type, index) => ({
      id: `el_${type}`,
      type,
      name: `${type}One`,
      label: type === "icon" ? "★" : type === "avatar" ? "AB" : "Label",
      note: "",
      x: (index % 4) * 290 + 20,
      y: Math.floor(index / 4) * 150 + 20,
      width: type === "divider" ? 240 : 240,
      height: type === "divider" ? 8 : 110,
      zIndex: index,
      items: type === "table" ? ["A | B", "C | D"] : ["Item 1", "Item 2"],
      columns: type === "table" ? ["One", "Two"] : undefined
    }));

    const lines = renderAsciiLines(project(seeds));
    expect(lines.length).toBeLessThanOrEqual(dimensions.rows);
    for (const line of lines) {
      expect(Array.from(line).length).toBeLessThanOrEqual(dimensions.cols);
    }
  });

  it("draws a container border without filling its interior", () => {
    const container = renderAsciiLines(
      project([
        {
          id: "c",
          type: "container",
          name: "containerOne",
          label: "Panel",
          note: "",
          x: 0,
          y: 0,
          width: 600,
          height: 400,
          zIndex: 0
        }
      ])
    );
    const interior = container[10] ?? "";
    expect(interior.startsWith("│")).toBe(true);
    expect(interior.slice(1, 20).trim()).toBe("");
  });

  it("renders table, dialog, bottom navigation and controls lexically", () => {
    const output = renderAscii(
      project([
        {
          id: "t",
          type: "table",
          name: "membersTable",
          label: "",
          note: "",
          x: 40,
          y: 40,
          width: 640,
          height: 200,
          zIndex: 0,
          columns: ["Name", "Role"],
          items: ["Anna | Owner", "Milo | Admin"]
        },
        {
          id: "d",
          type: "dialog",
          name: "confirmDialog",
          label: "Confirm",
          note: "",
          x: 40,
          y: 300,
          width: 400,
          height: 160,
          zIndex: 1
        },
        {
          id: "n",
          type: "bottomNav",
          name: "bottomNav",
          label: "",
          note: "",
          x: 40,
          y: 600,
          width: 560,
          height: 64,
          zIndex: 2,
          items: ["Home", "Search", "Profile"]
        },
        {
          id: "p",
          type: "progress",
          name: "uploadProgress",
          label: "",
          note: "",
          x: 40,
          y: 700,
          width: 240,
          height: 20,
          zIndex: 3
        },
        {
          id: "r",
          type: "radio",
          name: "planRadio",
          label: "Monthly",
          note: "",
          x: 700,
          y: 700,
          width: 200,
          height: 24,
          zIndex: 4
        }
      ])
    );

    expect(output).toContain("Name");
    expect(output).toContain("Anna");
    expect(output).toContain("Confirm");
    expect(output).toContain("Search");
    expect(output).toContain("█");
    expect(output).toContain("( ) Monthly");
  });
});
