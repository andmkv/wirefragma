import { describe, expect, it } from "vitest";
import { CHART_LIMITS, normalizeChartData, type ChartData } from "../model/chart";
import {
  detectChartDelimiter,
  formatChartValue,
  mergeParsedChart,
  parseChartText,
  serializeChartText
} from "./chartText";

const EXCEL_PASTE = [
  "Category\tRevenue\tCosts",
  "Jan\t120\t80",
  "Feb\t180\t110",
  "Mar\t150\t95"
].join("\n");

describe("parseChartText", () => {
  it("parses an Excel/Sheets paste (tab separated, header first)", () => {
    const { chart, invalid } = parseChartText(EXCEL_PASTE);
    expect(chart.categories).toEqual(["Jan", "Feb", "Mar"]);
    expect(chart.series).toEqual([
      { name: "Revenue", values: [120, 180, 150] },
      { name: "Costs", values: [80, 110, 95] }
    ]);
    expect(invalid).toEqual([]);
  });

  it("parses comma and semicolon separated text", () => {
    const comma = parseChartText("Category,Revenue\nJan,120\nFeb,180").chart;
    expect(comma.categories).toEqual(["Jan", "Feb"]);
    expect(comma.series[0]).toEqual({ name: "Revenue", values: [120, 180] });

    const semicolon = parseChartText("Category;Revenue\nJan;120\nFeb;180").chart;
    expect(semicolon.categories).toEqual(["Jan", "Feb"]);
    expect(semicolon.series[0].values).toEqual([120, 180]);
  });

  it("understands a decimal comma in a semicolon file", () => {
    const { chart, invalid } = parseChartText("Kategorie;Umsatz\nJan;12,5\nFeb;8,25");
    expect(chart.categories).toEqual(["Jan", "Feb"]);
    expect(chart.series[0].values).toEqual([12.5, 8.25]);
    expect(invalid).toEqual([]);
  });

  it("prefers a comma separator when the commas really are separators", () => {
    const { chart, invalid } = parseChartText("Category,Revenue,Costs\nJan,12,5\nFeb,10,4");
    expect(chart.categories).toEqual(["Jan", "Feb"]);
    expect(chart.series.map((series) => series.values)).toEqual([
      [12, 10],
      [5, 4]
    ]);
    expect(invalid).toEqual([]);
  });

  it("keeps quoted cells together, including escaped quotes and commas", () => {
    const { chart, invalid } = parseChartText('Category,Note\n"a,b",1\n"say ""hi""",2');
    expect(chart.categories).toEqual(["a,b", 'say "hi"']);
    expect(chart.series[0].values).toEqual([1, 2]);
    expect(invalid).toEqual([]);
  });

  it("reads empty cells as gaps", () => {
    const { chart, invalid } = parseChartText("Category,Revenue\nJan,\nFeb,120\nMar,\"\"");
    expect(chart.series[0].values).toEqual([null, 120, null]);
    expect(invalid).toEqual([]);
  });

  it("reports invalid cells with their original 1-based coordinates and keeps them as gaps", () => {
    const { chart, invalid } = parseChartText("Category,Revenue\nJan,abc\nFeb,120\nMar,12x");
    expect(invalid).toEqual([
      { row: 2, column: 2, text: "abc" },
      { row: 4, column: 2, text: "12x" }
    ]);
    expect(chart.series[0].values).toEqual([null, 120, null]);
  });

  it("pads ragged rows with gaps", () => {
    const { chart } = parseChartText("Category,A,B\nJan,1\nFeb,2,3\nMar");
    expect(chart.categories).toEqual(["Jan", "Feb", "Mar"]);
    expect(chart.series[0].values).toEqual([1, 2, null]);
    expect(chart.series[1].values).toEqual([null, 3, null]);
  });

  it("treats the first row as data when it holds no header", () => {
    const headerless = parseChartText("Jan,120\nFeb,180");
    expect(headerless.chart.categories).toEqual(["Jan", "Feb"]);
    expect(headerless.chart.series[0].name).toBe("Series 1");
    expect(headerless.chart.series[0].values).toEqual([120, 180]);

    const forced = parseChartText("Jan,120\nFeb,180", { header: false });
    expect(forced.chart.series[0].values).toEqual([120, 180]);
    const forcedHeader = parseChartText("Jan,120\nFeb,180", { header: true });
    expect(forcedHeader.chart.categories).toEqual(["Feb"]);
  });

  it("handles empty and nullish input without throwing", () => {
    for (const input of ["", "   ", "\n\n", null, undefined]) {
      const result = parseChartText(input);
      expect(result.chart).toEqual({ kind: "bar", categories: [], series: [] });
      expect(result.invalid).toEqual([]);
      expect(result.rows).toBe(0);
    }
  });

  it("applies the hard limits", () => {
    const rows = Array.from({ length: 40 }, (_, index) => `C${index},${index}`);
    const { chart } = parseChartText(["Category,S", ...rows].join("\n"));
    expect(chart.categories).toHaveLength(CHART_LIMITS.maxCategories);
    expect(chart.series[0].values).toHaveLength(CHART_LIMITS.maxCategories);

    const wide = ["Category," + Array.from({ length: 14 }, (_, index) => `S${index}`).join(",")];
    wide.push("Jan," + Array.from({ length: 14 }, () => "1").join(","));
    expect(parseChartText(wide.join("\n")).chart.series).toHaveLength(CHART_LIMITS.maxSeries);
  });

  it("detects the separator the same way it parses it", () => {
    expect(detectChartDelimiter(EXCEL_PASTE)).toBe("\t");
    expect(detectChartDelimiter("Category;A\nJan;1")).toBe(";");
    expect(detectChartDelimiter("Category,A\nJan,1")).toBe(",");
    expect(detectChartDelimiter("just one column")).toBe(",");
  });
});

