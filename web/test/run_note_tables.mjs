import assert from "node:assert/strict";
import {
  cellText, clipboardTableText, parseClipboardTable, parseNoteTable, pasteTableCells,
  setTableCell, sortTableRows, writeNoteTable,
} from "../js/note-table-model.js";
import { segment } from "../js/mdblocks.js";

const source = "왼쪽 | 오른쪽\r\n:--- | ---:\nC\\|5 | 12\r| A | 2 |\nM |";
const table = parseNoteTable(source);
assert.equal(writeNoteTable(table), source);
assert.equal(cellText(table.rows[1].cells[0]), "C|5");
assert.deepEqual(table.alignments, [":---", "---:"]);
assert.equal(setTableCell(table, 1, 0, "C|5"), false);
assert.equal(setTableCell(table, 1, 0, "B\\|7\t열\n값 <br> &#9;"), true);
assert.equal(cellText(parseNoteTable(writeNoteTable(table)).rows[1].cells[0]), "B\\|7\t열\n값 <br> &#9;");
assert.equal(writeNoteTable(table).split("\r").at(-1), "| A | 2 |\nM |");

assert.equal(sortTableRows(table, 1, 1), true);
assert.deepEqual(table.rows.slice(1).map(row => row.cells[1]), ["2", "12", undefined]);
assert.equal(sortTableRows(table, 1, -1), true);
assert.deepEqual(table.rows.slice(1).map(row => row.cells[1]), ["12", "2", undefined]);

const cells = [["측정", '"A"\tB\nC'], ["둥근 값", "끝"], ["", ""]];
assert.deepEqual(parseClipboardTable(clipboardTableText(cells)), cells);
assert.deepEqual(parseClipboardTable("A\tB\r\n1\t2\r\n"), [["A", "B"], ["1", "2"]]);
assert.deepEqual(parseClipboardTable('"한 열\n두 줄"\t"따옴표 ""포함"""\n'), [["한 열\n두 줄", '따옴표 "포함"']]);
assert.equal(pasteTableCells(table, 4, 1, cells), true);
assert.equal(table.rows.length, 7);
assert.equal(table.width, 3);
assert.deepEqual(parseNoteTable(writeNoteTable(table)).rows[4].cells.slice(1).map(cellText), cells[0]);
assert.equal(parseNoteTable("| a | b |\n| --- |"), null);
assert.equal(parseNoteTable("| 한 열 |\n| --- |\n| 값 |").width, 1);
assert.deepEqual(segment(source + "\n> 인용 | 다른 블록").blocks.map(block => block.kind), ["table", "quote"]);
console.log("PASS table source round trip, escaping, sorting, row growth and TSV");
