import assert from "node:assert/strict";
import { buildBoard } from "../js/eval-board-model.js";
import {
  cellWait, formatThreshold, formatWait, historyDurations, parseAt, waitHours, waitSentence, waitSummary, warnLevel,
} from "../js/eval-wait-model.js";

const NOW = Date.parse("2026-11-24T12:00:00+09:00");
assert.equal(waitHours("2026-11-24T10:00:00+09:00", NOW), 2);
assert.equal(waitHours("2026-11-24T10:00:00", NOW), 2); // no offset = Asia/Seoul
assert.equal(waitHours("2026-11-24T01:00:00Z", NOW), 2);
assert.equal(waitHours("2026-11-25T10:00:00+09:00", NOW), 0); // future clamps
assert.equal(waitHours("nope", NOW), null);
assert.equal(waitHours(null, NOW), null);
assert.equal(parseAt("2026-11-24T10:00:00+0900"), Date.parse("2026-11-24T10:00:00+09:00"));

assert.equal(warnLevel(10, 10), 0);
assert.equal(warnLevel(10.5, 10), 1);
assert.equal(warnLevel(20, 10), 1);
assert.equal(warnLevel(20.5, 10), 2);
assert.equal(warnLevel(99, null), 0);
assert.equal(warnLevel(null, 10), 0);

assert.equal(formatWait(0.001), "방금");
assert.equal(formatWait(0.75), "45분");
assert.equal(formatWait(3.2), "3시간");
assert.equal(formatWait(28), "1일 4시간");
assert.equal(formatWait(48), "2일");
assert.equal(formatWait(24 * 12 + 5), "12일");
assert.equal(formatWait(null), "");
assert.equal(formatThreshold(48), "2일");
assert.equal(formatThreshold(8), "8시간");

const stages = [{ key: "a", label: "A", warn_hours: 24 }, { key: "b", label: "B", warn_hours: null }, { key: "z", label: "Z", warn_hours: 1 }];
const board = buildBoard({
  now: "2026-11-24T12:00:00+09:00",
  evaluation: { stages, fields: [] },
  equipment: [{ id: 1, name: "EQ-A01" }],
  lots: [{ id: 1, lot_no: "LOT-TEST-001", wafers: [1, 2, 3, 4, 5].map((id) => ({ id, wafer_no: "0" + id })) }],
  cells: [
    { id: 1, equipment_id: 1, wafer_id: 1, stage_key: "a", excluded: false, at: "2026-11-23T08:00:00+09:00", wait_h: 28 }, // 28h > 24 -> 1
    { id: 2, equipment_id: 1, wafer_id: 2, stage_key: "a", excluded: false, at: "2026-11-20T08:00:00+09:00", wait_h: 100 }, // 100h > 48 -> 2
    { id: 3, equipment_id: 1, wafer_id: 3, stage_key: "b", excluded: false, at: "2026-11-01T08:00:00+09:00", wait_h: 1 }, // no threshold
    { id: 4, equipment_id: 1, wafer_id: 4, stage_key: "z", excluded: false, at: "2026-11-01T08:00:00+09:00", wait_h: 1 }, // last stage
    { id: 5, equipment_id: 1, wafer_id: 5, stage_key: "a", excluded: true, at: "2026-11-01T08:00:00+09:00", wait_h: null },
  ],
});
assert.equal(cellWait(board, board.byId.get(1), NOW).level, 1);
assert.equal(cellWait(board, board.byId.get(2), NOW).level, 2);
assert.equal(cellWait(board, board.byId.get(3), NOW).level, 0);
assert.equal(cellWait(board, board.byId.get(3), NOW).text, "23일");
assert.equal(cellWait(board, board.byId.get(4), NOW), null);
assert.equal(cellWait(board, board.byId.get(5), NOW), null);
assert.equal(cellWait(board, { ...board.byId.get(1), wait_h: null }, NOW), null); // server: no matching log
assert.equal(cellWait(board, { ...board.byId.get(1), stage_key: null }, NOW), null);
assert.match(waitSentence(cellWait(board, board.byId.get(2), NOW), true), /심각: 기준 1일의 2배 초과/);
assert.equal(waitSentence(cellWait(board, board.byId.get(2), NOW), false), "대기 4일 4시간");

const sum = waitSummary(board, board.cells, NOW);
assert.equal(sum.warn, 1);
assert.equal(sum.alert, 1);
assert.equal(sum.longest.cell.id, 3);
assert.equal(sum.stages.length, 2);

const items = [{ at: "2026-11-24T09:00:00+09:00" }, { at: "2026-11-24T06:00:00+09:00" }, { at: "2026-11-23T06:00:00+09:00" }];
assert.deepEqual(historyDurations(items, NOW), [3, 3, 24]);
console.log("eval wait model ok");
