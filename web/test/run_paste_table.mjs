// V-001: clipboard HTML / TSV -> note table, and cell-range operations. Fake data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { excelTableFromPaste, readExcelTable, serializeExcelTable } from "../js/excel-table-block.js";
import { PASTE_LIMITS, clipboardToTable, pasteNotes, tableBlockToSource, tsvToBlock } from "../js/paste-html.js";
import {
  clearRange, fillDown, fillRight, cellHtml, cellPlain, isRichCell, moveCursor, nextSortDirection, normalizeRange,
  parsePayload, pasteIntoRange, pasteSources, rangeToHtml, rangeToPayload, rangeToTsv, restoreRowOrder, tabTarget, wholeTable,
} from "../js/note-table-range.js";
import { cellSource, cellText, parseNoteTable, setTableCell, sortTableRows, writeNoteTable } from "../js/note-table-model.js";

const fixture = (name) => readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const grid = (source) => parseNoteTable(source).rows.map((row) => row.cells);

// ---- Excel (Windows) clipboard HTML: class based styles, fragment markers, merged cells, hidden cells
const excel = clipboardToTable({ html: fixture("excel-clipboard.html"), text: "ignored" });
assert.equal(excel.via, "html");
const eb = excel.block;
assert.equal(eb.rows.length, 4);
assert.equal(eb.cols, 4);
assert.deepEqual(eb.rows[0].map((c) => c.plain), ["항목", "수량", "비고", "그룹"]);
assert.equal(eb.rows[0][0].md, "**항목**"); // .xl65 bold; the gray header fill is NOT turned into a highlight
assert.equal(eb.rows[1][0].md, '<span style="color:#d93025">EQ-A01</span>'); // #C00000 -> nearest text preset
assert.equal(eb.rows[1][1].plain, "007.00"); // number text verbatim (leading zeros, decimals)
assert.equal(eb.rows[2][1].plain, "1,234.50");
assert.equal(eb.rows[1][2].md, "<mark>점검 필요</mark>"); // yellow -> default highlight; &nbsp; -> space
assert.equal(eb.rows[2][2].plain, "첫 줄\n둘째 줄"); // <br> + source newline inside a cell
assert.equal(eb.rows[3][2].md, '<span style="color:#1a73e8">*파랑 기울임*</span> 일반 <u>밑줄</u> ~~취소~~');
assert.equal(eb.rows[3][3].md, "2\\*3\\*4 \\~\\~ \\`x\\`");
assert.deepEqual(eb.aligns, ["", "right", "", "center"]);
// rowspan repeats the value down, colspan leaves a blank cell, hidden cells and rows are dropped
assert.equal(eb.rows[2][3].plain, "A조");
assert.equal(eb.rows[3][0].plain, "병합 제목");
assert.equal(eb.rows[3][1].plain, "");
assert.equal(eb.merged, 2);
assert.equal(eb.hasFormat, true);
assert.match(pasteNotes(eb)[0], /병합 셀 2개/);

// The same parse exposes the source geometry independently of its GFM projection.
const sourceCell = (block, row, col) => block.excel.cells.find((cell) => cell.row === row && cell.col === col);
assert.deepEqual(eb.excel.columnWidths, ["65pt", "65pt", "94pt", "94pt"]);
assert.deepEqual(eb.excel.rowHeights, Array(4).fill("15.0pt"));
assert.deepEqual(eb.excel.numberSeparators, { decimal: String.raw`"\."`, thousands: String.raw`"\,"` });
assert.equal(sourceCell(eb, 0, 0).styles["background-color"], "#D9D9D9");
assert.equal(sourceCell(eb, 0, 0).styles["font-family"], '"맑은 고딕", monospace');
assert.equal(sourceCell(eb, 1, 0).styles.color, "#C00000");
assert.deepEqual(sourceCell(eb, 1, 1).value, { type: "number", raw: "7" });
assert.equal(sourceCell(eb, 1, 1).displayText, "007.00");
assert.equal(sourceCell(eb, 1, 1).numberFormat, String.raw`"0\.00"`);
assert.equal(sourceCell(eb, 1, 3).rowSpan, 2);
assert.equal(sourceCell(eb, 2, 3), undefined);
assert.equal(sourceCell(eb, 3, 0).colSpan, 2);
assert.equal(sourceCell(eb, 3, 1), undefined);
assert.equal(sourceCell(eb, 3, 3).displayText, "2*3*4 ~~ `x`");

