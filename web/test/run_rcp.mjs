// Node test for the pure RCP screen helpers (P6-02).
import assert from "node:assert/strict";
import { cleanRules, filterParams, filterRecipes, groupParams, mappingLine, parseStatus, filterSummary, formatStamp, isRunning, runLine, runStatus, splitList, splitNames } from "../js/rcp-model.js";

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
assert.equal(parseStatus("partial")[0], "일부 파일 실패");
assert.equal(parseStatus("zzz")[0], "zzz");
const ps = [{ file: "a.xml", path: "Optics/Focus", label: "초점", value: "1", unit: "um", group_name: "광학" },
  { file: "a.xml", path: "Zeta", label: "", value: "9", unit: "", group_name: "" },
  { file: "b.ini", path: "Scan/Mode", label: "모드", value: "FAST", unit: "", group_name: "스캔" }];
assert.equal(filterParams(ps, { namedOnly: true }).length, 2);
assert.deepEqual(filterParams(ps, { file: "a.xml" }).map((p) => p.path), ["Optics/Focus", "Zeta"]);
assert.deepEqual(filterParams(ps, { query: " fast " }).map((p) => p.path), ["Scan/Mode"]);
assert.deepEqual(filterParams(ps, { query: "광학" }).map((p) => p.path), ["Optics/Focus"]);
assert.deepEqual(groupParams(ps).map(([g, r]) => [g, r.length]), [["광학", 1], ["스캔", 1], ["기타", 1]]);
assert.deepEqual(groupParams([]), []);
assert.equal(mappingLine({}, {}), "매핑 없음 · 파일 확장자로 파서를 골랐어요");
assert.equal(mappingLine({}, { mapping: "m1", mapping_version: "2", mapping_auto: true }), "매핑 m1 v2 · 설비사·모델로 자동 선택");
console.log("rcp model ok");
