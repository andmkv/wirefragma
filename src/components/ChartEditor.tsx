import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { drawChartScene } from "../canvas/render";
import { useT } from "../i18n";
import {
  CHART_LIMITS,
  chartValue,
  createChartData,
  isSingleSeriesKind,
  normalizeChartData,
  type ChartData,
  type ChartKind
} from "../model/chart";
import { mergeParsedChart, parseChartText, serializeChartText, type ChartParseResult } from "../utils/chartText";
import { EmojiTextField } from "./EmojiTextField";
import { SceneModal, useSceneHistory, useStageFit } from "./SceneEditorShell";

/** Small monochrome glyphs for the six kind buttons. */
const KIND_GLYPH: Record<ChartKind, string> = {
  bar: "▥",
  stackedBar: "▤",
  line: "∿",
  area: "◣",
  pie: "◔",
  donut: "◎"
};

type Mode = "table" | "text";

interface ChartEditorProps {
  name: string;
  initial: ChartData;
  onDone: (data: ChartData) => void;
  onCancel: () => void;
}

/** What a numeric cell currently holds: the value the model keeps and the text the user sees. */
interface CellDraft {
  raw: string;
  invalid: boolean;
}

function draftFor(value: number | null): CellDraft {
  return { raw: value === null ? "" : String(value), invalid: false };
}

