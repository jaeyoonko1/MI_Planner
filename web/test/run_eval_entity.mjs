import assert from "node:assert/strict";
import { buildBoard } from "../js/eval-board-model.js";
import {
  ENTITY_STATUS, applyEntity, applyStatusChanges, entitySentence, findEntity, statusMessage, statusMeta,
  statusSummary, statusTargets, touchedEntities, undoTargets, validateName,
} from "../js/eval-entity-model.js";

const stages = [{ key: "a", label: "A" }, { key: "z", label: "Z" }];
const wafers = (lot, n) => Array.from({ length: n }, (_, i) => ({ id: lot * 10 + i + 1, wafer_no: String(i + 1) }));
const lots = [
  { id: 1, lot_no: "LOT-TEST-001", status: "active", note: null, wafers: wafers(1, 2) },
  { id: 2, lot_no: "LOT-TEST-002", status: "hold", note: null, wafers: wafers(2, 1) },
];
const equipment = [
  { id: 1, name: "EQ-A01", vendor: null, status: "active", note: null },
  { id: 2, name: "EQ-A02", vendor: null, status: "done", note: null },
  { id: 3, name: "EQ-A03", vendor: null },
];
const cells = [];
let id = 1;
for (const e of equipment) for (const w of lots.flatMap((l) => l.wafers)) {
  cells.push({ id: id++, equipment_id: e.id, wafer_id: w.id, stage_key: null, excluded: false, values: {}, note: null, at: null });
}
const board = buildBoard({ evaluation: { stages, fields: [] }, equipment, lots, cells });

// metadata: every status has a label and an icon (never color alone)
for (const item of ENTITY_STATUS) assert.ok(item.label && item.icon);
assert.equal(statusMeta("equipment", "hold").label, "보류");
assert.equal(statusMeta("evaluation", "active").label, "진행 중");
assert.equal(statusMeta("lot", "weird").label, "weird", "unknown status falls back to its key");

// touched entities follow the selected cells, in board order
const t = touchedEntities(board, [cells[0].id, cells[5].id]);
assert.deepEqual(t.equipment, [1, 2]);
assert.deepEqual(t.lots, [1, 2]);
assert.deepEqual(touchedEntities(board, []), { equipment: [], lots: [] });
assert.deepEqual(touchedEntities(board, [99999]), { equipment: [], lots: [] });

// summary: uniform vs mixed; a missing status counts as active
assert.equal(statusSummary(board, "lot", [1]).uniform, "active");
assert.equal(statusSummary(board, "lot", [1, 2]).uniform, null);
assert.equal(statusSummary(board, "equipment", [1, 3]).uniform, "active");
assert.equal(statusSummary(board, "equipment", [1, 2, 3]).counts.get("done"), 1);

// targets and undo
const targets = statusTargets("equipment", [1, 2], "hold");
assert.deepEqual(targets, [{ kind: "equipment", id: 1, status: "hold" }, { kind: "equipment", id: 2, status: "hold" }]);
const changed = [{ kind: "equipment", id: 1, from: "active", to: "hold" }, { kind: "equipment", id: 2, from: "done", to: "hold" }];
assert.deepEqual(undoTargets(changed), [{ kind: "equipment", id: 1, status: "active" }, { kind: "equipment", id: 2, status: "done" }]);
applyStatusChanges(board, changed);
assert.equal(findEntity(board, "equipment", 2).status, "hold");
applyStatusChanges(board, undoTargets(changed).map((x) => ({ ...x, to: x.status })));
assert.equal(findEntity(board, "equipment", 2).status, "done");

// names: trim, empty, long, control chars, duplicates (own name is fine)
assert.equal(validateName(board, "equipment", 1, "  EQ-A09 ").value, "EQ-A09");
assert.equal(validateName(board, "equipment", 1, "   ").ok, false);
assert.equal(validateName(board, "equipment", 1, "x".repeat(121)).ok, false);
assert.equal(validateName(board, "equipment", 1, "a\nb").ok, false);
assert.equal(validateName(board, "equipment", 1, "EQ-A02").ok, false);
assert.match(validateName(board, "equipment", 1, "EQ-A02").error, /같은 이름/);
assert.equal(validateName(board, "equipment", 1, "EQ-A01").ok, true, "keeping the same name is not a duplicate");
assert.equal(validateName(board, "lot", 2, "LOT-TEST-001").ok, false);
assert.equal(validateName(board, "lot", 2, "EQ-A01").ok, true, "equipment and Lot names are independent");

// patching the model, including shared Lot objects used by rows
applyEntity(board, "lot", 1, { name: "LOT-TEST-009", status: "done", note: "메모" });
assert.equal(board.rows[0].lot.lot_no, "LOT-TEST-009");
assert.equal(findEntity(board, "lot", 1).status, "done");
applyEntity(board, "equipment", 1, { vendor: "VND-TEST" });
assert.equal(board.equipment[0].vendor, "VND-TEST");
assert.equal(applyEntity(board, "lot", 99, { status: "hold" }), null);

assert.equal(entitySentence("equipment", board.equipment[0]), "EQ-A01 · 설비 · 진행");
assert.equal(statusMessage("lot", 2, "hold"), "Lot 2개를 보류 상태로 바꿨어요");
console.log("eval entity model ok");
