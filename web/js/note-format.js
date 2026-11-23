// Formatting toolbar for the note editor (P3-04, redone against the final design).
// Toggle chips and icon buttons only (D-12), inline SVG only (offline), colors from theme tokens.
// The saved format stays preset-only (D-15): every command here ends in a value htmlToMd() accepts
// (SIZES, COLORS, HLS) or in a tag it ignores. Anything else is dropped when the file is written.
import { BASE_PX, COLORS, HLS, SIZES } from "./mdconv.js";
import { editorKeys } from "./lineeditor.js";
import { KEYS, formatKeyAction, presetIndex, rgbToHex, sizeIndex, stepSizeIndex, tip } from "./note-format-core.js";

const NS = "http://www.w3.org/2000/svg";
const SIZE_NAMES = ["극소", "소", "보통", "중", "대", "특대"];
const COLOR_NAMES = ["기본색", "빨강", "주황", "초록", "파랑", "보라", "회색"];
const HL_NAMES = ["노랑", "연두", "하늘", "분홍", "살구"];
const MARKER = "#010203"; // temporary color used to reset text color to the theme default

// 24x24 stroke icons. Static strings only; nothing user-supplied reaches innerHTML.
const ICONS = {
  body: '<path d="M5 7h14M5 12h14M5 17h9"/>',
  bullet: '<path d="M10 7h10M10 12h10M10 17h10"/><path d="M4.5 7h.01M4.5 12h.01M4.5 17h.01" stroke-width="2.6"/>',
  number: '<path d="M11 7h9M11 12h9M11 17h9M4.5 5.8l1.5-1v5M4 14.2h2.3L4 17.4h2.5"/>',
  check: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M8 12.2l2.6 2.6L16.2 9"/>',
  table: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 10h17M3.5 14.5h17M10 5v14"/>',
  bold: '<path d="M7 5h5.5a3.2 3.2 0 0 1 0 6.4H7zM7 11.4h6.5a3.3 3.3 0 0 1 0 6.6H7z"/>',
  italic: '<path d="M10 5h7M7 19h7M14.6 5l-5.2 14"/>',
  underline: '<path d="M7 4.5v7a5 5 0 0 0 10 0v-7M5 20h14"/>',
  strike: '<path d="M4.5 12h15M16.2 7.6C15.6 6 14 5 12 5c-2.4 0-4.2 1.2-4.2 3.1 0 1.5 1.2 2.2 2.9 2.9M8 16.6c.6 1.5 2.2 2.4 4.2 2.4 2.5 0 4.2-1.2 4.2-3"/>',
  clear: '<path d="M8.8 19.5H19M5.4 14.6l7.2-7.2a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8l-6 6.2H8.8l-3.4-3.4a2 2 0 0 1 0-1z"/><path d="M9.2 10.8l5 5"/>',
  size: '<path d="M3.5 18l4.5-11 4.5 11M5.3 14h5.4M15.5 18l2.5-6 2.5 6M16.4 16h3.2"/>',
  color: '<path d="M6.5 16l5.5-11.5L17.5 16M8.5 12h7"/><path d="M5 20h14" stroke-width="2.4"/>',
  marker: '<path d="M14.5 5.5l4 4-8 8H6.5v-4zM13 7l4 4M4.5 20.5h15"/>',
};

function svg(name) {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("class", "i");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name];
  return s;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * Builds the toolbar into `bar` and returns the formatting commands.
 * o: { compact, schedule(), lineAction(a), insertTable(), fold(to), cleanups[] }
 */
