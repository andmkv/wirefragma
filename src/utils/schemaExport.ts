/**
 * "WIREFRAGMA schema" export: LLM-ready instructions for WRITING a Wirefragma project.
 *
 * The Markdown export explains one existing screen to a model; this document teaches a model the
 * project format itself, so it can generate a JSON document that pastes straight into Import and
 * becomes an editable wireframe. Everything that can drift (types, defaults, limits, presets) is
 * generated from the model constants, and `TYPE_GUIDE` is a typed record, so adding an element type
 * without documenting it here is a compile error.
 */

import { CANVAS_PRESETS, ELEMENT_DEFAULTS } from "../model/defaults";
import {
  CANVAS_MODES,
  DEFAULT_ICON_CONTENT_SIZE,
  DEFAULT_IMAGE_CONTENT_SIZE,
  DEFAULT_TEXT_STYLE,
  ELEMENT_TYPES,
  ELEMENT_TYPE_LABEL,
  MAX_CANVAS_SIZE,
  MAX_CONTENT_SIZE,
  MAX_FONT_SIZE,
  MIN_CANVAS_SIZE,
  MIN_CONTENT_SIZE,
  MIN_ELEMENT_SIZE,
  MIN_FONT_SIZE,
  PROJECT_VERSION,
  type ElementType
} from "../model/project";
import { DIAGRAM_OBJECT_TYPES, DEFAULT_DIAGRAM_SIZE } from "../model/diagram";
import { DEFAULT_DRAWING_SIZE, DRAWING_PEN_WIDTHS, MAX_SCENE_SIZE, MIN_SCENE_SIZE } from "../model/drawing";
import { PROJECT_FENCE } from "./markdownExport";

const scenePoint = { type: "object", required: ["x", "y"], properties: { x: { type: "number" }, y: { type: "number" } } };
const sceneSize = {
  width: { type: "number", minimum: MIN_SCENE_SIZE, maximum: MAX_SCENE_SIZE },
  height: { type: "number", minimum: MIN_SCENE_SIZE, maximum: MAX_SCENE_SIZE }
};

/** What `label` / `items` / `columns` mean for each type — the part a model cannot guess. */
export const TYPE_GUIDE: Record<ElementType, string> = {
  container:
    "Generic box/section/card. `label` (optional) is a small title drawn on the border. Put the section's content inside it with `parentId`.",
  text: "Heading, paragraph or caption. `label` is the text (may contain `\\n` for several lines). Style it with `textStyle`.",
  button: "Push button. `label` is the caption.",
  input: "Single-line text field. `label` is the placeholder or current value.",
  textarea: "Multi-line text field. `label` is the placeholder/value.",
  checkbox: "Checkbox with a caption. `label` is the caption.",
  radio: "Radio option with a caption. `label` is the caption; use one element per option.",
  toggle: "On/off switch with a caption. `label` is the caption.",
  dropdown: "Select / combo box. `label` is the selected value or placeholder.",
  slider: "Range slider. `label` is an optional caption.",
  progress: "Progress bar. `label` is optional; describe the value in `note`.",
  iconButton: "Square icon-only button. `label` is one symbol or emoji, e.g. `+`, `⚙️`, `🔍`.",
  tabs: "Tab strip. `items` are the tab titles, left to right; say which one is active in `note`.",
  list: "Vertical list. `items` are the rows, top to bottom.",
  table:
    "Data table. `columns` are the header cells; each entry of `items` is one row with cells separated by ` | ` (e.g. `\"Alice | Admin | Active\"`).",
  image:
    "Picture placeholder. Empty `label` draws a crossed placeholder; an emoji `label` draws that symbol at `contentSize`.",
  icon: "Standalone symbol. `label` is one emoji or symbol, drawn at `contentSize`.",
  avatar: "Round user picture. `label` is 1–3 initials or an emoji.",
  badge: "Chip / tag / status pill. `label` is the text.",
  divider: "Horizontal separator line. No label.",
  toolbar: "Top app bar / header strip. `label` is its title; put its buttons inside it with `parentId`.",
  sidebar: "Side navigation. `label` is the header; `items` are the navigation entries, top to bottom.",
  bottomNav: "Mobile bottom navigation bar. `items` are the destinations, left to right.",
  dialog: "Modal window. `label` is its title; put its content inside it with `parentId`.",
  diagram:
    "\"Canvas\": a small structured diagram (flow, schema, map). `label` is its title; the shapes go in `diagram` (see below), never as separate elements.",
  drawing:
    "Freehand sketch. The strokes go in `drawing.strokes`; `drawing.description` says what it shows — without a description the sketch is left out of the LLM export."
};

