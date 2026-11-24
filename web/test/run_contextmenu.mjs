import assert from "node:assert/strict";
import {
  buildItems, createTypeBuffer, focusable, keyStep, moveIndex, placeMenu, placeSubmenu, typeaheadIndex,
} from "../js/contextmenu-core.js";

// ---- placement
const vp = { vw: 1000, vh: 700 };
assert.deepEqual(placeMenu({ x: 100, y: 100, w: 220, h: 300, ...vp }), { left: 100, top: 100, maxHeight: 684, flipX: false, flipY: false, scroll: false });
let p = placeMenu({ x: 900, y: 100, w: 220, h: 300, ...vp }); // no room on the right: opens to the left of the pointer
assert.equal(p.left, 680); assert.equal(p.flipX, true);
p = placeMenu({ x: 100, y: 600, w: 220, h: 300, ...vp }); // no room below: opens upward
assert.equal(p.top, 300); assert.equal(p.flipY, true);
p = placeMenu({ x: 100, y: 200, w: 220, h: 640, ...vp }); // taller than the room on both sides: clamped, height capped
assert.equal(p.top, 52); assert.equal(p.maxHeight, 684); assert.equal(p.scroll, false); // bottom aligned
p = placeMenu({ x: 100, y: 200, w: 220, h: 900, ...vp });
assert.equal(p.scroll, true); assert.equal(p.top, 8);
p = placeMenu({ x: 5, y: 5, w: 220, h: 100, ...vp }); // stays inside the margin
assert.equal(p.left, 8); assert.equal(p.top, 8);
p = placeMenu({ x: 990, y: 690, w: 220, h: 100, ...vp });
assert.ok(p.left >= 8 && p.left + 220 <= 992 && p.top >= 8 && p.top + 100 <= 692);
p = placeMenu({ x: 10, y: 10, w: 400, h: 100, vw: 300, vh: 200 }); // narrower than the menu: pinned to the margin
assert.equal(p.left, 8);

const anchor = { left: 100, right: 320, top: 200, bottom: 230 };
let sp = placeSubmenu({ anchor, w: 200, h: 200, ...vp });
assert.equal(sp.left, 316); assert.equal(sp.top, 194); assert.equal(sp.flipX, false);
sp = placeSubmenu({ anchor: { ...anchor, left: 700, right: 920 }, w: 200, h: 200, ...vp });
assert.equal(sp.flipX, true); assert.equal(sp.left, 504);
sp = placeSubmenu({ anchor: { ...anchor, top: 620, bottom: 650 }, w: 200, h: 200, ...vp });
assert.equal(sp.top, 492); // shifted up to fit

// ---- items
const run = () => {};
const built = buildItems([
  [{ label: "A", run }, { label: "숨김", hidden: true, run }],
  [],
  [{ header: "머리" }],                                    // header alone: group disappears
  [{ separator: true }, { label: "B", run, disabled: "이유" }, { separator: true }],
  [{ label: "삭제", danger: true, run }, { label: "하위", items: [{ label: "x", run }] }, { label: "빈 하위", items: [{ label: "y", hidden: true }] }],
  [{ label: "체크", checked: false, run }, { label: "라디오", radio: true, checked: true, run }],
]);
assert.deepEqual(built.map((i) => i.type === "separator" ? "-" : i.label), ["A", "-", "B", "-", "삭제", "하위", "빈 하위", "-", "체크", "라디오"]);
assert.equal(built[2].disabled, true); assert.equal(built[2].hint, "이유");
assert.equal(built[4].danger, true); assert.equal(built[4].icon, "alert"); // danger always carries an icon
assert.equal(built[5].items.length, 1);
assert.equal(built[6].disabled, true); assert.equal(built[6].items, null); // submenu with nothing to offer is disabled
assert.equal(built[8].role, "menuitemcheckbox"); assert.equal(built[8].checked, false);
assert.equal(built[9].role, "menuitemradio");
assert.deepEqual(buildItems([[{ label: "x", hidden: true }]]), []);
assert.deepEqual(buildItems(null), []);
assert.equal(buildItems([{ label: "단일", run }])[0].label, "단일");
// a note after items keeps its place; a trailing separator never survives
const withNote = buildItems([[{ label: "A", run }], [{ note: "안내" }]]);
assert.deepEqual(withNote.map((i) => i.type), ["item", "separator", "note"]);

// ---- keyboard model
const items = buildItems([[{ label: "복사", run }, { label: "붙여넣기", run, disabled: true }], [{ label: "삭제", run }, { label: "서식", items: [{ label: "굵게", run }] }]]);
assert.deepEqual(focusable(items), [0, 1, 3, 4]); // disabled items stay reachable
assert.equal(moveIndex(items, -1, "ArrowDown"), 0);
assert.equal(moveIndex(items, -1, "ArrowUp"), 4);
assert.equal(moveIndex(items, 1, "ArrowDown"), 3); // skips the separator
assert.equal(moveIndex(items, 4, "ArrowDown"), 0); // wraps
assert.equal(moveIndex(items, 0, "ArrowUp"), 4);
assert.equal(moveIndex(items, 3, "Home"), 0);
assert.equal(moveIndex(items, 0, "End"), 4);
assert.equal(moveIndex([], 0, "ArrowDown"), -1);

assert.deepEqual(keyStep(items, 0, "Enter"), { act: "activate", index: 0 });
assert.deepEqual(keyStep(items, 0, " "), { act: "activate", index: 0 });
assert.equal(keyStep(items, 1, "Enter").act, "none"); // disabled
assert.equal(keyStep(items, 4, "Enter").act, "open"); // submenu parent
assert.equal(keyStep(items, 4, "ArrowRight").act, "open");
assert.equal(keyStep(items, 0, "ArrowRight").act, "none");
assert.equal(keyStep(items, 0, "ArrowLeft").act, "none"); // root: nothing to go back to
assert.equal(keyStep(items, 0, "ArrowLeft", { level: 1 }).act, "back");
assert.equal(keyStep(items, 0, "Escape").act, "close");
assert.equal(keyStep(items, 0, "Escape", { level: 1 }).act, "back"); // Esc leaves the submenu first
assert.equal(keyStep(items, 0, "Tab").act, "close");
assert.equal(keyStep(items, 0, "ArrowDown").index, 1);
assert.equal(keyStep(items, -1, "Enter").act, "none");

// ---- typeahead
const list = buildItems([[{ label: "복사", run }, { label: "붙여넣기", run }, { label: "Bold", run }, { label: "bullet", run }, { label: "삭제", run }]]);
assert.equal(typeaheadIndex(list, -1, "붙"), 1);
assert.equal(typeaheadIndex(list, 0, "삭"), 4);
assert.equal(typeaheadIndex(list, 2, "b"), 2); // already on a match: stay while typing a longer prefix
assert.equal(typeaheadIndex(list, 2, "bb"), 3); // repeated letter cycles to the next match
assert.equal(typeaheadIndex(list, 3, "bb"), 2);
assert.equal(typeaheadIndex(list, 0, "zz"), -1);
assert.equal(typeaheadIndex(list, 0, ""), -1);
const buf = createTypeBuffer(700);
assert.equal(buf.push("붙", 1000), "붙");
assert.equal(buf.push("여", 1300), "붙여");
assert.equal(buf.push("삭", 2500), "삭"); // pause longer than 700 ms starts over
console.log("contextmenu ok");