// Excel's web export gives a hidden <col> zero width, while its cells still contain values.
const hiddenColumnTable = `<table>
  <colgroup><col width="50"><col width="0" span="2" style="display:none"><col width="90"></colgroup>
  <tr><td>Metric</td><td>Hidden</td><td>Also hidden</td><td>Result</td></tr>
  <tr><td colspan="4" style="border-right:1pt solid black">Merged across hidden columns</td></tr>
  <tr><td>LOT-TEST-001</td><td colspan="3">Merged from a hidden column</td></tr>
  <tr><td>Visible</td><td colspan="2">Entirely hidden merge</td><td x:num="0.125">12.5%</td></tr>
</table>`;
const hiddenColumnExcel = clipboardToTable({
  html: '<html xmlns:x="urn:schemas-microsoft-com:office:excel">' + hiddenColumnTable + '</html>',
}).block;
assert.deepEqual(hiddenColumnExcel.rows.map((row) => row.map(({ plain }) => plain)), [
  ["Metric", "Result"], ["Merged across hidden columns", ""],
  ["LOT-TEST-001", "Merged from a hidden column"], ["Visible", "12.5%"],
]);
assert.deepEqual(hiddenColumnExcel.excel.columnWidths, ["50", "90"]);
assert.equal(hiddenColumnExcel.merged, 1);
assert.equal(sourceCell(hiddenColumnExcel, 1, 0).colSpan, 2);
assert.equal(sourceCell(hiddenColumnExcel, 1, 0).styles["border-right"], "1pt solid black");
assert.equal(sourceCell(hiddenColumnExcel, 2, 1).colSpan, 1);
assert.deepEqual(sourceCell(hiddenColumnExcel, 3, 1).value, { type: "number", raw: "0.125" });
assert.doesNotMatch(tableBlockToSource(hiddenColumnExcel), /Entirely hidden merge|Also hidden/);
assert.equal(clipboardToTable({ html: hiddenColumnTable }).block.cols, 4);

// Excel rowspans include hidden worksheet rows in the HTML geometry.
const hiddenRowsExcel = clipboardToTable({ html: `
  <html xmlns:x="urn:schemas-microsoft-com:office:excel">
  <style>.hidden{display:none}.pattern{background:#DACA66;mso-pattern:#BB5522 diag-cross}</style>
  <table><col><col style="display:none"><col>
    <tr height="24"><td class="pattern" rowspan="3" colspan="2">Visible anchor</td><td>First</td></tr>
    <tr class="hidden"><td>Hidden row value</td></tr>
    <tr height="36"><td>Second</td></tr>
    <tr class="hidden"><td rowspan="2" class="pattern">Hidden anchor</td><td colspan="2">Hidden row value</td></tr>
    <tr height="42"><td>Hidden column value</td><td>Third</td></tr>
    <tr class="hidden"><td rowspan="2">Entirely hidden merge</td></tr>
    <tr class="hidden"><td colspan="6">Hidden row value</td></tr>
    <tr><td style="background:yellow;mso-pattern:black none">After merges</td>
      <td></td><td style="mso-pattern:url(invalid) diag-cross">Fourth</td></tr>
  </table></html>` }).block;
