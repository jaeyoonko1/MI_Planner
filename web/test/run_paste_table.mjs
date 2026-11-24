// V-001: clipboard HTML / TSV -> note table, and cell-range operations. Fake data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

// ---- Google Sheets
const sheets = clipboardToTable({ html: fixture("sheets-clipboard.html"), text: "" }).block;
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
