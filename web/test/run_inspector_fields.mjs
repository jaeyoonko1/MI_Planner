// Node test for the inspector classification model (V-006).
import assert from "node:assert/strict";
import { classRows, optionChips, toggleMulti } from "../js/inspector-fields.js";

const epic = { key: "epic", label: "에픽", type: "choice", builtin: false, archived: false,
  options: [{ value: "a", label: "A" }, { value: "a1", label: "A-1", parent: "a" }, { value: "old", label: "옛", archived: true }] };
const prod = { key: "c1", label: "제품", type: "choice", options: [] };
const tags = { key: "tags", label: "태그", type: "multi", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] };
const fields = [
  { key: "priority", label: "우선순위", type: "choice", builtin: true, options: [{ value: 1, label: "높음" }] },
  epic, prod, tags,
  { key: "gone", label: "보관", type: "choice", archived: true, options: [{ value: "z", label: "Z" }] },
  { key: "memo", label: "글", type: "text", options: [] },
];

const rows = classRows(fields, { epic: "a1", tags: ["y"] });
assert.deepEqual(rows.map((r) => r.key), ["epic", "c1", "tags"]);          // builtin/archived/non-pickable skipped
assert.equal(rows[0].current, "a1");
assert.deepEqual(rows[0].chips.map((c) => [c.label, c.depth]), [["A", 0], ["A-1", 1]]); // archived option hidden, tree order
assert.equal(rows[1].empty, true);                                          // zero options → empty state
assert.deepEqual(rows[2].current, ["y"]);

// the value an issue already has is shown even if its option is archived or gone
const orph = classRows(fields, { epic: "old" })[0].chips;
assert.deepEqual(orph.map((c) => c.label), ["A", "A-1", "옛"]);
const gone = classRows(fields, { epic: "deleted" })[0].chips.at(-1);
assert.equal(gone.orphan, true); assert.equal(gone.label, "deleted");
// a value on a classification with no options still shows (not an empty-state that hides it)
assert.equal(classRows(fields, { c1: "p" })[1].empty, false);

assert.deepEqual(optionChips({ options: [{ value: 1, label: "a", parent: 99 }] }, null).map((c) => c.depth), [0]); // dangling parent
assert.deepEqual(toggleMulti(["a"], "b"), ["a", "b"]);
assert.deepEqual(toggleMulti(["a", "b"], "a"), ["b"]);
console.log("inspector fields ok");
