// Shared line editor (P2B-02, D-21): used by the today screen and the monthly journal cells.
// View mode renders lines (bullets, marks, inline formatting, fold); one click switches to a plain-text editor
// whose keys follow lineeditor-core.js. Double click opens the whole text in a side sheet.
// Inline formatting (V-003) is the note editor's saved markup, written by lineeditor-format.js; the chips, shortcuts and
// presets are the note toolbar's (note-format-core.js, mdconv.js), so the two editors never drift apart.
import { KEY_HELP, foldInfo, keyAction, parseLine, toggleDoneRaw } from "./lineeditor-core.js";
import { formatKey, rawOffset, run, splitLine, styleAt, textToHtml } from "./lineeditor-format.js";
import { pasteToLines } from "./lineeditor-paste.js";
import { BASE_PX, COLORS, HLS, SIZES } from "./mdconv.js";
import { KEYS, tip } from "./note-format-core.js";
import { isMenuOpen, registerContext, textGroup } from "./contextmenu.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const SVG = {
  star: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9-4.3-4.1 5.9-.8z",
  mark: "M5 12.5l4.2 4.2L19 7",
  bullet: "M8 7h11M8 12h11M8 17h11M4.5 7h.01M4.5 12h.01M4.5 17h.01",
  indent: "M4 6h16M12 12h8M12 18h8M4 9l4 3-4 3z",
  outdent: "M4 6h16M12 12h8M12 18h8M8 9l-4 3 4 3z",
  up: "M12 19V6M6.5 11.5L12 6l5.5 5.5",
  down: "M12 5v13M6.5 12.5L12 18l5.5-5.5",
  help: "M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01",
  hl: "M5 19h14M8 15l7-9 3 2.3-7 9H8z",
  grip: "M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01",
  clear: "M8.8 19.5H19M5.4 14.6l7.2-7.2a2 2 0 0 1 2.8 0l2.6 2.6a2 2 0 0 1 0 2.8l-6 6.2H8.8l-3.4-3.4a2 2 0 0 1 0-1zM9.2 10.8l5 5",
  more: "M7 10l5 5 5-5",
};
function icon(name, filled) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", SVG[name]);
  if (filled) p.setAttribute("fill", "currentColor");
  s.append(p);
  return s;
}

// ---- shared preferences (per browser; localStorage may be blocked) ---------------
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

export const editorKeys = {
  on: store.get("mi.editorKeys", "on") !== "off",
  subs: new Set(),
  set(v) { this.on = v; store.set("mi.editorKeys", v ? "on" : "off"); this.subs.forEach((f) => f(v)); },
  subscribe(f) { this.subs.add(f); return () => this.subs.delete(f); },
};

let folded = new Set();
try { folded = new Set(JSON.parse(store.get("mi.folds", "[]"))); } catch { /* ignore */ }
const saveFolds = () => store.set("mi.folds", JSON.stringify([...folded].slice(-500)));

// ---- applying a text change while keeping the browser's undo stack ------------------
function applyState(ta, next) {
  const old = ta.value;
  if (old !== next.v) {
    let p = 0;
    const max = Math.min(old.length, next.v.length);
    while (p < max && old[p] === next.v[p]) p++;
    let q = 0;
    while (q < max - p && old[old.length - 1 - q] === next.v[next.v.length - 1 - q]) q++;
    const repl = next.v.slice(p, next.v.length - q);
    ta.setSelectionRange(p, old.length - q);
    let ok = false;
    try { ok = repl ? document.execCommand("insertText", false, repl) : document.execCommand("delete"); } catch { ok = false; }
    if (!ok || ta.value !== next.v) ta.value = next.v;
  }
  ta.setSelectionRange(next.s, next.e);
}

const fit = (ta) => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + 2 + "px"; };

