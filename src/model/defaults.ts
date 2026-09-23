import {
  DEFAULT_LAYER_NAME,
  PROJECT_VERSION,
  createId,
  createLayer,
  type CanvasMode,
  type ElementType,
  type WireframeElement,
  type WireframeLayer,
  type WireframeProject
} from "./project";

export const CANVAS_PRESETS: Record<Exclude<CanvasMode, "custom">, { width: number; height: number }> = {
  desktop: { width: 1200, height: 800 },
  mobile: { width: 390, height: 844 },
  mobileLandscape: { width: 844, height: 390 }
};

export interface ElementDefaults {
  width: number;
  height: number;
  label: string;
  items?: string[];
  columns?: string[];
}

export const ELEMENT_DEFAULTS: Record<ElementType, ElementDefaults> = {
  container: { width: 320, height: 200, label: "" },
  text: { width: 220, height: 24, label: "Text" },
  button: { width: 120, height: 40, label: "Button" },
  input: { width: 260, height: 40, label: "Input" },
  textarea: { width: 260, height: 96, label: "Notes" },
  checkbox: { width: 200, height: 24, label: "Checkbox" },
  radio: { width: 200, height: 24, label: "Radio" },
  toggle: { width: 200, height: 28, label: "Toggle" },
  dropdown: { width: 240, height: 40, label: "Select" },
  slider: { width: 220, height: 24, label: "Slider" },
  progress: { width: 220, height: 20, label: "" },
  iconButton: { width: 40, height: 40, label: "+" },
  tabs: { width: 320, height: 36, label: "", items: ["Tab 1", "Tab 2"] },
  list: { width: 280, height: 168, label: "", items: ["Item 1", "Item 2", "Item 3"] },
  table: {
    width: 420,
    height: 180,
    label: "",
    columns: ["Name", "Status", "Size"],
    items: ["Project A | Active | 24 GB", "Project B | Paused | 8 GB", "Project C | Active | 3 GB"]
  },
  // An empty label draws the generic crossed placeholder; set a label (usually an emoji) to
  // turn the Image into a symbol rendered at its own content size.
  image: { width: 220, height: 150, label: "" },
  icon: { width: 32, height: 32, label: "★" },
  avatar: { width: 40, height: 40, label: "AB" },
  badge: { width: 96, height: 28, label: "Badge" },
  divider: { width: 320, height: 8, label: "" },
  toolbar: { width: 480, height: 48, label: "Toolbar" },
  sidebar: { width: 220, height: 400, label: "Sidebar", items: ["Item 1", "Item 2", "Item 3"] },
  bottomNav: { width: 360, height: 64, label: "", items: ["Home", "Search", "Profile"] },
  dialog: { width: 360, height: 240, label: "Dialog" }
};

/** Palette groups shown in the left "Add" tab. */
export const PALETTE_GROUPS: { title: string; types: ElementType[] }[] = [
  { title: "Layout", types: ["container", "toolbar", "sidebar", "bottomNav", "dialog", "divider"] },
  { title: "Content", types: ["text", "image", "icon", "avatar", "badge", "list", "table", "tabs"] },
  {
    title: "Controls",
    types: [
      "button",
      "iconButton",
      "input",
      "textarea",
      "dropdown",
      "checkbox",
      "radio",
      "toggle",
      "slider",
      "progress"
    ]
  }
];

export function defaultNameFor(type: ElementType, project: WireframeProject): string {
  const taken = new Set(project.elements.map((element) => element.name));
  const stem = `${type}${taken.has(type) ? 2 : 1}`;
  if (!taken.has(stem)) return stem;
  let counter = 3;
  while (taken.has(`${type}${counter}`)) counter += 1;
  return `${type}${counter}`;
}

export interface CreateElementOptions {
  x: number;
  y: number;
  layerId?: string;
  name?: string;
  width?: number;
  height?: number;
  label?: string;
  items?: string[];
  columns?: string[];
}

export function createElement(
  type: ElementType,
  project: WireframeProject,
  options: CreateElementOptions
): WireframeElement {
  const defaults = ELEMENT_DEFAULTS[type];
  const element: WireframeElement = {
    id: createId(type),
    type,
    name: options.name ?? defaultNameFor(type, project),
    label: options.label ?? defaults.label,
    note: "",
    x: Math.round(options.x),
    y: Math.round(options.y),
    width: Math.round(options.width ?? defaults.width),
    height: Math.round(options.height ?? defaults.height),
    layerId: options.layerId ?? project.layers[0]?.id ?? "",
    visible: true,
    locked: false,
    zIndex: project.elements.filter((element) => element.layerId === options.layerId).length
  };
  const items = options.items ?? defaults.items;
  if (items) element.items = [...items];
  const columns = options.columns ?? defaults.columns;
  if (columns) element.columns = [...columns];
  return element;
}

