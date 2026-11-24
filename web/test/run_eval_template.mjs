import assert from "node:assert/strict";
import {
  addField, addStage, draftOf, moveItem, parseWarn, payloadOf, snapshot, uniqueKey, validate,
} from "../js/eval-template-model.js";

const template = {
  id: 1, name: "TEST 템플릿", is_master: false,
  stages: [
    { key: "a", label: "대기", color: "#8f9bb5", warn_hours: 12 },
    { key: "b", label: "완료", color: "#39e58c", warn_hours: null },
  ],
  fields: [{ key: "f1", label: "반복도", type: "okng" }],
};

assert.deepEqual(parseWarn(""), { value: null });
assert.deepEqual(parseWarn(" 1,200.5 "), { value: 1200.5 });
assert.ok(parseWarn("0").error && parseWarn("-1").error && parseWarn("abc").error && parseWarn("8761").error);
assert.deepEqual(parseWarn("8760"), { value: 8760 });

const draft = draftOf(template);
const initial = snapshot(draft);
assert.equal(snapshot(draftOf(template)), initial);
assert.equal(draft.stages[0].warn, "12");
assert.equal(validate(draft).count, 0);

// add keeps keys unique even after a delete in the middle
const s = addStage(draft, "  재검사 ");
assert.equal(s.label, "재검사");
assert.equal(s.key, "stage_3");
draft.stages.splice(0, 1);
assert.notEqual(addStage(draft, "다른").key, "stage_3");
assert.equal(uniqueKey("field", [{ key: "field_2" }, { key: "field_1" }]), "field_3");
assert.ok(new Set(draft.stages.map((x) => x.key)).size === draft.stages.length);

// reorder
const d2 = draftOf(template);
assert.equal(moveItem(d2.stages, 0, 1), true);
assert.deepEqual(d2.stages.map((x) => x.key), ["b", "a"]);
assert.equal(moveItem(d2.stages, 0, 5), false);
assert.notEqual(snapshot(d2), initial);

// validation
const bad = draftOf(template);
bad.name = " ";
bad.stages[0].label = "";
bad.stages[1].warn = "x";
addField(bad, "반복도", "text");
const errors = validate(bad);
assert.ok(errors.name && errors.stages.a && errors.stages.b && errors.fields.field_2);
assert.equal(errors.count, 4);
const dup = draftOf(template);
dup.stages[1].label = "대기";
assert.ok(validate(dup).stages.b.includes("같은 이름"));
const none = draftOf(template);
none.stages = [];
assert.ok(validate(none).stages._);

// payload: names trimmed, warn parsed, is_master only when newly set
const p = draftOf(template);
p.name = " 새 이름 ";
p.stages[0].warn = "";
p.stages[1].warn = "2.5";
assert.deepEqual(payloadOf(p, template), {
  name: "새 이름",
  stages: [
    { key: "a", label: "대기", color: "#8f9bb5", warn_hours: null },
    { key: "b", label: "완료", color: "#39e58c", warn_hours: 2.5 },
  ],
  fields: [{ key: "f1", label: "반복도", type: "okng" }],
});
p.is_master = true;
assert.equal(payloadOf(p, template).is_master, true);
assert.equal("is_master" in payloadOf(draftOf({ ...template, is_master: true }), { ...template, is_master: true }), false);
console.log("eval template model ok");
