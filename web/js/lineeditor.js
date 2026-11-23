// Shared line editor (P2B-02, D-21): used by the today screen and the monthly journal cells.
// View mode renders lines (bullets, marks, highlight, fold); one click switches to a plain-text editor
// whose keys follow lineeditor-core.js. Double click opens the whole text in a side sheet.
import { KEY_HELP, foldInfo, keyAction, parseLine, run, textToHtml, toggleDoneRaw } from "./lineeditor-core.js";

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
      const act = keyAction(e, true);
      const combo = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Meta", e.key.length === 1 ? e.key.toUpperCase() : e.key].filter(Boolean).join("+");
      out.textContent = `${combo} → 앱이 받았습니다${act ? ` (기능: ${ACTION_LABEL[act]})` : ""}`;
    });
    const note = el("p", "le-help-note", "아무 반응이 없는 조합은 브라우저가 먼저 가져간 키입니다. 그때는 Ctrl+1 대신 Alt+1 또는 Ctrl+Alt+1을 쓰세요.");
    helpDlg.append(head, tbl, diag, note);
    helpDlg.addEventListener("click", (e) => { if (e.target === helpDlg) helpDlg.close(); });
    document.body.append(helpDlg);
  }
  helpDlg.showModal();
}
const ACTION_LABEL = { indent: "들여쓰기", outdent: "내어쓰기", bullet: "불렛", cycle: "표시 순환", done: "완료 전환", star: "별표", highlight: "형광펜", up: "위로 이동", down: "아래로 이동", enter: "새 줄", backspace: "표시 해제" };

// ---- the editor -------------------------------------------------------------------------
// opts: { value, save(text)->Promise, placeholder, toolbar, expand:{title}|null, foldKey, lineExtra(raw, idx)->Node|null,
//         onState(kind: "saving"|"saved"|"error", message), sheet }
export function mountLineEditor(host, opts) {
  let value = opts.value || "";
  let editing = null; // textarea while editing
  let timer = null;
  let dirty = false;
  let chain = Promise.resolve();
  const ctl = {};
  let sheetHook = null; // status text of the open side sheet
  const emit = (kind, msg) => { opts.onState?.(kind, msg); sheetHook?.(kind, msg); };

  host.classList.add("le");
  const bar = opts.toolbar ? buildBar() : null;
  const body = el("div", "le-body");
  host.replaceChildren(...(bar ? [bar, body] : [body]));

  // -- persistence (saves run one after another so an older PUT never overwrites a newer one)
  function persist(text) {
    value = text;
    emit("saving", "저장 중…");
    chain = chain
      .then(() => opts.save(text))
      .then(() => { if (value === text) emit("saved", "저장됨"); })
      .catch((e) => { emit("error", `저장 실패: ${e.message}`); });
    return chain;
  }
  ctl.persist = persist;

  async function flush() {
    clearTimeout(timer);
    if (editing && dirty) { dirty = false; await persist(editing.value); }
    else await chain;
  }
  ctl.flush = flush;
  ctl.getValue = () => (editing ? editing.value : value);
  ctl.setValue = (t) => { value = t; if (!editing) paintView(); };
  ctl.isEditing = () => !!editing;

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
      row.style.setProperty("--d", String(Math.floor(p.ind / 2)));
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
      if (p.mark) {
        const m = el("button", "le-mark m" + ({ " ": "todo", x: "done", "*": "star", "!": "urgent" })[p.mark]);
        m.type = "button";
        m.dataset.act = "mark";
        m.setAttribute("aria-label", { " ": "할일 — 눌러서 완료", x: "완료 — 눌러서 되돌리기", "*": "중요 — 눌러서 완료", "!": "긴급 — 눌러서 완료" }[p.mark]);
        if (p.mark === "x") m.append(icon("mark"));
        else if (p.mark === "*") m.append(icon("star", true));
        else if (p.mark === "!") m.textContent = "!";
        row.append(m);
      } else if (p.bullet) row.append(el("span", "le-dot"));
      const t = el("span", "le-text");
      t.innerHTML = textToHtml(p.text) || "";
      if (p.mark === "x") t.classList.add("done");
      row.append(t);
      if (isFolded) row.append(el("span", "le-pill", `⋯ ${kids[i]}줄`));
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
    if (textEl && !raw.includes("<mark>")) {
      const r = caretFromPoint(e.clientX, e.clientY);
      if (r && textEl.contains(r.node)) col = Math.min(raw.length, raw.length - parseLine(raw).text.length + r.offset);
    }
    startEdit(off + col);
  }

  function onDblClick(e) {
    if (!opts.expand || e.target.closest("[data-act]")) return;
    e.preventDefault();
    openSheet(editing ? editing.selectionStart : value.length);
  }

  // -- edit mode
  function startEdit(caret) {
    if (editing) return;
    const ta = el("textarea", "le-ta");
    ta.value = value;
    ta.spellcheck = false;
    ta.rows = 3;
    ta.setAttribute("aria-label", "줄 편집 — Tab 들여쓰기, Esc로 나가기");
    editing = ta;
    body.replaceChildren(ta);
    ta.focus();
    const c = Math.min(caret ?? value.length, value.length);
    ta.setSelectionRange(c, c);
    fit(ta);
    ta.addEventListener("input", () => {
      dirty = true;
      fit(ta);
      clearTimeout(timer);
      timer = setTimeout(flush, 700);
    });
    ta.addEventListener("blur", async () => {
      await flush();
      if (editing === ta) { editing = null; value = ta.value; paintView(); }
    });
    ta.addEventListener("dblclick", (e) => {
      if (!opts.expand) return;
      e.preventDefault();
      openSheet(ta.selectionStart);
    });
    ta.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return; // Korean IME composition
      if (e.key === "Escape" && !opts.sheet) { e.preventDefault(); ta.blur(); return; }
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
      dirty = true;
      fit(ta);
      clearTimeout(timer);
      timer = setTimeout(flush, 700);
    });
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
    const hl = el("span", "le-hl", "가");
    act("hl", "형광펜 (Ctrl+Alt+H)", hl, "highlight");
    act("star", "별표 (Ctrl+Alt+S)", icon("star"), "star");
    const m = el("span", "le-cyc", "☐");
    act("cycle", "표시 순환 ☐ ☑ ★ ! (Ctrl+1 · Alt+1)", m, "cycle");
    act("bullet", "불렛 (Ctrl+.)", icon("bullet"), "bullet");
    b.append(el("span", "le-sep"));
    act("outdent", "내어쓰기 (Shift+Tab)", icon("outdent"), "outdent");
    act("indent", "들여쓰기 (Tab)", icon("indent"), "indent");
    act("up", "블록 위로 (Alt+↑)", icon("up"), "up");
    act("down", "블록 아래로 (Alt+↓)", icon("down"), "down");
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
    const ta = editing;
    if (!ta) return;
    ta.focus();
    const next = run(action, { v: ta.value, s: ta.selectionStart, e: ta.selectionEnd });
    if (!next) return;
    applyState(ta, next);
    dirty = true;
    fit(ta);
    clearTimeout(timer);
    timer = setTimeout(flush, 700);
  }

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