assert.deepEqual(hiddenRowsExcel.rows.map((row) => row.map(({ plain }) => plain)), [
  ["Visible anchor", "First"], ["Visible anchor", "Second"], ["Hidden anchor", "Third"], ["After merges", "Fourth"],
]);
assert.deepEqual(hiddenRowsExcel.excel.rowHeights, ["24", "36", "42", null]);
assert.equal(hiddenRowsExcel.merged, 1);
assert.equal(sourceCell(hiddenRowsExcel, 0, 0).rowSpan, 2);
assert.equal(sourceCell(hiddenRowsExcel, 0, 0).colSpan, 1);
assert.equal(sourceCell(hiddenRowsExcel, 1, 0), undefined);
assert.equal(sourceCell(hiddenRowsExcel, 2, 0).rowSpan, 1);
assert.equal(hiddenRowsExcel.rows[2][0].repeated, false);
assert.equal(sourceCell(hiddenRowsExcel, 0, 0).styles["background-color"], "#DACA66");
assert.deepEqual(sourceCell(hiddenRowsExcel, 2, 0).fillPattern, { pattern: "diag-cross", foreground: "#BB5522" });
assert.equal(sourceCell(hiddenRowsExcel, 3, 0).fillPattern, undefined);
assert.equal(sourceCell(hiddenRowsExcel, 3, 1).fillPattern, undefined);
assert.doesNotMatch(tableBlockToSource(hiddenRowsExcel), /Entirely hidden merge|Hidden (?:row|column) value/);

// Excel's web export also uses colspans for text overflow and compressed runs of blank cells.
const layoutSpans = `<table><col><col style="display:none"><col><col>
  <tr><td>Group</td><td></td><td>Value</td><td>End</td></tr>
  <tr><td colspan="3" style="mso-ignore:colspan">Overflow text</td><td>Right</td></tr>
  <tr><td colspan="3" style="mso-ignore:padding">True merge</td><td>Right</td></tr>
  <tr><td colspan="2" style="mso-ignore:colspan"></td><td>After blanks</td><td>Right</td></tr>
  <tr><td>Left</td><td colspan="2" style="mso-ignore:colspan">Hidden overflow</td><td>Right</td></tr>
</table>`;
const layoutSpanExcel = clipboardToTable({
  html: '<html xmlns:x="urn:schemas-microsoft-com:office:excel">' + layoutSpans + '</html>',
}).block;
assert.deepEqual(layoutSpanExcel.rows.map((row) => row.map(({ plain }) => plain)), [
  ["Group", "Value", "End"], ["Overflow text", "", "Right"], ["True merge", "", "Right"],
  ["", "After blanks", "Right"], ["Left", "", "Right"],
]);
assert.equal(layoutSpanExcel.merged, 1);
assert.equal(sourceCell(layoutSpanExcel, 1, 0).colSpan, 1);
assert.equal(sourceCell(layoutSpanExcel, 2, 0).colSpan, 2);
assert.equal(sourceCell(layoutSpanExcel, 3, 1).displayText, "After blanks");
assert.doesNotMatch(tableBlockToSource(layoutSpanExcel), /Hidden overflow/);
assert.equal(clipboardToTable({ html: layoutSpans }).block.merged, 4);

const customExcel = clipboardToTable({ html: `
  <style>br{mso-data-placement:same-cell}td{mso-number-format:General}</style>
  <table><colgroup><col span="2" width="88"></colgroup>
    <tr height="24"><td x:num="0.125" style='mso-number-format:"0.0%;[Red]-0.0%";
      vertical-align:middle; border-bottom:.5pt solid windowtext; text-indent:2pt;
      mso-rotate:45; background-image:url(https://invalid.example)'>12.5%</td>
    <td x:str="0017" style='color:var(--external);font-family:url(evil)'>0017</td></tr>
    <tr><td x:num>1,234</td><td x:num>1.234</td></tr>
  </table>` }).block;
assert.deepEqual(customExcel.excel.columnWidths, ["88", "88"]);
assert.deepEqual(customExcel.excel.rowHeights, ["24", null]);
assert.equal(sourceCell(customExcel, 0, 0).numberFormat, '"0.0%;[Red]-0.0%"');
assert.deepEqual(sourceCell(customExcel, 0, 0).styles, {
  "border-bottom": ".5pt solid windowtext",
  "vertical-align": "middle",
  "text-indent": "2pt",
  "mso-rotate": "45",
});
assert.deepEqual(sourceCell(customExcel, 0, 1).value, { type: "text", raw: "0017" });
assert.deepEqual(sourceCell(customExcel, 0, 1).styles, {});
assert.equal(sourceCell(customExcel, 1, 0).value, null);
assert.equal(sourceCell(customExcel, 1, 1).value, null);
assert.deepEqual(customExcel.excel.numberSeparators, { decimal: null, thousands: null });

