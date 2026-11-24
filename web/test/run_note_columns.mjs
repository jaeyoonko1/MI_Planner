import assert from "node:assert/strict";
import {
  addRowBelow, appendColumn, deleteColumn, insertColumn, joinColumns, layoutFor, layoutMeta, mergeTarget, resizePair, rowsOf,
  splitColumns, widthsAfterDelete, widthsAfterInsert,
} from "../js/note-column-layout.js";

const marker = "<!-- column -->";
const original = "# 제목\r\n\r\n```md\n" + marker + "\n```\r\n> " + marker
  + "\r\n" + marker + "\r\n\r\n본문\r";
const model = splitColumns(original);
assert.equal(model.parts.length, 2);
assert.equal(model.separators[0], marker + "\r\n");
assert.equal(joinColumns(model), original);
model.parts[1] = model.parts[1].replace("본문", "바뀐 본문");
assert.equal(joinColumns(model), original.replace("본문", "바뀐 본문"));

const tail = splitColumns("원본\n" + marker);
assert.deepEqual(tail.parts, ["원본\n", ""]);
assert.equal(joinColumns(tail), "원본\n" + marker);
tail.parts[1] = "새 내용";
assert.equal(joinColumns(tail), "원본\n" + marker + "\n새 내용");
assert.equal(joinColumns(splitColumns(" \r\n\r\n")), " \r\n\r\n");
assert.equal(appendColumn(splitColumns("```md\n열린 코드\n")), null);
assert.equal(appendColumn(splitColumns("<!-- 열린 주석\n")), null);
assert.equal(joinColumns(appendColumn(splitColumns("본문"))), "본문\n" + marker + "\n");

const overflow = ("열\n" + marker + "\n").repeat(5) + "끝";
assert.equal(splitColumns(overflow).parts.length, 4);
assert.equal(joinColumns(splitColumns(overflow)), overflow);
assert.deepEqual(layoutFor({ mode: "scroll", widths: [30, 70] }, 3), { mode: "scroll", rows: [[34, 33, 33]] });
assert.deepEqual(layoutFor({ mode: "fit", widths: [20, 30, 50] }, 3).rows, [[20, 30, 50]]);
assert.deepEqual(resizePair([25, 25, 50], 0, 99), [40, 10, 50]);
assert.deepEqual(resizePair([1, 1, 98], 0, 99), [1, 1, 98]);


// ---- V-008: rows, insert, delete -------------------------------------------------------------------
const row = "<!-- row -->";
const grid = "왼쪽\n" + marker + "\n오른쪽\n" + row + "\n아래\n";
const two = splitColumns(grid);
assert.deepEqual(two.parts, ["왼쪽\n", "오른쪽\n", "아래\n"]);
assert.deepEqual(rowsOf(two.separators), [[0, 1], [2]]);
assert.equal(joinColumns(two), grid);
assert.equal(joinColumns(splitColumns(joinColumns(two))), grid); // original == first == second
assert.equal(splitColumns("그냥 본문\n").parts.length, 1);
assert.equal(splitColumns("```\n" + row + "\n```\n").parts.length, 1);
const manyRows = ("행\n" + row + "\n").repeat(7) + "끝";
assert.equal(splitColumns(manyRows).parts.length, 6);
assert.equal(joinColumns(splitColumns(manyRows)), manyRows);

const below = addRowBelow(splitColumns("A\n" + marker + "\nB\n"), 0);
assert.deepEqual(rowsOf(below.separators), [[0, 1], [2]]);
assert.equal(joinColumns(below), "A\n" + marker + "\nB\n" + row + "\n");
assert.deepEqual(splitColumns(joinColumns(below)).parts, ["A\n", "B\n", ""]);
const middle = addRowBelow(two, 0);
assert.deepEqual(rowsOf(middle.separators), [[0, 1], [2], [3]]);
assert.equal(addRowBelow(splitColumns("```md\n열림"), 0), null);
let rows6 = splitColumns("x");
for (let i = 0; i < 5; i++) rows6 = addRowBelow(rows6, i);
assert.equal(rows6.parts.length, 6);
assert.equal(addRowBelow(rows6, 5), null);

