import assert from "node:assert/strict";
import {
  copyExcelTable, editExcelCell, pasteExcelRange, pasteExcelTextRange, readExcelTable, reorderExcelRows, replaceExcelTable, serializeExcelTable,
} from "../js/excel-table-block.js";
import { joinBlocks, segment } from "../js/mdblocks.js";
import { planPaste } from "../js/paste-doc.js";

const text = (displayText) => ({ displayText, value: null });
const table = {
  version: 1,
  id: "measurements",
  columns: ["lot", "rate"],
  rows: [
    { id: "header", cells: [{ ...text("검사율\r\n범위 ```"), colSpan: 2 }, null] },
    { id: "sample", cells: [text("LOT-TEST-001"), {
      displayText: "12.5%", value: { type: "number", raw: "0.125" }, numberFormat: "0.0%",
    }] },
  ],
};
const fenced = (data) => ["```mi-excel-table", JSON.stringify(data), "```"].join("\n");
const source = serializeExcelTable(table, "\r\n");
assert.ok(source);
assert.deepEqual(readExcelTable(source, table.id), table);
assert.ok(source.includes("\r\n") && !source.replaceAll("\r\n", "").includes("\n"));

const ordered = structuredClone(table);
ordered.rows.reverse();
ordered.columns.reverse();
for (const row of ordered.rows) {
  if (row.id === "sample") row.cells.reverse();
}
const gfm = "| A | B |\n| --- | --- |\n| ok | 1 |\n\n";
const opaque = fenced({ ...table, id: "future", version: 2 });
const prefix = "\r\n# 검사 기록\r\n\n" + gfm;
const suffix = "\r\n\n<!-- column -->\n" + opaque + "\n\n끝";
const markdown = prefix + source + suffix;
const updated = replaceExcelTable(markdown, table.id, ordered);
assert.equal(updated, prefix + serializeExcelTable(ordered, "\r\n") + suffix);
assert.deepEqual(readExcelTable(updated, table.id), ordered);
assert.equal(readExcelTable(updated, "future"), null);
assert.equal(replaceExcelTable(updated, table.id, { ...table, id: "another" }), null);
assert.equal(joinBlocks(segment(updated)), updated);

for (const badFence of [
  source.slice(0, -3),
  source.slice(0, -3) + "~~~",
  source.replace("```mi", "````mi"),
  "```mi-excel-table\n{broken\n```",
  "<!--\n" + source + "\n-->",
  source.split("\r\n").map(line => "> " + line).join("\r\n"),
  "- 예시\n" + source.split("\r\n").map(line => "  " + line).join("\r\n"),
  "````markdown\n" + source + "\n````",
]) {
  assert.equal(readExcelTable(badFence, table.id), null);
  assert.equal(replaceExcelTable(badFence, table.id, table), null);
  assert.equal(joinBlocks(segment(badFence)), badFence);
}
const tildeFence = source.replace(/^```/, "~~~~").replace(/```$/, "~~~~~  ");
assert.deepEqual(readExcelTable(tildeFence, table.id), table);

for (const duplicate of [source, fenced({ ...table, version: 2 }), fenced({ ...table, rows: [] })]) {
  const document = source + "\n\n<!-- column -->\n\n" + duplicate;
  assert.equal(readExcelTable(document, table.id), null);
  assert.equal(replaceExcelTable(document, table.id, table), null);
}
assert.equal(readExcelTable(source + "\n\n" + fenced({ ...table, id: "other" }), table.id).id, table.id);

for (const invalidate of [
  data => { data.version = 2; },
  data => { data.columns[1] = data.columns[0]; },
  data => { data.rows[1].id = data.rows[0].id; },
  data => { data.rows[1].cells.pop(); },
  data => { data.rows[1].cells[1].value.raw = "12,5%"; },
  data => { data.rows[1].cells[1].value.raw = "9e999"; },
  data => { data.rows[1].cells[1].numberFormat = {}; },
  data => { data.rows[0].cells[0].rowSpan = null; },
  data => { data.rows[0].cells[0].rowSpan = 3; },
  data => { data.rows[0].cells[0].colSpan = 0; },
  data => { data.rows[0].cells[0].rowSpan = 2; },
  data => { data.rows[0].cells[1] = text("overlap"); },
  data => { data.rows[0].cells[0].html = "<b>현황</b>"; },
  data => { data.rows[0].cells[0].styles = { color: "red; background: green" }; },
  data => { data.rows[0].cells[0].richText = [[{ text: "검사", styles: { position: "fixed" } }]]; },
  data => { data.rows[0].cells[0].fillPattern = { pattern: "diag-cross", foreground: "url(local)" }; },
  data => { data.rows[0].height = "10vh"; },
  data => { data.columnWidths = { absent: "14pt" }; },
  data => { data.numberSeparators = { decimal: "." }; },
  data => { data.rows[1].cells[1].displayText = "x".repeat(4 * 1024 * 1024); },
]) {
  const invalid = structuredClone(table);
  invalidate(invalid);
  assert.equal(serializeExcelTable(invalid), null);
  assert.equal(readExcelTable(fenced(invalid), table.id), null);
  assert.equal(replaceExcelTable(markdown, table.id, invalid), null);
}
assert.equal(serializeExcelTable(table, "\n```\n"), null);

