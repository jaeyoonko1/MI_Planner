// V-011: issue hierarchy model of the structure screen (web/js/structmodel.js). Run: node web/test/run_issue_tree.mjs
import assert from "node:assert/strict";
import { buildIssueTree, flatten, hasKids, issueAncestorPath, issueBranch, issuePathLabel, rankOf, visibleRows } from "../js/structmodel.js";

const levels = [{ id: 1, label: "에픽", rank: 2 }, { id: 2, label: "작업", rank: 1 }, { id: 3, label: "이슈", rank: 0, is_default: true }];
const t = (id, extra = {}) => ({ id, title: `T${id}`, status: "todo", parent_task_id: null, level_id: 3, ...extra });
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
assert.equal(tree[2].level.label, "이슈");
const inverted = buildIssueTree([t(1), t(2, { parent_task_id: 1, level_id: 1 })], levels);
assert.equal(inverted[0].children[0].outOfOrder, true);

assert.deepEqual(flatten(tree).map((n) => n.id), ["i1", "i4", "i6", "i3", "i2", "i5", "i7"]);
const vis = visibleRows(tree, new Set(["i4"]));
assert.deepEqual(vis.map((v) => [v.node.id, v.depth]), [["i1", 0], ["i4", 1], ["i3", 1], ["i2", 0], ["i5", 0], ["i7", 0]]);

// a corrupt cycle never loops forever (the server rejects cycles, this is only a guard)
const loop = buildIssueTree([t(1, { parent_task_id: 2 }), t(2, { parent_task_id: 1 })], levels);
assert.deepEqual(loop, []);

const recipe = [
  t(10, { level_id: 1, title: "Recipe 관리" }),
  t(11, { level_id: 1, title: "Recipe 관리" }),
  t(12, { level_id: 2, parent_task_id: 10, title: "동일 제목" }),
  t(13, { level_id: 2, parent_task_id: 11, title: "동일 제목" }),
  t(14, { level_id: 2, parent_task_id: 12, title: "제품명" }),
  t(15, { parent_task_id: 14, props: { type: "수기" } }),
  t(16, { parent_task_id: 15 }),
];
const byId = new Map(recipe.map((task) => [task.id, task]));
const path = (id) => issueAncestorPath(byId.get(id), byId).ancestors;
assert.deepEqual(path(16).map((task) => task.id), [10, 12, 14, 15], "keeps repeated and skipped levels in tree order");
assert.deepEqual(path(10), []);
assert.deepEqual(issueAncestorPath(byId.get(10), byId), { ancestors: [], missingParentId: null });
assert.deepEqual(issueAncestorPath({ id: 99, parent_task_id: 100 }, byId), { ancestors: [], missingParentId: 100 });
const orphan = t(100, { parent_task_id: 101 });
assert.deepEqual(issueAncestorPath(t(99, { parent_task_id: 100 }), new Map([[100, orphan]])),
  { ancestors: [orphan], missingParentId: 101 });
assert.equal(issuePathLabel(byId.get(14), levels[1]), "작업 · #14 제품명");
const treeAt = () => buildIssueTree([...byId.values()], levels);
const branchRows = (id, folds = []) => {
  const nodes = treeAt();
  const branch = issueBranch(flatten(nodes).find((node) => node.task.id === id));
  return visibleRows(nodes, new Set(folds), branch).map(({ node, depth }) => [node.task.id, depth]);
};
assert.deepEqual(branchRows(14, ["i10", "i12"]), [[10, 0], [12, 1], [14, 2], [15, 3], [16, 4]]);
assert.deepEqual(branchRows(14, ["i14"]), [[10, 0], [12, 1], [14, 2]]);
assert.deepEqual(branchRows(13), [[11, 0], [13, 1]], "equal titles from another branch are excluded by ID");
byId.set(14, { ...byId.get(14), parent_task_id: 13, title: "제품명 변경" });
assert.deepEqual(branchRows(14), [[11, 0], [13, 1], [14, 2], [15, 3], [16, 4]]);
assert.deepEqual(branchRows(12), [[10, 0], [12, 1]]);
assert.deepEqual(path(16).map((task) => task.title), ["Recipe 관리", "동일 제목", "제품명 변경", "T15"]);
assert.deepEqual(byId.get(15).props, { type: "수기" });
const cycle = new Map([[1, t(1, { parent_task_id: 2 })], [2, t(2, { parent_task_id: 1 })]]);
assert.deepEqual(issueAncestorPath(cycle.get(1), cycle).ancestors.map((task) => task.id), [2]);

console.log("issue tree ok");
