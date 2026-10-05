/**
 * Chart text mode: a small, dependency-free CSV dialect.
 *
 * The popup's Text tab lets a user paste straight out of Excel / Google Sheets, so the parser
 * accepts comma, semicolon and tab separators, double-quoted cells (`"a,b"`, with `""` as an
 * escaped quote) and a decimal comma (`12,5`), and it never throws — a cell it cannot read is
 * reported, not dropped.
 *
 * Pure functions only: no DOM, no React, no canvas. `parseChartText` and `serializeChartText` are
 * inverse on normalized data (pinned by `src/utils/chartText.test.ts`).
 */

import {
  CHART_LIMITS,
  chartValue,
  isSingleSeriesKind,
  normalizeChartData,
  type ChartData,
  type ChartKind
} from "../model/chart";

/** One parsed cell that is not a number and not empty. */
export interface ChartInvalidCell {
  /** 1-based row in the pasted text, including the header row. */
  row: number;
  /** 1-based column in the pasted text, including the category column. */
  column: number;
  text: string;
}

export interface ChartParseResult {
  chart: ChartData;
  /** Non-numeric, non-empty value cells with 1-based coordinates in the ORIGINAL text. */
  invalid: ChartInvalidCell[];
  /** Row count the text described (header included), before the chart limits were applied. */
  rows: number;
  /** Column count the text described (category column included), before the limits. */
  columns: number;
}

export interface ChartParseOptions {
  kind?: ChartKind;
  /** Override the detected separator (the editor passes the auto-detected one back in). */
  delimiter?: string;
  /** `false` treats the first row as data even when it holds no number. */
  header?: boolean;
  /** Header start row (default 2: the first row is the header). */
  startRow?: number;
  /** Header start column (default 1: the first cell of a row is its category). */
  startColumn?: number;
  /** A hint for quote-aware decimal-comma detection; defaults to `12,5`. */
  decimalComma?: string;
}

const DELIMITERS = [",", ";", "\t"] as const;
const DEFAULT_DELIMITER = ",";

/* ------------------------------------------------------------------ tokenizing */

interface TokenizedCell {
  value: string;
  /** The cell was written as `"..."`, i.e. it is text even when it reads like a number. */
  quoted: boolean;
}

/**
 * Split one row into cells, honouring double quotes. A quote only opens a quoted cell at the
 * beginning of a cell; `""` inside it is one literal quote.
 */
function tokenizeRow(line: string, delimiter: string): TokenizedCell[] {
  const cells: TokenizedCell[] = [];
  let current = "";
  let quoted = false;
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' && current === "") {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      cells.push({ value: current, quoted });
      current = "";
      quoted = false;
      continue;
    }
    current += char;
  }
  cells.push({ value: current, quoted });
  return cells.map((cell) => ({ value: cell.value.trim(), quoted: cell.quoted }));
}

function nonEmptyLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.trim() !== "");
}

/**
 * The separator that explains the most rows: tab wins over semicolon wins over comma on a tie, so
 * a spreadsheet paste with tabs inside values still splits into columns.
 */
