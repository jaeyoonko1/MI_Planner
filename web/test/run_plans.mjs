// Node test for the pure Plan/Step table logic (P5-01).
import assert from "node:assert/strict";
import { applyState, filterPreview, filterSteps, formatSize, formatStamp, visibleColumns } from "../js/plans-model.js";

const steps = [
  { step_code: "S1", name: "Gate Insp", area: "FEOL", tool_group: "", recipe: "", layer: "", note: "", extra: { "공정시간(분)": "12", empty: "" }, stale: false },
  { step_code: "S2", name: "Poly Meas", area: "", tool_group: "", recipe: "", layer: "L2", note: "두께", extra: {}, stale: false },
  { step_code: "S3", name: "Old step", area: "", tool_group: "", recipe: "", layer: "", note: "", extra: {}, stale: true },
];
const cols = visibleColumns(steps, ["공정시간(분)", "empty", "nope"]);
assert.deepEqual(cols.map((c) => c.key), ["step_code", "name", "area", "layer", "note", "공정시간(분)"]);
assert.equal(cols.at(-1).extra, true);
assert.equal(filterSteps(steps, cols, {}).length, 2);
assert.equal(filterSteps(steps, cols, { showStale: true }).length, 3);
assert.deepEqual(filterSteps(steps, cols, { query: "poly 두께" }).map((s) => s.step_code), ["S2"]);
assert.deepEqual(filterSteps(steps, cols, { query: "12" }).map((s) => s.step_code), ["S1"]); // extra column is searched
assert.equal(filterSteps(steps, cols, { query: "zzz" }).length, 0);
assert.equal(formatStamp("2026-11-24T09:05:33+09:00"), "2026-11-24 09:05");
assert.equal(formatSize(500), "500B");
assert.equal(formatSize(2048), "2KB");
assert.equal(formatSize(3 * 1048576), "3.0MB");
const rows = [{ status: "new" }, { status: "same" }, { status: "update" }];
assert.equal(filterPreview(rows, "all").length, 3);
assert.deepEqual(filterPreview(rows, "same"), [{ status: "same" }]);
const base = { can_apply: true, counts: { new: 0, update: 0, same: 4, missing: 0, error: 0 } };
assert.deepEqual(applyState(null), [false, "가져오기"]);
assert.deepEqual(applyState({ ...base, can_apply: false }), [false, "가져오기"]);
assert.deepEqual(applyState(base), [false, "바뀐 내용 없음"]);
assert.deepEqual(applyState({ ...base, counts: { ...base.counts, new: 2, update: 1 } }), [true, "3개 반영"]);
assert.deepEqual(applyState({ ...base, counts: { ...base.counts, missing: 2 } }), [true, "파일에 없는 2개 표시"]);
console.log("plans model ok");
