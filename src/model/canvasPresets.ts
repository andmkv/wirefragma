/**
 * Device preset catalog for the canvas size.
 *
 * Pure data, no DOM and no imports: `normalizeProject` validates stored preset ids against it and
 * `model/defaults.ts` re-exports it for the editor. Preset ids are a literal union on purpose —
 * the toolbar derives its i18n keys from them (`canvas.preset.<id>`), so a typo cannot compile.
 *
 * The three classic canvas modes (`desktop` / `mobile` / `mobileLandscape`) stay exactly as they
 * were for old documents; picking a device preset stores `mode: "custom"` plus `preset: <id>`.
 */

export type CanvasPresetGroup = "phone" | "tablet" | "desktop" | "other";

export interface CanvasDevicePresetSpec {
  id: string;
  /** English name — the UI shows `canvas.preset.<id>`, the Markdown export uses this. */
  name: string;
  group: CanvasPresetGroup;
  width: number;
  height: number;
}

export const CANVAS_PRESET_GROUPS: CanvasPresetGroup[] = ["phone", "tablet", "desktop", "other"];

export const CANVAS_DEVICE_PRESETS = [
  { id: "phone-iphone-se", name: "iPhone SE", group: "phone", width: 375, height: 667 },
  { id: "phone-iphone-15", name: "iPhone 15", group: "phone", width: 393, height: 852 },
  { id: "phone-iphone-15-pro-max", name: "iPhone 15 Pro Max", group: "phone", width: 430, height: 932 },
  { id: "phone-android", name: "Android", group: "phone", width: 360, height: 800 },
  { id: "phone-android-large", name: "Android large", group: "phone", width: 412, height: 915 },
  { id: "tablet-ipad", name: "iPad", group: "tablet", width: 768, height: 1024 },
  { id: "tablet-ipad-landscape", name: "iPad landscape", group: "tablet", width: 1024, height: 768 },
  { id: "tablet-ipad-pro-11", name: 'iPad Pro 11"', group: "tablet", width: 834, height: 1194 },
  { id: "desktop-1280x720", name: "Desktop 1280×720", group: "desktop", width: 1280, height: 720 },
  { id: "desktop-1366x768", name: "Laptop 1366×768", group: "desktop", width: 1366, height: 768 },
  { id: "desktop-1440x900", name: "Desktop 1440×900", group: "desktop", width: 1440, height: 900 },
  { id: "desktop-1536x864", name: "Desktop 1536×864", group: "desktop", width: 1536, height: 864 },
  { id: "desktop-1920x1080", name: "Full HD 1920×1080", group: "desktop", width: 1920, height: 1080 },
  { id: "other-a4", name: "A4", group: "other", width: 794, height: 1123 },
  { id: "other-square", name: "Square 1080×1080", group: "other", width: 1080, height: 1080 },
  { id: "other-16-9", name: "16:9 1280×720", group: "other", width: 1280, height: 720 },
  { id: "other-4-3", name: "4:3 1024×768", group: "other", width: 1024, height: 768 }
] as const satisfies readonly CanvasDevicePresetSpec[];

export type CanvasDevicePreset = (typeof CANVAS_DEVICE_PRESETS)[number];
export type CanvasPresetId = CanvasDevicePreset["id"];

/** The preset with this id, or null. Accepts untrusted input (used by `normalizeProject`). */
export function findCanvasPreset(id: unknown): CanvasDevicePreset | null {
  if (typeof id !== "string") return null;
  return CANVAS_DEVICE_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The preset with exactly these dimensions, or null (used when flipping the canvas). */
export function presetMatchingSize(width: number, height: number): CanvasDevicePreset | null {
  return (
    CANVAS_DEVICE_PRESETS.find((preset) => preset.width === width && preset.height === height) ?? null
  );
}
