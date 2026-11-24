import assert from "node:assert/strict";
import { buildBoard, visibleRows, formatAt } from "../js/eval-board-model.js";
import {
  allIds, applyChanged, columnIds, describeSelection, lotIds, mergeSelection, nextStageMoves,
  pruneSelection, rectIds, rowIds, stageDistribution, targetMoves,
} from "../js/eval-select-model.js";

const stages = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "z", label: "Z" }];
const wafers = (lot, n) => Array.from({ length: n }, (_, i) => ({ id: lot * 10 + i + 1, wafer_no: String(i + 1).padStart(2, "0") }));
const lots = [{ id: 1, lot_no: "LOT-TEST-001", wafers: wafers(1, 2) }, { id: 2, lot_no: "LOT-TEST-002", wafers: wafers(2, 1) }];
const equipment = [{ id: 1, name: "EQ-A01" }, { id: 2, name: "EQ-A02" }, { id: 3, name: "EQ-A03" }];
const cells = [];
let id = 1;
for (const e of equipment) for (const w of lots.flatMap((l) => l.wafers)) {
  cells.push({ id: id++, equipment_id: e.id, wafer_id: w.id, stage_key: null, excluded: false, values: {}, note: null, at: null });
}
cells.find((c) => c.equipment_id === 2 && c.wafer_id === 12).excluded = true;
const board = buildBoard({ evaluation: { stages, fields: [] }, equipment, lots, cells });
const rows = visibleRows(board, false);

assert.equal(rows.length, 3);
const r = rectIds(board, rows, { r: 0, c: 0 }, { r: 1, c: 1 });
assert.equal(r.ids.length + r.skipped, 4);
assert.equal(r.skipped, 1, "excluded cell is skipped, not selected");
assert.deepEqual(rectIds(board, rows, { r: 1, c: 1 }, { r: 0, c: 0 }).ids.sort(), r.ids.sort(), "order of corners does not matter");
assert.equal(columnIds(board, rows, 2).ids.length, 3);
assert.equal(columnIds(board, rows, 1).ids.length, 2);
assert.equal(rowIds(board, rows[0]).ids.length, 3);
assert.equal(lotIds(board, rows, 1).ids.length, 5);
assert.equal(allIds(board, rows).ids.length, 8);
assert.equal(allIds(board, rows).skipped, 1);
assert.equal(allIds(board, []).ids.length, 0);

// hidden rows (remaining-only filter) are not selected
const done = buildBoard({ evaluation: { stages, fields: [] }, equipment, lots, cells: cells.map((c) => ({ ...c, stage_key: c.wafer_id === 11 ? "z" : null })) });
assert.equal(visibleRows(done, true).length, 2);
assert.equal(allIds(done, visibleRows(done, true)).ids.length, 5);

const cur = new Set([1, 2]);
assert.deepEqual([...mergeSelection(cur, [3], "replace")], [3]);
assert.deepEqual([...mergeSelection(cur, [2, 3], "add")].sort(), [1, 2, 3]);
assert.deepEqual([...mergeSelection(cur, [2], "toggle")], [1]);
assert.deepEqual([...mergeSelection(cur, [2, 3], "toggle")].sort(), [1, 2, 3], "partial overlap adds");
assert.deepEqual([...mergeSelection(cur, [], "toggle")].sort(), [1, 2]);

assert.deepEqual(pruneSelection(board, [1, 2, 999]), [1, 2]);
const exId = cells.find((c) => c.excluded).id;
assert.deepEqual(pruneSelection(board, [exId, 1]), [1]);
assert.deepEqual(pruneSelection(board, [exId]), [exId]);
assert.deepEqual(pruneSelection(board, [999]), []);

assert.deepEqual(targetMoves([1, 2], "b"), [{ cell_id: 1, stage_key: "b" }, { cell_id: 2, stage_key: "b" }]);
board.byId.get(1).stage_key = "a";
board.byId.get(2).stage_key = "z";
board.byId.get(3).stage_key = "ghost";
assert.deepEqual(nextStageMoves(board, [1, 2, 3, 4, exId]), [
  { cell_id: 1, stage_key: "b" }, { cell_id: 3, stage_key: "a" }, { cell_id: 4, stage_key: "a" },
], "last stage and excluded stay; unassigned/unknown go to the first stage");

const dist = stageDistribution(board, [1, 2, 4, exId]);
assert.equal(dist.active, 3);
assert.equal(dist.counts.get("a"), 1);
assert.deepEqual(describeSelection(board, [1, 2, 4]), { cells: 3, equipment: 2, lots: 1 });

applyChanged(board, [{ id: 1, from: "a", to: "b" }, { id: 12345, from: null, to: "a" }], "2026-11-24T10:00:00+09:00");
assert.equal(board.byId.get(1).stage_key, "b");
assert.equal(board.byId.get(1).at, "2026-11-24T10:00:00+09:00");

const now = new Date(2026, 10, 24, 15, 0, 0);
assert.deepEqual(formatAt(new Date(2026, 10, 24, 14, 3, 0).toISOString(), now), { text: "11/24 14:03", ago: "57분 전" });
assert.equal(formatAt(new Date(2026, 10, 24, 11, 0, 0).toISOString(), now).ago, "4시간 전");
assert.equal(formatAt(new Date(2026, 10, 22, 11, 0, 0).toISOString(), now).ago, "2일 전");
assert.equal(formatAt(null).text, "");
console.log("eval select model ok");