describe("serializeChartText", () => {
  const chart: ChartData = {
    kind: "bar",
    categories: ["Jan", "Feb"],
    series: [
      { name: "Revenue", values: [120, null] },
      { name: "Costs", values: [80, 95] }
    ]
  };

  it("writes a header row and one row per category", () => {
    expect(serializeChartText(chart).split("\n")).toEqual([
      "Category\tRevenue\tCosts",
      "Jan\t120\t80",
      "Feb\t\t95"
    ]);
  });

  it("quotes only the cells that need it", () => {
    const quoted = serializeChartText(
      { kind: "bar", categories: ["a,b"], series: [{ name: 'say "hi"', values: [1] }] },
      ","
    );
    expect(quoted.split("\n")).toEqual(['Category,"say ""hi"""', '"a,b",1']);
  });

  it("round-trips through parse", () => {
    for (const kind of ["bar", "stackedBar", "line", "area", "pie", "donut"] as const) {
      const original = normalizeChartData({ ...chart, kind });
      // The kind is not stored in the text, so the editor passes the current one back in.
      const parsed = parseChartText(serializeChartText(original), { kind }).chart;
      expect(parsed.kind).toBe(original.kind);
      expect(parsed.categories).toEqual(original.categories);
      expect(parsed.series).toEqual(original.series);
    }
  });

  it("formats values compactly and gaps as empty", () => {
    expect(formatChartValue(120)).toBe("120");
    expect(formatChartValue(12.5)).toBe("12.5");
    expect(formatChartValue(-0.25)).toBe("-0.25");
    expect(formatChartValue(null)).toBe("");
  });
});

describe("mergeParsedChart", () => {
  it("keeps the table shape when the text has fewer rows or columns", () => {
    const previous: ChartData = {
      kind: "bar",
      categories: ["Jan", "Feb", "Mar"],
      series: [
        { name: "Revenue", values: [120, 180, 150] },
        { name: "Costs", values: [80, 110, 95] }
      ]
    };
    const parsed = parseChartText("Category\tRevenue\nJan\t999").chart;
    const merged = mergeParsedChart(previous, parsed);
    expect(merged.categories).toHaveLength(3);
    expect(merged.series).toHaveLength(2);
    expect(merged.series[0]).toEqual({ name: "Revenue", values: [999, 180, 150] });
    expect(merged.series[1]).toEqual({ name: "Costs", values: [80, 110, 95] });
  });

  it("adds genuinely new rows and columns", () => {
    const previous: ChartData = { kind: "line", categories: ["Jan"], series: [{ name: "Revenue", values: [1] }] };
    const parsed = parseChartText("Category\tRevenue\tCosts\nJan\t1\t2\nFeb\t3\t4").chart;
    const merged = mergeParsedChart(previous, parsed);
    expect(merged.kind).toBe("line");
    expect(merged.categories).toEqual(["Jan", "Feb"]);
    expect(merged.series).toEqual([
      { name: "Revenue", values: [1, 3] },
      { name: "Costs", values: [2, 4] }
    ]);
  });

  it("keeps a single series for pie and donut", () => {
    const previous: ChartData = { kind: "pie", categories: ["A"], series: [{ name: "S", values: [1] }] };
    const parsed = parseChartText("Category\tS\tT\nA\t5\t9").chart;
    const merged = mergeParsedChart(previous, parsed);
    expect(merged.series).toHaveLength(1);
    expect(merged.series[0].values).toEqual([5]);
  });
});