const left = insertColumn(two, 1, "left");
assert.deepEqual(left.parts, ["왼쪽\n", "", "오른쪽\n", "아래\n"]);
assert.deepEqual(rowsOf(left.separators), [[0, 1, 2], [3]]);
const right = insertColumn(two, 1, "right");
assert.deepEqual(rowsOf(right.separators), [[0, 1, 2], [3]]);
assert.deepEqual(right.parts, ["왼쪽\n", "오른쪽\n", "", "아래\n"]);
assert.equal(joinColumns(splitColumns(joinColumns(right))), joinColumns(right));
const first = insertColumn(splitColumns("단독"), 0, "left");
assert.deepEqual(first.parts, ["", "단독"]);
assert.equal(insertColumn(splitColumns(("a\n" + marker + "\n").repeat(3) + "b"), 3, "right"), null);

const merged = deleteColumn(two, 1, "merge");
assert.deepEqual(merged.parts, ["왼쪽\n\n오른쪽\n", "아래\n"]);
assert.equal(merged.target, 0);
assert.deepEqual(rowsOf(merged.separators), [[0], [1]]);
const dropped = deleteColumn(two, 1, "drop");
assert.deepEqual(dropped.parts, ["왼쪽\n", "아래\n"]);
assert.equal(dropped.merged, null);
const firstOfRow = deleteColumn(two, 0, "merge");
assert.deepEqual(firstOfRow.parts, ["왼쪽\n\n오른쪽\n", "아래\n"]);
assert.equal(firstOfRow.target, 1);
const wholeRow = deleteColumn(two, 2, "merge");
assert.deepEqual(wholeRow.parts, ["왼쪽\n", "오른쪽\n\n아래\n"]);
assert.deepEqual(rowsOf(wholeRow.separators), [[0, 1]]);
const topRow = deleteColumn(splitColumns("위\n" + row + "\n아래\n"), 0, "merge");
assert.deepEqual(topRow.parts, ["위\n\n아래\n"]);
assert.equal(joinColumns(topRow), "위\n\n아래\n");
assert.equal(deleteColumn(splitColumns("하나"), 0, "drop"), null);
const emptyDrop = deleteColumn(splitColumns("a\n" + marker + "\n"), 1, "merge");
assert.equal(joinColumns(emptyDrop), "a\n");
assert.equal(mergeTarget(two.separators, 2), 1);
assert.equal(joinColumns(deleteColumn(right, 2, "drop")), grid);
assert.equal(joinColumns(deleteColumn(addRowBelow(splitColumns("본문\n"), 0), 1, "drop")), "본문\n");

assert.deepEqual(layoutFor({ mode: "fit", rows: [[40, 60], [100]] }, [2, 1]).rows, [[40, 60], [100]]);
assert.deepEqual(layoutFor({ mode: "fit", rows: [[40, 60], [100]] }, [2, 2]).rows, [[40, 60], [50, 50]]);
assert.deepEqual(layoutMeta(layoutFor({ mode: "scroll", rows: [[40, 60], [100]] }, [2, 1])), { mode: "scroll", rows: [[40, 60], [100]] });
assert.deepEqual(layoutMeta({ mode: "fit", rows: [[40, 60]] }), { mode: "fit", widths: [40, 60] });
assert.deepEqual(layoutMeta({ mode: "fit", rows: [[100]] }), { mode: "fit" });
assert.deepEqual(widthsAfterInsert([50, 50], 0, "right"), [25, 25, 50]);
assert.deepEqual(widthsAfterInsert([100], 0, "left"), [50, 50]);
assert.deepEqual(widthsAfterInsert([1, 99], 0, "right"), [34, 33, 33]);
assert.deepEqual(widthsAfterDelete([25, 25, 50], 1), [50, 50]);
assert.deepEqual(widthsAfterDelete([30, 70], 0), [100]);
console.log("P3-03 / V-008 note column and row round trips pass");