// Excel's General alignment is not a CSS keyword. The exported HTML align attribute
// supplies the rendered direction without changing the legacy GFM projection.
const alignedExcel = clipboardToTable({ html: String.raw`
  <head><meta name="Generator" content="Microsoft Excel 15">
  <style>td{text-align:general}.center{text-align:center}</style></head>
  <table style='mso-displayed-decimal-separator:"\,";mso-displayed-thousand-separator:"\."'>
    <tr><td>Heading</td><td>Summary</td></tr>
    <tr><td align="RIGHT">12,5%</td><td class="center" align="right">LOT-TEST-001</td></tr>
  </table>` }).block;
assert.equal(sourceCell(alignedExcel, 0, 0).styles["text-align"], "general");
assert.equal(sourceCell(alignedExcel, 1, 0).styles["text-align"], "right");
assert.equal(sourceCell(alignedExcel, 1, 0).displayText, "12,5%");
assert.equal(sourceCell(alignedExcel, 1, 0).value, null);
assert.equal(sourceCell(alignedExcel, 1, 1).styles["text-align"], "center");
assert.deepEqual(alignedExcel.aligns, ["", "center"]);
assert.deepEqual(alignedExcel.excel.numberSeparators, {
  decimal: String.raw`"\,"`, thousands: String.raw`"\."`,
});

// Excel exports mixed cell fonts as class-based <font> elements, including Office-only double underline.
const mixedExcel = clipboardToTable({ html: `
  <head><meta name=Generator content="Microsoft Excel 15"></head>
  <style>
    td { color:black; font-size:11.0pt; font-weight:400; text-decoration:none }
    .xl65 { color:#12265B; font-weight:700 }
    .font0 { color:black; font-weight:400 }
    .font7 { color:black; font-weight:400; font-family:Arial,sans-serif; font-size:16.0pt; font-style:italic }
    .font8 { color:black; font-weight:400; text-decoration:underline; text-underline-style:double }
  </style>
  <table><tr><td class=xl65>LOT<font class=font0>-</font><font class=font7>TEST</font><font
    class=font0>-001<br></font><font class=font8><s>READY</s></font></td>
    <td>Same <span style="color:var(--external);font-family:url(evil)">font</span></td></tr></table>
` }).block;
const mixedCell = sourceCell(mixedExcel, 0, 0);
assert.equal(mixedCell.displayText, "LOT-TEST-001\nREADY");
assert.deepEqual(mixedCell.richText.map((line) => line.map((run) => run.text)), [["LOT", "-", "TEST", "-001"], ["READY"]]);
assert.equal(mixedCell.richText[0][0].styles.color, "#12265B");
assert.equal(mixedCell.richText[0][0].styles["font-weight"], "700");
assert.equal(mixedCell.richText[0][1].styles.color, "black");
assert.equal(mixedCell.richText[0][1].styles["font-weight"], "400");
assert.equal(mixedCell.richText[0][2].styles["font-family"], "Arial,sans-serif");
assert.equal(mixedCell.richText[0][2].styles["font-size"], "16.0pt");
assert.equal(mixedCell.richText[1][0].styles["text-decoration-line"], "underline line-through");
assert.equal(mixedCell.richText[1][0].styles["text-underline-style"], "double");
assert.equal(sourceCell(mixedExcel, 0, 1).richText, undefined);

