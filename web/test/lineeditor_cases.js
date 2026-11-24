// Shared by lineeditor.html (browser) and run_lineeditor.mjs (node). Each case returns true on pass.
import * as C from "../js/lineeditor-core.js";
import * as F from "../js/lineeditor-format.js";

const st = (v, s = 0, e = s) => ({ v, s, e });
const at = (v) => { const i = v.indexOf("|"); return st(v.replace("|", ""), i); };
const sel = (v) => { const i = v.indexOf("["), j = v.indexOf("]") - 1; return st(v.replace("[", "").replace("]", ""), i, j); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const cases = {
  "parse + build roundtrip": () => ["  - [x] 완료", "- 불렛", "일반", "- [*] 별", "- [!] 긴급"].every((l) => C.buildLine(C.parseLine(l)) === l),
  "indent capped by previous line": () => C.indent(at("- a\n- b|"), 1).v === "- a\n  - b" && C.indent(at("- a|"), 1).v === "- a",
  "indent twice does not exceed parent+1": () => { const r = C.indent(C.indent(at("- a\n- b|"), 1), 1); return r.v === "- a\n  - b"; },
  "outdent": () => C.indent(at("- a\n    - b|"), -1).v === "- a\n  - b",
  "multi-line indent keeps relative depth": () => C.indent(sel("- a\n[- b\n  - c]"), 1).v === "- a\n  - b\n    - c",
  "bullet toggle": () => C.toggleBullet(at("text|")).v === "- text" && C.toggleBullet(at("- [ ] x|")).v === "x",
  "cycle order none->todo->done->star->urgent->none": () => {
    let s = at("hello|"); const seen = [];
    for (let i = 0; i < 5; i++) { s = C.cycleMark(s); seen.push(s.v); }
    return same(seen, ["- [ ] hello", "- [x] hello", "- [*] hello", "- [!] hello", "- hello"]);
  },
  "cycle on several lines": () => C.cycleMark(sel("[a\nb]")).v === "- [ ] a\n- [ ] b",
  "done toggle": () => C.toggleDone(at("- [ ] a|")).v === "- [x] a" && C.toggleDone(at("- [x] a|")).v === "- [ ] a",
  "star toggle": () => C.setMark(at("a|"), "*").v === "- [*] a" && C.setMark(at("- [*] a|"), "*").v === "- a",
  "highlight selection wrap/unwrap": () => {
    const w = F.run("highlight", sel("ab[cd]ef"));
    return w.v === "ab<mark>cd</mark>ef" && F.run("highlight", st(w.v, w.s, w.e)).v === "abcdef";
  },
  "highlight whole line when no selection": () => F.run("highlight", at("- [ ] task|")).v === "- [ ] <mark>task</mark>" && F.run("highlight", at("<mark>x</mark>|")).v === "x",
  "move block down with children": () => C.moveBlock(at("- a|\n  - a1\n- b"), 1).v === "- b\n- a\n  - a1",
  "move block up": () => C.moveBlock(at("- a\n  - a1\n- b|"), -1).v === "- b\n- a\n  - a1",
  "move blocked at edges / parent": () => C.moveBlock(at("- a|\n- b"), -1) === null && C.moveBlock(at("- a\n  - x|"), -1) === null && C.moveBlock(at("- a\n  - x|"), 1) === null,
  "move keeps caret in same block": () => { const r = C.moveBlock(at("- a|\n- b"), 1); return r.v === "- b\n- a" && r.s === 7; },
  "enter continues bullet, drops mark": () => C.enter(at("  - [x] done|")).v === "  - [x] done\n  - " && C.enter(at("  - [x] done|")).s === 17,
  "enter splits text": () => C.enter(at("- ab|cd")).v === "- ab\n- cd",
  "enter on plain line defers to browser": () => C.enter(at("plain|")) === null,
  "enter on empty nested bullet outdents": () => C.enter(at("- a\n  - |")).v === "- a\n- ",
  "enter on empty top bullet removes bullet": () => C.enter(at("- a\n- |")).v === "- a\n",
  "backspace peels mark, bullet, indent": () => {
    let s = at("  - [ ] x");
    s = st(s.v, 8); // right after the mark prefix
    const a = C.backspace(s); const b = C.backspace(st(a.v, a.s)); const c = C.backspace(st(b.v, b.s));
    return a.v === "  - x" && b.v === "  x" && c.v === "x";
  },
  "keyAction: Tab always, others gated": () =>
    C.keyAction({ key: "Tab" }, false) === "indent" && C.keyAction({ key: "Tab", shiftKey: true }, false) === "outdent" &&
    C.keyAction({ key: "1", code: "Digit1", ctrlKey: true }, false) === null && C.keyAction({ key: "1", code: "Digit1", ctrlKey: true }, true) === "cycle",
  "keyAction: reserved-key alternatives": () =>
    C.keyAction({ key: "1", code: "Digit1", altKey: true }, true) === "cycle" && C.keyAction({ key: "1", code: "Digit1", ctrlKey: true, altKey: true }, true) === "cycle" &&
    C.keyAction({ key: "H", code: "KeyH", altKey: true, shiftKey: true }, true) === "highlight" && C.keyAction({ key: "ArrowUp", altKey: true }, true) === "up",
  "html rendering escapes everything but the preset markup": () => F.textToHtml("<script>x</script> <mark>y</mark>") === "&lt;script&gt;x&lt;/script&gt; <mark>y</mark>",
};

export function runAll() {
  return Object.entries(cases).map(([name, fn]) => {
    let ok = false, err = "";
    try { ok = fn() === true; } catch (e) { err = ` (${e.message})`; }
    return { name, ok, err };
  });
}