// ---- help dialog (shortcut list + live key check) ------------------------------------
let helpDlg = null;
function openHelp() {
  if (!helpDlg) {
    helpDlg = el("dialog", "le-help");
    const head = el("div", "le-help-head");
    head.append(el("strong", "", "줄 편집 단축키"));
    const close = el("button", "le-btn", "닫기");
    close.type = "button";
    close.addEventListener("click", () => helpDlg.close());
    head.append(close);
    const tbl = el("div", "le-keys");
    for (const [name, keys, always] of KEY_HELP) {
      tbl.append(el("div", "le-keyname", name));
      const k = el("div", "le-keycaps");
      keys.split(" · ").forEach((x) => k.append(el("kbd", "", x)));
      if (always) k.append(el("span", "le-always", "항상"));
      tbl.append(k);
    }
    const diag = el("div", "le-diag");
    diag.tabIndex = 0;
    const out = el("div", "le-diag-out", "여기를 누른 채 키 조합을 눌러 보세요.");
    diag.append(el("b", "", "키 확인"), out);
    diag.addEventListener("keydown", (e) => {
      if (e.key === "Escape") return;
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
      e.preventDefault();
      const act = formatKey(e, true) || keyAction(e, true);
      const combo = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta", e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
      out.textContent = `${combo} → 앱이 받았습니다${act ? ` (기능: ${ACTION_LABEL[act.t || act]})` : ""}`;
    });
    const note = el("p", "le-help-note", "아무 반응이 없는 조합은 브라우저가 먼저 가져간 키입니다. 그때는 Ctrl+1 대신 Alt+1 또는 Ctrl+Alt+1을 쓰세요.");
    helpDlg.append(head, tbl, diag, note);
    helpDlg.addEventListener("click", (e) => { if (e.target === helpDlg) helpDlg.close(); });
    document.body.append(helpDlg);
  }
  helpDlg.showModal();
}
const ACTION_LABEL = { b: "굵게", i: "기울임", u: "밑줄", s: "취소선", clear: "서식 지우기", step: "글자 크기", indent: "들여쓰기", outdent: "내어쓰기", bullet: "불렛", cycle: "표시 순환", done: "완료 전환", star: "별표", highlight: "형광펜", up: "위로 이동", down: "아래로 이동", enter: "새 줄", backspace: "표시 해제" };

// A line linked to a task ends with " → 할일 #12" (P2B-05). The chip shows the live task info.
const LINK_RE = /\s*→ 할일 #(\d+)\s*$/;
const mdShort = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

function taskChip(id, info) {
  const chip = el("button", "le-tid");
  chip.type = "button";
  chip.dataset.act = "task";
  chip.title = "이슈 상세 열기 (더블클릭)";
  chip.append(el("span", "le-tid-id", `#${id}`));
  if (info?.due_date && info.status !== "done") {
    const n = Math.round((new Date(info.due_date + "T00:00:00") - new Date(new Date().toDateString())) / 864e5);
    const late = n < 0, soon = n >= 0 && n <= 3;
    chip.append(el("span", "le-tid-due" + (late ? " late" : soon ? " soon" : ""),
      late ? `납기 ${-n}일 지남` : n === 0 ? "오늘 납기" : soon ? `D-${n}` : `${mdShort(info.due_date)} 납기`));
  }
  if (info?.requester) chip.append(el("span", "le-tid-req", info.requester));
  return chip;
}

const SIZE_NAMES = ["극소", "소", "보통", "중", "대", "특대"];
const COLOR_NAMES = ["기본색", "빨강", "주황", "초록", "파랑", "보라", "회색"];
const HL_NAMES = ["노랑", "연두", "하늘", "분홍", "살구"];