export function detectChartDelimiter(text: string): string {
  const lines = nonEmptyLines(text);
  if (lines.length === 0) return DEFAULT_DELIMITER;
  let best = DEFAULT_DELIMITER;
  let bestScore = 0;
  for (const delimiter of [...DELIMITERS].reverse()) {
    let columns = 1;
    for (const line of lines) columns = Math.max(columns, tokenizeRow(line, delimiter).length);
    const score = columns > 1 ? columns : 0;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** True when the cell reads as a number, so `12,5` can be told apart from a value list. */
function numericLike(cell: TokenizedCell): boolean {
  return cell.value !== "" && chartValue(cell.value) !== null;
}

function looksNumericLine(line: string, delimiter: string): boolean {
  return tokenizeRow(line, delimiter).slice(1).some(numericLike);
}

/**
 * `,` is also a decimal separator in most of Europe, so `12,5` is read as 12.5 — but only when the
 * text really is decimal-comma data. A comma that already splits cells (`,`) can still be a
 * decimal separator inside a `;`/tab separated file, so the test counts cells that only become
 * numbers after the swap and only trusts it while plain numbers are at least as common.
 */
function usesDecimalComma(rows: TokenizedCell[][]): boolean {
  let plain = 0;
  let decimal = 0;
  for (const row of rows) {
    for (const cell of row) {
      if (cell.value === "") continue;
      if (chartValue(cell.value) !== null) {
        plain += 1;
        continue;
      }
      if (cell.value.includes(",") && chartValue(cell.value.replace(/,/g, ".")) !== null) decimal += 1;
    }
  }
  return decimal > 0 && decimal >= plain;
}

function numericCell(cell: TokenizedCell, decimalComma: boolean): number | null {
  if (cell.value === "") return null;
  if (cell.quoted) return chartValue(cell.value);
  return chartValue(decimalComma ? cell.value.replace(",", ".") : cell.value);
}

/* ------------------------------------------------------------------ parsing */

function emptyChart(kind: ChartKind): ChartData {
  return { kind, categories: [], series: [] };
}

/**
 * Parse pasted/typed chart data.
 *
 * Layout: the first row is the header (series names after the first cell), the first column holds
 * the categories. Row lengths do not have to match — a short row is padded with gaps and a long one
 * is truncated by the category limit. Every cell that is neither empty nor a number is reported in
 * `invalid` (and read as a gap), so the editor can highlight it instead of silently dropping it.
 */
export function parseChartText(text: string | null | undefined, options: ChartParseOptions = {}): ChartParseResult {
  const kind = options.kind ?? "bar";
  if (typeof text !== "string" || text.trim() === "") {
    return { chart: emptyChart(kind), invalid: [], rows: 0, columns: 0 };
  }

  const lines = nonEmptyLines(text);
  const delimiter = options.delimiter ?? detectChartDelimiter(text);
  const table = lines.map((line) => tokenizeRow(line, delimiter));
  const decimalComma = usesDecimalComma(table);
  const header = options.header ?? lines.some((line) => !looksNumericLine(line, delimiter));
  const startRow = Math.max(1, options.startRow ?? 2);
  const startColumn = Math.max(1, options.startColumn ?? 1);
  const columns = table.reduce((max, row) => Math.max(max, row.length), 0);

  const headerRow = header ? (table[startRow - 2] ?? []) : [];
  const seriesNames = Array.from({ length: Math.max(0, columns - startColumn) }, (_, index) => {
    const cell = headerRow[startColumn + index];
    return cell ? cell.value.slice(0, CHART_LIMITS.maxLabelLength) : "";
  });

  const dataRows = header ? table.slice(startRow - 1) : table;
  const invalid: ChartInvalidCell[] = [];
  const categories: string[] = [];
  const values: (number | null)[][] = seriesNames.map(() => []);

  for (const [rowIndex, row] of dataRows.entries()) {
    // 1-based coordinates in the original text, so the message points at what the user sees.
    const textRow = rowIndex + (header ? startRow : 1);
    const label = (row[startColumn - 1]?.value ?? "").replace(/\s+/g, " ").slice(0, CHART_LIMITS.maxLabelLength);
    categories.push(label);
    for (let index = 0; index < seriesNames.length; index += 1) {
      const cell = row[startColumn + index];
      const parsed = cell ? numericCell(cell, decimalComma) : null;
      if (cell && cell.value !== "" && parsed === null) {
        invalid.push({ row: textRow, column: startColumn + index + 1, text: cell.value });
      }
      values[index].push(parsed);
    }
  }

  // The limits are applied by `normalizeChartData`, the single place that owns them.
  const chart =
    categories.length === 0 && seriesNames.length === 0
      ? // `normalizeChartData` falls back to the demo dataset for completely empty input; an empty
        // paste must stay empty instead.
        emptyChart(kind)
      : normalizeChartData({
          kind,
          categories,
          series: seriesNames.map((name, index) => ({ name, values: values[index] }))
        });

  return { chart, invalid, rows: lines.length, columns };
}

/* ------------------------------------------------------------------ serializing */

/** Integer when it is one, otherwise the shortest decimal that still round-trips. */
export function formatChartValue(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  return String(value);
}

function quoteCell(value: string, delimiter: string): string {
  const needsQuotes =
    value.includes(delimiter) || value.includes('"') || value.includes("\n") || value.includes("\t");
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Write the chart back as text: header row first (series names after the category column), then one
 * row per category. `delimiter` defaults to a tab, which is what a spreadsheet paste looks like and
 * which can never be confused with a decimal comma.
 */
export function serializeChartText(chart: ChartData, delimiter = "\t"): string {
  const separator = delimiter === "" ? "\t" : delimiter;
  const series = isSingleSeriesKind(chart.kind) ? chart.series.slice(0, 1) : chart.series;
  const header = ["Category", ...series.map((entry) => entry.name || "Series")];
  const lines = [header.map((cell) => quoteCell(cell, separator)).join(separator)];
  for (const [index, category] of chart.categories.entries()) {
    const cells = [category, ...series.map((entry) => formatChartValue(entry.values[index] ?? null))];
    lines.push(cells.map((cell) => quoteCell(cell, separator)).join(separator));
  }
  return lines.join("\n");
}

/**
 * Fold freshly parsed data back into the chart the table is editing without shrinking its shape:
 * the user's trailing empty rows and empty series columns survive a round trip through the Text tab.
 */
export function mergeParsedChart(previous: ChartData, parsed: ChartData, kind?: ChartKind): ChartData {
  // The kind lives outside the text, so the caller's current kind wins over the parse default.
  const resolved: ChartKind = kind ?? previous.kind ?? parsed.kind;
  if (isSingleSeriesKind(resolved)) {
    const source = parsed.series[0] ?? previous.series[0];
    return normalizeChartData({ ...parsed, kind: resolved, series: source ? [source] : [] });
  }
  const seriesCount = Math.max(previous.series.length, parsed.series.length);

  const categoriesLength = Math.max(previous.categories.length, parsed.categories.length);
  const categories = Array.from({ length: categoriesLength }, (_, index) =>
    parsed.categories[index] ?? previous.categories[index] ?? ""
  );
  const series = Array.from({ length: seriesCount }, (_, index) => {
    const next = parsed.series[index];
    const before = previous.series[index];
    const name = next?.name || before?.name || "";
    // A parsed cell is `null` both for "empty in the text" and "not mentioned", so the previous
    // value is the fallback: pasting a short table must never silently erase the rest.
    const values = Array.from({ length: categoriesLength }, (_, cell) =>
      next?.values[cell] ?? before?.values[cell] ?? null
    );
    return { name, values };
  });

  return normalizeChartData({ ...parsed, kind: resolved, categories, series });
}
