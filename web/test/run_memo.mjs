// node web/test/run_memo.mjs — pure memo helpers (image width markdown, fold plan). Exits 1 on failure.
import assert from "node:assert/strict";
import { clampWidth, foldPlan, imgCssWidth, imgSuffix, ownerHeading, parseImgAttr, pruneFolds } from "../js/memocore.js";

const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t("image width round trip", () => {
  for (const w of ["small", "orig", "480", "60", "2400"]) assert.equal(parseImgAttr(imgSuffix(w)), w);
  assert.equal(imgSuffix(null), "");
  assert.equal(imgSuffix("auto"), "");
  assert.equal(imgSuffix("5"), ""); // too short to be a width
  assert.equal(parseImgAttr(""), null);
  assert.equal(parseImgAttr("{size=huge}"), null);
  assert.equal(parseImgAttr("{width=abc}"), null);
});

t("widths are clamped, never negative or absurd", () => {
  assert.equal(clampWidth(1), 60);
  assert.equal(clampWidth(99999), 2400);
  assert.equal(parseImgAttr("{width=10}"), "60"); // 2 digits parse, then clamp
  assert.equal(imgSuffix("9999"), "{width=2400}");
  assert.equal(imgCssWidth("small"), "240px");
  assert.equal(imgCssWidth("480"), "480px");
  assert.equal(imgCssWidth("orig"), "");
  assert.equal(imgCssWidth(null), "");
});

const doc = [
  { level: 0, text: "intro" },
  { level: 2, text: "A" },
  { level: 0, text: "a1" },
  { level: 3, text: "A.1" },
  { level: 0, text: "a1x" },
  { level: 2, text: "B" },
  { level: 0, text: "b1" },
  { level: 2, text: "A" }, // duplicate title
  { level: 0, text: "dup" },
];

t("fold hides a section up to the next heading of the same or higher level", () => {
  const p = foldPlan(doc, new Set(["h2|A|0"]));
  assert.deepEqual(p.map((x) => x.hidden), [false, false, true, true, true, false, false, false, false]);
  assert.equal(p[1].count, 3);
  assert.equal(p[1].folded, true);
  assert.equal(p[5].folded, false);
});

t("a nested fold only hides its own children", () => {
  const p = foldPlan(doc, new Set(["h3|A.1|0"]));
  assert.deepEqual(p.map((x) => x.hidden), [false, false, false, false, true, false, false, false, false]);
});

t("duplicate headings get distinct keys by occurrence", () => {
  const p = foldPlan(doc, new Set(["h2|A|1"]));
  assert.equal(p[7].key, "h2|A|1");
  assert.deepEqual(p.map((x) => x.hidden), [false, false, false, false, false, false, false, false, true]);
});

t("a heading with nothing under it cannot fold", () => {
  const p = foldPlan([{ level: 1, text: "x" }, { level: 1, text: "y" }], new Set(["h1|x|0"]));
  assert.equal(p[0].count, 0);
  assert.equal(p[0].folded, false);
});

t("owner heading and prune", () => {
  assert.equal(ownerHeading(doc, 4), 3);
  assert.equal(ownerHeading(doc, 1), 1);
  assert.equal(ownerHeading(doc, 0), -1);
  const kept = pruneFolds(doc, new Set(["h2|A|0", "h2|Gone|0"]));
  assert.deepEqual([...kept], ["h2|A|0"]);
});

let bad = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("PASS", name); } catch (e) { bad++; console.log("FAIL", name, e.message); }
}
process.exit(bad ? 1 : 0);
