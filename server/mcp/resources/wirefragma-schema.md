# WIREFRAGMA project format — instructions for generating wireframes

You are going to create or edit user-interface wireframes stored in a Wirefragma account, through the
Wirefragma MCP server. Every wireframe is one **Wirefragma project**: a JSON document that the editor opens as an editable wireframe.
Wirefragma draws generic grey wireframe primitives only — no colours, fonts, images or icons
beyond emoji. Describe look-and-feel and behaviour in each element's `note` instead.

## Output rules

1. Pass the project as the `data` argument of `create_wireframe` or `update_wireframe`: a JSON object, not a string
   and not a fenced block. The server validates it against the JSON Schema at the end of this document.
2. Numbers are plain JSON numbers; no `NaN`, no `Infinity`, no comments.
3. Every `id` is unique across layers and elements. Use short readable ids like `el_submit`, `layer_form`.
4. Every element's `layerId` points at a layer in `layers`; every `parentId` points at another element.
5. Coordinates are integers. Keep every element inside the canvas.

## Editing an existing wireframe (critical)

1. Call `get_wireframe` and keep its `revision`.
2. Change the minimum necessary part of the returned `data`. Keep every other element, layer, id and
   field exactly as it was — including fields this document does not describe (newer Wirefragma versions
   and other clients may store data you do not know about).
3. Call `update_wireframe` with the whole modified document and `baseRevision` = that revision.
4. On a `conflict` error somebody else saved in between: the error carries the current document and
   revision. Re-apply your intended change to THAT document and retry with the new revision. Never
   discard the other change, and never retry the old document unchanged.

## Coordinate system

- Units are logical pixels. The origin (0, 0) is the canvas's top-left corner; x grows right, **y grows down**.
- `x`, `y` are the element's top-left corner; `width`, `height` its size. Coordinates are always
  **absolute canvas coordinates**, also for nested elements (a child is not positioned relative to its parent).
- Canvas presets: `desktop` 1200×800, `mobile` 390×844, `mobileLandscape` 844×390; `custom` accepts any size from 120 to 6000.
- Minimum element size is 8×8. Snap to an 8 px grid for tidy layouts.

## Document shape

```ts
{
  version: 2;                       // always 2
  title: string;                    // screen name
  canvas: { mode: "desktop" | "mobile" | "mobileLandscape" | "custom"; width: number; height: number };
  layers: Layer[];                  // FRONT-most layer first, at least one
  elements: Element[];              // BACK-to-front paint order
}

Layer = { id: string; name: string; visible: boolean; locked: boolean }

Element = {
  id: string;                       // unique
  type: ElementType;                // see the table below
  name: string;                     // semantic camelCase id: "emailInput", "saveButton"
  label: string;                    // the visible text / emoji ("" when none)
  note: string;                     // behaviour, states, data, look — written for a developer or LLM
  x: number; y: number; width: number; height: number;
  layerId: string;                  // the layer it belongs to
  parentId?: string;                // optional: the element it is nested in (same layer)
  visible: boolean;                 // true
  locked: boolean;                  // false
  zIndex: number;                   // position inside its layer, 0 = back (recomputed on import)
  items?: string[];                 // tabs / list / sidebar / bottomNav entries, table rows
  columns?: string[];               // table header cells
  textStyle?: { fontSize?: number; bold?: boolean; italic?: boolean; underline?: boolean;
                align?: "left" | "center" | "right" };   // `text` only
  contentSize?: number;             // `icon` / `image` symbol size
  diagram?: Diagram;                // `diagram` (Canvas) only, see below
  drawing?: Drawing;                // `drawing` only, see below
}
```

## Element types

