// V-003: inline formatting of the shared line editor. Each case returns true on pass. Run: node web/test/run_lineeditor_format.mjs
import * as F from "../js/lineeditor-format.js";

const st = (v, s = 0, e = s) => ({ v, s, e });
const at = (v) => { const i = v.indexOf("|"); return st(v.replace("|", ""), i); };
const sel = (v) => { const i = v.indexOf("["), j = v.indexOf("]") - 1; return st(v.replace("[", "").replace("]", ""), i, j); };
const op = (state, o) => F.run(o, state);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Canonical spellings: reading and writing them again must not change a character (original == first save == second save).
export const CANON = [
  "plain", "**bold**", "*italic*", "~~strike~~", "<u>under</u>", "<mark>yellow</mark>", '<mark style="background:#a5f3a5">green</mark>',
  '<span style="color:#d93025">red</span>', '<span style="font-size:18px">big</span>', '<span style="color:#188038;font-size:22px">both</span>',
  "a * b * c", "한글 **굵게** 와 *기울임*", "**bold** and <u>under</u> and <mark>hl</mark>", "x \\* y", "\\#tag", "5 > 3 <b>not ours</b>",
  "~~**both**~~", "tilde ~ single", "a<u>b</u>c",
];

export const cases = {
  "canonical spellings survive read -> write unchanged": () => CANON.every((t) => F.serialize(F.styledChars(t)).text === t),
  "format op on text it does not change keeps everything else byte for byte": () => {
    const v = "- [ ] a **b** <u>c</u> d → 할일 #12";
    return op(st(v, v.indexOf("d"), v.indexOf("d")), { t: "b" }).v.endsWith(" → 할일 #12") && op(st(v, 0), { t: "b" }).v.startsWith("- [ ] ");
  },
  "bold selection and toggle back": () => {
    const a = op(sel("ab[cd]ef"), { t: "b" });
    return a.v === "ab**cd**ef" && op(st(a.v, a.s, a.e), { t: "b" }).v === "abcdef";
  },
  "italic, underline, strike write the note format": () =>
    op(sel("[x]"), { t: "i" }).v === "*x*" && op(sel("[x]"), { t: "u" }).v === "<u>x</u>" && op(sel("[x]"), { t: "s" }).v === "~~x~~",
  "no selection formats the whole text of the line, not the bullet or mark": () =>
    op(at("  - [x] done thing|"), { t: "b" }).v === "  - [x] **done thing**" && op(at("- plain|"), { t: "i" }).v === "- *plain*",
  "linked task tail stays outside the markup": () =>
    op(at("- [ ] 작업 → 할일 #12|"), { t: "b" }).v === "- [ ] **작업** → 할일 #12",
  "several lines each get formatted": () => op(sel("[- a\n  - b]"), { t: "b" }).v === "- **a**\n  - **b**",
  "blank lines are left alone": () => op(sel("[a\n\nb]"), { t: "b" }).v === "**a**\n\n**b**",
  "highlight: default is the bare <mark>, other presets carry the color": () =>
    op(sel("[x]"), { t: "hl", i: 0 }).v === "<mark>x</mark>" && op(sel("[x]"), { t: "hl", i: 1 }).v === '<mark style="background:#a5f3a5">x</mark>',
  "highlight toggles off and switches color": () => {
    const a = op(sel("[x]"), { t: "hl", i: 1 });
    const b = op(st(a.v, a.s, a.e), { t: "hl", i: 2 });
    const c = op(st(b.v, b.s, b.e), { t: "hl", i: 2 });
    return b.v.includes("#a5d8ff") && c.v === "x";
  },
  "text color presets; the first one is the default (no markup)": () => {
    const a = op(sel("[x]"), { t: "color", i: 1 });
    return a.v === '<span style="color:#d93025">x</span>' && op(st(a.v, a.s, a.e), { t: "color", i: 0 }).v === "x" && op(st(a.v, a.s, a.e), { t: "color", i: 1 }).v === "x";
  },
  "size steps through the presets and base size writes nothing": () => {
    const a = op(sel("[x]"), { t: "step", dir: 1 });
    const b = op(st(a.v, a.s, a.e), { t: "step", dir: -1 });
    return a.v === '<span style="font-size:18px">x</span>' && b.v === "x";
  },
  "color and size share one span": () => {
    const a = op(sel("[x]"), { t: "color", i: 3 });
    const b = op(st(a.v, a.s, a.e), { t: "size", px: 22 });
    return b.v === '<span style="color:#188038;font-size:22px">x</span>';
  },
  "clear removes every format in the range, text stays": () => {
    const v = '**a** <u>b</u> <mark>c</mark> <span style="color:#d93025">d</span>';
    return op(st(v, 0, v.length), { t: "clear" }).v === "a b c d";
  },
  "partial selection of a formatted run splits it": () => {
    const r = op(sel("**a[b]c**"), { t: "b" });
    return r.v === "**a**b**c**";
  },
  "selection that includes markers formats the visible characters": () => {
    const v = "<u>abc</u>";
    const r = op(st(v, 0, v.length), { t: "b" });
    return F.plainText(r.v) === "abc" && F.styledChars(r.v).every((c) => c.st.b && c.st.u);
  },
  "unpaired markers are plain text and are escaped only when a format op rewrites the line": () =>
    F.plainText("unclosed **bold") === "unclosed **bold" && op(at("unclosed **bold|"), { t: "i" }).v === "*unclosed \\*\\*bold*",
  "bold + italic nest and read back": () => {
    const a = op(op(sel("[x]"), { t: "b" }), { t: "i" });
    return F.plainText(a.v) === "x" && F.styledChars(a.v).every((c) => c.st.b && c.st.i);
  },
  "literal asterisks and tags typed by the user are escaped when a format is added": () => {
    const r = op(sel("[a*b]"), { t: "b" });
    return F.plainText(r.v) === "a*b" && F.styledChars(r.v).every((c) => c.st.b);
  },
  "edge spaces are not wrapped (markers need a non-space next to them)": () => {
    const r = op(sel("[ a ]"), { t: "b" });
    return r.v === " **a** " && F.plainText(r.v) === " a ";
  },
  "selection returned after an op still selects the same text": () => {
    const r = op(sel("ab[cd]ef"), { t: "b" });
    return r.v.slice(r.s, r.e) === "cd";
  },
  "styleAt reports what the whole selection shares": () => {
    const s = F.styleAt(sel("**[ab]** c"));
    const mixed = F.styleAt(sel("[**a**b]"));
    return s.b === true && mixed.b === false && F.styleAt(at("<mark>x</mark>|")).hl === "#fff176";
  },
  "view html: only preset tags, everything else escaped": () => {
    const h = F.textToHtml('<script>x</script> **b** <span style="color:#123456">c</span> <img src=x onerror=1>');
    return !h.includes("<script") && !h.includes("<img") && h.includes("<b>b</b>") && !h.includes("<span");
  },
  "view html: sizes scale with the editor density": () => F.textToHtml('<span style="font-size:18px">x</span>').includes("var(--le-scale"),
  "view html: unknown colors and sizes are plain text": () => F.plainText('<span style="color:#123456">c</span>') === '<span style="color:#123456">c</span>',
  "plainText is what a linked task title / search sees": () =>
    F.plainText("**굵게** <u>밑줄</u> <mark>형광</mark> ~~취소~~ \\*별 <span style=\"color:#d93025;font-size:18px\">색</span>") === "굵게 밑줄 형광 취소 *별 색",
  "visible <-> raw offsets skip the markers": () => {
    const t = "a**b**c";
    return F.rawOffset(t, 0) === 0 && F.rawOffset(t, 1) === 3 && F.rawOffset(t, 2) === 6 && F.visibleIndex(t, 5) === 2 && F.rawOffset(t, 99) === t.length;
  },
  "shortcuts follow the on/off switch": () => {
    const e = { ctrlKey: true, key: "b", code: "KeyB" };
    return same(F.formatKey(e, true), { t: "b" }) && F.formatKey(e, false) === null &&
      same(F.formatKey({ ctrlKey: true, key: "i" }, true), { t: "i" }) && same(F.formatKey({ ctrlKey: true, key: "u" }, true), { t: "u" }) &&
      same(F.formatKey({ ctrlKey: true, key: "-", code: "Minus" }, true), { t: "s" }) && same(F.formatKey({ ctrlKey: true, key: " ", code: "Space" }, true), { t: "clear" }) &&
      same(F.formatKey({ ctrlKey: true, shiftKey: true, key: ".", code: "Period" }, true), { t: "step", dir: 1 }) &&
      F.formatKey({ ctrlKey: true, key: "x" }, true) === null;
  },
  "highlight action keeps working through run()": () => F.run("highlight", sel("a[b]c")).v === "a<mark>b</mark>c" && F.run("indent", at("- a\n- b|")).v === "- a\n  - b",
  "random styles survive write -> read (nesting and edge spaces)": () => {
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const alpha = ["a", "b", " ", "한", "*", "~", "<", "x"];
    for (let round = 0; round < 400; round++) {
      const len = 1 + rnd(8);
      const cs = Array.from({ length: len }, () => ({
        ch: alpha[rnd(alpha.length)], raw: undefined,
        st: { b: !!rnd(2), i: !!rnd(2), s: !!rnd(3), u: !!rnd(2), hl: rnd(3) === 0 ? "#fff176" : "", color: rnd(4) === 0 ? "#d93025" : "", size: rnd(4) === 0 ? 18 : 0 },
      }));
      const text = cs.map((c) => c.ch).join("");
      const out = F.serialize(cs.map((c) => ({ ...c, st: { ...c.st } }))).text;
      const back = F.styledChars(out);
      if (back.map((c) => c.ch).join("") !== text) return `text changed: ${JSON.stringify(text)} -> ${JSON.stringify(out)}`;
      if (F.serialize(back).text !== out) return `not stable: ${JSON.stringify(out)}`;
    }
    return true;
  },
  "round trip after an op is stable (format, save, read, save)": () => {
    const a = op(sel("한글 [테스트] 문장"), { t: "color", i: 4 });
    return F.serialize(F.styledChars(a.v)).text === a.v;
  },
};

export function runAll() {
  return Object.entries(cases).map(([name, fn]) => {
    let ok = false, err = "";
    try { ok = fn() === true; } catch (e) { err = ` (${e.message})`; }
    return { name, ok, err };
  });
}