for (const block of [eb, hiddenColumnExcel, hiddenRowsExcel, layoutSpanExcel, customExcel, alignedExcel, mixedExcel]) {
  const ids = {
    id: "sheet-test",
    rowIds: block.rows.map((_, index) => "r" + index),
    columnIds: Array.from({ length: block.cols }, (_, index) => "c" + index),
  };
  const model = excelTableFromPaste(block, ids);
  assert.ok(model);
  const stored = serializeExcelTable(model);
  assert.ok(stored);
  const reopened = readExcelTable(stored, ids.id);
  assert.deepEqual(reopened.rows.map(row => row.id), ids.rowIds);
  assert.deepEqual(reopened.columns, ids.columnIds);
  assert.deepEqual(reopened.rows.map(row => row.height), block.excel.rowHeights);
  assert.deepEqual(reopened.columns.map(id => reopened.columnWidths[id] ?? null), block.excel.columnWidths);
  assert.deepEqual(reopened.numberSeparators, block.excel.numberSeparators);
  const cells = reopened.rows.flatMap((row, r) => row.cells.flatMap((cell, c) => cell ? [{ row: r, col: c, ...cell }] : []));
  assert.deepEqual(cells, JSON.parse(JSON.stringify(block.excel.cells)));
}
assert.equal(excelTableFromPaste(eb, { id: "test", rowIds: [], columnIds: [] }), null);
assert.equal(excelTableFromPaste(eb, {
  id: "test", rowIds: ["r1", "r1", "r3", "r4"], columnIds: ["c1", "c2", "c3", "c4"],
}), null);
assert.equal(excelTableFromPaste(tsvToBlock("왼쪽\t오른쪽"), {
  id: "test", rowIds: ["r1"], columnIds: ["c1", "c2"],
}), null);
assert.equal(mixedExcel.rows[0][0].plain, mixedCell.displayText);

const clippedExcel = clipboardToTable({ html: `
  <html xmlns:x="urn:schemas-microsoft-com:office:excel"><table>
    <tr><td colspan="70" rowspan="1000">Merged</td><td>Outside</td></tr><tr><td>Outside</td></tr>
  </table></html>` }).block;
assert.equal(clippedExcel.cols, PASTE_LIMITS.cols);
assert.equal(clippedExcel.excel.cells.length, 1);
assert.equal(sourceCell(clippedExcel, 0, 0).colSpan, clippedExcel.cols);
assert.equal(sourceCell(clippedExcel, 0, 0).rowSpan, clippedExcel.rows.length);


const NL = "\n";
const source = tableBlockToSource(eb, { format: true, eol: NL });
const parsed = parseNoteTable(source);
assert.equal(writeNoteTable(parsed), source); // untouched: byte identical
assert.equal(parsed.width, 4);
assert.equal(parsed.rows.length, 4);
assert.equal(parsed.alignments[1], "---:");
assert.equal(parsed.alignments[3], ":---:");
assert.equal(cellText(parsed.rows[2].cells[0]), "a|b"); // pipe escaped in the file, plain again in the cell
assert.ok(source.includes("a\\|b"));
assert.ok(source.includes("첫 줄<br>둘째 줄"));
assert.equal(source.split(NL).length, 5); // no line break leaked out of a cell
assert.equal(cellPlain(parsed.rows[1].cells[0]), "EQ-A01");
assert.equal(cellPlain(parsed.rows[3].cells[3]), "2*3*4 ~~ `x`");
assert.equal(isRichCell(parsed.rows[1].cells[0]), true);
assert.equal(isRichCell(parsed.rows[1].cells[1]), false);
assert.equal(cellHtml(parsed.rows[3].cells[2]), '<span style="color:#1a73e8"><i>파랑 기울임</i></span> 일반 <u>밑줄</u> <s>취소</s>');

// "텍스트만": same text, no markup, no alignment
const plainSource = tableBlockToSource(eb, { format: false, eol: NL });
assert.ok(!/\*\*|<u>|<mark|<span|:---|---:/.test(plainSource.replace(/\\\*/g, "")));
assert.equal(cellText(parseNoteTable(plainSource).rows[3].cells[2]), "파랑 기울임 일반 밑줄 취소");

