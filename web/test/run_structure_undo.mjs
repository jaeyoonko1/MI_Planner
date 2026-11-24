import assert from "node:assert/strict";
import { createUndoStack } from "../js/structundo.js";
import { click, deleteItems, emptySelection, isTypingTarget, moveTo, neighbourAfterRemoval, prune, selectAll, single, toggleActive } from "../js/structselect.js";

// ---- undo stack ----
const s = createUndoStack(3);
assert.equal(s.takeUndo(), null);
s.push("a"); s.push("b");
assert.equal(s.peekUndo(), "b");
let e = s.takeUndo();
assert.equal(e, "b");
assert.equal(s.takeUndo(), null, "busy while a step is in flight");
s.doneUndo(e);
assert.equal(s.peekRedo(), "b");
assert.equal(s.busy, false);
e = s.takeRedo();
s.doneRedo(e);
assert.equal(s.peekUndo(), "b");
assert.equal(s.redoCount, 0);
// a failed undo keeps the entry; a dropped one does not
e = s.takeUndo();
s.failUndo(e);
assert.equal(s.undoCount, 2);
e = s.takeUndo();
s.failUndo(e, false);
assert.equal(s.undoCount, 1);
// new action clears redo
e = s.takeUndo(); s.doneUndo(e);
assert.equal(s.redoCount, 1);
s.push("c");
assert.equal(s.redoCount, 0);
// limit
s.push("d"); s.push("e"); s.push("f");
assert.equal(s.undoCount, 3);
assert.equal(s.peekUndo(), "f");
s.clear();
assert.equal(s.undoCount + s.redoCount, 0);

// ---- selection ----
const vis = ["g1", "i1", "i2", "g2", "i3"];
let sel = single("i1");
sel = click(sel, "i3", { shift: true }, vis);
assert.deepEqual([...sel.ids], ["i1", "i2", "g2", "i3"]);
assert.equal(sel.anchor, "i1");
sel = click(sel, "i2", { ctrl: true }, vis);
assert.deepEqual([...sel.ids].sort(), ["g2", "i1", "i3"]);
sel = click(sel, "g1", {}, vis);
assert.deepEqual([...sel.ids], ["g1"]);
sel = moveTo(sel, "i1", { shift: true }, vis);
sel = moveTo(sel, "i2", { shift: true }, vis);
assert.deepEqual([...sel.ids], ["g1", "i1", "i2"]);
sel = moveTo(sel, "i1", { shift: true }, vis);
assert.deepEqual([...sel.ids], ["g1", "i1"], "range shrinks back toward the anchor");
sel = moveTo(sel, "g2", {}, vis);
assert.deepEqual([...sel.ids], ["g2"]);
sel = toggleActive(sel);
assert.equal(sel.ids.size, 0);
assert.equal(selectAll(sel, vis).ids.size, 5);
assert.deepEqual([...prune(selectAll(sel, vis), new Set(["i1", "i3"])).ids], ["i1", "i3"]);
assert.equal(click(emptySelection(), "i2", { shift: true }, vis).active, "i2");
assert.equal(moveTo(single("i1"), "", {}, vis).active, "i1");

// ---- after removal ----
assert.equal(neighbourAfterRemoval(vis, new Set(["i1", "i2"])), "g2");
assert.equal(neighbourAfterRemoval(vis, new Set(["g2", "i3"])), "i2");
assert.equal(neighbourAfterRemoval(vis, new Set(vis)), "");
assert.equal(neighbourAfterRemoval(vis, new Set(["zzz"])), "");

// ---- delete payload ----
const index = new Map([
  ["g1", { kind: "group", nodeId: 7 }], ["i1", { kind: "issue", task: { id: 11 } }], ["f", { kind: "group", nodeId: undefined }],
]);
assert.deepEqual(deleteItems(["g1", "i1"], index, { free: true }), { items: [{ kind: "group", id: 7 }, { kind: "issue", id: 11 }], blockedGroups: 0 });
assert.deepEqual(deleteItems(["g1", "i1", "f"], index, { free: false }), { items: [{ kind: "issue", id: 11 }], blockedGroups: 2 });
// V-011: classification-view groups are values; the same value under two branches is sent once, 미분류 is skipped
const vIndex = new Map([
  ["a", { kind: "group", key: "type", value: "셋업" }], ["b", { kind: "group", key: "type", value: "셋업" }],
  ["n", { kind: "group", key: "type", value: null, none: true }],
]);
assert.deepEqual(deleteItems(["a", "b", "n"], vIndex, { free: false }), { items: [{ kind: "value", key: "type", value: "셋업" }], blockedGroups: 1 });

// ---- typing targets ----
const fake = (tag, extra = {}) => ({ nodeType: 1, tagName: tag, isContentEditable: false, closest: () => null, ...extra });
assert.equal(isTypingTarget(fake("INPUT", { type: "text" })), true);
assert.equal(isTypingTarget(fake("INPUT", { type: "checkbox" })), false);
assert.equal(isTypingTarget(fake("TEXTAREA")), true);
assert.equal(isTypingTarget(fake("DIV", { isContentEditable: true })), true);
assert.equal(isTypingTarget(fake("DIV")), false);
assert.equal(isTypingTarget(null), false);
console.log("structure undo/selection ok");
