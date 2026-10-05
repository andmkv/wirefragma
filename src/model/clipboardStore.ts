/**
 * Cross-wireframe clipboard store.
 *
 * The editor renders one `<App key=…>` per wireframe (`account/Workspace.tsx`), so a clipboard
 * held in component state would be lost on every switch. The payload therefore lives in a module
 * level store that survives remounts, is never part of React state (nothing renders from it) and
 * never touches the OS clipboard.
 *
 * It is also mirrored into `localStorage` — wrapped in try/catch and capped — so a copy in one
 * browser tab can be pasted in another tab of the same origin. The payload is validated on read:
 * anything that does not look like a clipboard payload is ignored rather than trusted.
 */

import { cloneElement, isElementType, type WireframeElement } from "./project";
import type { WirefragmaClipboard } from "./clipboard";
import type { StorageLike } from "../utils/storage";

export const CLIPBOARD_STORAGE_KEY = "wirefragma.clipboard";

/** Largest serialized payload that is mirrored into localStorage (in UTF-16 code units). */
export const MAX_STORED_CLIPBOARD_CHARS = 64 * 1024;

/** Upper bound on the number of elements a stored payload may contain. */
export const MAX_CLIPBOARD_ELEMENTS = 2000;

/** A payload plus the identity of the copy that produced it (drives the paste cascade). */
export interface ClipboardSnapshot extends WirefragmaClipboard {
  /** Changes on every copy, so a paste counter can tell "the same copy" from "a new copy". */
  token: string;
}

/** The subset of a clipboard payload the store keeps; everything else is dropped on read. */
const CORE_FIELDS = ["id", "type", "name", "label", "note", "x", "y", "width", "height", "layerId"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Validate one element from an untrusted payload; returns a normalised copy, or null. */
function parseElement(raw: unknown): WireframeElement | null {
  if (!isRecord(raw)) return null;
  if (!CORE_FIELDS.every((field) => field in raw)) return null;
  if (!isElementType(raw.type)) return null;
  if (typeof raw.id !== "string" || raw.id === "") return null;
  if (typeof raw.layerId !== "string") return null;
  if (!finite(raw.x) || !finite(raw.y) || !finite(raw.width) || !finite(raw.height)) return null;
  if (raw.width <= 0 || raw.height <= 0) return null;

  const element: WireframeElement = {
    id: raw.id,
    type: raw.type,
    name: typeof raw.name === "string" ? raw.name : raw.type,
    label: typeof raw.label === "string" ? raw.label : "",
    note: typeof raw.note === "string" ? raw.note : "",
    x: raw.x,
    y: raw.y,
    width: raw.width,
    height: raw.height,
    layerId: raw.layerId,
    visible: raw.visible !== false,
    locked: raw.locked === true,
    zIndex: finite(raw.zIndex) ? raw.zIndex : 0
  };
  if (typeof raw.parentId === "string" && raw.parentId !== "") element.parentId = raw.parentId;
  if (Array.isArray(raw.items) && raw.items.every((item) => typeof item === "string")) {
    element.items = [...(raw.items as string[])];
  }
  if (Array.isArray(raw.columns) && raw.columns.every((column) => typeof column === "string")) {
    element.columns = [...(raw.columns as string[])];
  }
  // Scene payloads are only checked to be objects here; the model normalizers validate them
  // when they are used, and `cloneElement` deep-copies them on paste.
  if (isRecord(raw.textStyle)) element.textStyle = { ...(raw.textStyle as unknown as WireframeElement["textStyle"]) };
  if (finite(raw.contentSize)) element.contentSize = raw.contentSize;
  if (isRecord(raw.diagram)) element.diagram = raw.diagram as unknown as WireframeElement["diagram"];
  if (isRecord(raw.drawing)) element.drawing = raw.drawing as unknown as WireframeElement["drawing"];
  return element;
}

/** Parse an untrusted value (localStorage, tests) into a clipboard payload, or null. */
export function parseClipboardPayload(value: unknown): WirefragmaClipboard | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.elements)) return null;
  if (value.elements.length === 0 || value.elements.length > MAX_CLIPBOARD_ELEMENTS) return null;

  const elements: WireframeElement[] = [];
  for (const raw of value.elements) {
    const element = parseElement(raw);
    if (!element) return null;
    elements.push(element);
  }

  const payload: WirefragmaClipboard = { elements };
  if (isRecord(value.layerNames)) {
    const layerNames: Record<string, string> = {};
    for (const [key, name] of Object.entries(value.layerNames)) {
      if (typeof name === "string") layerNames[key] = name;
    }
    if (Object.keys(layerNames).length > 0) payload.layerNames = layerNames;
  }
  return payload;
}

function hashToken(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return `s${(hash >>> 0).toString(36)}:${text.length}`;
}

export interface ClipboardStore {
  /** The current payload, reading it back from storage the first time. */
  get(): ClipboardSnapshot | null;
  /** Replace the payload (null clears it) and mirror it into storage. */
  set(payload: WirefragmaClipboard | null): void;
}

/** A store backed by `storage` (null = memory only). One instance per editor session. */
export function createClipboardStore(storage: StorageLike | null): ClipboardStore {
  let memory: ClipboardSnapshot | null = null;
  let loaded = false;
  let copies = 0;

  const read = (): ClipboardSnapshot | null => {
    if (memory || loaded) return memory;
    loaded = true;
    if (!storage) return null;
    let raw: string | null = null;
    try {
      raw = storage.getItem(CLIPBOARD_STORAGE_KEY);
    } catch {
      return null;
    }
    if (!raw) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const payload = parseClipboardPayload(parsed);
    if (!payload) return null;
    memory = { ...payload, token: hashToken(raw) };
    return memory;
  };

  return {
    get: read,
    set(payload) {
      loaded = true;
      if (!payload || payload.elements.length === 0) {
        memory = null;
        try {
          storage?.removeItem(CLIPBOARD_STORAGE_KEY);
        } catch {
          /* storage may be full or blocked */
        }
        return;
      }
      const stored: WirefragmaClipboard = {
        elements: payload.elements.map(cloneElement)
      };
      if (payload.layerNames) stored.layerNames = { ...payload.layerNames };
      copies += 1;
      memory = { ...stored, token: `c${copies}` };
      let text: string;
      try {
        text = JSON.stringify(stored);
      } catch {
        return;
      }
      // Oversized payloads keep working in memory; they are simply not mirrored to storage.
      if (text.length > MAX_STORED_CLIPBOARD_CHARS) {
        try {
          storage?.removeItem(CLIPBOARD_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        return;
      }
      try {
        storage?.setItem(CLIPBOARD_STORAGE_KEY, text);
      } catch {
        /* storage is a convenience, never a requirement */
      }
    }
  };
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The store the editor uses: survives `<App>` remounts and is shared by tabs of one origin. */
export const clipboardStore: ClipboardStore = createClipboardStore(browserStorage());