// Excel's Save as Web Page output puts the clipped tail in a trailing, plain hidden span.
const excelOverflowTable = `<table>
  <tr><td>Lot</td><td>Equipment</td></tr>
  <tr><td>LOT-TEST-<span style='display:none'>001</span></td><td>EQ-A01</td>
  <td style="display:none">Hidden column cell</td></tr>
  <tr><td>A<span style="display:none">Hidden</span>B</td><td>EQ-A02<span style="display:none;mso-hide:all">Hidden</span></td></tr>
  <tr><td><span style="display:none">Hidden</span></td><td>EQ-A03</td></tr>
  <tr style="display:none"><td>Hidden row</td><td>EQ-A04</td></tr>
</table>`;
const excelOverflowBlocks = [
  `<html><head><meta name=Generator content="Microsoft Excel 15"></head><body>${excelOverflowTable}</body></html>`,
  "<style>br{mso-data-placement:same-cell}td{mso-number-format:General}</style>" + excelOverflowTable,
];
for (const html of excelOverflowBlocks) {
  const { block } = clipboardToTable({ html });
  assert.deepEqual(block.rows.map((row) => row.map((cell) => cell.plain)), [
    ["Lot", "Equipment"], ["LOT-TEST-001", "EQ-A01"], ["AB", "EQ-A02"], ["", "EQ-A03"],
  ]);
  assert.equal(cellText(grid(tableBlockToSource(block))[1][0]), "LOT-TEST-001");
}
for (const html of [excelOverflowTable, "<style>td{mso-number-format:General}</style>" + excelOverflowTable]) {
  assert.equal(clipboardToTable({ html }).block.rows[1][0].plain, "LOT-TEST-");
}

// ---- Google Sheets
const sheets = clipboardToTable({ html: fixture("sheets-clipboard.html"), text: "" }).block;
assert.equal(sheets.excel, undefined);
assert.equal(sheets.rows[0][0].md, '<mark>**Lot**</mark>'); // pale yellow fill -> yellow highlight
assert.deepEqual(sheets.rows[1].map((c) => c.plain), ["LOT-TEST-001", "0.5"]);
assert.equal(sheets.rows[1][0].md, '<span style="color:#d93025"><u>LOT-TEST-001</u></span>');
assert.deepEqual(sheets.aligns, ["", "right"]);

// ---- tab separated text (no HTML)
const tsv = clipboardToTable({ html: "", text: 'A\tB\r\n"x\ny"\t007\r\n' });
assert.equal(tsv.via, "tsv");
assert.equal(tsv.block.rows[1][0].plain, "x\ny");
assert.equal(tsv.block.rows[1][1].plain, "007");
assert.equal(clipboardToTable({ html: "", text: "그냥 문장" }), null);
assert.equal(clipboardToTable({ html: "", text: "한 줄\t탭" }), null); // a single line is not a table
assert.equal(clipboardToTable({ html: "<p>문단</p>", text: "문단" }), null);
assert.equal(tsvToBlock("본문 문장입니다\n탭 하나\t있음\n다른 문장"), null);

// ---- large pastes stay bounded
const bigRows = Array.from({ length: 2000 }, (_, r) => Array.from({ length: 50 }, (_, c) => `r${r}c${c}`).join("\t")).join("\n");
const started = performance.now();
const big = clipboardToTable({ html: "", text: bigRows }).block;
assert.ok(big.rows.length * big.cols <= PASTE_LIMITS.cells);
assert.equal(big.truncated.rows, 2000);
assert.equal(big.truncated.cols, 50);
assert.match(pasteNotes(big).join(" "), /2000행 × 50열 중 앞 200행 × 50열/);
const bigHtml = "<table>" + Array.from({ length: 2000 }, (_, r) => "<tr>" + Array.from({ length: 50 }, (_, c) => `<td class=xl65 style='color:red'>r${r}c${c}</td>`).join("") + "</tr>").join("") + "</table>";
const bigBlock = clipboardToTable({ html: "<style>.xl65{font-weight:700}</style>" + bigHtml, text: "" }).block;
assert.ok(bigBlock.rows.length * bigBlock.cols <= PASTE_LIMITS.cells);
assert.ok(performance.now() - started < 4000, "large paste converts quickly");

// ---- cell range operations
const base = ["| 항목 | 값 |", "| --- | --- |", "| A | 1 |", "| B | 2 |", "| C | 3 |"].join(NL);
const fresh = () => parseNoteTable(base);
let t = fresh();
assert.equal(writeNoteTable(t), base);
const rc = normalizeRange([3, 1], [2, 0]);
assert.deepEqual(rc, { r0: 2, r1: 3, c0: 0, c1: 1 });
assert.equal(rangeToTsv(t, rc), "B\t2\r\nC\t3");
assert.ok(rangeToHtml(t, wholeTable(t)).startsWith("<table><tbody><tr><td>항목</td><td>값</td></tr>"));
assert.deepEqual(parsePayload(rangeToPayload(t, rc)), [["B", "2"], ["C", "3"]]);
assert.equal(parsePayload("{}"), null);
assert.equal(parsePayload("not json"), null);

