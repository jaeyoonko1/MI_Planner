// P7-03: AI request text builder. Fake data only.
import assert from "node:assert/strict";
import { SELECTION_LIMIT, buildRequest, clipSelection, describeLocation, toggleSkill } from "../js/ai-request-model.js";

assert.equal(describeLocation("#/today").kind, "today");
assert.equal(describeLocation("#/evaluations").label, "평가 현황판");
assert.equal(describeLocation("").kind, "home");
const page = describeLocation("#/MI%20%EC%97%85%EB%AC%B4/EQ-A01/");
assert.equal(page.kind, "page");
assert.equal(page.file, "vault/MI 업무/EQ-A01/");

assert.deepEqual(toggleSkill([], "a"), ["a"]);
assert.deepEqual(toggleSkill(["a", "b"], "a"), ["b"]);

const long = "x".repeat(SELECTION_LIMIT + 25);
const c = clipSelection(long);
assert.equal(c.text.length, SELECTION_LIMIT);
assert.equal(c.cut, 25);
assert.deepEqual(clipSelection("  hi \r\n"), { text: "hi", cut: 0 });

const full = buildRequest({ hash: "#/Notes/EQ-A01", selection: "LOT-TEST-001 대기", skills: ["status-brief"], request: "정리해줘" });
for (const part of ["현재 위치: 페이지 Notes/EQ-A01", "vault/Notes/EQ-A01/", "LOT-TEST-001 대기", "skills/status-brief/SKILL.md", "정리해줘", "python -m app.cli", "RCP"]) {
  assert.ok(full.includes(part), part);
}
const bare = buildRequest({ hash: "#/today" });
assert.ok(!bare.includes("선택한 내용"));
assert.ok(!bare.includes("사용할 스킬"));
assert.ok(bare.includes("(여기에 요청을 적어 주세요)"));
assert.ok(buildRequest({ selection: long }).includes("25자는 잘렸습니다"));
console.log("ai-request ok");
