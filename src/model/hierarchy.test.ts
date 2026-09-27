import { describe, expect, it } from "vitest";
import {
  canonicalizeTree,
  childrenOf,
  createLayer,
  deleteLayer,
  duplicateElement,
  duplicateElements,
  effectiveLocked,
  effectiveVisible,
  elementsInDrawOrder,
  moveElement,
  nestElement,
  normalizeProject,
  removeElements,
  reorderElement,
  bringToFront,
  sendToBack,
  unnestElement,
  updateElement,
  withDescendants,
  type WireframeElement,
  type WireframeProject
} from "./project";
import { copySelection, pasteClipboard } from "./clipboard";
import { hitTestProject } from "../canvas/hitTest";
import { projectFromMarkdown } from "../utils/markdownImport";
import { projectToMarkdown } from "../utils/markdownExport";

function el(id: string, layerId: string, parentId?: string, extra: Partial<WireframeElement> = {}): WireframeElement {
  const element: WireframeElement = {
    id,
    type: "button",
    name: id,
    label: id,
    note: "",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
    layerId,
    visible: true,
    locked: false,
    zIndex: 0,
    ...extra
  };
  if (parentId) element.parentId = parentId;
  return element;
}

/** Layer "ui": card (with title + actions(ok)) and a loose footer. Layer "bg" behind it. */
function makeProject(): WireframeProject {
  return normalizeProject({
    version: 2,
    title: "Nest",
    canvas: { mode: "desktop", width: 1200, height: 800 },
    layers: [createLayer("UI", { id: "ui" }), createLayer("Background", { id: "bg" })],
    elements: [
      el("card", "ui", undefined, { type: "container", width: 400, height: 300 }),
      el("footer", "ui"),
      el("title", "ui", "card", { type: "text" }),
      el("actions", "ui", "card", { type: "container" }),
      el("ok", "ui", "actions"),
      el("backdrop", "bg")
    ]
  });
}

const ids = (elements: WireframeElement[]) => elements.map((element) => element.id);

describe("canonical tree order", () => {
  it("keeps every subtree contiguous right after its parent", () => {
    const project = makeProject();
    expect(ids(project.elements)).toEqual(["card", "title", "actions", "ok", "footer", "backdrop"]);
    expect(project.elements.map((element) => element.zIndex)).toEqual([0, 1, 2, 3, 4, 0]);
  });

  it("draws children in front of their parent and hit-tests them first", () => {
    const project = makeProject();
    const order = ids(elementsInDrawOrder(project));
    expect(order.indexOf("ok")).toBeGreaterThan(order.indexOf("actions"));
    expect(order.indexOf("actions")).toBeGreaterThan(order.indexOf("card"));
    const hit = hitTestProject({ x: 10, y: 10 }, project, { scale: 1, originX: 0, originY: 0 });
    // footer is a later root, so it is in front of the whole card subtree.
    expect(hit).toEqual({ kind: "element", elementId: "footer" });
  });

  it("repairs dangling, self and cyclic parent links, and pulls children into the root's layer", () => {
    const elements = [
      el("a", "ui", "b"),
      el("b", "ui", "a"),
      el("c", "bg", "a"),
      el("d", "ui", "missing"),
      el("e", "ui", "e")
    ];
    const result = canonicalizeTree(elements);
    const byId = new Map(result.map((element) => [element.id, element]));
    expect(byId.get("d")!.parentId).toBeUndefined();
    expect(byId.get("e")!.parentId).toBeUndefined();
    // exactly one link of the a<->b cycle is cut
    expect([byId.get("a")!.parentId, byId.get("b")!.parentId].filter(Boolean)).toHaveLength(1);
    expect(byId.get("c")!.layerId).toBe("ui");
  });

  it("returns the same array when nothing has to change", () => {
    const project = makeProject();
    expect(canonicalizeTree(project.elements)).toBe(project.elements);
  });
});

describe("inheritance", () => {
  it("hides and locks children through their ancestors", () => {
    let project = updateElement(makeProject(), "card", { visible: false });
    expect(effectiveVisible(project, project.elements.find((e) => e.id === "ok")!)).toBe(false);
    expect(effectiveVisible(project, project.elements.find((e) => e.id === "footer")!)).toBe(true);
    project = updateElement(makeProject(), "actions", { locked: true });
    expect(effectiveLocked(project, project.elements.find((e) => e.id === "ok")!)).toBe(true);
    expect(effectiveLocked(project, project.elements.find((e) => e.id === "title")!)).toBe(false);
  });
});