| type | name in the UI | default w×h | how to fill it |
| --- | --- | --- | --- |
| `container` | Container | 320×200 | Generic box/section/card. `label` (optional) is a small title drawn on the border. Put the section's content inside it with `parentId`. |
| `text` | Text | 220×24 | Heading, paragraph or caption. `label` is the text (may contain `\n` for several lines). Style it with `textStyle`. |
| `button` | Button | 120×40 | Push button. `label` is the caption. |
| `input` | Input | 260×40 | Single-line text field. `label` is the placeholder or current value. |
| `textarea` | Textarea | 260×96 | Multi-line text field. `label` is the placeholder/value. |
| `checkbox` | Checkbox | 200×24 | Checkbox with a caption. `label` is the caption. |
| `radio` | Radio | 200×24 | Radio option with a caption. `label` is the caption; use one element per option. |
| `toggle` | Toggle | 200×28 | On/off switch with a caption. `label` is the caption. |
| `dropdown` | Dropdown | 240×40 | Select / combo box. `label` is the selected value or placeholder. |
| `slider` | Slider | 220×24 | Range slider. `label` is an optional caption. |
| `progress` | Progress | 220×20 | Progress bar. `label` is optional; describe the value in `note`. |
| `iconButton` | Icon Button | 40×40 | Square icon-only button. `label` is one symbol or emoji, e.g. `+`, `⚙️`, `🔍`. |
| `tabs` | Tabs | 320×36 | Tab strip. `items` are the tab titles, left to right; say which one is active in `note`. |
| `list` | List | 280×168 | Vertical list. `items` are the rows, top to bottom. |
| `table` | Table | 420×180 | Data table. `columns` are the header cells; each entry of `items` is one row with cells separated by ` | ` (e.g. `"Alice | Admin | Active"`). |
| `image` | Image | 220×150 | Picture placeholder. Empty `label` draws a crossed placeholder; an emoji `label` draws that symbol at `contentSize`. |
| `icon` | Icon | 32×32 | Standalone symbol. `label` is one emoji or symbol, drawn at `contentSize`. |
| `avatar` | Avatar | 40×40 | Round user picture. `label` is 1–3 initials or an emoji. |
| `badge` | Badge / Chip | 96×28 | Chip / tag / status pill. `label` is the text. |
| `divider` | Divider | 320×8 | Horizontal separator line. No label. |
| `toolbar` | Toolbar | 480×48 | Top app bar / header strip. `label` is its title; put its buttons inside it with `parentId`. |
| `sidebar` | Sidebar | 220×400 | Side navigation. `label` is the header; `items` are the navigation entries, top to bottom. |
| `bottomNav` | Bottom Navigation | 360×64 | Mobile bottom navigation bar. `items` are the destinations, left to right. |
| `dialog` | Dialog | 360×240 | Modal window. `label` is its title; put its content inside it with `parentId`. |
| `diagram` | Canvas | 450×300 | "Canvas": a small structured diagram (flow, schema, map). `label` is its title; the shapes go in `diagram` (see below), never as separate elements. |
| `drawing` | Drawing | 240×180 | Freehand sketch. The strokes go in `drawing.strokes`; `drawing.description` says what it shows — without a description the sketch is left out of the LLM export. |

## Layers, stacking and nesting

- `layers[0]` is drawn on top of `layers[1]`, and so on. Use layers for big independent planes:
  page content, a modal/overlay, a popover. One layer is fine for a simple screen.
- Inside a layer, `elements` later in the array are drawn on top of earlier ones.
- **Nesting:** set `parentId` to put an element inside another one (a card's fields inside the card,
  a toolbar's buttons inside the toolbar, a dialog's content inside the dialog). A child must use
  its parent's `layerId`, must be listed after its parent, is always drawn in front of it, and
  should lie inside the parent's bounds.
- Use `visible: false` for alternative states you want to keep in the file (e.g. an error banner).

## Text, symbols and content

- `textStyle` applies to `text` elements only. Defaults: fontSize 16, not bold/italic/underlined, align left.
  fontSize range 8–96. Omit fields that keep the default. Give a text element a height of about fontSize × 1.4 per line.
- `contentSize` applies to `icon` and `image` (default 24 for icons, 48 for images; range 8–256).
- Emoji are welcome as icon/iconButton/avatar/image labels (`🔍`, `⚙️`, `🛒`).
- Omit `items`/`columns` for types that do not use them.

## Canvas (`diagram`) and Drawing

Both hold a small scene in their OWN coordinate space (`width` × `height`, origin top-left, y down),
fitted into the element's bounds. Scene coordinates never change when the element is moved or resized.

```ts
Diagram = { width: number; height: number;            // e.g. 600 × 400
            description?: string;                     // optional context for the whole diagram
            objects: DiagramObject[] }                // back-to-front
DiagramObject =
  | { id; type: "rectangle" | "ellipse" | "text"; x; y; width; height; label? }   // text: label is the text
  | { id; type: "line" | "arrow"; x1; y1; x2; y2; label? }                       // arrow points at (x2, y2)
  | { id; type: "bezier"; start; control1; control2; end; label? }                 // points are { x, y }
Drawing = { width: number; height: number;            // e.g. 480 × 360
            strokes: { points: { x; y }[]; width: number }[];   // pen widths 2 / 4 / 8
            description?: string }
```

- Prefer a Canvas for anything structural (flows, schemas, maps): label every shape and connector,
  and start/end arrows on the shapes they connect — the export derives relationships from that geometry.
- A Drawing is for illustrations only. Always write its `description`; an empty `strokes` array is fine.

## Writing good notes

`note` is where the wireframe carries intent. Mention: what the element does on click/tap, its
states (empty, loading, error, disabled), what data it shows and where it comes from, validation
rules, and any visual emphasis (primary/secondary, destructive). Keep each note to 1–3 sentences.
Give every element a meaningful `name`; names should be unique.

## What the importer repairs (do not rely on it)