const area = structuredClone(table);
area.rows[0].cells[0].rowSpan = 2;
area.rows[1].cells = [null, null];
assert.deepEqual(readExcelTable(serializeExcelTable(area), table.id), area);

const withMerge = structuredClone(area);
withMerge.columnWidths = { lot: "64pt" };
withMerge.rows[0].height = "24pt";
withMerge.rows[0].cells[0].styles = { color: "#123456" };
withMerge.rows[0].cells[0].richText = [[{ text: "검사", styles: { color: "#123456" } }]];
withMerge.rows.push({ id: "blank", cells: [null, null] });
const newIds = { id: "copied", rowIds: ["r1", "r2", "r3"], columnIds: ["c1", "c2"] };
const copy = copyExcelTable(withMerge, markdown, newIds);
assert.deepEqual(readExcelTable(serializeExcelTable(copy), newIds.id), copy);
assert.deepEqual(copy.columnWidths, { c1: "64pt" });
assert.deepEqual(copy.rows.map(row => row.id), newIds.rowIds);
assert.deepEqual(copy.rows[0].cells, withMerge.rows[0].cells);
assert.equal(copy.rows[0].height, "24pt");
copy.rows[0].cells[0].styles.color = "black";
assert.equal(withMerge.rows[0].cells[0].styles.color, "#123456");
for (const invalidIds of [
  { id: table.id }, { id: "future" }, { rowIds: ["r1", "sample", "r3"] },
  { columnIds: ["lot", "c2"] }, { columnIds: ["c1", "c1"] }, { rowIds: ["r1", "r1", "r3"] },
]) assert.equal(copyExcelTable(withMerge, markdown, { ...newIds, ...invalidIds }), null);
assert.equal(copyExcelTable(withMerge, fenced({ id: newIds.id, version: 99 }), newIds), null);

const moved = reorderExcelRows(withMerge, ["blank", "header", "sample"]);
assert.deepEqual(moved.rows.map(row => row.id), ["blank", "header", "sample"]);
assert.equal(moved.rows[1].cells[0].rowSpan, 2);
for (const invalidOrder of [
  ["header", "blank", "sample"], ["sample", "header", "blank"],
  ["header", "sample", "sample"], ["header", "sample", "unknown"],
]) assert.equal(reorderExcelRows(withMerge, invalidOrder), null);

assert.equal(editExcelCell(moved, "sample", "rate", text("covered")), null);
assert.equal(editExcelCell(moved, "header", "rate", text("covered")), null);
assert.equal(editExcelCell(moved, "absent", "rate", text("missing row")), null);
const editedAnchor = editExcelCell(moved, "header", "lot", text("교정 완료"));
assert.deepEqual(editedAnchor.rows[1].cells[0], {
  ...text("교정 완료"), rowSpan: 2, colSpan: 2, styles: { color: "#123456" },
});
const edited = editExcelCell(editedAnchor, "blank", "rate", table.rows[1].cells[1]);
assert.deepEqual(readExcelTable(replaceExcelTable(markdown, table.id, edited), table.id), edited);
assert.deepEqual(edited.rows.map(row => row.id), ["blank", "header", "sample"]);
assert.deepEqual(edited.columns, table.columns);
assert.deepEqual(edited.rows[0].cells[1], {
  displayText: "12.5%", value: { type: "number", raw: "0.125" },
});
assert.deepEqual(editExcelCell(table, "sample", "rate", {
  displayText: "25.0%", value: { type: "number", raw: "0.25" },
}).rows[1].cells[1], {
  displayText: "25.0%", value: { type: "number", raw: "0.25" }, numberFormat: "0.0%",
});
assert.equal(withMerge.rows[0].cells[0].displayText, table.rows[0].cells[0].displayText);

const clipboardRange = rows => planPaste({
  html: `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table>${rows}</table></html>`,
  keepSingleExcelCell: true,
}).block;
const range = clipboardRange(`<tr><td rowspan="2" x:str>001</td>
  <td x:num="0.125" style="background-color:#ffc144;mso-number-format:0.0%">12.5%</td></tr>
  <tr><td></td></tr>`);
const targetSnapshot = structuredClone(withMerge);
const rangeResult = pasteExcelRange(withMerge, "header", "lot", range).table;
assert.deepEqual(withMerge, targetSnapshot);
assert.deepEqual(rangeResult.columns, withMerge.columns);
assert.deepEqual(rangeResult.columnWidths, withMerge.columnWidths);
assert.deepEqual(rangeResult.rows.map(row => [row.id, row.height]), withMerge.rows.map(row => [row.id, row.height]));
assert.equal(rangeResult.rows[0].cells[0].rowSpan, 2);
assert.equal(rangeResult.rows[0].cells[0].colSpan, 1);
assert.deepEqual(rangeResult.rows[0].cells[0].value, { type: "text", raw: "001" });
assert.equal(rangeResult.rows[1].cells[0], null);
assert.equal(rangeResult.rows[1].cells[1].displayText, "");
const rate = rangeResult.rows[0].cells[1];
assert.deepEqual([rate.displayText, rate.value.raw, rate.numberFormat, rate.styles["background-color"]],
  ["12.5%", "0.125", "0.0%", "#ffc144"]);