describe("structural transforms", () => {
  it("nests an element as the front-most child and refuses cycles", () => {
    const project = nestElement(makeProject(), "footer", "card");
    expect(ids(childrenOf(project, "ui", "card"))).toEqual(["title", "actions", "footer"]);
    expect(nestElement(project, "card", "ok")).toBe(project);
    expect(nestElement(project, "card", "card")).toBe(project);
  });

  it("nesting across layers moves the whole subtree into the parent's layer", () => {
    const project = nestElement(makeProject(), "card", "backdrop");
    for (const id of ["card", "title", "actions", "ok"]) {
      expect(project.elements.find((element) => element.id === id)!.layerId).toBe("bg");
    }
    expect(ids(project.elements.filter((element) => element.layerId === "bg"))).toEqual([
      "backdrop",
      "card",
      "title",
      "actions",
      "ok"
    ]);
  });

  it("unnests an element to sit directly in front of its former parent", () => {
    const project = unnestElement(makeProject(), "ok");
    const ok = project.elements.find((element) => element.id === "ok")!;
    expect(ok.parentId).toBe("card");
    expect(ids(childrenOf(project, "ui", "card"))).toEqual(["title", "actions", "ok"]);
  });

  it("moveElement makes the element a sibling of the target, never of its own descendant", () => {
    const project = moveElement(makeProject(), "footer", "ui", "title", false);
    expect(project.elements.find((element) => element.id === "footer")!.parentId).toBe("card");
    expect(ids(childrenOf(project, "ui", "card"))).toEqual(["footer", "title", "actions"]);
    const unchanged = makeProject();
    expect(moveElement(unchanged, "card", "ui", "ok", true)).toBe(unchanged);
    const root = moveElement(makeProject(), "ok", "bg", null, true);
    expect(root.elements.find((element) => element.id === "ok")).toMatchObject({ layerId: "bg" });
    expect(root.elements.find((element) => element.id === "ok")!.parentId).toBeUndefined();
  });

  it("reorders among siblings only, carrying subtrees along", () => {
    let project = reorderElement(makeProject(), "title", "forward");
    expect(ids(project.elements.slice(0, 4))).toEqual(["card", "actions", "ok", "title"]);
    project = reorderElement(makeProject(), "card", "forward");
    expect(ids(project.elements.slice(0, 5))).toEqual(["footer", "card", "title", "actions", "ok"]);
    project = bringToFront(makeProject(), "title");
    expect(ids(childrenOf(project, "ui", "card"))).toEqual(["actions", "title"]);
    project = sendToBack(project, "title");
    expect(ids(childrenOf(project, "ui", "card"))).toEqual(["title", "actions"]);
  });

  it("removes whole subtrees", () => {
    const project = removeElements(makeProject(), ["actions"]);
    expect(ids(project.elements)).toEqual(["card", "title", "footer", "backdrop"]);
    expect(ids(deleteLayer(makeProject(), "ui").project.elements)).toEqual(["backdrop"]);
  });

  it("duplicates a subtree with re-pointed parents, in front of the source", () => {
    const { project, newId } = duplicateElement(makeProject(), "actions");
    const copy = project.elements.find((element) => element.id === newId)!;
    expect(copy.parentId).toBe("card");
    const copyChildren = childrenOf(project, "ui", copy.id);
    expect(copyChildren).toHaveLength(1);
    expect(copyChildren[0].name).toBe("okCopy");
    expect(ids(childrenOf(project, "ui", "card"))).toEqual(["title", "actions", copy.id]);
  });

  it("does not duplicate a child twice when its parent is selected too", () => {
    const { project, newIds } = duplicateElements(makeProject(), ["card", "ok"]);
    expect(newIds).toHaveLength(1);
    expect(project.elements).toHaveLength(6 + 4);
  });

  it("withDescendants expands a selection to everything nested inside it", () => {
    expect(withDescendants(makeProject(), ["actions", "footer"])).toEqual(["actions", "ok", "footer"]);
  });
});

describe("clipboard", () => {
  it("copies subtrees and pastes them with re-pointed parents", () => {
    const source = makeProject();
    const clipboard = copySelection(source, ["actions"])!;
    expect(ids(clipboard.elements)).toEqual(["actions", "ok"]);
    const { project, newIds } = pasteClipboard(source, clipboard, { pasteIndex: 1, activeLayerId: "ui" });
    expect(newIds).toHaveLength(1);
    const pasted = project.elements.find((element) => element.id === newIds[0])!;
    expect(pasted.parentId).toBe("card");
    expect(childrenOf(project, "ui", pasted.id).map((element) => element.name)).toEqual(["okCopy"]);
  });
});

describe("serialization", () => {
  it("round-trips parentId through Markdown and names the parent in the element section", () => {
    const project = makeProject();
    const markdown = projectToMarkdown(project);
    expect(markdown).toContain("Inside: `actions`");
    expect(projectFromMarkdown(markdown)).toEqual(project);
  });

  it("imports documents without parentId exactly as before", () => {
    const flat = normalizeProject({
      version: 2,
      title: "Flat",
      canvas: { width: 400, height: 400 },
      elements: [el("a", "x"), el("b", "x")]
    });
    expect(flat.elements.every((element) => element.parentId === undefined)).toBe(true);
    expect(JSON.stringify(flat)).not.toContain("parentId");
  });
});