fillDown(t, normalizeRange([1, 0], [3, 1])); // range of several rows: first row goes down
assert.deepEqual(grid(writeNoteTable(t)).slice(1), [["A", "1"], ["A", "1"], ["A", "1"]]);
t = fresh();
assert.equal(fillDown(t, normalizeRange([2, 1], [2, 1])), true); // one cell: copy from the cell above
assert.equal(cellText(t.rows[2].cells[1]), "1");
assert.equal(fillDown(t, normalizeRange([0, 0], [0, 1])), false); // nothing above the header
t = fresh();
fillRight(t, normalizeRange([1, 0], [2, 1]));
assert.deepEqual(grid(writeNoteTable(t)).slice(1, 3), [["A", "A"], ["B", "B"]]);
assert.equal(fillRight(t, normalizeRange([1, 0], [1, 0])), false);

t = fresh();
assert.equal(clearRange(t, normalizeRange([1, 1], [2, 1])), true);
assert.equal(writeNoteTable(t), ["| 항목 | 값 |", "| --- | --- |", "| A |  |", "| B |  |", "| C | 3 |"].join(NL));
assert.equal(clearRange(t, normalizeRange([1, 1], [2, 1])), false); // already empty: no change, no undo entry

t = fresh();
assert.equal(pasteSources(t, 3, 1, [["x", "y"], ["z", "w"], ["q", "r"]]), true); // grows rows and columns
assert.equal(t.width, 3);
assert.equal(t.rows.length, 6);
assert.equal(parseNoteTable(writeNoteTable(t)).rows.length, 6);
assert.equal(cellText(t.rows[0].cells[2]), "열 3");
t = fresh();
assert.equal(pasteIntoRange(t, normalizeRange([1, 1], [3, 1]), [["9"]]), true); // one value fills the selection
assert.deepEqual(t.rows.slice(1).map((row) => row.cells[1]), ["9", "9", "9"]);
assert.equal(pasteIntoRange(t, normalizeRange([1, 1], [3, 1]), [["9"]]), false);

// sort chips: ascending -> descending -> off restores the exact original order and bytes
assert.deepEqual([nextSortDirection(0), nextSortDirection(1), nextSortDirection(-1)], [1, -1, 0]);
t = parseNoteTable(["| 이름 | 수 |", "| --- | --- |", "| b | 10 |", "| a | 9 |", "| c | 100 |"].join(NL));
const original = writeNoteTable(t);
const order = t.rows.slice(1);
assert.equal(sortTableRows(t, 1, 1), true);
assert.deepEqual(t.rows.slice(1).map((r) => r.cells[1]), ["9", "10", "100"]);
assert.equal(sortTableRows(t, 1, -1), true);
assert.deepEqual(t.rows.slice(1).map((r) => r.cells[1]), ["100", "10", "9"]);
assert.equal(restoreRowOrder(t, order), true);
assert.equal(writeNoteTable(t), original);
assert.equal(restoreRowOrder(t, order), false);
setTableCell(t, 1, 0, "z"); // edits survive restoring the order
sortTableRows(t, 1, 1);
restoreRowOrder(t, order);
assert.equal(cellText(t.rows[1].cells[0]), "z");

// navigation
const size = { rows: 3, cols: 2 };
assert.deepEqual(moveCursor([1, 1], "ArrowDown", size), [2, 1]);
assert.deepEqual(moveCursor([2, 1], "ArrowDown", size), [2, 1]);
assert.deepEqual(moveCursor([1, 1], "ArrowLeft", size, true), [1, 0]);
assert.deepEqual(moveCursor([1, 0], "End", size, true), [2, 1]);
assert.deepEqual(tabTarget([0, 1], size), { pos: [1, 0] });
assert.deepEqual(tabTarget([1, 0], size, true), { pos: [0, 1] });
assert.deepEqual(tabTarget([2, 1], size), { pos: [2, 1], append: true });

console.log("PASS paste table: Excel/Sheets/TSV conversion, formatting, merges, caps, range operations, sort off");