function typeTable(): string[] {
  const rows = ELEMENT_TYPES.map((type) => {
    const defaults = ELEMENT_DEFAULTS[type];
    const size = `${defaults.width}×${defaults.height}`;
    return `| \`${type}\` | ${ELEMENT_TYPE_LABEL[type]} | ${size} | ${TYPE_GUIDE[type]} |`;
  });
  return ["| type | name in the UI | default w×h | how to fill it |", "| --- | --- | --- | --- |", ...rows];
}

function presetList(): string {
  return Object.entries(CANVAS_PRESETS)
    .map(([mode, size]) => `\`${mode}\` ${size.width}×${size.height}`)
    .join(", ");
}

/** A small, complete, valid project used as the worked example (pinned by tests). */
export function schemaExampleProject() {
  return {
    version: PROJECT_VERSION,
    title: "Sign in",
    canvas: { mode: "mobile", width: 390, height: 844 },
    layers: [
      { id: "layer_form", name: "Form", visible: true, locked: false },
      { id: "layer_page", name: "Page", visible: true, locked: false }
    ],
    elements: [
      {
        id: "el_header",
        type: "toolbar",
        name: "appHeader",
        label: "Acme",
        note: "Sticky header. Tapping the logo opens the landing page.",
        x: 0,
        y: 0,
        width: 390,
        height: 56,
        layerId: "layer_page",
        visible: true,
        locked: false,
        zIndex: 0
      },
      {
        id: "el_card",
        type: "container",
        name: "signInCard",
        label: "",
        note: "Centered card that holds the whole sign-in form.",
        x: 24,
        y: 120,
        width: 342,
        height: 360,
        layerId: "layer_form",
        visible: true,
        locked: false,
        zIndex: 0
      },
      {
        id: "el_title",
        type: "text",
        name: "signInTitle",
        label: "Welcome back",
        note: "",
        x: 48,
        y: 144,
        width: 294,
        height: 32,
        layerId: "layer_form",
        parentId: "el_card",
        visible: true,
        locked: false,
        zIndex: 1,
        textStyle: { fontSize: 24, bold: true }
      },
      {
        id: "el_email",
        type: "input",
        name: "emailInput",
        label: "Email",
        note: "Email field, validated on blur. Shows an inline error under the field.",
        x: 48,
        y: 200,
        width: 294,
        height: 40,
        layerId: "layer_form",
        parentId: "el_card",
        visible: true,
        locked: false,
        zIndex: 2
      },
      {
        id: "el_password",
        type: "input",
        name: "passwordInput",
        label: "Password",
        note: "Masked password field with a show/hide eye icon on the right.",
        x: 48,
        y: 256,
        width: 294,
        height: 40,
        layerId: "layer_form",
        parentId: "el_card",
        visible: true,
        locked: false,
        zIndex: 3
      },
      {
        id: "el_remember",
        type: "checkbox",
        name: "rememberMe",
        label: "Remember me",
        note: "",
        x: 48,
        y: 312,
        width: 200,
        height: 24,
        layerId: "layer_form",
        parentId: "el_card",
        visible: true,
        locked: false,
        zIndex: 4
      },
      {
        id: "el_submit",
        type: "button",
        name: "signInButton",
        label: "Sign in",
        note: "Primary action. Disabled until both fields are filled; shows a spinner while submitting.",
        x: 48,
        y: 360,
        width: 294,
        height: 44,
        layerId: "layer_form",
        parentId: "el_card",
        visible: true,
        locked: false,
        zIndex: 5
      }
    ]
  };
}

