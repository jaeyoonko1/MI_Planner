// P3-04: pure toolbar logic (presets, size stepping, shortcut mapping). Run: node web/test/run_note_format.mjs
import assert from "node:assert/strict";
import { KEYS, formatKeyAction, presetIndex, rgbToHex, sizeIndex, stepSizeIndex, tip } from "../js/note-format-core.js";

const SIZES = [11, 13, 15, 18, 22, 28];
const COLORS = ["#1f2430", "#d93025", "#e8710a", "#188038", "#1a73e8", "#7b1fa2", "#6b7280"];
const ev = (o) => ({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, key: "", code: "", ...o });

assert.equal(rgbToHex("rgb(217, 48, 37)"), "#d93025");
assert.equal(rgbToHex("rgba(217, 48, 37, 1)"), "#d93025");
assert.equal(rgbToHex("rgba(0, 0, 0, 0)"), "");
assert.equal(rgbToHex("transparent"), "");
assert.equal(rgbToHex("#D93025"), "#d93025");
assert.equal(presetIndex("rgb(217, 48, 37)", COLORS), 1);
assert.equal(presetIndex("rgb(1, 2, 3)", COLORS), -1);
assert.equal(presetIndex("", COLORS), -1);

assert.equal(sizeIndex(15, SIZES), 2);
assert.equal(sizeIndex(15.4, SIZES), 2);
assert.equal(sizeIndex(24, SIZES), -1);
assert.equal(stepSizeIndex(15, 1, SIZES), 3);
assert.equal(stepSizeIndex(15, -1, SIZES), 1);
assert.equal(stepSizeIndex(28, 1, SIZES), 5);
assert.equal(stepSizeIndex(11, -1, SIZES), 0);
assert.equal(stepSizeIndex(40, -1, SIZES), 4); // above the top preset: step down from the end
assert.equal(stepSizeIndex(24, 1, SIZES), 5); // between presets: next larger preset

// shortcuts follow the editor-shortcut switch (P2B-02)
assert.deepEqual(formatKeyAction(ev({ altKey: true, key: "2", code: "Digit2" }), true), { type: "block", value: "2" });
assert.deepEqual(formatKeyAction(ev({ altKey: true, key: "0", code: "Digit0" }), true), { type: "block", value: "0" });
assert.deepEqual(formatKeyAction(ev({ shiftKey: true, key: ">", code: "Period" }), true), { type: "size", value: 1 });
assert.deepEqual(formatKeyAction(ev({ shiftKey: true, key: "<", code: "Comma" }), true), { type: "size", value: -1 });
assert.deepEqual(formatKeyAction(ev({ key: " ", code: "Space" }), true), { type: "clear" });
assert.deepEqual(formatKeyAction(ev({ shiftKey: true, key: "N", code: "KeyN" }), true), { type: "clear" });
assert.deepEqual(formatKeyAction(ev({ key: "-", code: "Minus" }), true), { type: "strike" });
assert.deepEqual(formatKeyAction(ev({ shiftKey: true, key: "{", code: "BracketLeft" }), true), { type: "fold", value: true });
assert.deepEqual(formatKeyAction(ev({ shiftKey: true, key: "}", code: "BracketRight" }), true), { type: "fold", value: false });
for (const e of [
  ev({ altKey: true, key: "1", code: "Digit1" }), ev({ shiftKey: true, key: ">", code: "Period" }),
  ev({ key: " ", code: "Space" }), ev({ key: "-", code: "Minus" }),
]) assert.equal(formatKeyAction(e, false), null);
assert.equal(formatKeyAction(ev({ key: "b", code: "KeyB" }), true), null); // Ctrl+B/I/U stay native
assert.equal(formatKeyAction(ev({ ctrlKey: false, key: "-", code: "Minus" }), true), null);
assert.equal(formatKeyAction(ev({ ctrlKey: false, key: " ", code: "Space" }), true), null);
assert.equal(formatKeyAction(ev({ altKey: true, key: "4", code: "Digit4" }), true), null);

assert.equal(tip("굵게", KEYS.bold, true), "굵게 · Ctrl+B");
assert.equal(tip("굵게", KEYS.bold, false), "굵게");
assert.equal(tip("표 추가", "", true), "표 추가");
console.log("PASS note format core: presets, size steps, shortcut map and shortcut switch");
