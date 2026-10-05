/**
 * Chart element — a small, self-contained dataset rendered as one of six chart kinds.
 *
 * A Chart is NOT the Canvas (`diagram`) element: it holds numbers, not shapes, and every renderer
 * (canvas, ASCII, Markdown, popup preview) derives its picture from the same `ChartData`. The data
 * is deliberately tiny — a wireframe chart communicates a shape and a magnitude, not a report — so
 * the hard limits below keep the cloud footprint of a document small.
 *
 * Pure data + pure helpers only (no DOM, no canvas, no React), exactly like `diagram.ts` and
 * `drawing.ts`. The canvas geometry for a Chart is its element bounds, so there is nothing here
 * that could become a second hit test.
 */

export const CHART_KINDS = ["bar", "stackedBar", "line", "area", "pie", "donut"] as const;
export type ChartKind = (typeof CHART_KINDS)[number];

export interface ChartSeries {
  name: string;
  /** One entry per category; `null` is a missing value (a gap in a line, nothing to draw). */
  values: (number | null)[];
}

export interface ChartData {
  kind: ChartKind;
  title?: string;
  categories: string[];
  series: ChartSeries[];
  options?: { legend?: boolean; showValues?: boolean; horizontal?: boolean };
}

/** Hard limits. Documents must stay small; every one of these is enforced by `normalizeChartData`. */
export const CHART_LIMITS = {
  /** Maximum categories (x-axis slots / pie slices). */
  maxCategories: 24,
  /** Maximum series (data rows in the legend). */
  maxSeries: 8,
  /** Maximum length of a category label or series name. */
  maxLabelLength: 40,
  /** Maximum length of the chart title. */
  maxTitleLength: 80,
  /** Values are clamped to this absolute bound (they must also be finite). */
  maxAbsValue: 1e12
} as const;

export function isChartKind(value: unknown): value is ChartKind {
  return typeof value === "string" && (CHART_KINDS as readonly string[]).includes(value);
}

/** Pie and donut are single-series kinds; every other kind stacks or groups its series. */
export function isSingleSeriesKind(kind: ChartKind): boolean {
  return kind === "pie" || kind === "donut";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Round to 0.01 so a chart of real-world numbers still serializes compactly. */
function roundValue(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A finite number, or `null` for anything a chart cannot plot:
 * `null`, `""`, whitespace, `NaN`, `±Infinity`, booleans, objects and `undefined`.
 */
export function chartValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? clamp(roundValue(value), -CHART_LIMITS.maxAbsValue, CHART_LIMITS.maxAbsValue) : null;
  }
  // LLMs emit numbers as strings ("12", "3.5"): a finite numeric string is coerced, anything else is a gap.
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? clamp(roundValue(parsed), -CHART_LIMITS.maxAbsValue, CHART_LIMITS.maxAbsValue) : null;
  }
  return null;
}

function text(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").replace(/\n+/g, " ").trim().slice(0, maxLength);
}

/**
 * A fresh Chart is a small demo dataset, never an empty box: 3 categories and 2 series read as a
 * chart at a glance and give the table editor something to start from.
 *
 * The result is already normalized, so `normalizeChartData(createChartData())` is the same value
 * (pinned by `src/model/chart.test.ts`) and a fresh element round-trips unchanged.
 */
export function createChartData(): ChartData {
  return {
    kind: "bar",
    title: "Monthly revenue",
    categories: ["Jan", "Feb", "Mar"],
    series: [
      { name: "Revenue", values: [120, 180, 150] },
      { name: "Costs", values: [80, 110, 95] }
    ]
  };
}

/**
 * Validate + repair chart data from untrusted input (import, localStorage, an LLM answer).
 *
 * Never throws for recoverable input: a wrong kind becomes `bar`, missing optionals are filled,
 * extra categories/series/padding are dropped, values are coerced from finite numeric strings and
 * anything unplottable becomes `null`.
 *
 * A chart whose `categories` and `series` are both *absent* (no `chart` key at all, `null`, a
 * string, an element created before the field existed) falls back to the demo dataset, so a Chart
 * is never an empty box out of the blue. Explicit empty arrays are respected: deleting every row in
 * the editor must stay deleted through a save/import round trip.
 *
 * `categories` is the shape of the data: its length is the authoritative number of slots and every
 * series is padded/truncated to exactly that length, so renderers never have to guess.
 */
export function normalizeChartData(value: unknown): ChartData {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return createChartData();
  const raw = value as Record<string, unknown>;

  const kind = isChartKind(raw.kind) ? raw.kind : "bar";
  const title = text(raw.title, CHART_LIMITS.maxTitleLength);

  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  const categories = rawCategories
    .slice(0, CHART_LIMITS.maxCategories)
    .map((category) => text(category, CHART_LIMITS.maxLabelLength));

  const rawSeries = Array.isArray(raw.series) ? raw.series : [];
  // One extra category beyond the cap is irrelevant: every series is mapped over `categories`,
  // so `categories.length` is the shape and padding is dropped by construction.
  let series: ChartSeries[] = [];
  for (const entry of rawSeries.slice(0, CHART_LIMITS.maxSeries)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const values = Array.isArray(record.values) ? record.values : [];
    const cells: (number | null)[] = categories.map((_, index) => chartValue(values[index]));
    series.push({ name: text(record.name, CHART_LIMITS.maxLabelLength), values: cells });
  }

  // Pie/donut use the first series only; keeping the rest would silently change what is drawn.
  if (isSingleSeriesKind(kind)) series = series.slice(0, 1);

  // Both arrays absent entirely -> there is nothing to describe: start from the demo dataset.
  // The kind and a title that WERE given are kept, so the fallback never throws information away.
  // (Explicit empty arrays are respected, so clearing a chart in the editor survives a round trip.)
  if (raw.categories === undefined && raw.series === undefined) {
    const fallback = createChartData();
    return title ? { ...fallback, kind, title } : { ...fallback, kind };
  }

  const named = series.map((entry, index) => ({
    name: entry.name === "" ? `Series ${index + 1}` : entry.name,
    values: entry.values
  }));

  const data: ChartData = { kind, categories, series: named };
  if (title) data.title = title;

  const rawOptions = raw.options;
  if (rawOptions !== null && typeof rawOptions === "object" && !Array.isArray(rawOptions)) {
    const options = rawOptions as Record<string, unknown>;
    const normalized: NonNullable<ChartData["options"]> = {};
    if (options.legend === true) normalized.legend = true;
    if (options.showValues === true) normalized.showValues = true;
    if (options.horizontal === true) normalized.horizontal = true;
    if (Object.keys(normalized).length > 0) data.options = normalized;
  }

  return data;
}

/** Series/category counts for the Properties summary and the spatial summary. */
export function chartSummaryCounts(data: ChartData | undefined): { series: number; categories: number } {
  return { series: data?.series.length ?? 0, categories: data?.categories.length ?? 0 };
}

/**
 * The number a chart's scale is built from, across the series it actually draws.
 * Returns 0 for an empty chart, so callers can test "nothing to draw" with a single value.
 */
export function chartMaxAbsValue(data: ChartData): number {
  const drawn = isSingleSeriesKind(data.kind) ? data.series.slice(0, 1) : data.series;
  let max = 0;
  for (const entry of drawn) {
    for (const value of entry.values) {
      if (value !== null) max = Math.max(max, Math.abs(value));
    }
  }
  return max;
}
