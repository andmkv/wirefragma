import {
  DEFAULT_ICON_CONTENT_SIZE,
  DEFAULT_IMAGE_CONTENT_SIZE,
  DEFAULT_TEXT_STYLE,
  ELEMENT_TYPE_LABEL,
  PROJECT_VERSION,
  contentSizeOf,
  layerName,
  parentOf,
  textStyleOf,
  visibleElementsInDrawOrder,
  type WireframeElement,
  type WireframeProject
} from "../model/project";
import { renderAscii } from "./asciiRenderer";
import { buildSpatialSummary } from "./spatialSummary";

/**
 * Markdown export: the canonical interchange format of the app.
 *
 * The document is written for humans and LLMs; the fenced `ui-project` block
 * at the end is the machine-readable source of truth.
 */

export const PROJECT_FENCE = "ui-project";

export const LLM_PREAMBLE = `The following document describes a UI wireframe.

The ASCII section provides approximate spatial layout.
The UI Elements section provides semantic meaning and behavior.
The ui-project block is the canonical machine-readable representation.

Use both spatial and semantic information when reasoning about the interface.`;

function fenceSafe(value: string): string {
  return value.replace(/`/g, "'");
}

/**
 * Human label for the `## Screen` section.
 *
 * This is prose only: the importer never reads it, so an older document whose Screen section says
 * `Type: Custom` for a landscape project still imports correctly — the real mode always comes from
 * the `ui-project` block.
 */
function canvasModeLabel(project: WireframeProject): string {
  const { mode } = project.canvas;
  if (mode === "desktop") return "Desktop";
  if (mode === "mobile") return "Mobile";
  if (mode === "mobileLandscape") return "Mobile landscape";
  return "Custom";
}

function tableSections(element: WireframeElement): string[] {
  const lines: string[] = [];
  const columns = (element.columns ?? []).filter((column) => column.trim() !== "");
  if (columns.length > 0) {
    lines.push("Columns:", ...columns.map((column) => `- ${column.trim()}`));
  }
  const rows = (element.items ?? []).filter((row) => row.trim() !== "");
  if (rows.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Rows:", ...rows.map((row) => `- ${row.replace(/\s*\|\s*/g, " | ").trim()}`));
  }
  return lines;
}

const ALIGN_LABEL: Record<string, string> = { left: "Left", center: "Center", right: "Right" };

/**
 * Semantic typography block for a Text element — only the attributes that differ from the
 * defaults, so a plain Text element stays as short as it was before this feature existed.
 */
function typographySection(element: WireframeElement): string[] {
  if (element.type !== "text") return [];
  const style = textStyleOf(element);
  const attributes: string[] = [];
  if (style.fontSize !== DEFAULT_TEXT_STYLE.fontSize) attributes.push(`- Size: ${style.fontSize}`);
  if (style.bold) attributes.push("- Weight: Bold");
  if (style.italic) attributes.push("- Style: Italic");
  if (style.underline) attributes.push("- Style: Underlined");
  if (style.align !== DEFAULT_TEXT_STYLE.align) {
    attributes.push(`- Alignment: ${ALIGN_LABEL[style.align] ?? style.align}`);
  }
  return attributes.length > 0 ? ["Typography:", ...attributes] : [];
}

/** Icon / Image only: the rendered symbol size, when it is not the type's default. */
function contentSizeLine(element: WireframeElement): string | null {
  if (element.type !== "icon" && element.type !== "image") return null;
  const size = contentSizeOf(element);
  const fallback = element.type === "image" ? DEFAULT_IMAGE_CONTENT_SIZE : DEFAULT_ICON_CONTENT_SIZE;
  return size === fallback ? null : `Content size: ${size}px`;
}

function visibleContent(element: WireframeElement): string[] {
  const lines: string[] = [];
  if (element.type === "table") return lines;
  if (element.items && element.items.length > 0 && element.type !== "text") {
    lines.push(
      ...element.items
        .filter((item) => item.trim() !== "")
        .map((item) => `- ${item.replace(/\n/g, " ").trim()}`)
    );
  } else if (element.label && element.type !== "text") {
    lines.push(`- ${element.label.replace(/\n/g, " ").trim()}`);
  } else if (element.label) {
    lines.push(
      ...element.label
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => `- ${line.trim()}`)
    );
  }
  return lines;
}

function elementSection(project: WireframeProject, element: WireframeElement): string {
  const parts: string[] = [];
  parts.push(`### \`${fenceSafe(element.name)}\``);
  parts.push("");
  parts.push(`Type: ${ELEMENT_TYPE_LABEL[element.type]}`);
  parts.push("");
  parts.push(`Layer: ${layerName(project, element.layerId)}`);
  const parent = parentOf(project, element);
  if (parent) {
    parts.push("");
    parts.push(`Inside: \`${fenceSafe(parent.name)}\``);
  }
  if (element.label.trim()) {
    parts.push("");
    parts.push(`Label: ${element.label.replace(/\n+/g, " ").trim()}`);
  }
  parts.push("");
  parts.push(
    `Bounds: x=${Math.round(element.x)}, y=${Math.round(element.y)}, width=${Math.round(element.width)}, height=${Math.round(element.height)}`
  );

  const typography = typographySection(element);
  if (typography.length > 0) {
    parts.push("");
    parts.push(...typography);
  }

  const contentSize = contentSizeLine(element);
  if (contentSize) {
    parts.push("");
    parts.push(contentSize);
  }

  const content = visibleContent(element);
  if (content.length > 0) {
    parts.push("");
    parts.push("Visible content:");
    parts.push("");
    parts.push(...content);
  }

  const table = element.type === "table" ? tableSections(element) : [];
  if (table.length > 0) {
    parts.push("");
    parts.push(...table);
  }

  if (element.note.trim()) {
    parts.push("");
    parts.push("LLM note:");
    parts.push("");
    parts.push(element.note.trim());
  }

  return parts.join("\n");
}

export function projectToJson(project: WireframeProject, pretty = true): string {
  const payload = {
    version: PROJECT_VERSION,
    title: project.title,
    canvas: project.canvas,
    layers: project.layers,
    elements: project.elements
  };
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}

export function projectToMarkdown(project: WireframeProject): string {
  // The human/LLM sections describe the currently visible interface; hidden elements and
  // layers survive only in the canonical `ui-project` source below.
  const visible = visibleElementsInDrawOrder(project);
  const sections: string[] = [];

  sections.push(`# UI Wireframe: ${project.title}`);
  sections.push("");
  sections.push("Generated by Wirefragma.");

  sections.push("");
  sections.push("## Screen");
  sections.push("");
  sections.push(`Type: ${canvasModeLabel(project)}`);
  sections.push(`Canvas: ${Math.round(project.canvas.width)} × ${Math.round(project.canvas.height)}`);
  sections.push(`Elements: ${visible.length}`);
  if (visible.length !== project.elements.length) {
    sections.push(`Hidden elements omitted: ${project.elements.length - visible.length}`);
  }
  const layerList = project.layers.map((layer) => `${layer.name}${layer.visible ? "" : " (hidden)"}`);
  sections.push(`Layers (front to back): ${layerList.join(" → ")}`);

  sections.push("");
  sections.push("## ASCII Wireframe");
  sections.push("");
  sections.push("```text");
  sections.push(renderAscii(project));
  sections.push("```");

  sections.push("");
  sections.push("## UI Elements");
  if (visible.length === 0) {
    sections.push("");
    sections.push("_No elements on the canvas._");
  } else {
    for (const element of visible) {
      sections.push("");
      sections.push(elementSection(project, element));
    }
  }

  sections.push("");
  sections.push("## Spatial Summary");
  sections.push("");
  sections.push(...buildSpatialSummary(project));

  sections.push("");
  sections.push("## Editable Project Source");
  sections.push("");
  sections.push(`\`\`\`${PROJECT_FENCE}`);
  // A backtick run inside a note or label ("```js") would close the fence early. `\u0060` is the
  // same character in JSON, so the block still parses to exactly the same project.
  sections.push(projectToJson(project).replace(/`/g, "\\u0060"));
  sections.push("```");
  sections.push("");

  return sections.join("\n");
}

/** Same document, prefixed with a short orientation note for chat models. */
export function projectToLlmMarkdown(project: WireframeProject): string {
  return `${LLM_PREAMBLE}\n\n---\n\n${projectToMarkdown(project)}`;
}

export function markdownFilename(project: WireframeProject, extension = "md"): string {
  const slug = project.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "wireframe"}.${extension}`;
}
