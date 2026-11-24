// Node test for the pure DOI library logic (P5-02).
import assert from "node:assert/strict";
import { facets, filterItems, gridMove, metaLine, move, originLabel, parseTags, pickImage, sortItems, suggestions, thumbSize, toggle } from "../js/doi-model.js";

const mk = (o) => ({ title: "", description: "", product: "", plan: "", step: "", defect_type: "", tool_condition: "", source_dept: "", source_author: "", tags: [], images: [], updated_at: "2026-01-01", origin: "mine", status: "ready", ...o });
const items = [
  mk({ id: 1, title: "Scratch near edge", product: "PROD-TEST-A", step: "S0010", defect_type: "Scratch", tags: ["edge", "scratch"], updated_at: "2026-02-01" }),
  mk({ id: 2, title: "Particle cluster", product: "PROD-TEST-A", step: "S0020", defect_type: "Particle", tags: ["edge"], images: [{ id: 9, caption: "after clean" }] }),
  mk({ id: 3, title: "Void in contact", product: "PROD-TEST-B", step: "S0010", defect_type: "Void", tags: [], status: "draft" }),
];

assert.deepEqual(filterItems(items, {}).map((i) => i.id), [1, 2, 3]);
assert.deepEqual(filterItems(items, { product: "PROD-TEST-A" }).map((i) => i.id), [1, 2]);
assert.deepEqual(filterItems(items, { product: "PROD-TEST-A", step: "S0020" }).map((i) => i.id), [2]);
assert.deepEqual(filterItems(items, { tags: ["EDGE", "scratch"] }).map((i) => i.id), [1]);
assert.deepEqual(filterItems(items, { query: "particle EDGE" }).map((i) => i.id), [2]);
assert.deepEqual(filterItems(items, { query: "after clean" }).map((i) => i.id), [2], "captions are searched");
assert.deepEqual(filterItems(items, { draftsOnly: true }).map((i) => i.id), [3]);
assert.equal(filterItems(items, { query: "zzz" }).length, 0);

// facet counts ignore their own filter but respect the others
const f = facets(items, { product: "PROD-TEST-A" });
assert.deepEqual(f.products, [["PROD-TEST-A", 2], ["PROD-TEST-B", 1]]);
assert.deepEqual(f.steps.map((s) => s[0]).sort(), ["S0010", "S0020"]);
assert.deepEqual(f.tags[0], ["edge", 2]);
assert.deepEqual(facets(items, { defect: "Void" }).products, [["PROD-TEST-B", 1]]);

assert.deepEqual(sortItems(items, "title", "desc").map((i) => i.id), [3, 1, 2]);
assert.deepEqual(sortItems(items, "updated_at", "desc").map((i) => i.id)[0], 1);
assert.deepEqual(sortItems(items, "nope").map((i) => i.id), [1, 2, 3]);
assert.deepEqual(sortItems(items, "images", "asc").map((i) => i.id), [1, 3, 2], "stable for equal keys");

// keyboard moves: 3 columns, 7 cards
assert.equal(gridMove(0, "ArrowRight", 3, 7), 1);
assert.equal(gridMove(0, "ArrowLeft", 3, 7), 0);
assert.equal(gridMove(1, "ArrowDown", 3, 7), 4);
assert.equal(gridMove(5, "ArrowDown", 3, 7), 5, "no card below: stay");
assert.equal(gridMove(4, "ArrowUp", 3, 7), 1);
assert.equal(gridMove(4, "End", 3, 7), 6);
assert.equal(gridMove(4, "Home", 3, 7), 0);
assert.equal(gridMove(0, "ArrowRight", 3, 0), -1);

assert.deepEqual(parseTags("a, b #c，A"), ["a", "b", "c"]);
assert.deepEqual(parseTags("B, x", ["b"]), ["b", "x"]);
assert.deepEqual(toggle(["a"], "b"), ["a", "b"]);
assert.deepEqual(toggle(["a", "b"], "a"), ["b"]);
assert.deepEqual(move([1, 2, 3], 0, 2), [2, 3, 1]);
assert.deepEqual(move([1, 2, 3], 0, 5), [1, 2, 3]);
assert.deepEqual(thumbSize(1920, 1080, 480), { w: 480, h: 270 });
assert.deepEqual(thumbSize(100, 50, 480), { w: 100, h: 50 }, "never enlarged");
assert.deepEqual(thumbSize(0, 0, 480), { w: 480, h: 480 });
assert.equal(metaLine(items[0]), "PROD-TEST-A · S0010");
assert.equal(originLabel(items[0]), "");
assert.equal(originLabel(mk({ origin: "imported", source_dept: "DEPT-TEST", source_author: "홍길동" })), "가져옴 · DEPT-TEST 홍길동");
assert.equal(originLabel(mk({ origin: "imported" })), "가져옴");
assert.deepEqual(suggestions(["Scratch", "Scrap", "Void", ""], "scr"), ["Scratch", "Scrap"]);
assert.deepEqual(suggestions(["Scratch"], "scratch"), [], "exact match needs no suggestion");
assert.equal(pickImage([{ id: 1 }, { id: 2 }], 2).id, 2);
assert.equal(pickImage([{ id: 1 }], 7).id, 1);
assert.equal(pickImage([], 7), null);
console.log("doi model ok");
