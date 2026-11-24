// V-011: issue hierarchy model of the structure screen (web/js/structmodel.js). Run: node web/test/run_issue_tree.mjs
import assert from "node:assert/strict";
import { buildIssueTree, flatten, hasKids, rankOf, visibleRows } from "../js/structmodel.js";

const levels = [{ id: 1, label: "에픽", rank: 2 }, { id: 2, label: "작업", rank: 1 }];
const t = (id, extra = {}) => ({ id, title: `T${id}`, status: "todo", parent_task_id: null, level_id: null, ...extra });
const tasks = [
  t(5),                                         // plain top-level issue
  t(1, { level_id: 1, title: "프로젝트" }),      // epic
  t(2, { level_id: 1, title: "스터디" }),        // epic
  t(3, { parent_task_id: 1, status: "done" }),
  t(4, { parent_task_id: 1, level_id: 2 }),     // 작업 under the epic: sorts before plain issue 3
  t(6, { parent_task_id: 4 }),
  t(7, { parent_task_id: 99 }),                 // parent not in the list: shown at the top level
];

const tree = buildIssueTree(tasks, levels);
assert.deepEqual(tree.map((n) => n.task.id), [1, 2, 5, 7], "upper levels first, then by id");
const epic = tree[0];
assert.equal(epic.level.label, "에픽");
assert.deepEqual(epic.children.map((n) => n.task.id), [4, 3]);
assert.deepEqual(epic.items.map((x) => x.id), [4, 6, 3], "rollup counts every descendant");
assert.equal(epic.done, 1);
assert.equal(epic.children[0].children[0].parent, epic.children[0]);
assert.equal(hasKids(epic), true);
assert.equal(hasKids(tree[1]), false, "an epic without children does not fold");
assert.equal(hasKids({ kind: "group", children: [] }), true);
assert.equal(rankOf(tasks[1], levels), 2);
assert.equal(rankOf(tasks[0], levels), 0);

assert.deepEqual(flatten(tree).map((n) => n.id), ["i1", "i4", "i6", "i3", "i2", "i5", "i7"]);
const vis = visibleRows(tree, new Set(["i4"]));
assert.deepEqual(vis.map((v) => [v.node.id, v.depth]), [["i1", 0], ["i4", 1], ["i3", 1], ["i2", 0], ["i5", 0], ["i7", 0]]);

// a corrupt cycle never loops forever (the server rejects cycles, this is only a guard)
const loop = buildIssueTree([t(1, { parent_task_id: 2 }), t(2, { parent_task_id: 1 })], levels);
assert.deepEqual(loop, []);

console.log("issue tree ok");
