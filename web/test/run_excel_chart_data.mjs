import assert from "node:assert/strict";
import { readExcelChart, replaceExcelChart, serializeExcelChart } from "../js/excel-chart-block.js";
import { joinBlocks, segment } from "../js/mdblocks.js";
import { readExcelChartData } from "../js/excel-chart-data.js";
import { editExcelCell, reorderExcelRows, replaceExcelTable, serializeExcelTable } from "../js/excel-table-block.js";

const number = (displayText, raw) => ({ displayText, value: { type: "number", raw } });
const text = displayText => ({ displayText, value: null });
const table = {
  id: "test-table", version: 1, columns: ["lot", "rate", "count"],
  rows: [
    { id: "titles", cells: [text("LOT"), text("검사율"), text("개수")] },
    { id: "first", cells: [number("01", "1"), number("12,5%", "0.125"), number("0", "0")] },
    { id: "second", cells: [{ ...text("02"), value: { type: "text", raw: "2" } }, text("9"), number("4", "4")] },
    { id: "third", cells: [{ ...number("3", "3"), colSpan: 2 }, null, number("-2", "-2")] },
    { id: "excluded", cells: [text("other"), number("20", "20"), number("40", "40")] },
  ],
};
const ref = {
  tableId: table.id, rowIds: ["third", "first", "second"], headerRowId: "titles",
  xColumnId: "lot", xAxis: "category", yColumnIds: ["count", "rate"],
};
const original = "# Test\n\n<!-- column -->\n\n" + serializeExcelTable(table, "\r\n");
const result = readExcelChartData(original, ref);
assert.deepEqual(result, {
  status: "ready",
  series: [{ columnId: "count", label: "개수" }, { columnId: "rate", label: "검사율" }],
  rows: [
    { rowId: "first", x: "01", y: [0, 0.125] },
    { rowId: "second", x: "02", y: [4, null] },
    { rowId: "third", x: "3", y: [-2, null] },
  ],
});
const scatter = readExcelChartData(original, { ...ref, xAxis: "number", headerRowId: undefined });
assert.deepEqual(scatter.rows.map(row => row.x), [1, null, 3]);
assert.deepEqual(scatter.series.map(series => series.label), [null, null]);

const reordered = reorderExcelRows(table, ["titles", "third", "excluded", "second", "first"]);
const reorderedSource = replaceExcelTable(original, table.id, reordered);
assert.deepEqual(readExcelChartData(reorderedSource, ref).rows, [...result.rows].reverse());

const edited = editExcelCell(reordered, "first", "rate", { displayText: "20%", value: null });
const editedSource = replaceExcelTable(reorderedSource, table.id, edited);
assert.deepEqual(readExcelChartData(editedSource, ref).rows.at(-1).y, [0, null]);
const confirmed = editExcelCell(edited, "first", "rate", { displayText: "20%", value: { type: "number", raw: "0.2" } });
assert.deepEqual(readExcelChartData(replaceExcelTable(editedSource, table.id, confirmed), ref).rows.at(-1).y, [0, 0.2]);

const deleted = { ...table, rows: table.rows.filter(row => row.id !== "second") };
assert.deepEqual(readExcelChartData(replaceExcelTable(original, table.id, deleted), ref), { status: "missing-reference" });
assert.deepEqual(readExcelChartData(original, ref), result);

const reorderedColumns = {
  ...table,
  columns: ["count", "lot", "rate"],
  rows: table.rows.map(row => ({ ...row, cells: [row.cells[2], row.cells[0], row.cells[1]] })),
};
assert.deepEqual(readExcelChartData(replaceExcelTable(original, table.id, reorderedColumns), ref), result);
const withoutCount = {
  ...reorderedColumns,
  columns: reorderedColumns.columns.slice(1),
  rows: reorderedColumns.rows.map(row => ({ ...row, cells: row.cells.slice(1) })),
};
assert.deepEqual(readExcelChartData(serializeExcelTable(withoutCount), ref), { status: "missing-reference" });
assert.deepEqual(readExcelChartData(original, { ...ref, headerRowId: "absent" }), { status: "missing-reference" });

const future = serializeExcelTable(table).replace('"version": 1', '"version": 2');
for (const markdown of ["# Test", future, original + "\n\n<!-- column -->\n\n" + future,
  original + "\n\n" + serializeExcelTable(table)]) {
  assert.deepEqual(readExcelChartData(markdown, ref), { status: "unavailable-table" });
}
for (const badRef of [null, { ...ref, rowIds: [] }, { ...ref, rowIds: ["first", "first"] },
  { ...ref, yColumnIds: ["rate", "rate"] }, { ...ref, extra: "unexpected" },
  { ...ref, xAxis: "unknown" }, { ...ref, headerRowId: "first" }]) {
  assert.deepEqual(readExcelChartData(original, badRef), { status: "invalid-source" });
}
const definition = { id: "chart1", version: 1, kind: "bar", source: ref };
const chartBlock = serializeExcelChart(definition, "\r\n");
assert.ok(chartBlock);
assert.ok(!chartBlock.replaceAll("\r\n", "").includes("\n"));
const chartTail = "\r\n\r\n<!-- column -->\r\n\r\n" + chartBlock + "\r\n\r\n메모";
const withChart = original + chartTail;
assert.equal(joinBlocks(segment(withChart)), withChart);
assert.deepEqual(readExcelChart(withChart, "chart1"), { definition, data: result });
assert.deepEqual(readExcelChart(editedSource + chartTail, "chart1").data.rows.at(-1).y, [0, null]);
assert.deepEqual(readExcelChart(chartTail, "chart1").data, { status: "unavailable-table" });
assert.equal(readExcelChart(withChart, "missing"), null);
assert.equal(serializeExcelChart({ ...definition, kind: "scatter" }), null);
assert.ok(serializeExcelChart({ ...definition, kind: "scatter", source: { ...ref, xAxis: "number" } }));
assert.equal(serializeExcelChart({ ...definition, values: result }), null);
const futureChart = chartBlock.replace('"version": 1', '"version": 2');
const replacement = {
  ...definition, kind: "scatter", source: { ...ref, xAxis: "number", yColumnIds: ["count"] },
};
const otherChart = serializeExcelChart({ ...definition, id: "chart2" });
const mixedDocument = withChart + "\n\n" + otherChart + "\n";
const replaced = replaceExcelChart(mixedDocument, "chart1", replacement);
assert.equal(replaced, mixedDocument.replace(chartBlock, serializeExcelChart(replacement, "\r\n")));
assert.deepEqual(readExcelChart(replaced, "chart1"), {
  definition: replacement, data: readExcelChartData(original, replacement.source),
});
assert.deepEqual(readExcelChart(replaced, "chart2"), readExcelChart(mixedDocument, "chart2"));
assert.equal(replaceExcelChart(mixedDocument, "chart1", { ...replacement, id: "chart2" }), null);
assert.equal(replaceExcelChart(mixedDocument, "chart1", { ...replacement, version: 2 }), null);
assert.equal(replaceExcelChart(mixedDocument, "absent", { ...replacement, id: "absent" }), null);
for (const ignored of [futureChart, withChart + "\n\n" + futureChart,
  withChart + "\n\n" + chartBlock, chartBlock.slice(0, -3), "<!--\n" + chartBlock + "\n-->"]) {
  assert.equal(readExcelChart(ignored, "chart1"), null);
  assert.equal(replaceExcelChart(ignored, "chart1", replacement), null);
}
console.log("Excel chart references, typed data and Markdown storage verified");
