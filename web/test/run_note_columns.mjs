import assert from "node:assert/strict";
import { appendColumn, joinColumns, layoutFor, resizePair, splitColumns } from "../js/note-column-layout.js";

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
assert.deepEqual(layoutFor({ mode: "scroll", widths: [30, 70] }, 3), { mode: "scroll", widths: [34, 33, 33] });
assert.deepEqual(layoutFor({ mode: "fit", widths: [20, 30, 50] }, 3).widths, [20, 30, 50]);
assert.deepEqual(resizePair([25, 25, 50], 0, 99), [40, 10, 50]);
assert.deepEqual(resizePair([1, 1, 98], 0, 99), [1, 1, 98]);
console.log("P3-03 note column round trips and width limits pass");
