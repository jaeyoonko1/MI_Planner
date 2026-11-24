import assert from "node:assert/strict";
import { buildBoard } from "../js/eval-board-model.js";
import {
  DEFAULT_MAPPING, buildMoves, norm, parseMosTime, parseStageMapText, parseTable, parseWaferSpec, planPaste, previewRows,
  readMapping, resolveColumns, serializeMapping, stageMapText, undoMoves, waferKey,
} from "../js/mos-paste-model.js";

// ---- fixture: 2 equipment x LOT-TEST-001 (01..03) + LOT-TEST-002 (01) ----
const stages = [{ key: "recv", label: "접수" }, { key: "meas", label: "측정" }, { key: "rev", label: "리뷰" }, { key: "done", label: "완료" }];
const wafers = (ids) => ids.map(([id, no]) => ({ id, wafer_no: no }));
const lots = [
  { id: 1, lot_no: "LOT-TEST-001", wafers: wafers([[1, "01"], [2, "02"], [3, "03"]]) },
  { id: 2, lot_no: "LOT-TEST-002", wafers: wafers([[4, "01"]]) },
];
let cid = 0;
const cells = [];
for (const eq of [1, 2]) for (const w of [1, 2, 3, 4]) cells.push({ id: ++cid, equipment_id: eq, wafer_id: w, stage_key: null, excluded: false, at: null });
const make = (patch = {}) => {
  const copy = cells.map((c) => ({ ...c }));
  for (const [id, p] of Object.entries(patch)) Object.assign(copy[id - 1], p);
  return buildBoard({
    now: "2026-11-24T12:00:00+09:00", evaluation: { stages, fields: [] },
    equipment: [{ id: 1, name: "EQ-A01" }, { id: 2, name: "EQ-A02" }], lots, cells: copy,
  });
};
const map = readMapping("");
const plan = (text, board = make(), mapping = map) => planPaste(board, parseTable(text), mapping);

// ---- table parsing: tab / CSV / quoted / semicolon / aligned / BOM / CRLF ----
const tab = parseTable("Lot ID\tEquipment\tStage\r\nLOT-TEST-001\tEQ-A01\t측정\r\n\r\n");
assert.deepEqual(tab.headers, ["Lot ID", "Equipment", "Stage"]);
assert.equal(tab.rows.length, 1);
assert.equal(tab.rows[0].line, 2);
const csv = parseTable('﻿LOT_ID,EQP,"STEP"\n"LOT-TEST-001","EQ-A01","측정, 완료"');
assert.deepEqual(csv.rows[0].cells, ["LOT-TEST-001", "EQ-A01", "측정, 완료"]);
assert.equal(parseTable("a;b;c\n1;2;3").delimiter, ";");
assert.equal(parseTable("Lot   EQP   Step\nLOT-TEST-001   EQ-A01   측정").rows[0].cells.length, 3);
assert.match(parseTable("   \n").error, /비어/);
assert.match(parseTable("onlyone\nvalue").error, /열을 나눌 수 없/);

// ---- column mapping by header name ----
assert.equal(norm("LOT_ID"), norm("lot id"));
const cols = resolveColumns(["No", "Lot ID", "Wafer", "EQP_ID", "Status", "Event Time"], map);
assert.deepEqual(cols.index, { lot: 1, wafer: 2, equipment: 3, stage: 4, time: 5 });
assert.deepEqual(resolveColumns(["Lot", "Foo"], map).missing, ["equipment", "stage"]);
const dup = resolveColumns(["Lot", "Tool"], { ...map, stage: "Tool" });
assert.deepEqual(dup.duplicate, ["equipment", "stage"]);
assert.match(plan("Lot\tFoo\nLOT-TEST-001\tx").error, /열을 찾지 못했어요: 설비, 단계/);

// ---- mapping settings round trip ----
assert.deepEqual(readMapping(""), { ...DEFAULT_MAPPING, stageMap: {} });
assert.deepEqual(readMapping("not json").stageMap, {});
const custom = readMapping(serializeMapping({ ...map, lot: "LOTNO", stageMap: { RCVD: "접수" } }));
assert.equal(custom.lot, "LOTNO");
assert.deepEqual(custom.stageMap, { RCVD: "접수" });
assert.deepEqual(parseStageMapText("RCVD = 접수\nMEAS->측정\n\nbad line\n리뷰중 → 리뷰"), { RCVD: "접수", MEAS: "측정", 리뷰중: "리뷰" });
assert.equal(stageMapText({ A: "접수" }), "A = 접수");