/** Tab and Enter both move through the grid: one field is one step. */
function gridKeyDown(event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void {
  if (event.key !== "Enter") return;
  event.preventDefault();
  event.currentTarget.blur();
}

/**
 * The Chart popup: kind, title, options and the dataset, edited either as a table or as pasted
 * text. The live preview paints through the SAME `drawChartScene` the wireframe renderer uses, so
 * what the popup shows is what lands on the canvas.
 *
 * Everything is a draft with its own undo stack until Done, which the host commits as one history
 * step; Esc/× discard after a dirty confirmation.
 */
export function ChartEditor({ name, initial, onDone, onCancel }: ChartEditorProps) {
  const t = useT();
  const history = useSceneHistory<ChartData>(normalizeChartData(initial));
  const data = normalizeChartData(history.present);
  const [mode, setMode] = useState<Mode>("table");
  const [drafts, setDrafts] = useState<Record<string, CellDraft>>({});
  const [text, setText] = useState(() => serializeChartText(normalizeChartData(initial)));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { stageRef, scale, cssWidth, cssHeight } = useStageFit({ width: 360, height: 240 });

  const single = isSingleSeriesKind(data.kind);

  /* ------------------------------------------------------------------ preview */

  const paint = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    ctx.save();
    ctx.scale(scale, scale);
    // The ONE chart renderer: the popup preview is the canvas art, not a second implementation.
    drawChartScene(ctx, data, { width: 360, height: 240 }, 1 / scale);
    ctx.restore();
  };

  useEffect(paint);

  /* ------------------------------------------------------------------ history */

  const apply = (next: ChartData, coalesceKey?: string) => history.push(normalizeChartData(next), coalesceKey);

  const setKind = (kind: ChartKind) => {
    const next = normalizeChartData({ ...data, kind });
    setText(serializeChartText(next));
    setDrafts({});
    apply(next);
  };

  const setTitle = (value: string) =>
    apply({ ...data, title: value.trim() === "" ? undefined : value }, "chart-title");

  const setOption = (key: "legend" | "showValues" | "horizontal", value: boolean) => {
    const options: NonNullable<ChartData["options"]> = { ...(data.options ?? {}) };
    if (value) options[key] = true;
    else delete options[key];
    apply({ ...data, options: Object.keys(options).length > 0 ? options : undefined });
  };

  const setCategory = (index: number, value: string) => {
    const categories = data.categories.map((category, position) => (position === index ? value : category));
    apply({ ...data, categories }, `chart-category-${index}`);
  };

  const setSeriesName = (index: number, value: string) => {
    const series = data.series.map((entry, position) => (position === index ? { ...entry, name: value } : entry));
    apply({ ...data, series }, `chart-series-${index}`);
  };

  const setCell = (seriesIndex: number, categoryIndex: number, commit: number | null) => {
    const series = data.series.map((entry, position) =>
      position === seriesIndex
        ? { ...entry, values: entry.values.map((value, cell) => (cell === categoryIndex ? commit : value)) }
        : entry
    );
    apply({ ...data, series }, `chart-cell-${seriesIndex}-${categoryIndex}`);
  };

  const addRow = () => {
    const categories = [...data.categories, ""];
    const series = data.series.map((entry) => ({ ...entry, values: [...entry.values, null] }));
    setDrafts({});
    apply({ ...data, categories, series });
  };

  const removeRow = (index: number) => {
    if (data.categories.length <= 1) return;
    const categories = data.categories.filter((_, position) => position !== index);
    const series = data.series.map((entry) => ({
      ...entry,
      values: entry.values.filter((_, position) => position !== index)
    }));
    setDrafts({});
    apply({ ...data, categories, series });
  };

  const addColumn = () => {
    if (data.series.length >= CHART_LIMITS.maxSeries) return;
    const series = [...data.series, { name: "", values: data.categories.map(() => null) }];
    setDrafts({});
    apply({ ...data, series });
  };

  const removeColumn = (index: number) => {
    if (data.series.length <= 1) return;
    const series = data.series.filter((_, position) => position !== index);
    setDrafts({});
    apply({ ...data, series });
  };

  const swapRowsColumns = () => {
    const [first, ...rest] = data.series;
    if (!first || data.categories.length === 0) return;
    const categories = data.series.map((entry) => entry.name || "Series");
    const names = data.categories.map((category) => category || "Category");
    const rows = [first, ...rest];
    const series = names.map((name, nameIndex) => ({
      name,
      values: categories.map((_, seriesIndex) => rows[seriesIndex]?.values[nameIndex] ?? null)
    }));
    setDrafts({});
    apply({ ...data, kind: data.kind, categories, series });
  };

  /* ------------------------------------------------------------------ text mode */

  const parsed: ChartParseResult = parseChartText(text, { kind: data.kind });

  const openTextMode = () => {
    setText(serializeChartText(data));
    setDrafts({});
    setMode("text");
  };

  const onTextChange = (value: string) => {
    setText(value);
    const result = parseChartText(value, { kind: data.kind });
    apply(mergeParsedChart(data, result.chart, data.kind), "chart-text");
  };

  /* ------------------------------------------------------------------ table mode */

  const cellKey = (seriesIndex: number, categoryIndex: number) => `${seriesIndex}:${categoryIndex}`;
  const invalidCells = Object.values(drafts).filter((draft) => draft.invalid).length;

  const renderCategoryCell = (index: number) => (
    <td key={`category-${index}`} className="chart-cell chart-cell-category">
      <EmojiTextField
        value={data.categories[index] ?? ""}
        ariaLabel={`${t("chart.categoryColumn")} ${index + 1}`}
        onChange={(value) => setCategory(index, value)}
        onKeyDown={gridKeyDown}
      />
      <button
        type="button"
        className="chart-cell-remove"
        onClick={() => removeRow(index)}
        disabled={data.categories.length <= 1}
        title={t("chart.removeRow")}
        aria-label={t("chart.removeRow")}
      >
        ✕
      </button>
    </td>
  );

  const renderValueCell = (seriesIndex: number, categoryIndex: number) => {
    const value = data.series[seriesIndex]?.values[categoryIndex] ?? null;
    const key = cellKey(seriesIndex, categoryIndex);
    const draft = drafts[key] ?? draftFor(value);
    return (
      <td key={key} className={`chart-cell${draft.invalid ? " chart-cell-invalid" : ""}`}>
        <input
          type="text"
          inputMode="decimal"
          className="chart-value-input"
          value={draft.raw}
          aria-label={`${data.series[seriesIndex]?.name || t("chart.series")} ${data.categories[categoryIndex] || categoryIndex + 1}`}
          aria-invalid={draft.invalid}
          onKeyDown={gridKeyDown}
          onChange={(event) => {
            const raw = event.target.value;
            const commit = chartValue(raw);
            setDrafts((current) => ({ ...current, [key]: { raw, invalid: raw.trim() !== "" && commit === null } }));
            // An invalid cell keeps its text on screen but is never written into the model.
            if ((raw.trim() === "" || commit !== null) && commit !== value) {
              setCell(seriesIndex, categoryIndex, commit);
            }
          }}
        />
      </td>
    );
  };

  const table = (
    <div className="chart-table-wrap">
      <table className="chart-table">
        <thead>
          <tr>
            <th className="chart-cell-category">
              <span className="field-label">{t("chart.categoryColumn")}</span>
            </th>
            {data.series.map((entry, index) => (
              <th key={`series-${index}`}>
                <EmojiTextField
                  value={entry.name}
                  placeholder={t("chart.seriesLabel", { index: index + 1 })}
                  ariaLabel={`${t("chart.series")} ${index + 1}`}
                  onChange={(value) => setSeriesName(index, value)}
                  onKeyDown={gridKeyDown}
                  trailing={
                    !single && data.series.length > 1 ? (
                      <button
                        type="button"
                        className="chart-cell-remove chart-column-remove"
                        onClick={() => removeColumn(index)}
                        title={t("chart.removeColumn")}
                        aria-label={t("chart.removeColumn")}
                      >
                        ✕
                      </button>
                    ) : null
                  }
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.categories.map((_, index) => (
            <tr key={`row-${index}`}>
              {renderCategoryCell(index)}
              {data.series.map((__, seriesIndex) => renderValueCell(seriesIndex, index))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="chart-table-actions">
        <button type="button" onClick={addRow} disabled={data.categories.length >= CHART_LIMITS.maxCategories}>
          + {t("chart.addRow")}
        </button>
        <button type="button" onClick={addColumn} disabled={data.series.length >= CHART_LIMITS.maxSeries || single}>
          + {t("chart.addColumn")}
        </button>
        <button type="button" onClick={swapRowsColumns} disabled={single}>
          ⇄ {t("chart.swapRowsColumns")}
        </button>
      </div>
      {invalidCells > 0 ? (
        <p className="chart-invalid-note">⚠ {t("chart.invalidCells", { count: invalidCells })}</p>
      ) : null}
    </div>
  );

  const textMode = (
    <div className="chart-text-mode">
      <EmojiTextField
        multiline
        rows={14}
        value={text}
        placeholder={t("chart.textPlaceholder")}
        ariaLabel={t("chart.mode.text")}
        onChange={onTextChange}
      />
      <p className="hint">{t("chart.parseHint")}</p>
      {parsed.invalid.length > 0 ? (
        <p className="chart-invalid-note">
          ⚠ {t("chart.invalidCells", { count: parsed.invalid.length })}
          <span className="chart-invalid-list">
            {parsed.invalid
              .slice(0, 8)
              .map((cell) => `R${cell.row}C${cell.column} “${cell.text}”`)
              .join(", ")}
          </span>
        </p>
      ) : null}
    </div>
  );

  return (
    <SceneModal
      title={`${t("type.chart")}: ${name}`}
      dirty={history.dirty}
      canUndo={history.canUndo}
      canRedo={history.canRedo}
      onUndo={history.undo}
      onRedo={history.redo}
      onDone={() => onDone(data)}
      onCancel={onCancel}
      hint={t("chart.parseHint")}
      stageRef={stageRef}
      tools={
        <>
          {(Object.keys(KIND_GLYPH) as ChartKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={data.kind === kind ? "active" : undefined}
              aria-pressed={data.kind === kind}
              title={t(`chart.kind.${kind}`)}
              onClick={() => setKind(kind)}
            >
              <span aria-hidden="true">{KIND_GLYPH[kind]}</span> {t(`chart.kind.${kind}`)}
            </button>
          ))}
          <span className="scene-toolbar-sep" />
          <button type="button" onClick={() => apply(createChartData())} title={t("chart.reset")}>
            ↺ {t("chart.reset")}
          </button>
        </>
      }
      footer={
        <div className="scene-footer chart-footer">
          <div className="chart-modes" role="tablist" aria-label={t("chart.categories")}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "table"}
              className={mode === "table" ? "active" : undefined}
              onClick={() => {
                setMode("table");
                setDrafts({});
              }}
            >
              {t("chart.mode.table")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              className={mode === "text" ? "active" : undefined}
              onClick={openTextMode}
            >
              {t("chart.mode.text")}
            </button>
          </div>
          <label className="field chart-title-field">
            <span className="field-label">{t("chart.title")}</span>
            <EmojiTextField
              value={data.title ?? ""}
              placeholder={t("chart.titlePlaceholder")}
              onChange={setTitle}
            />
          </label>
          <div className="chart-options">
            <span className="field-label">{t("chart.options")}</span>
            <label className="field inline">
              <input
                type="checkbox"
                checked={data.options?.legend === true}
                onChange={(event) => setOption("legend", event.target.checked)}
              />
              <span>{t("chart.legend")}</span>
            </label>
            <label className="field inline">
              <input
                type="checkbox"
                checked={data.options?.showValues === true}
                onChange={(event) => setOption("showValues", event.target.checked)}
              />
              <span>{t("chart.showValues")}</span>
            </label>
            <label className="field inline">
              <input
                type="checkbox"
                checked={data.options?.horizontal === true}
                disabled={single || data.kind === "line" || data.kind === "area"}
                onChange={(event) => setOption("horizontal", event.target.checked)}
              />
              <span>{t("chart.horizontal")}</span>
            </label>
          </div>
          {data.series.length === 0 ? <p className="hint">{t("chart.emptySeries")}</p> : null}
          <div className="chart-data-area">{mode === "table" ? table : textMode}</div>
        </div>
      }
    >
      <canvas ref={canvasRef} className="scene-canvas chart-preview" />
    </SceneModal>
  );
}
