// Node test for the pure DOI share-package logic (P5-04).
import assert from "node:assert/strict";
import { applyLabel, bulk, choiceOptions, defaultChoices, existingLine, exportSummary, exportable, metaLine, summarize } from "../js/doi-package-model.js";

const it = (uid, state, extra = {}) => ({
  uid, state, title: uid, allowed: state === "new" ? ["import", "skip"] : state === "identical" ? ["skip"] : ["skip", "both", "overwrite"],
  default: state === "new" ? "import" : "skip", existing: null, ...extra,
});
const items = [it("a", "new"), it("b", "new"), it("c", "identical"), it("d", "conflict"), it("e", "conflict", { allowed: ["skip", "both"] })];

let ch = defaultChoices(items);
assert.deepEqual(ch, { a: "import", b: "import", c: "skip", d: "skip", e: "skip" });
assert.deepEqual(summarize(items, ch), { import: 2, both: 0, overwrite: 0, skip: 3 });
assert.equal(applyLabel(summarize(items, ch)), "2개 가져오기");
ch = bulk(items, ch, "both");
assert.deepEqual([ch.d, ch.e, ch.a], ["both", "both", "import"]);
ch = bulk(items, ch, "skip");
assert.deepEqual([ch.d, ch.e], ["skip", "skip"]);
ch = bulk(items, ch, "new", false);
assert.deepEqual([ch.a, ch.b, ch.c], ["skip", "skip", "skip"]);
assert.equal(applyLabel(summarize(items, ch)), "가져올 항목 없음");
ch.d = "overwrite";
assert.equal(summarize(items, ch).overwrite, 1);
assert.deepEqual(choiceOptions(items[4]).map((o) => o[0]), ["skip", "both"]);

const docs = [
  { status: "ready", deleted: false, images: [{ size: 10 }, { size: 5 }] },
  { status: "draft", deleted: false, images: [{ size: 99 }] },
  { status: "ready", deleted: true, images: [] },
  { status: "ready", deleted: false, images: [{}] },
];
assert.equal(exportable(docs).length, 2);
assert.deepEqual(exportSummary(docs), { count: 2, images: 3, bytes: 15, skippedDrafts: 1 });
assert.equal(existingLine({ existing: { origin: "mine", title: "T", deleted: true, updated_at: "2026-11-24T10:00:00" } }), "내 DOI ‘T’ (휴지통) · 수정 2026-11-24");
assert.equal(metaLine({ product: "P", plan: "", step: "S1", defect_type: "Void" }), "P · S1 · Void");
console.log("doi-package model: ok");