export function emptyProject(mode: CanvasMode = "desktop", title = "Untitled"): WireframeProject {
  const preset = mode === "custom" ? CANVAS_PRESETS.desktop : CANVAS_PRESETS[mode];
  return {
    version: PROJECT_VERSION,
    title,
    canvas: { mode, width: preset.width, height: preset.height },
    layers: [createLayer(DEFAULT_LAYER_NAME)],
    elements: []
  };
}

/**
 * The project Wirefragma opens with when there is nothing saved yet, and the one `New` creates:
 * a Desktop 1200×800 canvas with a single empty `Default` layer — no demo content.
 */
export function createBlankProject(): WireframeProject {
  return emptyProject("desktop", "Untitled");
}

interface SampleElementSeed {
  type: ElementType;
  name: string;
  label: string;
  note: string;
  x: number;
  y: number;
  width: number;
  height: number;
  items?: string[];
}

/**
 * Example project used by tests and by the dev self-test harness (pass 4). It is deliberately
 * NOT loaded on startup any more: a first launch opens a blank project.
 *
 * Every control-like object in the sample (buttons, toggle, input…) is a real
 * WireframeElement — nothing decorative is drawn that cannot be selected or exported.
 *
 * Layer order is front-to-back: Controls sits above Content, which sits above Layout.
 * `elements` is the global back-to-front paint order.
 */
export function createSampleProject(): WireframeProject {
  const layoutLayer: WireframeLayer = createLayer("Layout");
  const contentLayer: WireframeLayer = createLayer("Content");
  const controlsLayer: WireframeLayer = createLayer("Controls");

  const seeds: { layer: WireframeLayer; seed: SampleElementSeed }[] = [
    {
      layer: layoutLayer,
      seed: {
        type: "toolbar",
        name: "topToolbar",
        label: "Settings",
        note: "Global application header. The primary save action lives here.",
        x: 0,
        y: 0,
        width: 1200,
        height: 64
      }
    },
    {
      layer: layoutLayer,
      seed: {
        type: "sidebar",
        name: "settingsSidebar",
        label: "Sections",
        note: "Main navigation. Selecting an item changes the settings section without leaving the screen.",
        x: 0,
        y: 64,
        width: 220,
        height: 736,
        items: ["General", "Appearance", "Advanced"]
      }
    },
    {
      layer: contentLayer,
      seed: {
        type: "text",
        name: "heading",
        label: "General",
        note: "Section title. Reflects the currently selected sidebar entry.",
        x: 264,
        y: 104,
        width: 300,
        height: 32
      }
    },
    {
      layer: contentLayer,
      seed: {
        type: "input",
        name: "usernameInput",
        label: "Username",
        note: "Editable username. Validate that it is not empty before saving.",
        x: 264,
        y: 168,
        width: 380,
        height: 40
      }
    },
    {
      layer: contentLayer,
      seed: {
        type: "list",
        name: "teamList",
        label: "",
        note: "Read-only list of team members. Each row links to a member profile.",
        x: 264,
        y: 232,
        width: 420,
        height: 200,
        items: ["Anna Kovacs — Owner", "Milo Reyes — Admin", "Sara Lindt — Editor"]
      }
    },
    {
      layer: controlsLayer,
      seed: {
        type: "toggle",
        name: "notificationsToggle",
        label: "Notifications",
        note: "Updates the preference immediately. Does not require Save.",
        x: 264,
        y: 464,
        width: 260,
        height: 32
      }
    },
    {
      layer: controlsLayer,
      seed: {
        type: "button",
        name: "cancelButton",
        label: "Cancel",
        note: "Discards unsaved changes and returns to the previous screen.",
        x: 900,
        y: 720,
        width: 120,
        height: 40
      }
    },
    {
      layer: controlsLayer,
      seed: {
        type: "button",
        name: "saveButton",
        label: "Save",
        note: "Saves changes but remains on this screen. Disabled while the form is pristine.",
        x: 1040,
        y: 12,
        width: 130,
        height: 40
      }
    }
  ];

  const counters = new Map<string, number>();
  const elements: WireframeElement[] = seeds.map(({ layer, seed }) => {
    const zIndex = counters.get(layer.id) ?? 0;
    counters.set(layer.id, zIndex + 1);

    const element: WireframeElement = {
      id: createId(seed.type),
      type: seed.type,
      name: seed.name,
      label: seed.label,
      note: seed.note,
      x: seed.x,
      y: seed.y,
      width: seed.width,
      height: seed.height,
      layerId: layer.id,
      visible: true,
      locked: false,
      zIndex
    };
    if (seed.items) element.items = [...seed.items];
    return element;
  });

  return {
    version: PROJECT_VERSION,
    title: "Settings",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [controlsLayer, contentLayer, layoutLayer],
    elements
  };
}