// ---- time formats ----
const KST = "+09:00";
assert.equal(parseMosTime("2026-11-24 09:30:15"), `2026-11-24T09:30:15${KST}`);
assert.equal(parseMosTime("2026/11/24 9:30"), `2026-11-24T09:30:00${KST}`);
assert.equal(parseMosTime("2026.11.24 09:30"), `2026-11-24T09:30:00${KST}`);
assert.equal(parseMosTime("20261124093015"), `2026-11-24T09:30:15${KST}`);
assert.equal(parseMosTime("202611240930"), `2026-11-24T09:30:00${KST}`);
assert.equal(parseMosTime("20261124"), `2026-11-24T00:00:00${KST}`);
assert.equal(parseMosTime("2026-11-24T09:30:15Z"), "2026-11-24T09:30:15+00:00");
assert.equal(parseMosTime("2026-11-24T09:30:15+0900"), "2026-11-24T09:30:15+09:00");
assert.equal(parseMosTime("2026-11-24 오후 3:30"), `2026-11-24T15:30:00${KST}`);
assert.equal(parseMosTime("2026-11-24 12:05 AM"), `2026-11-24T00:05:00${KST}`);
assert.equal(parseMosTime("2026-02-30 10:00"), null);
assert.equal(parseMosTime("2026-13-01"), null);
assert.equal(parseMosTime("yesterday"), null);
assert.equal(parseMosTime(""), null);

// ---- wafer specs ----
assert.equal(waferKey("W01"), "1");
assert.equal(waferKey("#02"), "2");
assert.equal(waferKey("1"), waferKey("01"));
const known = new Set(["1", "2", "3"]);
assert.equal(parseWaferSpec("", known).keys, null);
assert.equal(parseWaferSpec("ALL", known).keys, null);
assert.deepEqual([...parseWaferSpec("1-3", known).keys], ["1", "2", "3"]);
assert.deepEqual([...parseWaferSpec("01, 03", known).keys], ["1", "3"]);
assert.deepEqual(parseWaferSpec("2,9", known).bad, ["9"]);

// ---- plan: header/format variants give the same result ----
const want = (p) => p.rows.flatMap((r) => r.cells.map((c) => `${c.id}:${c.to}:${c.kind}`)).sort().join(" ");
assert.equal(want(plan("Lot ID\tWafer\tEquipment\tStage\nLOT-TEST-001\t01\tEQ-A01\t측정")), "1:meas:apply");
assert.equal(want(plan('LOT_ID,WAFER_NO,EQP,STEP\n"lot-test-001","W1","eq a01","측정"')), "1:meas:apply");

// no wafer column -> every wafer of that lot; wafer range
assert.equal(plan("Lot\tEQP\tStatus\nLOT-TEST-001\tEQ-A02\t접수").counts.apply, 3);
assert.equal(plan("Lot\tWafer\tEQP\tStatus\nLOT-TEST-001\t1-2\tEQ-A01\t접수").counts.apply, 2);

// stage via mapping alias and via stage key
const aliased = readMapping(serializeMapping({ ...map, stageMap: { MEAS_RUN: "측정" } }));
assert.equal(want(plan("Lot\tEQP\tStatus\nLOT-TEST-002\tEQ-A01\tMEAS_RUN", make(), aliased)), "4:meas:apply");
assert.equal(want(plan("Lot\tEQP\tStatus\nLOT-TEST-002\tEQ-A01\tmeas")), "4:meas:apply");

// ---- per-row errors: unknown rows are listed and skipped ----
const bad = plan([
  "Lot ID\tWafer\tEquipment\tStage\tTime",
  "LOT-TEST-999\t01\tEQ-A01\t측정\t2026-11-24 09:00",
  "LOT-TEST-001\t01\tEQ-Z99\t측정\t2026-11-24 09:00",
  "LOT-TEST-001\t07\tEQ-A01\t측정\t2026-11-24 09:00",
  "LOT-TEST-001\t01\tEQ-A01\t보관\t2026-11-24 09:00",
  "LOT-TEST-001\t01\tEQ-A01\t측정\tnot a time",
  "LOT-TEST-001\t01\t\t측정\t2026-11-24 09:00",
  "LOT-TEST-001\t01\tEQ-A01\t측정\t2026-11-24 09:00",
].join("\n"));
assert.deepEqual(bad.rows.map((r) => r.error), ["unknown_lot", "unknown_equipment", "unknown_wafer", "unknown_stage", "bad_time", "blank", ""]);
assert.deepEqual(bad.unknown, { lots: ["LOT-TEST-999"], equipment: ["EQ-Z99"], stages: ["보관"] });
assert.equal(bad.counts.skipped, 6);
assert.equal(bad.counts.apply, 1);
assert.equal(bad.rows[0].line, 2);
assert.equal(previewRows(bad, "skipped").rows.length, 6);
assert.equal(previewRows(bad, "apply").total, 1);