// ---- the editor -------------------------------------------------------------------------
// opts: { value, save(text)->Promise<string|void> (a returned string replaces the text when the server normalized it),
//         taskInfo(id)->task|undefined, onOpenTask(id), linkGrip,
//         value, save(text)->Promise, placeholder, toolbar, expand:{title}|null, foldKey, lineExtra(raw, idx)->Node|null,
//         onState(kind: "saving"|"saved"|"error", message), sheet }
export function mountLineEditor(host, opts) {
  let value = opts.value || "";
  let editing = null; // textarea while editing
  let timer = null;
  let dirty = false;
  let chain = Promise.resolve();
  const ctl = {};
  let sheetHook = null; // status text of the open side sheet
  const cleanups = [];
  let composing = false; // Korean IME composition: rich paste stays out of the way
  let fmt = null; // inline formatting chips of this editor (the full bar's, or the strip under a cell's textarea)
  const emit = (kind, msg) => { opts.onState?.(kind, msg); sheetHook?.(kind, msg); };

  host.classList.add("le");
  const bar = opts.toolbar ? buildBar() : null;
  const body = el("div", "le-body");
  host.replaceChildren(...(bar ? [bar, body] : [body]));

  // -- persistence (saves run one after another so an older PUT never overwrites a newer one)
  let pending = 0;
  function persist(text) {
    value = text;
    pending++;
    emit("saving", "저장 중…");
    chain = chain
      .then(() => opts.save(text))
      .then((normalized) => {
        pending--;
        if (value !== text) return;
        if (typeof normalized === "string" && normalized !== text && !editing) { value = normalized; paintView(); }
        emit("saved", "저장됨");
      })
      .catch((e) => { pending--; emit("error", `저장 실패: ${e.message}`); });
    return chain;
  }
  ctl.persist = persist;
  ctl.isBusy = () => pending > 0 || !!editing || dirty;

  async function flush() {
    clearTimeout(timer);
    if (editing && dirty) { dirty = false; await persist(editing.value); }
    else await chain;
  }
  ctl.flush = flush;
  ctl.getValue = () => (editing ? editing.value : value);
  ctl.setValue = (t) => { value = t; if (!editing) paintView(); };
  ctl.isEditing = () => !!editing;
  ctl.expand = () => { if (opts.expand) openSheet(editing ? editing.selectionStart : value.length); };

  // -- view mode
  function paintView() {
    const lines = value.split("\n");
    const kids = foldInfo(lines);
    const view = el("div", "le-view");
    view.tabIndex = 0;
    view.setAttribute("role", "textbox");
    view.setAttribute("aria-label", "줄 편집 영역 — 클릭하거나 Enter로 편집");
    if (!value.trim()) {
      view.classList.add("empty");
      view.append(el("span", "le-ph", opts.placeholder ?? "눌러서 쓰기 — 불렛으로 쭉 쓰고 Ctrl+1로 ☐"));
    }
    const fkey = (raw) => `${opts.foldKey || ""}|${raw.trim()}`;
    for (let i = 0; value.trim() && i < lines.length; i++) {
      const raw = lines[i];
      const p = parseLine(raw);
      const row = el("div", "le-line");
      row.dataset.idx = String(i);
      const link = p.text.match(LINK_RE);
      if (link) { row.dataset.tid = link[1]; row.classList.add("linked"); }
      row.style.setProperty("--d", String(Math.floor(p.ind / 2)));
      if (p.ind >= 2) row.classList.add("nested");
      if (!raw.trim()) { row.classList.add("blank"); view.append(row); continue; }
      const isFolded = kids[i] > 0 && folded.has(fkey(raw));
      const gutter = el("span", "le-gut");
      if (kids[i] > 0) {
        const f = el("button", "le-fold");
        f.type = "button";
        f.dataset.act = "fold";
        f.setAttribute("aria-expanded", String(!isFolded));
        f.setAttribute("aria-label", isFolded ? "하위 줄 펼치기" : "하위 줄 접기");
        f.append(icon("down"));
        f.classList.toggle("closed", isFolded);
        gutter.append(f);
      }
      row.append(gutter);
      // one fixed marker column for every kind (bullet, box, star, urgent) and every level: levels differ by indent only
      const mk = el("span", "le-mk");
      if (p.mark) {
        const m = el("button", "le-mark m" + ({ " ": "todo", x: "done", "*": "star", "!": "urgent" })[p.mark]);
        m.type = "button";
        m.dataset.act = "mark";
        m.setAttribute("aria-label", { " ": "할일 — 눌러서 완료", x: "완료 — 눌러서 되돌리기", "*": "중요 — 눌러서 완료", "!": "긴급 — 눌러서 완료" }[p.mark]);
        if (p.mark === "x") m.append(icon("mark"));
        else if (p.mark === "*") m.append(icon("star", true));
        else if (p.mark === "!") m.textContent = "!";
        mk.append(m);
      } else if (p.bullet) mk.append(el("span", "le-dot"));
      if (p.mark || p.bullet) row.append(mk);
      const t = el("span", "le-text");
      t.innerHTML = textToHtml(link ? p.text.slice(0, link.index) : p.text) || "";
      if (p.mark === "x") t.classList.add("done");
      row.append(t);
      if (isFolded) row.append(el("span", "le-pill", `⋯ ${kids[i]}줄`));
      if (link) {
        row.append(taskChip(link[1], opts.taskInfo?.(link[1])));
        if (opts.linkGrip) {
          const grip = el("span", "le-grip");
          grip.draggable = true;
          grip.title = "끌어서 다른 날짜로 옮기기";
          grip.setAttribute("aria-label", "다른 날짜로 옮기기");
          grip.append(icon("grip"));
          grip.addEventListener("dragstart", (e) => {
            e.dataTransfer.setData("application/x-mi-task", link[1]);
            e.dataTransfer.setData("text/plain", `#${link[1]}`);
            e.dataTransfer.effectAllowed = "move";
            row.classList.add("dragging");
            requestAnimationFrame(() => document.body.classList.add("dragging-task"));
          });
          grip.addEventListener("dragend", () => { row.classList.remove("dragging"); document.body.classList.remove("dragging-task"); });
          row.append(grip);
        }
      }
      const extra = opts.lineExtra?.(raw, i);
      if (extra) row.append(extra);
      view.append(row);
      if (isFolded) i += kids[i];
    }
    body.replaceChildren(view);
    view.addEventListener("click", onViewClick);
    view.addEventListener("dblclick", onDblClick);
    view.addEventListener("keydown", (e) => {
      if (e.target === view && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); startEdit(value.length); }
    });
  }

  function rewriteLine(idx, fn) {
    const lines = value.split("\n");
    lines[idx] = fn(lines[idx]);
    persist(lines.join("\n"));
    paintView();
  }

  function onViewClick(e) {
    if (e.target.closest(".jpromote")) return;
    const act = e.target.closest("[data-act]");
    const row = e.target.closest(".le-line");
    if (act && row) {
      e.stopPropagation();
      const idx = +row.dataset.idx;
      if (act.dataset.act === "mark") rewriteLine(idx, toggleDoneRaw);
      else if (act.dataset.act === "task") opts.onOpenTask?.(Number(row.dataset.tid));
      else {
        const k = `${opts.foldKey || ""}|${value.split("\n")[idx].trim()}`;
        folded.has(k) ? folded.delete(k) : folded.add(k);
        saveFolds();
        paintView();
      }
      return;
    }
    if (e.detail > 1) return; // second click of a double click: handled by dblclick
    const lines = value.split("\n");
    if (!row) return startEdit(value.length);
    const idx = +row.dataset.idx;
    let off = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
    const raw = lines[idx];
    let col = raw.length;
    const textEl = row.querySelector(".le-text");
    if (textEl) {
      const r = caretFromPoint(e.clientX, e.clientY);
      if (r && textEl.contains(r.node)) {
        // rendered characters -> raw offset (formatting markers are skipped)
        const range = document.createRange();
        range.selectNodeContents(textEl);
        range.setEnd(r.node, r.offset);
        const { head, body: text } = splitLine(raw);
        col = Math.min(raw.length, head.length + rawOffset(text, range.toString().length));
      }
    }
    startEdit(off + col);
  }

  function onDblClick(e) {
    const linked = e.target.closest(".le-line[data-tid]");
    if (linked && opts.onOpenTask && !e.target.closest("[data-act=mark],[data-act=fold]")) {
      e.preventDefault();
      opts.onOpenTask(Number(linked.dataset.tid));
      return;
    }
    if (!opts.expand || e.target.closest("[data-act]")) return;
    e.preventDefault();
    openSheet(editing ? editing.selectionStart : value.length);
  }

  // -- edit mode
  const touched = () => {
    dirty = true;
    fit(editing);
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  };

  function endEdit(ta) {
    if (editing !== ta) return;
    editing = null;
    host.classList.remove("editing");
    if (!bar) { fmt?.el.remove(); fmt = null; } else fmtSync();
    value = ta.value;
    paintView();
  }

  function startEdit(caret) {
    if (editing) return;
    const ta = el("textarea", "le-ta");
    ta.value = value;
    ta.spellcheck = false;
    ta.rows = 3;
    ta.setAttribute("aria-label", "줄 편집 — Tab 들여쓰기, Esc로 나가기");
    editing = ta;
    host.classList.add("editing");
    if (!bar) { fmt = buildFormat(true); body.replaceChildren(ta, fmt.el); } else body.replaceChildren(ta);
    ta.focus();
    const c = Math.min(caret ?? value.length, value.length);
    ta.setSelectionRange(c, c);
    fit(ta);
    ta.addEventListener("input", touched);
    ta.addEventListener("blur", async () => {
      if (isMenuOpen()) { // the context menu took focus: stay in edit mode until it closes
        const wait = setInterval(() => {
          if (isMenuOpen()) return;
          clearInterval(wait);
          if (editing === ta && document.activeElement !== ta) ta.dispatchEvent(new Event("blur"));
        }, 120);
        return;
      }
      await flush();
      endEdit(ta);
    });
    ta.addEventListener("keyup", fmtSync);
    ta.addEventListener("mouseup", fmtSync);
    ta.addEventListener("focus", fmtSync);
    ta.addEventListener("select", fmtSync);
    ta.addEventListener("compositionstart", () => { composing = true; });
    ta.addEventListener("compositionend", () => { composing = false; });
    ta.addEventListener("paste", (e) => {
      if (composing || e.isComposing) return;
      const html = e.clipboardData?.getData("text/html") || "";
      const text = html.trim() ? pasteToLines({ html, text: e.clipboardData.getData("text/plain") }) : null;
      if (text === null) return; // plain text: the browser's own paste
      e.preventDefault();
      pasteLines(ta, text);
    });
    ta.addEventListener("dblclick", (e) => {
      if (!opts.expand) return;
      e.preventDefault();
      openSheet(ta.selectionStart);
    });
    ta.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return; // Korean IME composition
      if (e.key === "Escape" && !opts.sheet) { e.preventDefault(); ta.blur(); return; }
      const op = formatKey(e, editorKeys.on);
      if (op) { e.preventDefault(); e.stopPropagation(); doOp(op); return; }
      const action = keyAction(e, editorKeys.on);
      if (!action) return;
      const next = run(action, { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
      if (!next) {
        // Edge cases: let the browser handle Enter/Backspace; swallow reserved shortcuts so focus never leaves.
        if (action === "enter" || action === "backspace") return;
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      applyState(ta, next);
      touched();
      fmtSync();
    });
  }

  // Pasted rich text arrives as the note's markup, one row per line; an empty bullet line is replaced and the level kept.
  function pasteLines(ta, text) {
    const { value: v, selectionStart: s, selectionEnd: e } = ta;
    const a = v.lastIndexOf("\n", s - 1) + 1;
    let b = v.indexOf("\n", s);
    if (b < 0) b = v.length;
    const p = parseLine(v.slice(a, b));
    const multi = text.includes("\n") || /^ *[-*] /.test(text);
    let from = s;
    let out = text;
    if (multi && s === e && !p.text.trim() && s - a >= v.slice(a, b).length) { // an empty line / empty bullet
      from = a;
      out = text.split("\n").map((l) => " ".repeat(p.ind) + l).join("\n");
    }
    ta.setSelectionRange(from, e);
    let ok = false;
    try { ok = document.execCommand("insertText", false, out); } catch { ok = false; }
    if (!ok) ta.setRangeText(out, from, e, "end");
    touched();
    fmtSync();
  }
  ctl.edit = startEdit;

  // -- toolbar
  function buildBar() {
    const b = el("div", "le-bar");
    b.setAttribute("role", "toolbar");
    b.setAttribute("aria-label", "줄 편집 도구");
    const act = (name, title, content, action) => {
      const btn = el("button", "le-btn");
      btn.type = "button";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.append(content);
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the caret in the text
      btn.addEventListener("click", () => doAction(action));
      btn.dataset.name = name;
      b.append(btn);
      return btn;
    };
    act("star", "별표 (Ctrl+Alt+S)", icon("star"), "star");
    const m = el("span", "le-cyc", "☐");
    act("cycle", "표시 순환 ☐ ☑ ★ ! (Ctrl+1 · Alt+1)", m, "cycle");
    act("bullet", "불렛 (Ctrl+.)", icon("bullet"), "bullet");
    b.append(el("span", "le-sep"));
    act("outdent", "내어쓰기 (Shift+Tab)", icon("outdent"), "outdent");
    act("indent", "들여쓰기 (Tab)", icon("indent"), "indent");
    act("up", "블록 위로 (Alt+↑)", icon("up"), "up");
    act("down", "블록 아래로 (Alt+↓)", icon("down"), "down");
    b.append(el("span", "le-sep"));
    fmt = buildFormat(true, true);
    b.append(fmt.el);
    b.append(el("span", "le-grow"));
    const sw = el("button", "le-switch");
    sw.type = "button";
    sw.setAttribute("role", "switch");
    sw.title = "Ctrl/Alt 단축키를 켜거나 끕니다. Tab·Enter는 항상 동작합니다.";
    sw.append(el("span", "le-knob"), el("span", "le-swl", "단축키"));
    const paintSw = (on) => {
      if (!b.isConnected && b.dataset.seen) { unsub(); return; }
      sw.setAttribute("aria-checked", String(on));
    };
    paintSw(editorKeys.on);
    sw.addEventListener("mousedown", (e) => e.preventDefault());
    sw.addEventListener("click", () => editorKeys.set(!editorKeys.on));
    const unsub = editorKeys.subscribe(paintSw);
    queueMicrotask(() => { b.dataset.seen = "1"; });
    b.append(sw);
    const help = el("button", "le-btn");
    help.type = "button";
    help.title = "단축키 목록과 키 확인";
    help.setAttribute("aria-label", "단축키 도움말");
    help.append(icon("help"));
    help.addEventListener("click", openHelp);
    b.append(help);
    return b;
  }

  function doAction(action) {
    if (!editing) startEdit(value.length);
    doOp(action);
  }

  // one text change from a toolbar chip, a shortcut or the context menu (a line operation name or a format op)
  function doOp(action) {
    const ta = editing;
    if (!ta) return;
    ta.focus();
    const next = run(action, { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
    if (!next) return;
    applyState(ta, next);
    touched();
    fmtSync();
  }

  // -- inline formatting chips (V-003): the note toolbar's presets and shortcuts, as toggle chips (D-12)
  const stateOf = () => (editing && document.activeElement === editing ? { v: editing.value, s: editing.selectionStart, e: editing.selectionEnd } : null);
  function fmtSync() {
    if (!fmt) return;
    const st = stateOf();
    fmt.sync(st ? styleAt(st) : null);
  }

  // compact = the strip under a cell's textarea: B I U S + the yellow marker + a "more" chip that opens sizes, colors and highlights
  function buildFormat(compact, inBar = false) {
    const root = el("div", "le-fmt" + (compact ? " compact" : "") + (inBar ? " inbar" : ""));
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "글자 서식");
    const items = [];
    const chip = (parent, spec) => {
      const btn = el("button", "lf" + (spec.cls ? " " + spec.cls : ""));
      btn.type = "button";
      if (spec.on) btn.setAttribute("aria-pressed", "false");
      if (spec.glyph) btn.append(el("span", "lf-g", spec.glyph));
      if (spec.icon) btn.append(icon(spec.icon));
      if (spec.color) btn.style.setProperty("--c", spec.color);
      btn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection in the text
      btn.addEventListener("click", () => { if (editing) doOp(spec.op); });
      parent.append(btn);
      items.push({ btn, spec });
      return btn;
    };
    const group = (label, parent) => {
      const g = el("span", "lf-grp");
      g.setAttribute("role", "group");
      g.setAttribute("aria-label", label);
      parent.append(g);
      return g;
    };
    const sep = (parent) => parent.append(el("span", "lf-sep"));
    let g = group("글자 모양", root);
    chip(g, { cls: "b", glyph: "B", label: "굵게", keys: KEYS.bold, op: { t: "b" }, on: (s) => s.b });
    chip(g, { cls: "i", glyph: "I", label: "기울임", keys: KEYS.italic, op: { t: "i" }, on: (s) => s.i });
    chip(g, { cls: "u", glyph: "U", label: "밑줄", keys: KEYS.underline, op: { t: "u" }, on: (s) => s.u });
    chip(g, { cls: "s", glyph: "S", label: "취소선", keys: KEYS.strike, op: { t: "s" }, on: (s) => s.s });
    let rest = root;
    if (compact) {
      sep(root);
      chip(group("형광펜", root), { cls: "sw", color: HLS[0], label: "형광펜", keys: KEYS.highlight, op: { t: "hl", i: 0 }, on: (s) => s.hl === HLS[0] });
      const toggle = el("button", "lf lf-toggle");
      toggle.type = "button";
      toggle.setAttribute("aria-expanded", "false");
      toggle.title = "크기 · 글자색 · 형광펜 색 · 서식 지우기";
      toggle.setAttribute("aria-label", "서식 더 보기");
      toggle.append(icon("more"));
      toggle.addEventListener("mousedown", (e) => e.preventDefault());
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        root.classList.toggle("open", open);
      });
      root.append(toggle);
      rest = el("div", "lf-rest");
      root.append(rest);
    } else sep(rest);
    g = group("글자 크기", rest);
    chip(g, { cls: "sz sm", glyph: "A", label: "글자 작게", keys: KEYS.sizeDown, op: { t: "step", dir: -1 } });
    const szl = el("span", "lf-szl", String(BASE_PX));
    szl.title = "현재 글자 크기(px)";
    g.append(szl);
    chip(g, { cls: "sz lg", glyph: "A", label: "글자 크게", keys: KEYS.sizeUp, op: { t: "step", dir: 1 } });
    sep(rest);
    g = group("글자색", rest);
    COLORS.forEach((c, i) => chip(g, {
      cls: "sw" + (i === 0 ? " auto" : ""), color: i ? c : "", label: `글자색 ${COLOR_NAMES[i]}`, op: { t: "color", i },
      on: (s) => (i === 0 ? !s.color : s.color === c),
    }));
    sep(rest);
    g = group("형광펜 색", rest);
    chip(g, { cls: "sw none", label: "형광펜 없음", op: { t: "hl", i: -1 }, on: (s) => !s.hl });
    HLS.forEach((c, i) => chip(g, { cls: "sw", color: c, label: `형광펜 ${HL_NAMES[i]}`, keys: i === 0 ? KEYS.highlight : "", op: { t: "hl", i }, on: (s) => s.hl === c }));
    sep(rest);
    chip(rest, { cls: "clr", icon: "clear", label: "서식 지우기", keys: KEYS.clear, op: { t: "clear" } });
    if (compact && !inBar) { // the toolbar already has the shortcut switch
      const sw = el("button", "le-switch");
      sw.type = "button";
      sw.setAttribute("role", "switch");
      sw.title = "Ctrl/Alt 단축키를 켜거나 끕니다. Tab·Enter는 항상 동작합니다.";
      sw.append(el("span", "le-knob"), el("span", "le-swl", "단축키"));
      sw.addEventListener("mousedown", (e) => e.preventDefault());
      sw.addEventListener("click", () => editorKeys.set(!editorKeys.on));
      const paint = (on) => sw.setAttribute("aria-checked", String(on));
      const unsub = editorKeys.subscribe(paint);
      paint(editorKeys.on);
      cleanups.push(unsub);
      rest.append(sw);
    }
    const retip = (on) => {
      for (const { btn, spec } of items) {
        btn.title = tip(spec.label || "", spec.keys, on);
        btn.setAttribute("aria-label", spec.label || "");
      }
    };
    cleanups.push(editorKeys.subscribe(retip));
    retip(editorKeys.on);
    return {
      el: root,
      sync(style) {
        root.classList.toggle("idle", !style);
        for (const { btn, spec } of items) {
          if (spec.on) btn.setAttribute("aria-pressed", String(!!style && !!spec.on(style)));
          if (!style) btn.setAttribute("aria-disabled", "true"); else btn.removeAttribute("aria-disabled");
        }
        szl.textContent = String(style?.size || BASE_PX);
      },
    };
  }

  // Subscriptions are dropped once the editor has left the page (a repaint replaces the host's children).
  const alive = setInterval(() => {
    if (host.isConnected) return;
    clearInterval(alive);
    cleanups.splice(0).forEach((f) => f());
  }, 4000);

  // -- context menu (V-010): the same text formatting as the chips; the whole line when nothing is selected
  function lineOffsets(idx) {
    const lines = value.split("\n");
    const a = lines.slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
    return { a, b: a + lines[idx].length };
  }
  function menuGroups(ctx) {
    const ta = editing;
    let st = null;
    let row = null;
    if (ta && ctx.target === ta) st = { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd };
    else if (!ta) {
      row = ctx.target.closest?.(".le-line:not(.blank)");
      if (row) { const { a } = lineOffsets(+row.dataset.idx); st = { v: value, s: a, e: a }; }
    }
    if (!ta && !row) { // empty space below the lines: just a way into the editor; the toolbar keeps the browser's own menu
      if (!ctx.target.closest?.(".le-body")) return null;
      return [[{ label: "편집", icon: "edit", run: () => startEdit(value.length) }]];
    }
    const style = st ? styleAt(st) : null;
    const off = !st;
    const keys = (k) => (editorKeys.on ? k : "");
    const go = (op) => () => {
      if (ta) { doOp(op); return; }
      const next = run(op, st);
      if (next && next.v !== value) { persist(next.v); paintView(); }
    };
    const radio = (label, checked, op, extra = {}) => ({ label, radio: true, checked: !!style && checked, disabled: off, run: go(op), ...extra });
    const toggle = (label, key, k, always) => ({ label, keys: always ? KEYS[k] : keys(KEYS[k]), checked: !!style && style[key], disabled: off, run: go({ t: key }) });
    const groups = [];
    if (ta) groups.push(textGroup(ta));
    else groups.push([{ label: "이 줄 편집", icon: "edit", run: () => startEdit(lineOffsets(+row.dataset.idx).b) }]);
    groups.push([
      toggle("굵게", "b", "bold", true), toggle("기울임", "i", "italic", true), toggle("밑줄", "u", "underline", true), toggle("취소선", "s", "strike"),
      { label: "형광펜", keys: keys(KEYS.highlight), checked: !!style && style.hl === HLS[0], disabled: off, run: go({ t: "hl", i: 0 }) },
    ]);
    groups.push([
      { label: "글자 크기", icon: "size", items: [
        ...SIZES.map((px, i) => radio(`${px}px · ${SIZE_NAMES[i]}`, (style?.size || BASE_PX) === px, { t: "size", px })),
        { separator: true },
        { label: "키우기", keys: keys(KEYS.sizeUp), disabled: off, run: go({ t: "step", dir: 1 }) },
        { label: "줄이기", keys: keys(KEYS.sizeDown), disabled: off, run: go({ t: "step", dir: -1 }) },
      ] },
      { label: "글자색", icon: "color", items: COLORS.map((color, i) => radio(COLOR_NAMES[i], i === 0 ? !style?.color : style?.color === color, { t: "color", i }, { swatch: i ? color : "auto" })) },
      { label: "형광펜 색", icon: "marker", items: [
        radio("없음", !style?.hl, { t: "hl", i: -1 }),
        ...HLS.map((color, i) => radio(HL_NAMES[i], style?.hl === color, { t: "hl", i }, { swatch: color })),
      ] },
    ]);
    groups.push([
      { label: "서식 지우기", icon: "fmt-clear", keys: keys(KEYS.clear), disabled: off, run: go({ t: "clear" }) },
      ...(st && st.s === st.e ? [{ note: "선택한 글이 없으면 줄 전체에 적용돼요" }] : []),
    ]);
    return groups;
  }
  cleanups.push(registerContext(host, menuGroups));

  // -- expand side sheet (double click)
  function openSheet(caret) {
    const dlg = el("dialog", "le-sheet");
    const head = el("div", "le-sheet-head");
    head.append(el("strong", "", opts.expand.title || "확대 편집"));
    const status = el("span", "le-sheet-status");
    const close = el("button", "le-btn le-close", "닫기  Esc");
    close.type = "button";
    head.append(status, close);
    const inner = el("div", "le-sheet-body");
    dlg.append(head, inner);
    document.body.append(dlg);
    clearTimeout(timer);
    if (editing && dirty) { dirty = false; persist(editing.value); }
    const startValue = ctl.getValue();
    editing = null; // the inline textarea is replaced by the sheet's editor
    value = startValue;
    const big = mountLineEditor(inner, {
      value: startValue,
      save: (t) => persist(t), // same chain as the inline editor, so saves stay ordered
      placeholder: opts.placeholder,
      toolbar: true,
      expand: null,
      sheet: true,
      foldKey: opts.foldKey,
    });
    sheetHook = (k, msg) => { status.textContent = msg; status.dataset.k = k; };
    const done = async () => {
      await big.flush();
      value = big.getValue();
      dlg.close();
    };
    close.addEventListener("click", done);
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(); });
    dlg.addEventListener("click", (e) => { if (e.target === dlg) done(); });
    dlg.addEventListener("close", () => { sheetHook = null; dlg.remove(); paintView(); });
    dlg.showModal();
    big.edit(Math.min(caret, startValue.length));
  }

  paintView();
  return ctl;
}

function caretFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const p = document.caretPositionFromPoint(x, y);
    return p ? { node: p.offsetNode, offset: p.offset } : null;
  }
  if (document.caretRangeFromPoint) {
    const r = document.caretRangeFromPoint(x, y);
    return r ? { node: r.startContainer, offset: r.startOffset } : null;
  }
  return null;
}
