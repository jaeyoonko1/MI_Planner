import assert from "node:assert/strict";
import {
  deleteTableColumns, deleteTableRows, insertTableColumns, insertTableRows, tableFilledCells, tableHeaderBlank,
  toggleTableHeader, TABLE_CONFIRM_CELLS,
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


// ---- V-009: structure edits (row / column insert + delete, header toggle, filled-cell count)
const NL = "\n";
const rowsOf = (...lines) => lines.join(NL);
const base = rowsOf("| 항목 | 값 | 비고 |", "| --- | ---: | --- |", "| A | 1 | x |", "| B | 2 | y |", "| C | 3 | z |");
const fresh = () => parseNoteTable(base);
assert.equal(writeNoteTable(fresh()), base); // untouched table: byte-identical

let t = fresh();
assert.deepEqual(deleteTableRows(t, 2), { empty: false, removed: 1 });
assert.equal(writeNoteTable(t), rowsOf("| 항목 | 값 | 비고 |", "| --- | ---: | --- |", "| A | 1 | x |", "| C | 3 | z |"));
t = fresh(); deleteTableRows(t, 1, 3);
assert.equal(writeNoteTable(t), rowsOf("| 항목 | 값 | 비고 |", "| --- | ---: | --- |"));
assert.equal(parseNoteTable(writeNoteTable(t)).rows.length, 1);
t = fresh(); deleteTableRows(t, 0); // header deleted: the first body row becomes the header
assert.equal(writeNoteTable(t), rowsOf("| A | 1 | x |", "| --- | ---: | --- |", "| B | 2 | y |", "| C | 3 | z |"));
t = parseNoteTable(rowsOf("| a | b |", "| --- | --- |", "only |")); deleteTableRows(t, 0); // short row promoted: padded
assert.equal(parseNoteTable(writeNoteTable(t)).width, 2);
t = parseNoteTable(rowsOf("| a |", "| --- |")); // header only: deleting the last row means deleting the table
assert.deepEqual(deleteTableRows(t, 0), { empty: true });
assert.equal(writeNoteTable(t), rowsOf("| a |", "| --- |"));

t = fresh();
assert.equal(insertTableRows(t, 2, 2), 2);
assert.equal(writeNoteTable(t), rowsOf("| 항목 | 값 | 비고 |", "| --- | ---: | --- |", "| A | 1 | x |", "|  |  |  |", "|  |  |  |", "| B | 2 | y |", "| C | 3 | z |"));
assert.equal(insertTableRows(t, 0), 1); // never above the header

t = fresh(); insertTableColumns(t, 1);
assert.equal(writeNoteTable(t), rowsOf("| 항목 | 열 4 | 값 | 비고 |", "| --- | --- | ---: | --- |", "| A |  | 1 | x |", "| B |  | 2 | y |", "| C |  | 3 | z |"));
assert.equal(parseNoteTable(writeNoteTable(t)).width, 4);
t = fresh(); insertTableColumns(t, 3, 2);
assert.equal(parseNoteTable(writeNoteTable(t)).width, 5);
t = fresh(); deleteTableColumns(t, 1);
assert.equal(writeNoteTable(t), rowsOf("| 항목 | 비고 |", "| --- | --- |", "| A | x |", "| B | y |", "| C | z |"));
t = fresh(); assert.deepEqual(deleteTableColumns(t, 0, 2), { empty: true });
assert.equal(writeNoteTable(t), base); // nothing changed when it would empty the table
t = fresh(); deleteTableColumns(t, 0, 1);
assert.equal(writeNoteTable(t), rowsOf("| 비고 |", "| --- |", "| x |", "| y |", "| z |"));

t = fresh();
assert.equal(toggleTableHeader(t), "off");
assert.equal(tableHeaderBlank(t), true);
assert.equal(parseNoteTable(writeNoteTable(t)).rows.length, 5);
assert.equal(toggleTableHeader(t), "on");
assert.equal(writeNoteTable(t), base); // off then on restores the same text
assert.equal(toggleTableHeader(parseNoteTable(rowsOf("|  |", "| --- |"))), null);

// filled cells: default placeholder headers and blanks do not count
assert.equal(tableFilledCells(parseNoteTable(rowsOf("| 열 1 | 열 2 |", "| --- | --- |", "|  |  |"))), 0);
assert.equal(tableFilledCells(fresh()), 12);
assert.equal(tableFilledCells(parseNoteTable(rowsOf("| 열 1 | 열 2 |", "| --- | --- |", "| a | b |"))), 2);
assert.ok(TABLE_CONFIRM_CELLS >= 1 && TABLE_CONFIRM_CELLS < 12);
console.log("PASS table structure edits: delete / insert rows and columns, header toggle, round trip");