Missing/duplicate ids are regenerated, an unknown `layerId` falls back to the back-most layer,
dangling or cyclic `parentId`s are dropped, sizes below the minimum are clamped and `zIndex` is
recomputed. An unknown `type`, a missing canvas size or a non-array `elements` makes the import fail.

## Complete example

```ui-project
{
  "version": 2,
  "title": "Sign in",
  "canvas": {
    "mode": "mobile",
    "width": 390,
    "height": 844
  },
  "layers": [
    {
      "id": "layer_form",
      "name": "Form",
      "visible": true,
      "locked": false
    },
    {
      "id": "layer_page",
      "name": "Page",
      "visible": true,
      "locked": false
    }
  ],
  "elements": [
    {
      "id": "el_header",
      "type": "toolbar",
      "name": "appHeader",
      "label": "Acme",
      "note": "Sticky header. Tapping the logo opens the landing page.",
      "x": 0,
      "y": 0,
      "width": 390,
      "height": 56,
      "layerId": "layer_page",
      "visible": true,
      "locked": false,
      "zIndex": 0
    },
    {
      "id": "el_card",
      "type": "container",
      "name": "signInCard",
      "label": "",
      "note": "Centered card that holds the whole sign-in form.",
      "x": 24,
      "y": 120,
      "width": 342,
      "height": 360,
      "layerId": "layer_form",
      "visible": true,
      "locked": false,
      "zIndex": 0
    },
    {
      "id": "el_title",
      "type": "text",
      "name": "signInTitle",
      "label": "Welcome back",
      "note": "",
      "x": 48,
      "y": 144,
      "width": 294,
      "height": 32,
      "layerId": "layer_form",
      "parentId": "el_card",
      "visible": true,
      "locked": false,
      "zIndex": 1,
      "textStyle": {
        "fontSize": 24,
        "bold": true
      }
    },
    {
      "id": "el_email",
      "type": "input",
      "name": "emailInput",
      "label": "Email",
      "note": "Email field, validated on blur. Shows an inline error under the field.",
      "x": 48,
      "y": 200,
      "width": 294,
      "height": 40,
      "layerId": "layer_form",
      "parentId": "el_card",
      "visible": true,
      "locked": false,
      "zIndex": 2
    },
    {
      "id": "el_password",
      "type": "input",
      "name": "passwordInput",
      "label": "Password",
      "note": "Masked password field with a show/hide eye icon on the right.",
      "x": 48,
      "y": 256,
      "width": 294,
      "height": 40,
      "layerId": "layer_form",
      "parentId": "el_card",
      "visible": true,
      "locked": false,
      "zIndex": 3
    },
    {
      "id": "el_remember",
      "type": "checkbox",
      "name": "rememberMe",
      "label": "Remember me",
      "note": "",
      "x": 48,
      "y": 312,
      "width": 200,
      "height": 24,
      "layerId": "layer_form",
      "parentId": "el_card",
      "visible": true,
      "locked": false,
      "zIndex": 4
    },
    {
      "id": "el_submit",
      "type": "button",
      "name": "signInButton",
      "label": "Sign in",
      "note": "Primary action. Disabled until both fields are filled; shows a spinner while submitting.",
      "x": 48,
      "y": 360,
      "width": 294,
      "height": 44,
      "layerId": "layer_form",
      "parentId": "el_card",
      "visible": true,
      "locked": false,
      "zIndex": 5
    }
  ]
}
```

## JSON Schema