export function mountFormatBar(ed, bar, o) {
  const run = (cmd, val) => document.execCommand(cmd, false, val);
  const caretEl = () => {
    const n = getSelection().anchorNode;
    const e = n && (n.nodeType === 3 ? n.parentElement : n);
    return e && ed.contains(e) ? e : null;
  };
  // Focus inside a table cell (textarea) or a read-only raw block: inline formatting must not run there.
  const noInline = () => {
    const a = document.activeElement;
    if (a && a !== ed && ed.contains(a) && /^(TEXTAREA|INPUT)$/.test(a.tagName)) return true;
    const c = caretEl();
    return !!(c && c.closest("[data-raw], .note-table"));
  };
  const inlineStyle = (from, prop) => {
    for (let n = from; n && n !== ed; n = n.parentElement) {
      const v = n.style && n.style[prop];
      if (v) return v;
    }
    return "";
  };

  // ---- commands
  const setBlock = (tag) => {
    const cur = caretEl()?.closest("h1,h2,h3");
    run("formatBlock", cur && cur.tagName === tag.toUpperCase() ? "div" : tag);
  };
  const setSize = (px) => {
    run("fontSize", 7);
    ed.querySelectorAll('span[style*="xxx-large"], font[size="7"]').forEach((node) => {
      let t = node;
      if (node.tagName === "FONT") {
        t = document.createElement("span");
        t.innerHTML = node.innerHTML;
        node.replaceWith(t);
      }
      t.style.fontSize = px === BASE_PX ? "" : px + "px";
      if (!t.getAttribute("style")) t.removeAttribute("style");
    });
  };
  // The saved size is a preset from SIZES; text without one renders at the editor's own size (BASE_PX).
  const curSizeIdx = () => {
    const e = caretEl();
    if (!e) return SIZES.indexOf(BASE_PX);
    const px = parseFloat(inlineStyle(e, "fontSize"));
    if (px) return sizeIndex(px, SIZES);
    return e.closest("h1,h2,h3") ? -1 : SIZES.indexOf(BASE_PX);
  };
  const stepSize = (dir) => {
    if (!caretEl()) return;
    const i = curSizeIdx();
    setSize(SIZES[stepSizeIndex(SIZES[i < 0 ? SIZES.indexOf(BASE_PX) : i], dir, SIZES)]);
  };
  const resetColor = () => {
    run("foreColor", MARKER);
    ed.querySelectorAll('span[style*="color"], font[color]').forEach((n) => {
      if (rgbToHex(n.style.color || n.getAttribute("color")) !== MARKER) return;
      n.style.removeProperty("color");
      n.removeAttribute("color");
      if (!n.getAttribute("style")) n.removeAttribute("style");
    });
  };
  const curColorIdx = () => {
    const i = presetIndex(inlineStyle(caretEl(), "color"), COLORS);
    return i < 0 ? 0 : i; // no preset on the text means the theme default
  };
  const setColor = (i) => {
    if (i === 0 || curColorIdx() === i) resetColor();
    else run("foreColor", COLORS[i]);
  };
  const curHlIdx = () => {
    const e = caretEl();
    return e ? presetIndex(inlineStyle(e, "backgroundColor"), HLS) : -1;
  };
  const setHighlight = (i) => {
    run("hiliteColor", i < 0 || curHlIdx() === i ? "transparent" : HLS[i]);
  };
  const toggleHighlight = () => setHighlight(0);
  const clearFormat = () => {
    run("removeFormat");
    run("hiliteColor", "transparent");
  };
  const exec = (name) => () => run(name);

  // ---- toolbar model
  const items = []; // {btn, label, keys, state(ctx) -> bool, always}
  const add = (parent, spec) => {
    const b = el("button", "nb" + (spec.cls ? " " + spec.cls : ""));
    b.type = "button";
    b.tabIndex = -1;
    if (spec.icon) b.append(svg(spec.icon));
    if (spec.text) b.append(el("span", "nb-tx", spec.text));
    if (spec.color) b.style.setProperty("--c", spec.color);
    if (spec.none) b.classList.add("none");
    if (spec.state) b.setAttribute("aria-pressed", "false");
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("click", () => {
      if (b.getAttribute("aria-disabled") === "true") return;
      ed.focus();
      spec.fn();
      o.schedule();
      sync();
    });
    parent.append(b);
    items.push({ btn: b, label: spec.label, keys: spec.keys, state: spec.state, always: spec.always });
    return b;
  };
  const group = (label, icon) => {
    const g = el("span", "nb-grp");
    g.setAttribute("role", "group");
    g.setAttribute("aria-label", label);
    if (icon) {
      const gi = el("span", "nb-gi");
      gi.append(svg(icon));
      g.append(gi);
    }
    bar.append(g);
    return g;
  };
  const sep = () => bar.append(Object.assign(el("span", "nb-sep"), { role: "separator" }));
  const blockIs = (tag) => (c) => (tag ? !!c.el?.closest(tag) : !c.el?.closest("h1,h2,h3"));

  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "서식 도구 모음");

  let g = group("블록");
  add(g, { icon: "body", label: "본문", keys: KEYS.body, fn: () => run("formatBlock", "div"), state: blockIs(null) });
  [["제목 1", "h1"], ["제목 2", "h2"], ["제목 3", "h3"]].forEach(([label, tag]) =>
    add(g, { text: "H" + tag[1], label, keys: KEYS[tag], fn: () => setBlock(tag), state: blockIs(tag) }));
  sep();
  g = group("목록");
  add(g, { icon: "bullet", label: "글머리 목록", keys: KEYS.bullet, fn: () => o.lineAction("bullet"), state: (c) => !!c.el?.closest("ul") && !c.el.closest("li[data-m]") });
  add(g, { icon: "number", label: "번호 목록", fn: exec("insertOrderedList"), state: (c) => !!c.el?.closest("ol") });
  add(g, { icon: "check", label: "체크 목록", fn: () => o.lineAction("check"), state: (c) => !!c.el?.closest("li[data-m]") });
  add(g, { icon: "table", label: "표 추가", fn: () => o.insertTable(), always: true });
  sep();
  g = group("글자 모양");
  add(g, { icon: "bold", label: "굵게", keys: KEYS.bold, fn: exec("bold"), state: () => document.queryCommandState("bold") });
  add(g, { icon: "italic", label: "기울임", keys: KEYS.italic, fn: exec("italic"), state: () => document.queryCommandState("italic") });
  add(g, { icon: "underline", label: "밑줄", keys: KEYS.underline, fn: exec("underline"), state: () => document.queryCommandState("underline") });
  add(g, { icon: "strike", label: "취소선", keys: KEYS.strike, fn: exec("strikeThrough"), state: () => document.queryCommandState("strikeThrough") });
  if (!o.compact) {
    sep();
    g = group("글자 크기", "size");
    SIZES.forEach((px, i) => add(g, {
      text: String(px), cls: "num", label: `글자 크기 ${px}px (${SIZE_NAMES[i]})`, keys: i === 0 ? `${KEYS.sizeUp} / ${KEYS.sizeDown}` : "",
      fn: () => setSize(curSizeIdx() === i ? BASE_PX : px),
      state: (c) => c.sizeIdx === i,
    }));
    sep();
    g = group("글자색", "color");
    COLORS.forEach((c, i) => add(g, {
      cls: "sw" + (i === 0 ? " auto" : ""), color: i ? c : "", label: `글자색 ${COLOR_NAMES[i]}`, fn: () => setColor(i),
      state: (ctx) => ctx.colorIdx === i,
    }));
  }
  sep();
  g = group("형광펜", "marker");
  add(g, { cls: "sw", none: true, label: "형광펜 없음", fn: () => setHighlight(-1), state: (c) => c.hlIdx < 0 });
  HLS.forEach((c, i) => add(g, {
    cls: "sw", color: c, label: `형광펜 ${HL_NAMES[i]}`, keys: i === 0 ? KEYS.highlight : "", fn: () => setHighlight(i),
    state: (ctx) => ctx.hlIdx === i,
  }));
  sep();
  add(bar, { icon: "clear", label: "서식 지우기", keys: KEYS.clear, fn: clearFormat });

  // shortcut switch (P2B-02): same preference as the journal and the line editor
  const sw = el("button", "nb-switch");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.append(el("span", "nb-knob"), el("span", "nb-sw-l", "단축키"));
  sw.addEventListener("mousedown", (e) => e.preventDefault());
  sw.addEventListener("click", () => editorKeys.set(!editorKeys.on));
  sw.tabIndex = -1;
  items.push({ btn: sw, label: "편집기 단축키", keys: "", nostate: true });

  const retip = () => {
    const on = editorKeys.on;
    for (const it of items) {
      const t = it.btn === sw ? `편집기 단축키 ${on ? "켜짐" : "꺼짐"} · 눌러서 ${on ? "끄기" : "켜기"}` : tip(it.label, it.keys, on);
      it.btn.title = t;
      it.btn.setAttribute("aria-label", it.btn === sw ? "편집기 단축키" : it.label);
    }
    sw.setAttribute("aria-checked", String(on));
  };
  retip();
  o.cleanups.push(editorKeys.subscribe(retip));

  // ---- state: reflect the caret's formatting in the chips
  const read = () => {
    const sel = getSelection();
    const inside = sel.rangeCount > 0 && ed.contains(sel.anchorNode);
    const e = inside ? caretEl() : null;
    return {
      el: e, raw: inside ? noInline() : false,
      sizeIdx: e ? curSizeIdx() : -1,
      colorIdx: e ? curColorIdx() : 0,
      hlIdx: e ? curHlIdx() : -1,
    };
  };
  function sync() {
    const ctx = read();
    for (const it of items) {
      if (it.btn === sw) continue;
      const off = ctx.raw && !it.always;
      if (off) it.btn.setAttribute("aria-disabled", "true");
      else it.btn.removeAttribute("aria-disabled");
      if (it.state) it.btn.setAttribute("aria-pressed", String(!off && !!ctx.el && !!it.state(ctx)));
    }
  }
  let raf = 0;
  const queue = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); };
  const onSel = () => { if (ed.contains(getSelection().anchorNode)) queue(); };
  document.addEventListener("selectionchange", onSel);
  ed.addEventListener("focusin", queue);
  ed.addEventListener("focusout", queue);
  o.cleanups.push(() => { document.removeEventListener("selectionchange", onSel); cancelAnimationFrame(raf); });

  // ---- keyboard: arrow keys move through the toolbar (roving tabindex), Esc returns to the text
  const live = () => items.map((i) => i.btn);
  const setStop = (b) => live().forEach((x) => { x.tabIndex = x === b ? 0 : -1; });
  setStop(items[0].btn);
  bar.addEventListener("focusin", (e) => { if (live().includes(e.target)) setStop(e.target); });
  bar.addEventListener("keydown", (e) => {
    const all = live();
    const i = all.indexOf(document.activeElement);
    if (i < 0) return;
    let to = -1;
    if (e.key === "ArrowRight") to = (i + 1) % all.length;
    else if (e.key === "ArrowLeft") to = (i - 1 + all.length) % all.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = all.length - 1;
    else if (e.key === "Escape") { e.preventDefault(); ed.focus(); return; }
    if (to < 0) return;
    e.preventDefault();
    setStop(all[to]);
    all[to].focus();
  });
  bar.append(sw);

  /** Handle a note shortcut. Returns true when the event was consumed. */
  function handleKey(e) {
    const a = formatKeyAction(e, editorKeys.on);
    if (!a) return false;
    if (a.type === "fold") {
      e.preventDefault();
      o.fold(a.value);
      return true;
    }
    if (noInline()) return false;
    e.preventDefault();
    if (a.type === "block") a.value === "0" ? run("formatBlock", "div") : setBlock("h" + a.value);
    else if (a.type === "size") stepSize(a.value);
    else if (a.type === "clear") clearFormat();
    else if (a.type === "strike") run("strikeThrough");
    o.schedule();
    queue();
    return true;
  }

  return { handleKey, toggleHighlight, sync: queue, syncNow: sync, shortcutSwitch: sw };
}
