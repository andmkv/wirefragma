import { describe, expect, it } from "vitest";
import {
  CHART_KINDS,
  CHART_LIMITS,
  chartMaxAbsValue,
  chartSummaryCounts,
  chartValue,
  createChartData,
  isChartKind,
  isSingleSeriesKind,
  normalizeChartData,
  type ChartData
} from "./chart";

describe("chart model", () => {
  it("declares the six kinds in order", () => {
    expect([...CHART_KINDS]).toEqual(["bar", "stackedBar", "line", "area", "pie", "donut"]);
    for (const kind of CHART_KINDS) expect(isChartKind(kind)).toBe(true);
    expect(isChartKind("scatter")).toBe(false);
    expect(isChartKind(null)).toBe(false);
  });

  it("creates a small demo dataset that is already normalized", () => {
    const demo = createChartData();
    expect(demo.categories).toHaveLength(3);
    expect(demo.series.length).toBeGreaterThanOrEqual(1);
    expect(demo.series.length).toBeLessThanOrEqual(2);
    expect(demo.series.every((series) => series.values.length === demo.categories.length)).toBe(true);
    expect(demo.series.some((series) => series.values.some((value) => value !== null))).toBe(true);
    expect(normalizeChartData(demo)).toEqual(demo);
    // Deep-copied by value, never shared: mutating the demo must not leak into the next call.
    demo.categories.push("Apr");
    expect(createChartData().categories).toHaveLength(3);
  });

  it("repairs a wrong kind and missing optionals", () => {
    const data = normalizeChartData({ kind: "scatter", categories: ["A"], series: [{ name: "S", values: [1] }] });
    expect(data.kind).toBe("bar");
    expect(data.options).toBeUndefined();
    expect(data.title).toBeUndefined();
  });

  it("coerces finite numeric strings and turns everything else into a gap", () => {
    const data = normalizeChartData({
      kind: "bar",
      categories: ["A", "B", "C", "D", "E", "F", "G"],
      series: [{ name: "S", values: ["12", " 3.5 ", "", null, "NaN", "abc", true] }]
    });
    expect(data.series[0].values).toEqual([12, 3.5, null, null, null, null, null]);
  });

  it("clamps values to the finite range and rounds them", () => {
    expect(chartValue(1e13)).toBe(CHART_LIMITS.maxAbsValue);
    expect(chartValue(-1e13)).toBe(-CHART_LIMITS.maxAbsValue);
    expect(chartValue(Infinity)).toBeNull();
    expect(chartValue(-Infinity)).toBeNull();
    expect(chartValue(NaN)).toBeNull();
    expect(chartValue("2.005")).toBeCloseTo(2.01, 5);
  });

  it("enforces every hard limit", () => {
    const manyCategories = Array.from({ length: 40 }, (_, index) => `Category ${index}`);
    const manySeries = Array.from({ length: 12 }, (_, index) => ({
      name: `Series ${index} with a very long name that must be truncated`,
      values: manyCategories.map((_, cell) => cell)
    }));
    const data = normalizeChartData({
      kind: "bar",
      title: "x".repeat(200),
      categories: manyCategories,
      series: manySeries
    });

    expect(data.categories).toHaveLength(CHART_LIMITS.maxCategories);
    expect(data.series).toHaveLength(CHART_LIMITS.maxSeries);
    expect(data.title).toHaveLength(CHART_LIMITS.maxTitleLength);
    for (const category of data.categories) expect(category.length).toBeLessThanOrEqual(CHART_LIMITS.maxLabelLength);
    for (const series of data.series) {
      expect(series.name.length).toBeLessThanOrEqual(CHART_LIMITS.maxLabelLength);
      expect(series.values).toHaveLength(CHART_LIMITS.maxCategories);
    }
  });

  it("pads and truncates series to the category count", () => {
    const short = normalizeChartData({ kind: "line", categories: ["A", "B", "C"], series: [{ name: "S", values: [1] }] });
    expect(short.series[0].values).toEqual([1, null, null]);

    const long = normalizeChartData({ kind: "line", categories: ["A"], series: [{ name: "S", values: [1, 2, 3, 4] }] });
    expect(long.series[0].values).toEqual([1]);
  });

  it("keeps only the first series for pie and donut", () => {
    for (const kind of ["pie", "donut"] as const) {
      expect(isSingleSeriesKind(kind)).toBe(true);
      const data = normalizeChartData({
        kind,
        categories: ["A", "B"],
        series: [
          { name: "First", values: [1, 2] },
          { name: "Second", values: [3, 4] }
        ]
      });
      expect(data.series.map((series) => series.name)).toEqual(["First"]);
    }
    expect(isSingleSeriesKind("bar")).toBe(false);
  });

  it("names unnamed series instead of leaving them blank", () => {
    const data = normalizeChartData({ kind: "bar", categories: ["A"], series: [{ values: [1] }, { name: "", values: [2] }] });
    expect(data.series.map((series) => series.name)).toEqual(["Series 1", "Series 2"]);
  });

  it("normalizes titles and labels to one trimmed line", () => {
    const data = normalizeChartData({
      kind: "bar",
      title: "  Two\nlines  ",
      categories: ["  A\nB  "],
      series: [{ name: " S\n1 ", values: [1] }]
    });
    expect(data.title).toBe("Two lines");
    expect(data.categories).toEqual(["A B"]);
    expect(data.series[0].name).toBe("S 1");
  });

  it("keeps only true option flags, and drops the object when nothing is set", () => {
    expect(normalizeChartData({ kind: "bar", categories: ["A"], series: [], options: { legend: false } }).options).toBeUndefined();
    expect(
      normalizeChartData({ kind: "bar", categories: ["A"], series: [], options: { legend: true, showValues: false } }).options
    ).toEqual({ legend: true });
    expect(
      normalizeChartData({ kind: "bar", categories: ["A"], series: [], options: { legend: 1, horizontal: "yes" } }).options
    ).toBeUndefined();
  });

  it("never throws, whatever it is handed", () => {
    const inputs: unknown[] = [
      undefined,
      null,
      0,
      "",
      "not a chart",
      [],
      [1, 2, 3],
      {},
      { kind: [], categories: {}, series: "no" },
      { categories: [null, 3, {}], series: [null, 5, { values: "x" }, { values: [1, 2] }] },
      { categories: new Array(100).fill("c"), series: new Array(100).fill({ name: "s", values: [] }) }
    ];
    for (const input of inputs) {
      expect(() => normalizeChartData(input)).not.toThrow();
      const data = normalizeChartData(input);
      expect(Array.isArray(data.categories)).toBe(true);
      expect(Array.isArray(data.series)).toBe(true);
      expect(isChartKind(data.kind)).toBe(true);
      // Always JSON-serializable, always inside the limits.
      expect(() => JSON.stringify(data)).not.toThrow();
      expect(data.categories.length).toBeLessThanOrEqual(CHART_LIMITS.maxCategories);
      expect(data.series.length).toBeLessThanOrEqual(CHART_LIMITS.maxSeries);
    }
  });

  it("falls back to the demo dataset only when categories and series are both absent", () => {
    const demo = createChartData();
    expect(normalizeChartData(null)).toEqual(demo);
    expect(normalizeChartData("nope")).toEqual(demo);
    expect(normalizeChartData({ kind: "bar" })).toEqual(demo);
    expect(normalizeChartData({ kind: "bar", title: "T" })).toEqual({ ...demo, title: "T" });

    // Explicit (even empty or unusable) arrays are respected: clearing a chart stays cleared.
    expect(normalizeChartData({ kind: "bar", categories: [], series: [] })).toEqual({
      kind: "bar",
      categories: [],
      series: []
    });
    expect(normalizeChartData({ kind: "bar", categories: "nope", series: "nope" })).toEqual({
      kind: "bar",
      categories: [],
      series: []
    });

    // Either one alone is kept: the other dimension is simply empty.
    const categoriesOnly = normalizeChartData({ kind: "bar", categories: ["A"], series: [] });
    expect(categoriesOnly.categories).toEqual(["A"]);
    expect(categoriesOnly.series).toEqual([]);

    const seriesOnly = normalizeChartData({ kind: "bar", categories: [], series: [{ name: "S", values: [1] }] });
    expect(seriesOnly.series).toEqual([{ name: "S", values: [] }]);
  });

  it("survives a JSON round trip unchanged", () => {
    const data = normalizeChartData({
      kind: "stackedBar",
      title: "Totals",
      categories: ["A", "B"],
      series: [{ name: "S", values: [1.5, null] }],
      options: { legend: true, horizontal: true }
    });
    expect(normalizeChartData(JSON.parse(JSON.stringify(data)))).toEqual(data);
  });

  it("summarizes counts and scale", () => {
    const data: ChartData = {
      kind: "bar",
      categories: ["A", "B"],
      series: [
        { name: "S1", values: [4, null] },
        { name: "S2", values: [-9, 3] }
      ]
    };
    expect(chartSummaryCounts(data)).toEqual({ series: 2, categories: 2 });
    expect(chartSummaryCounts(undefined)).toEqual({ series: 0, categories: 0 });
    expect(chartMaxAbsValue(data)).toBe(9);
    expect(chartMaxAbsValue({ ...data, kind: "pie" })).toBe(4);
    expect(chartMaxAbsValue({ kind: "bar", categories: [], series: [] })).toBe(0);
  });
});