/** JSON Schema (draft 2020-12) of the importable document, for tools with structured output. */
export function projectJsonSchema() {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "Wirefragma project",
    type: "object",
    required: ["version", "title", "canvas", "layers", "elements"],
    properties: {
      version: { const: PROJECT_VERSION },
      title: { type: "string" },
      canvas: {
        type: "object",
        required: ["mode", "width", "height"],
        properties: {
          mode: { enum: [...CANVAS_MODES] },
          width: { type: "number", minimum: MIN_CANVAS_SIZE, maximum: MAX_CANVAS_SIZE },
          height: { type: "number", minimum: MIN_CANVAS_SIZE, maximum: MAX_CANVAS_SIZE }
        }
      },
      layers: {
        type: "array",
        minItems: 1,
        description: "Front-most layer first.",
        items: {
          type: "object",
          required: ["id", "name"],
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            visible: { type: "boolean", default: true },
            locked: { type: "boolean", default: false }
          }
        }
      },
      elements: {
        type: "array",
        description: "Back-to-front paint order; children after their parent.",
        items: {
          type: "object",
          required: ["id", "type", "name", "x", "y", "width", "height", "layerId"],
          properties: {
            id: { type: "string" },
            type: { enum: [...ELEMENT_TYPES] },
            name: { type: "string" },
            label: { type: "string", default: "" },
            note: { type: "string", default: "" },
            x: { type: "number" },
            y: { type: "number" },
            width: { type: "number", minimum: MIN_ELEMENT_SIZE },
            height: { type: "number", minimum: MIN_ELEMENT_SIZE },
            layerId: { type: "string" },
            parentId: { type: "string" },
            visible: { type: "boolean", default: true },
            locked: { type: "boolean", default: false },
            zIndex: { type: "integer" },
            items: { type: "array", items: { type: "string" } },
            columns: { type: "array", items: { type: "string" } },
            textStyle: {
              type: "object",
              properties: {
                fontSize: { type: "integer", minimum: MIN_FONT_SIZE, maximum: MAX_FONT_SIZE },
                bold: { type: "boolean" },
                italic: { type: "boolean" },
                underline: { type: "boolean" },
                align: { enum: ["left", "center", "right"] }
              }
            },
            contentSize: { type: "integer", minimum: MIN_CONTENT_SIZE, maximum: MAX_CONTENT_SIZE },
            diagram: {
              type: "object",
              description: "`diagram` (Canvas) elements only: shapes in the scene's own coordinate space.",
              required: ["width", "height", "objects"],
              properties: {
                ...sceneSize,
                description: { type: "string" },
                objects: {
                  type: "array",
                  description: "Back-to-front paint order.",
                  items: {
                    type: "object",
                    required: ["id", "type"],
                    properties: {
                      id: { type: "string" },
                      type: { enum: [...DIAGRAM_OBJECT_TYPES] },
                      label: { type: "string" },
                      x: { type: "number" },
                      y: { type: "number" },
                      width: { type: "number" },
                      height: { type: "number" },
                      x1: { type: "number" },
                      y1: { type: "number" },
                      x2: { type: "number" },
                      y2: { type: "number" },
                      start: scenePoint,
                      control1: scenePoint,
                      control2: scenePoint,
                      end: scenePoint
                    }
                  }
                }
              }
            },
            drawing: {
              type: "object",
              description: "`drawing` elements only: freehand strokes in the drawing's own coordinate space.",
              required: ["width", "height", "strokes"],
              properties: {
                ...sceneSize,
                description: { type: "string" },
                strokes: {
                  type: "array",
                  items: {
                    type: "object",
                    required: ["points", "width"],
                    properties: { points: { type: "array", items: scenePoint }, width: { type: "number" } }
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}

/** The full LLM-ready instruction document. */
export function wirefragmaSchemaMarkdown(): string {
  const lines: string[] = [];
  const push = (...values: string[]) => lines.push(...values);

  push(
    "# WIREFRAGMA project format — instructions for generating wireframes",
    "",
    "You are going to design a user-interface wireframe and return it as a **Wirefragma project**:",
    "a JSON document that the Wirefragma editor imports and turns into an editable wireframe.",
    "Wirefragma draws generic grey wireframe primitives only — no colours, fonts, images or icons",
    "beyond emoji. Describe look-and-feel and behaviour in each element's `note` instead.",
    "",
    "## Output rules",
    "",
    `1. Answer with exactly one fenced code block whose info string is \`${PROJECT_FENCE}\` and whose body is the JSON project.`,
    "   Plain JSON (`{ ... }`) or a ```` ```json ```` block also imports, but prefer the fenced form.",
    "2. Strict JSON: double quotes, no comments, no trailing commas, no `undefined`/`NaN`.",
    "3. Every `id` is unique across layers and elements. Use short readable ids like `el_submit`, `layer_form`.",
    "4. Every element's `layerId` points at a layer in `layers`; every `parentId` points at another element.",
    "5. Coordinates are integers. Keep every element inside the canvas.",
    "",
    "## Coordinate system",
    "",
    "- Units are logical pixels. The origin (0, 0) is the canvas's top-left corner; x grows right, **y grows down**.",
    "- `x`, `y` are the element's top-left corner; `width`, `height` its size. Coordinates are always",
    "  **absolute canvas coordinates**, also for nested elements (a child is not positioned relative to its parent).",
    `- Canvas presets: ${presetList()}; \`custom\` accepts any size from ${MIN_CANVAS_SIZE} to ${MAX_CANVAS_SIZE}.`,
    `- Minimum element size is ${MIN_ELEMENT_SIZE}×${MIN_ELEMENT_SIZE}. Snap to an 8 px grid for tidy layouts.`,
    "",
    "## Document shape",
    "",
    "```ts",
    "{",
    `  version: ${PROJECT_VERSION};                       // always ${PROJECT_VERSION}`,
    "  title: string;                    // screen name",
    `  canvas: { mode: ${CANVAS_MODES.map((mode) => `"${mode}"`).join(" | ")}; width: number; height: number };`,
    "  layers: Layer[];                  // FRONT-most layer first, at least one",
    "  elements: Element[];              // BACK-to-front paint order",
    "}",
    "",
    "Layer = { id: string; name: string; visible: boolean; locked: boolean }",
    "",
    "Element = {",
    "  id: string;                       // unique",
    "  type: ElementType;                // see the table below",
    "  name: string;                     // semantic camelCase id: \"emailInput\", \"saveButton\"",
    "  label: string;                    // the visible text / emoji (\"\" when none)",
    "  note: string;                     // behaviour, states, data, look — written for a developer or LLM",
    "  x: number; y: number; width: number; height: number;",
    "  layerId: string;                  // the layer it belongs to",
    "  parentId?: string;                // optional: the element it is nested in (same layer)",
    "  visible: boolean;                 // true",
    "  locked: boolean;                  // false",
    "  zIndex: number;                   // position inside its layer, 0 = back (recomputed on import)",
    "  items?: string[];                 // tabs / list / sidebar / bottomNav entries, table rows",
    "  columns?: string[];               // table header cells",
    "  textStyle?: { fontSize?: number; bold?: boolean; italic?: boolean; underline?: boolean;",
    "                align?: \"left\" | \"center\" | \"right\" };   // `text` only",
    "  contentSize?: number;             // `icon` / `image` symbol size",
    "  diagram?: Diagram;                // `diagram` (Canvas) only, see below",
    "  drawing?: Drawing;                // `drawing` only, see below",
    "}",
    "```",
    "",
    "## Element types",
    "",
    ...typeTable(),
    "",
    "## Layers, stacking and nesting",
    "",
    "- `layers[0]` is drawn on top of `layers[1]`, and so on. Use layers for big independent planes:",
    "  page content, a modal/overlay, a popover. One layer is fine for a simple screen.",
    "- Inside a layer, `elements` later in the array are drawn on top of earlier ones.",
    "- **Nesting:** set `parentId` to put an element inside another one (a card's fields inside the card,",
    "  a toolbar's buttons inside the toolbar, a dialog's content inside the dialog). A child must use",
    "  its parent's `layerId`, must be listed after its parent, is always drawn in front of it, and",
    "  should lie inside the parent's bounds.",
    "- Use `visible: false` for alternative states you want to keep in the file (e.g. an error banner).",
    "",
    "## Text, symbols and content",
    "",
    `- \`textStyle\` applies to \`text\` elements only. Defaults: fontSize ${DEFAULT_TEXT_STYLE.fontSize}, not bold/italic/underlined, align left.`,
    `  fontSize range ${MIN_FONT_SIZE}–${MAX_FONT_SIZE}. Omit fields that keep the default. Give a text element a height of about fontSize × 1.4 per line.`,
    `- \`contentSize\` applies to \`icon\` and \`image\` (default ${DEFAULT_ICON_CONTENT_SIZE} for icons, ${DEFAULT_IMAGE_CONTENT_SIZE} for images; range ${MIN_CONTENT_SIZE}–${MAX_CONTENT_SIZE}).`,
    "- Emoji are welcome as icon/iconButton/avatar/image labels (`🔍`, `⚙️`, `🛒`).",
    "- Omit `items`/`columns` for types that do not use them.",
    "",
    "## Canvas (`diagram`) and Drawing",
    "",
    "Both hold a small scene in their OWN coordinate space (`width` × `height`, origin top-left, y down),",
    "fitted into the element's bounds. Scene coordinates never change when the element is moved or resized.",
    "",
    "```ts",
    `Diagram = { width: number; height: number;            // e.g. ${DEFAULT_DIAGRAM_SIZE.width} × ${DEFAULT_DIAGRAM_SIZE.height}`,
    "            description?: string;                     // optional context for the whole diagram",
    "            objects: DiagramObject[] }                // back-to-front",
    "DiagramObject =",
    "  | { id; type: \"rectangle\" | \"ellipse\" | \"text\"; x; y; width; height; label? }   // text: label is the text",
    "  | { id; type: \"line\" | \"arrow\"; x1; y1; x2; y2; label? }                       // arrow points at (x2, y2)",
    "  | { id; type: \"bezier\"; start; control1; control2; end; label? }                 // points are { x, y }",
    `Drawing = { width: number; height: number;            // e.g. ${DEFAULT_DRAWING_SIZE.width} × ${DEFAULT_DRAWING_SIZE.height}`,
    `            strokes: { points: { x; y }[]; width: number }[];   // pen widths ${DRAWING_PEN_WIDTHS.join(" / ")}`,
    "            description?: string }",
    "```",
    "",
    "- Prefer a Canvas for anything structural (flows, schemas, maps): label every shape and connector,",
    "  and start/end arrows on the shapes they connect — the export derives relationships from that geometry.",
    "- A Drawing is for illustrations only. Always write its `description`; an empty `strokes` array is fine.",
    "",
    "## Writing good notes",
    "",
    "`note` is where the wireframe carries intent. Mention: what the element does on click/tap, its",
    "states (empty, loading, error, disabled), what data it shows and where it comes from, validation",
    "rules, and any visual emphasis (primary/secondary, destructive). Keep each note to 1–3 sentences.",
    "Give every element a meaningful `name`; names should be unique.",
    "",
    "## What the importer repairs (do not rely on it)",
    "",
    "Missing/duplicate ids are regenerated, an unknown `layerId` falls back to the back-most layer,",
    "dangling or cyclic `parentId`s are dropped, sizes below the minimum are clamped and `zIndex` is",
    "recomputed. An unknown `type`, a missing canvas size or a non-array `elements` makes the import fail.",
    "",
    "## Complete example",
    "",
    `\`\`\`${PROJECT_FENCE}`,
    JSON.stringify(schemaExampleProject(), null, 2),
    "```",
    "",
    "## JSON Schema",
    "",
    "For tools that support structured output:",
    "",
    "```json",
    JSON.stringify(projectJsonSchema(), null, 2),
    "```",
    "",
    "## Your task",
    "",
    "Design the screen the user describes. Choose a canvas preset, lay the elements out on the grid,",
    "nest them sensibly, write useful notes, and return the project in a single",
    `\`${PROJECT_FENCE}\` block.`,
    ""
  );
  return lines.join("\n");
}