For tools that support structured output:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "Wirefragma project",
  "type": "object",
  "required": [
    "version",
    "title",
    "canvas",
    "layers",
    "elements"
  ],
  "properties": {
    "version": {
      "const": 2
    },
    "title": {
      "type": "string"
    },
    "canvas": {
      "type": "object",
      "required": [
        "mode",
        "width",
        "height"
      ],
      "properties": {
        "mode": {
          "enum": [
            "desktop",
            "mobile",
            "mobileLandscape",
            "custom"
          ]
        },
        "width": {
          "type": "number",
          "minimum": 120,
          "maximum": 6000
        },
        "height": {
          "type": "number",
          "minimum": 120,
          "maximum": 6000
        }
      }
    },
    "layers": {
      "type": "array",
      "minItems": 1,
      "description": "Front-most layer first.",
      "items": {
        "type": "object",
        "required": [
          "id",
          "name"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "visible": {
            "type": "boolean",
            "default": true
          },
          "locked": {
            "type": "boolean",
            "default": false
          }
        }
      }
    },
    "elements": {
      "type": "array",
      "description": "Back-to-front paint order; children after their parent.",
      "items": {
        "type": "object",
        "required": [
          "id",
          "type",
          "name",
          "x",
          "y",
          "width",
          "height",
          "layerId"
        ],
        "properties": {
          "id": {
            "type": "string"
          },
          "type": {
            "enum": [
              "container",
              "text",
              "button",
              "input",
              "textarea",
              "checkbox",
              "radio",
              "toggle",
              "dropdown",
              "slider",
              "progress",
              "iconButton",
              "tabs",
              "list",
              "table",
              "image",
              "icon",
              "avatar",
              "badge",
              "divider",
              "toolbar",
              "sidebar",
              "bottomNav",
              "dialog",
              "diagram",
              "drawing"
            ]
          },
          "name": {
            "type": "string"
          },
          "label": {
            "type": "string",
            "default": ""
          },
          "note": {
            "type": "string",
            "default": ""
          },
          "x": {
            "type": "number"
          },
          "y": {
            "type": "number"
          },
          "width": {
            "type": "number",
            "minimum": 8
          },
          "height": {
            "type": "number",
            "minimum": 8
          },
          "layerId": {
            "type": "string"
          },
          "parentId": {
            "type": "string"
          },
          "visible": {
            "type": "boolean",
            "default": true
          },
          "locked": {
            "type": "boolean",
            "default": false
          },
          "zIndex": {
            "type": "integer"
          },
          "items": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "columns": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "textStyle": {
            "type": "object",
            "properties": {
              "fontSize": {
                "type": "integer",
                "minimum": 8,
                "maximum": 96
              },
              "bold": {
                "type": "boolean"
              },
              "italic": {
                "type": "boolean"
              },
              "underline": {
                "type": "boolean"
              },
              "align": {
                "enum": [
                  "left",
                  "center",
                  "right"
                ]
              }
            }
          },
          "contentSize": {
            "type": "integer",
            "minimum": 8,
            "maximum": 256
          },
          "diagram": {
            "type": "object",
            "description": "`diagram` (Canvas) elements only: shapes in the scene's own coordinate space.",
            "required": [
              "width",
              "height",
              "objects"
            ],
            "properties": {
              "width": {
                "type": "number",
                "minimum": 40,
                "maximum": 4000
              },
              "height": {
                "type": "number",
                "minimum": 40,
                "maximum": 4000
              },
              "description": {
                "type": "string"
              },
              "objects": {
                "type": "array",
                "description": "Back-to-front paint order.",
                "items": {
                  "type": "object",
                  "required": [
                    "id",
                    "type"
                  ],
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "type": {
                      "enum": [
                        "rectangle",
                        "ellipse",
                        "line",
                        "arrow",
                        "bezier",
                        "text"
                      ]
                    },
                    "label": {
                      "type": "string"
                    },
                    "x": {
                      "type": "number"
                    },
                    "y": {
                      "type": "number"
                    },
                    "width": {
                      "type": "number"
                    },
                    "height": {
                      "type": "number"
                    },
                    "x1": {
                      "type": "number"
                    },
                    "y1": {
                      "type": "number"
                    },
                    "x2": {
                      "type": "number"
                    },
                    "y2": {
                      "type": "number"
                    },
                    "start": {
                      "type": "object",
                      "required": [
                        "x",
                        "y"
                      ],
                      "properties": {
                        "x": {
                          "type": "number"
                        },
                        "y": {
                          "type": "number"
                        }
                      }
                    },
                    "control1": {
                      "type": "object",
                      "required": [
                        "x",
                        "y"
                      ],
                      "properties": {
                        "x": {
                          "type": "number"
                        },
                        "y": {
                          "type": "number"
                        }
                      }
                    },
                    "control2": {
                      "type": "object",
                      "required": [
                        "x",
                        "y"
                      ],
                      "properties": {
                        "x": {
                          "type": "number"
                        },
                        "y": {
                          "type": "number"
                        }
                      }
                    },
                    "end": {
                      "type": "object",
                      "required": [
                        "x",
                        "y"
                      ],
                      "properties": {
                        "x": {
                          "type": "number"
                        },
                        "y": {
                          "type": "number"
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          "drawing": {
            "type": "object",
            "description": "`drawing` elements only: freehand strokes in the drawing's own coordinate space.",
            "required": [
              "width",
              "height",
              "strokes"
            ],
            "properties": {
              "width": {
                "type": "number",
                "minimum": 40,
                "maximum": 4000
              },
              "height": {
                "type": "number",
                "minimum": 40,
                "maximum": 4000
              },
              "description": {
                "type": "string"
              },
              "strokes": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": [
                    "points",
                    "width"
                  ],
                  "properties": {
                    "points": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": [
                          "x",
                          "y"
                        ],
                        "properties": {
                          "x": {
                            "type": "number"
                          },
                          "y": {
                            "type": "number"
                          }
                        }
                      }
                    },
                    "width": {
                      "type": "number"
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Your task

Design or change the screen the user describes. Choose a canvas preset for new wireframes, lay the
elements out on the grid, nest them sensibly, write useful notes, and save through the MCP tools.
