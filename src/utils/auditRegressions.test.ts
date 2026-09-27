import { describe, expect, it } from "vitest";
import { createSampleProject } from "../model/defaults";
import { mergeTextStyle, updateElement, type WireframeProject } from "../model/project";
import { beginTransaction, commit, createHistory, redo, undo } from "./history";
import { projectToMarkdown } from "./markdownExport";
import { projectFromMarkdown } from "./markdownImport";
import { BACKUP_STORAGE_KEY, STORAGE_KEY, loadFrom, type StorageLike } from "./storage";
import { cappedDpr, MAX_CANVAS_BACKING_AREA, MAX_CANVAS_BACKING_SIDE } from "../components/CanvasEditor";

function memoryStorage(seed: Record<string, string> = {}): StorageLike & { values: Record<string, string> } {
  const values = { ...seed };
  return {
    values,
    getItem: (key) => (key in values ? values[key] : null),
    setItem: (key, value) => {
      values[key] = value;
    },
    removeItem: (key) => {
      delete values[key];
    }
  };
}

describe("Markdown export survives backticks in notes and labels", () => {
  it("round-trips a note containing a code fence", () => {
    const sample = createSampleProject();
    const first = sample.elements[0];
    const project = updateElement(sample, first.id, {
      note: "Example:\n```js\nconsole.log(1)\n```\nand ```ui-project too",
      label: "`quoted`"
    });
    const markdown = projectToMarkdown(project);
    expect(projectFromMarkdown(markdown)).toEqual(project);
  });
});

describe("history", () => {
  it("undo and redo are inert while a gesture transaction is open", () => {
    let history = createHistory({ n: 0 });
    history = commit(history, { n: 1 });
    history = beginTransaction(history);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });
});

describe("storage", () => {
  it("keeps a backup of stored data that cannot be read", () => {
    const raw = JSON.stringify({ version: 99, canvas: { width: 400, height: 400 }, elements: [] });
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const result = loadFrom(storage);
    expect(result.project).toBeNull();
    expect(storage.values[BACKUP_STORAGE_KEY]).toBe(raw);
    expect(result.error).toContain(BACKUP_STORAGE_KEY);
  });
});

describe("typography", () => {
  it("mergeTextStyle clamps the font size", () => {
    const project: WireframeProject = createSampleProject();
    const text = project.elements.find((element) => element.type === "text")!;
    expect(mergeTextStyle(text, { fontSize: 0 })).toEqual({ fontSize: 8 });
    expect(mergeTextStyle(text, { fontSize: 500 })).toEqual({ fontSize: 96 });
  });
});

describe("canvas backing store", () => {
  it("lowers the DPR for huge canvases and leaves normal ones alone", () => {
    expect(cappedDpr(2, 1200, 800)).toBe(2);
    const dpr = cappedDpr(2, 12000, 12000);
    expect(12000 * dpr).toBeLessThanOrEqual(MAX_CANVAS_BACKING_SIDE);
    expect(12000 * dpr * 12000 * dpr).toBeLessThanOrEqual(MAX_CANVAS_BACKING_AREA + 1);
  });
});
