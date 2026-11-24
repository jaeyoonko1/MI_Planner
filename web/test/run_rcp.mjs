// Node test for the pure RCP screen helpers (P6-02).
import assert from "node:assert/strict";
import { cleanRules, filterRecipes, filterSummary, formatStamp, isRunning, runLine, runStatus, splitList, splitNames } from "../js/rcp-model.js";

assert.deepEqual(cleanRules([{ type: "contains", value: "  aabb " }, { type: "suffix", value: "  ", exclude: true }, { type: "suffix", value: "_old", exclude: 1 }]),
  [{ type: "contains", value: "aabb", exclude: false }, { type: "suffix", value: "_old", exclude: true }]);
assert.deepEqual(filterSummary([]), ["전체 (필터 없음)"]);
assert.deepEqual(filterSummary([{ type: "suffix", value: "_old", exclude: true }]), ["제외 · 끝 _old"]);
assert.deepEqual(splitList("*.xml, params/*.ini ,,"), ["*.xml", "params/*.ini"]);
assert.deepEqual(splitNames("a\r\nb\n\na\n"), ["a", "b"]);
assert.equal(runStatus("partial")[0], "일부 실패");
assert.equal(runStatus("weird")[0], "weird");
assert.equal(isRunning({ status: "running" }), true);
assert.equal(isRunning(null), false);
assert.equal(runLine(null), "아직 수집한 적이 없어요");
assert.match(runLine({ status: "ok", matched: 2, new_snapshots: 1, unchanged: 1 }), /^완료 · 레시피 2개/);
assert.equal(formatStamp("2026-11-24T09:05:33+09:00"), "2026-11-24 09:05");
const items = [{ name: "AABB_1", missing: false }, { name: "aabb_2", missing: true }, { name: "ccdd", missing: false }];
assert.deepEqual(filterRecipes(items, {}).map((r) => r.name), ["AABB_1", "ccdd"]);
assert.deepEqual(filterRecipes(items, { showMissing: true, query: "AaBb" }).map((r) => r.name), ["AABB_1", "aabb_2"]);
console.log("rcp model ok");