// ---- never silently overwrite: same / backward / stale / excluded ----
const board = make({
  1: { stage_key: "rev", at: "2026-11-24T08:00:00+09:00" },   // already past the MOS stage
  2: { stage_key: "meas", at: "2026-11-24T08:00:00+09:00" },  // already there
  3: { stage_key: "recv", at: "2026-11-24T10:00:00+09:00" },  // entered after the MOS time
  4: { excluded: true },
});
const guard = plan("Lot ID\tWafer\tEquipment\tStage\tTime\n"
  + "LOT-TEST-001\t01\tEQ-A01\t측정\t2026-11-24 09:00\n"
  + "LOT-TEST-001\t02\tEQ-A01\t측정\t2026-11-24 09:00\n"
  + "LOT-TEST-001\t03\tEQ-A01\t측정\t2026-11-24 09:00\n"
  + "LOT-TEST-002\t01\tEQ-A01\t측정\t2026-11-24 09:00", board);
// cell 4 is LOT-TEST-002 wafer 01 on EQ-A01 only by id; check by kinds in row order
assert.deepEqual(guard.rows.map((r) => r.cells[0]?.kind ?? r.error), ["backward", "same", "stale", "excluded"]);
assert.deepEqual(buildMoves(guard), []);                                          // nothing moves without opt-in
assert.deepEqual(buildMoves(guard, { allowBackward: true }).map((m) => m.cell_id), [1]);
assert.deepEqual(buildMoves(guard, { allowStale: true }).map((m) => m.cell_id), [3]);
assert.equal(buildMoves(guard, { allowBackward: true, allowStale: true }).every((m) => !("at" in m)), true); // risky moves log "now"
assert.equal(previewRows(guard, "risky").rows.length, 2);

// ---- moves carry the MOS time only when it is not in the future ----
const now = Date.parse("2026-11-24T12:00:00+09:00");
const timed = plan("Lot\tEQP\tStatus\tTime\nLOT-TEST-002\tEQ-A01\t측정\t2026-11-24 09:00\nLOT-TEST-002\tEQ-A02\t측정\t2026-11-25 09:00");
assert.deepEqual(buildMoves(timed, {}, now), [
  { cell_id: 4, stage_key: "meas", at: "2026-11-24T09:00:00+09:00" },
  { cell_id: 8, stage_key: "meas" },
]);

// ---- the same cell twice: the later MOS time wins ----
const twice = plan("Lot\tEQP\tStatus\tTime\nLOT-TEST-002\tEQ-A01\t리뷰\t2026-11-24 10:00\nLOT-TEST-002\tEQ-A01\t측정\t2026-11-24 09:00");
assert.deepEqual(twice.rows.map((r) => r.cells[0].kind), ["apply", "superseded"]);
assert.deepEqual(buildMoves(twice, {}, now).map((m) => m.stage_key), ["rev"]);
const tie = plan("Lot\tEQP\tStatus\nLOT-TEST-002\tEQ-A01\t측정\nLOT-TEST-002\tEQ-A01\t리뷰");
assert.deepEqual(buildMoves(tie, {}, now).map((m) => m.stage_key), ["rev"]); // no time: later line wins

// ---- undo ----
assert.deepEqual(undoMoves([{ id: 4, from: null, to: "meas" }, { id: 5, from: "recv", to: "meas" }]),
  [{ cell_id: 4, stage_key: null }, { cell_id: 5, stage_key: "recv" }]);

// ---- size guard ----
const huge = "Lot\tEQP\tStatus\n" + "LOT-TEST-001\tEQ-A01\t측정\n".repeat(5001);
assert.match(plan(huge).error, /5,000줄/);
console.log("mos paste model ok");
