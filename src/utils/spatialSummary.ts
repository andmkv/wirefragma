import {
  ELEMENT_TYPE_LABEL,
  exportedElementsInDrawOrder,
  type WireframeElement,
  type WireframeProject
} from "../model/project";

/**
 * Deterministic, rule-based description of where things sit on the screen.
 * No AI involved — downstream LLMs get an extra semantic hint.
 */

type Vertical = "top" | "middle" | "bottom";
type Horizontal = "left" | "center" | "right";

const LAYOUT_TYPES = new Set(["container", "toolbar", "sidebar"]);

interface Region {
  vertical: Vertical;
  horizontal: Horizontal;
}

function regionOf(element: WireframeElement, canvas: { width: number; height: number }): Region {
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;

  const horizontal: Horizontal =
    centerX < canvas.width / 3 ? "left" : centerX > (canvas.width * 2) / 3 ? "right" : "center";
  const vertical: Vertical =
    centerY < canvas.height / 3 ? "top" : centerY > (canvas.height * 2) / 3 ? "bottom" : "middle";

  return { vertical, horizontal };
}

const VERTICAL_WORD: Record<Vertical, string> = {
  top: "upper",
  middle: "middle",
  bottom: "lower"
};

const HORIZONTAL_WORD: Record<Horizontal, string> = {
  left: "left",
  center: "center",
  right: "right"
};

function regionPhrase(region: Region): string {
  if (region.vertical === "middle" && region.horizontal === "center") return "center";
  if (region.vertical === "middle") return `${HORIZONTAL_WORD[region.horizontal]} side`;
  if (region.horizontal === "center") return `${VERTICAL_WORD[region.vertical]} portion`;
  return `${VERTICAL_WORD[region.vertical]}-${HORIZONTAL_WORD[region.horizontal]} area`;
}

function isFullWidth(element: WireframeElement, canvas: { width: number }): boolean {
  return element.width >= canvas.width * 0.8;
}

function describeLayoutElement(
  element: WireframeElement,
  canvas: { width: number; height: number }
): string {
  const label = `${ELEMENT_TYPE_LABEL[element.type]} "${element.name}"`;
  const region = regionOf(element, canvas);

  if (element.type === "toolbar") {
    if (isFullWidth(element, canvas)) return `- The ${label} spans the full width across the upper portion of the screen.`;
    return `- The ${label} sits in the ${regionPhrase(region)} of the screen.`;
  }
  if (element.type === "sidebar") {
    return `- The ${label} occupies the ${HORIZONTAL_WORD[region.horizontal]} side of the screen.`;
  }
  if (element.height >= canvas.height * 0.6) {
    return `- The ${label} runs vertically through the ${regionPhrase(region)}.`;
  }
  return `- The ${label} frames the ${regionPhrase(region)} of the screen.`;
}

const nameOf = (element: WireframeElement) => `"${element.name}" (${ELEMENT_TYPE_LABEL[element.type]})`;

/**
 * Children of one parent in reading order: rows top to bottom, and elements whose vertical
 * extents overlap share a row ("A, B side by side").
 */
function readingOrder(children: WireframeElement[]): string {
  const sorted = [...children].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: WireframeElement[][] = [];
  for (const child of sorted) {
    const row = rows[rows.length - 1];
    const center = child.y + child.height / 2;
    if (row && row.some((other) => center > other.y && center < other.y + other.height)) row.push(child);
    else rows.push([child]);
  }
  return rows
    .map((row) =>
      row.length === 1 ? nameOf(row[0]) : `${[...row].sort((a, b) => a.x - b.x).map(nameOf).join(", ")} side by side`
    )
    .join("; ");
}

export function buildSpatialSummary(project: WireframeProject): string[] {
  const { canvas } = project;
  // The summary describes what the user actually sees (minus undescribed Drawings).
  const elements = exportedElementsInDrawOrder(project);
  if (elements.length === 0) return ["- The screen is empty."];

  const lines: string[] = [];
  const exportedIds = new Set(elements.map((element) => element.id));
  // Nested elements are described relative to their (exported) parent, not the screen.
  const childrenOf = new Map<string, WireframeElement[]>();
  for (const element of elements) {
    if (element.parentId && exportedIds.has(element.parentId)) {
      const siblings = childrenOf.get(element.parentId) ?? [];
      siblings.push(element);
      childrenOf.set(element.parentId, siblings);
    }
  }
  const isNested = (element: WireframeElement) => !!element.parentId && exportedIds.has(element.parentId);

  for (const element of elements) {
    if (LAYOUT_TYPES.has(element.type) && !isNested(element)) lines.push(describeLayoutElement(element, canvas));
  }

  const order: Region[] = [];
  const buckets = new Map<string, { region: Region; entries: WireframeElement[] }>();

  for (const element of elements) {
    if (LAYOUT_TYPES.has(element.type) || isNested(element)) continue;
    const region = regionOf(element, canvas);
    const key = `${region.vertical}:${region.horizontal}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { region, entries: [] };
      buckets.set(key, bucket);
      order.push(region);
    }
    bucket.entries.push(element);
  }

  const verticalRank: Record<Vertical, number> = { top: 0, middle: 1, bottom: 2 };
  const horizontalRank: Record<Horizontal, number> = { left: 0, center: 1, right: 2 };
  order.sort(
    (a, b) =>
      verticalRank[a.vertical] - verticalRank[b.vertical] ||
      horizontalRank[a.horizontal] - horizontalRank[b.horizontal]
  );

  for (const region of order) {
    const bucket = buckets.get(`${region.vertical}:${region.horizontal}`);
    if (!bucket) continue;
    const names = bucket.entries
      .map((element) => `"${element.name}" (${ELEMENT_TYPE_LABEL[element.type]})`)
      .join(", ");
    lines.push(`- The ${regionPhrase(region)} contains: ${names}.`);
  }

  for (const element of elements) {
    const children = childrenOf.get(element.id);
    if (children) lines.push(`- Inside ${nameOf(element)}, top to bottom: ${readingOrder(children)}.`);
  }

  return lines;
}
