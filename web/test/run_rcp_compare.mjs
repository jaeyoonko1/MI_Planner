// Node test for the pure comparison helpers (P6-04).
import assert from "node:assert/strict";
import {
  cellMarker, cellText, cellTitle, compareIds, compareTSV, diffTSV, filterCompareRows, filterDiffRows, fmt, summaryText,
  toggleBasket, withGroupHeaders,
} from "../js/rcp-compare-model.js";

const cols = [{ name: "RCP-A" }, { name: "RCP-B" }];
const rows = [
  { file: "a.xml", path: "Focus", label: "초점", unit: "um", group: "광학", compare: "number", tolerance: 0.05, values: ["1.00", "1.20"], marks: ["", "d"], diff: true },
  { file: "a.xml", path: "Gain", label: "게인", unit: "", group: "광학", compare: "number", tolerance: 0, values: ["2", "2"], marks: ["", ""], diff: false },
  { file: "a.xml", path: "Zed", label: "", unit: "", group: "", compare: "text", tolerance: 0, values: ["x", null], marks: ["", "m"], diff: true },
  { file: "b.ini", path: "Mode", label: "모드", unit: "", group: "스캔", compare: "text", tolerance: 0, values: ["FAST", "FAST"], marks: ["", ""], diff: false },
];

assert.deepEqual(filterCompareRows(rows, { onlyDiff: true }).map((r) => r.path), ["Focus", "Zed"]);
assert.equal(filterCompareRows(rows, { onlyDiff: false }).length, 4);
assert.deepEqual(filterCompareRows(rows, { onlyDiff: false, group: "광학" }).map((r) => r.path), ["Focus", "Gain"]);
assert.deepEqual(filterCompareRows(rows, { onlyDiff: false, group: "" }).map((r) => r.path), ["Zed"]);
assert.deepEqual(filterCompareRows(rows, { onlyDiff: false, query: " fast " }).map((r) => r.path), ["Mode"]);
assert.deepEqual(filterCompareRows(rows, { onlyDiff: false, query: "초점" }).map((r) => r.path), ["Focus"]);

const flat = withGroupHeaders(rows);
assert.deepEqual(flat.filter((i) => i.kind === "group").map((g) => [g.text, g.count, g.diffs]), [["광학", 2, 1], ["스캔", 1, 0], ["기타", 1, 1]]);
assert.equal(flat.length, 4 + 3);
assert.deepEqual(withGroupHeaders([]), []);

assert.equal(cellText(rows[2], 1), "없음");
assert.equal(cellText({ values: [""], marks: [""] }, 0), "(빈 값)");
assert.equal(cellMarker(rows[0], 1), "≠");
assert.equal(cellMarker(rows[2], 1), "∅");
assert.equal(cellMarker(rows[0], 0), "");
assert.match(cellTitle(rows[0], 1, cols), /RCP-B: 기준과 \+0\.2 차이 \(허용 ±0\.05\)/);
assert.match(cellTitle(rows[2], 1, cols), /없어요/);
assert.equal(cellTitle(rows[0], 0, cols), "");
assert.equal(fmt(0.30000000000000004), "0.3");
assert.equal(fmt(-1.5, true), "-1.5");

const tsv = compareTSV(cols, rows.slice(0, 3));
const lines = tsv.split("\n");
assert.equal(lines.length, 4);
assert.equal(lines[0], "그룹\t파일\t이름\t경로\t단위\t판정\tRCP-A\tRCP-B");
assert.equal(lines[1], "광학\ta.xml\t초점\tFocus\tum\t다름\t1.00\t1.20");
assert.equal(lines[3].split("\t").at(-1), "없음");
assert.equal(compareTSV(cols, [{ ...rows[0], values: ["a\tb\nc", "d"] }]).split("\n")[1].split("\t")[6], "a b c");

const d = [
  { status: "added", path: "N", label: "", file: "f", group: "", old: null, new: "1", unit: "" },
  { status: "removed", path: "O", label: "옛", file: "f", group: "", old: "2", new: null, unit: "" },
  { status: "changed", path: "C", label: "", file: "f", group: "g", old: "1", new: "3", unit: "um" },
];
assert.deepEqual(filterDiffRows(d, { status: "removed" }).map((r) => r.path), ["O"]);
assert.deepEqual(filterDiffRows(d, { query: "옛" }).map((r) => r.path), ["O"]);
assert.equal(filterDiffRows(d, {}).length, 3);
assert.equal(diffTSV(d).split("\n")[3], "변경\tg\tf\t\tC\t1\t3\tum");
assert.equal(diffTSV(d).split("\n")[1].split("\t")[5], "");

assert.equal(summaryText(null), "최초 수집");
assert.equal(summaryText({ added: 2, removed: 0, changed: 3 }), "추가 2 · 변경 3");
assert.equal(summaryText({ added: 0, removed: 0, changed: 0, files_changed: 0 }), "변경 없음");
assert.equal(summaryText({ added: 0, removed: 0, changed: 0, files_changed: 1 }), "파라미터는 같고 파일만 달라요");

let b = [];
let r = toggleBasket(b, { id: 1, name: "a" });
assert.deepEqual(r.basket.map((x) => x.id), [1]);
b = r.basket;
b = toggleBasket(b, { id: 2, name: "b" }).basket;
assert.equal(compareIds(b), "1,2");
assert.deepEqual(toggleBasket(b, { id: 1, name: "a" }).basket.map((x) => x.id), [2]);
for (let i = 3; i <= 6; i++) b = toggleBasket(b, { id: i, name: String(i) }).basket;
assert.equal(b.length, 6);
r = toggleBasket(b, { id: 7, name: "7" });
assert.equal(r.full, true);
assert.equal(r.basket.length, 6);
console.log("rcp compare model ok");