assert.deepEqual(rangeResult.rows[2], withMerge.rows[2]);
assert.deepEqual(readExcelTable(serializeExcelTable(rangeResult), withMerge.id), JSON.parse(JSON.stringify(rangeResult)));

const oneCell = clipboardRange("<tr><td>one</td></tr>");
for (const [row, column] of [["header", "lot"], ["header", "rate"], ["sample", "lot"], ["sample", "rate"]]) {
  assert.deepEqual(pasteExcelRange(withMerge, row, column, oneCell), { error: "merge" });
}
assert.deepEqual(pasteExcelRange(withMerge, "blank", "lot", range), { error: "bounds" });
assert.deepEqual(pasteExcelRange(withMerge, "header", "rate", range), { error: "bounds" });
assert.deepEqual(pasteExcelRange(withMerge, "unknown", "lot", range), { error: "bounds" });
assert.deepEqual(pasteExcelRange(withMerge, "header", "lot", { ...range, truncated: {} }), { error: "source" });
assert.equal(pasteExcelRange(withMerge, "blank", "rate", oneCell).table.rows[2].cells[1].displayText, "one");

const valuesOnly = { valuesOnly: true };
assert.deepEqual(pasteExcelRange(withMerge, "header", "lot", range, valuesOnly), { error: "merge" });
const matchingMerge = clipboardRange('<tr><td rowspan="2" colspan="2" x:num="2">2</td></tr><tr></tr>');
const keptMerge = pasteExcelRange(withMerge, "header", "lot", matchingMerge, valuesOnly).table;
assert.deepEqual(keptMerge.rows[0].cells[0], {
  displayText: "2", value: { type: "number", raw: "2" }, rowSpan: 2, colSpan: 2, styles: { color: "#123456" },
});
assert.equal(keptMerge.rows[1].cells[1], null);
const unmerged = structuredClone(withMerge);
unmerged.rows[0].cells[0] = null;
unmerged.rows[0].cells[1] = {
  ...text("old percent"), styles: { color: "red" }, numberFormat: "0.00%",
  richText: [[{ text: "old percent", styles: { "font-weight": "bold" } }]],
};
const valuesResult = pasteExcelRange(unmerged, "header", "lot", range, valuesOnly).table;
assert.deepEqual(valuesResult.rows[0].cells[0], { displayText: "001", value: { type: "text", raw: "001" } });
assert.deepEqual(valuesResult.rows[0].cells[1], {
  displayText: "12.5%", value: { type: "number", raw: "0.125" }, styles: { color: "red" }, numberFormat: "0.00%",
});
assert.equal(valuesResult.rows[1].cells[0], null);
const richRate = {
  ...unmerged.rows[0].cells[1],
  displayText: "12.5%",
  richText: [[{ text: "12.5%", styles: { "font-weight": "bold" } }]],
};
unmerged.rows[0].cells[1] = richRate;
const sameDisplay = pasteExcelRange(unmerged, "header", "lot", range, valuesOnly).table.rows[0].cells[1];
assert.deepEqual(sameDisplay.richText, richRate.richText);
const emptyRange = clipboardRange('<tr><td></td></tr>');
const cleared = pasteExcelRange(unmerged, "header", "rate", emptyRange, valuesOnly).table.rows[0].cells[1];
assert.deepEqual(cleared, { displayText: "", value: null, styles: { color: "red" }, numberFormat: "0.00%" });
const tsvRange = pasteExcelTextRange(unmerged, "header", "lot", '001\t"12.5%\n*literal*|<tag>"\r\n');
assert.deepEqual(tsvRange.table.rows[0].cells, [
  { displayText: "001", value: null },
  { displayText: "12.5%\n*literal*|<tag>", value: null, styles: { color: "red" }, numberFormat: "0.00%" },
]);
assert.deepEqual(pasteExcelTextRange(withMerge, "header", "lot", "첫 값\t\r\n\t").table.rows[0].cells[0],
  { displayText: "첫 값", value: null, colSpan: 2, rowSpan: 2, styles: { color: "#123456" } });
assert.deepEqual(pasteExcelTextRange(withMerge, "header", "lot", "a\tb\na\tb"), { error: "merge" });
assert.deepEqual(pasteExcelTextRange(withMerge, "header", "lot", "a\t"), { error: "merge" });
assert.deepEqual(pasteExcelTextRange(unmerged, "header", "lot", "a\tb\nc"), { error: "source" });
assert.deepEqual(pasteExcelTextRange(unmerged, "blank", "rate", "a\tb"), { error: "bounds" });
assert.deepEqual(pasteExcelTextRange(unmerged, "blank", "rate", "\t".repeat(10000)), { error: "source" });
console.log("Excel table block storage cases passed");
