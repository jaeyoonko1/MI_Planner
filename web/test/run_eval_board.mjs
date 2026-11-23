import assert from "node:assert/strict";
import { buildBoard, cellsByStage, formatValue, lotProgress, stageCounts, visibleRows, UNASSIGNED } from "../js/eval-board-model.js";

const stages = [{ key: "a", label: "A" }, { key: "b", label: "B" }, { key: "z", label: "Z" }];
const data = {
  evaluation: { stages, fields: [{ key: "v", label: "V", type: "number" }] },
  equipment: [{ id: 1, name: "EQ-A01" }, { id: 2, name: "EQ-A02" }],
  lots: [{ id: 1, lot_no: "LOT-TEST-001", wafers: [{ id: 1, wafer_no: "01" }, { id: 2, wafer_no: "02" }] }],
  cells: [
    { id: 1, equipment_id: 1, wafer_id: 1, stage_key: "z", excluded: false },
    { id: 2, equipment_id: 2, wafer_id: 1, stage_key: "a", excluded: false },
    { id: 3, equipment_id: 1, wafer_id: 2, stage_key: null, excluded: false },
    { id: 4, equipment_id: 2, wafer_id: 2, stage_key: "z", excluded: true },
  ],
};
const board = buildBoard(data);
assert.equal(board.fields.length, 1);
const total = stageCounts(board);
assert.equal(total.active, 3);
assert.equal(total.done, 1);
assert.equal(total.percent, 33);
assert.equal(total.counts.get(UNASSIGNED), 1);
assert.equal(lotProgress(board, data.lots[0], 1).active, 2);
assert.equal(visibleRows(board, true).length, 2);
assert.equal(cellsByStage(board, true).get("z").length, 0);
assert.equal(cellsByStage(board, false).get("z").length, 1);
assert.equal(formatValue({ type: "okng" }, "ok"), "OK");
assert.equal(formatValue({ type: "check" }, true), "✓");
assert.equal(formatValue({ type: "number" }, 1200), (1200).toLocaleString("ko-KR"));
assert.equal(formatValue({ type: "text" }, undefined), "");
// Unknown stage keys never crash and fall back to unassigned.
const odd = buildBoard({ ...data, cells: [{ id: 9, equipment_id: 1, wafer_id: 1, stage_key: "gone", excluded: false }] });
assert.equal(stageCounts(odd).counts.get(UNASSIGNED), 1);
console.log("PASS evaluation board model");
