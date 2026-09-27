import { normalizeProject, type WireframeProject } from "../model/project";

/** Current key (Wirefragma). */
export const STORAGE_KEY = "wirefragma.project.v1";
/** Key used before the rename; still read so existing projects are not lost. */
export const LEGACY_STORAGE_KEY = "ui-sketch.project.v1";
/** Copy of stored data that could not be read, kept before anything can overwrite it. */
export const BACKUP_STORAGE_KEY = "wirefragma.project.v1.unreadable";

export interface LoadResult {
  project: WireframeProject | null;
  error: string | null;
  /** The project came from the pre-rename key and has been copied to the new key. */
  migrated: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function parse(raw: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { project: null, error: "The saved project data was corrupted and has been ignored.", migrated: false };
  }
  try {
    return { project: normalizeProject(parsed), error: null, migrated: false };
  } catch (error) {
    return {
      project: null,
      error: `The saved project could not be restored (${(error as Error).message}).`,
      migrated: false
    };
  }
}

/** Read the stored project, falling back to the legacy UI Sketch key and migrating it. */
export function loadFrom(storage: StorageLike): LoadResult {
  let raw: string | null = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { project: null, error: "Browser storage is not available; changes will not be saved.", migrated: false };
  }

  if (raw) {
    const result = parse(raw);
    if (!result.project) {
      // Keep the unreadable data (e.g. written by a newer build) so it is never silently lost.
      try {
        storage.setItem(BACKUP_STORAGE_KEY, raw);
        result.error = `${result.error} A copy was kept in browser storage under "${BACKUP_STORAGE_KEY}".`;
      } catch {
        /* storage full or blocked — the app still will not autosave over it before an edit */
      }
    }
    return result;
  }

  let legacy: string | null = null;
  try {
    legacy = storage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return { project: null, error: null, migrated: false };
  }
  if (!legacy) return { project: null, error: null, migrated: false };

  const result = parse(legacy);
  if (!result.project) return result;

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(result.project));
  } catch {
    /* keep working in memory even if the copy fails */
  }
  return { project: result.project, error: null, migrated: true };
}

export function saveTo(storage: StorageLike, project: WireframeProject): string | null {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(project));
    return null;
  } catch {
    return "Could not save to browser storage (it may be full or disabled).";
  }
}

export function clearStoredProject(storage: StorageLike): void {
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadProject(): LoadResult {
  const storage = browserStorage();
  if (!storage) return { project: null, error: null, migrated: false };
  return loadFrom(storage);
}

export function saveProject(project: WireframeProject): string | null {
  const storage = browserStorage();
  if (!storage) return null;
  return saveTo(storage, project);
}
