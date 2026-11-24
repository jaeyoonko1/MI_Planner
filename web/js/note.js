// Rich note editor (P3-02, P3-04) — one component used by note pages AND by an issue's memo (P2B-10).
// contenteditable + markdown (mdconv.js). The caller supplies how to save, how to upload an image and how to
// turn a `files/x.png` reference into a URL, so the same editor works for a page and for an issue memo.
// Images: paste / drop -> upload -> <img data-file="files/…">; width auto | small | fixed px (memocore.js).
// Folding: headings fold their section; the state is kept in settings (foldstore.js), never in the file.
import { api } from "./api.js";
import { getFolds, setFolds } from "./foldstore.js";
import { keyAction } from "./lineeditor-core.js";
import { bindNoteTables } from "./note-table.js";
import { clipboardToTable } from "./paste-html.js";
import { editorKeys } from "./lineeditor.js";
import { runNoteLineAction } from "./note-lines.js";
import { mountNoteColumns } from "./note-columns.js";
import { bindWikiEditor } from "./wikilinks.js";
import { hub } from "./hub.js";
import { mountPptPanel } from "./ppt.js";
import { htmlToMd, loadInto } from "./mdconv.js";
import { mountFormatBar } from "./note-format.js";
import { MIN_W, SMALL_PX, clampWidth, foldPlan, imgCssWidth, ownerHeading, pruneFolds } from "./memocore.js";

const SAVE_DELAY_MS = 700;
const IMG_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp" };
const WIDTH_CHOICES = [["auto", "자동"], ["small", "소형"], ["480", "480"], ["720", "720"], ["orig", "원본"]];

let current = null; // {flush} of the note page being edited

export async function flushNote() {
  const c = current;
  current = null;
  if (c) {
    await c.flush();
    c.destroy?.();
  }
}

async function req(method, url, body, raw) {
  const res = await fetch(url, {
    method,
    headers: raw ? undefined : { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
    keepalive: !raw,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function loadCss() {
  if (document.getElementById("note-css")) return;
  const l = document.createElement("link");
  l.id = "note-css";
  l.rel = "stylesheet";
  l.href = "/css/note.css";
  document.head.append(l);
}

/**
 * cfg: { content, fileUrl(rel), upload(file, name) -> rel, save(md) -> Promise, onError?(err, retry),
 *        foldScope?, compact?, placeholder? }
 * returns { el, flush, getMd, setMd, isBusy, destroy, focus }
 */
export function mountEditor(cfg) {
  loadCss();
  const root = el("div", "rich" + (cfg.compact && !cfg.shared ? " compact" : ""));
  const bar = el("div", "note-bar");
  const status = el("span", cfg.compact ? "memo-stat" : "jstatus", "");
  status.setAttribute("role", "status");
  const ed = el("div", "note-editor");
  ed.contentEditable = "true";
  ed.spellcheck = false;
  ed.setAttribute("role", "textbox");
  ed.setAttribute("aria-multiline", "true");
  ed.setAttribute("aria-label", cfg.label || "본문");
  if (cfg.placeholder) ed.dataset.ph = cfg.placeholder;
  loadInto(ed, cfg.content || "", cfg.fileUrl);
  document.execCommand("defaultParagraphSeparator", false, "div");
  document.execCommand("styleWithCSS", false, true);
  const cleanups = [];

  // ---- autosave: one save at a time, retried on the next edit after a failure
  let last = htmlToMd(ed);
  let timer = null;
  let chain = Promise.resolve();
  let pending = 0;
  const setStatus = (t, bad = false) => {
    status.textContent = t;
    status.classList.toggle("error", bad);
    if (cfg.shared && t.startsWith("이미지")) cfg.report?.(t, bad);
  };
  const markEmpty = () => ed.classList.toggle("is-empty", !ed.textContent.trim() && !ed.querySelector("img"));
  const save = () => {
    clearTimeout(timer);
    timer = null;
    const md = htmlToMd(ed);
    if (md === last && !pending) return chain;
    setStatus("저장 중…");
    pending++;
    chain = chain
      .then(() => md === last ? undefined : cfg.save(md))
      .then(() => {
        last = md;
        setStatus(md === htmlToMd(ed) ? "저장됨" : "편집 중…");
      })
      .catch((e) => {
        setStatus("저장 실패", true);
        cfg.onError?.(e, save);
        if (!cfg.onError) setStatus("저장 실패: " + e.message, true);
      })
      .finally(() => { pending--; });
    return chain;
  };
  const schedule = () => {
    setStatus("편집 중…");
    markEmpty();
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };

  // ---- block helpers
  const closest = (sel) => {
    const n = getSelection().anchorNode;
    const e = n && (n.nodeType === 3 ? n.parentElement : n);
    const hit = e && e.closest(sel);
    return hit && ed.contains(hit) ? hit : null;
  };
  const run = (cmd, val) => document.execCommand(cmd, false, val);
  const lineAction = (action) => {
    if (!runNoteLineAction(ed, action)) return;
    applyFolds();
    schedule();
  };

  // ---- folding (state outside the text)
  let folded = new Set();
  const kids = () => [...ed.children];
  const info = (c) => ({ level: /^H[1-3]$/.test(c.tagName) ? +c.tagName[1] : 0, text: c.textContent });
  const persistFolds = () => {
    if (!cfg.foldScope) return;
    folded = pruneFolds(kids().map(info), folded);
    setFolds(cfg.foldScope, folded);
  };
  let foldBtn = null;
  function applyFolds() {
    const list = kids();
    const plan = foldPlan(list.map(info), folded);
    list.forEach((c, i) => {
      c.classList.toggle("fold-hid", plan[i].hidden);
      if (plan[i].key && plan[i].count) {
        c.dataset.fold = plan[i].folded ? "1" : "0";
        c.dataset.n = String(plan[i].count);
        c.dataset.fk = plan[i].key;
      } else {
        delete c.dataset.fold;
        delete c.dataset.n;
        delete c.dataset.fk;
      }
    });
    if (foldBtn) {
      const keys = plan.filter((p) => p.key && p.count);
      foldBtn.hidden = keys.length === 0;
      const all = keys.length > 0 && keys.every((p) => p.folded);
      foldBtn.setAttribute("aria-pressed", String(all));
      foldBtn.textContent = all ? "모두 펼치기" : "모두 접기";
    }
  }
  const toggleFold = (h, to) => {
    const k = h.dataset.fk;
    if (!k) return;
    const on = to ?? !folded.has(k);
    on ? folded.add(k) : folded.delete(k);
    applyFolds();
    persistFolds();
    if (on) { // the caret may have been inside the now hidden section
      const r = document.createRange();
      r.selectNodeContents(h);
      r.collapse(false);
      const s = getSelection();
      if (!ed.contains(s.anchorNode) || closest(".fold-hid")) { s.removeAllRanges(); s.addRange(r); }
    }
  };
  const foldAll = () => {
    const heads = kids().filter((c) => c.dataset.fk);
    const allOn = heads.length && heads.every((h) => h.dataset.fold === "1");
    heads.forEach((h) => (allOn ? folded.delete(h.dataset.fk) : folded.add(h.dataset.fk)));
    applyFolds();
    persistFolds();
  };
  const foldAtCaret = (to) => {
    const n = getSelection().anchorNode;
    const e = n && (n.nodeType === 3 ? n.parentElement : n);
    let top = e && ed.contains(e) ? e : null;
    while (top && top.parentElement !== ed) top = top.parentElement;
    if (!top) return;
    const i = ownerHeading(kids().map(info), kids().indexOf(top));
    if (i >= 0) toggleFold(kids()[i], to);
  };
  if (cfg.foldScope) getFolds(cfg.foldScope).then((s) => { folded = s; applyFolds(); });

  const noteTables = bindNoteTables(ed, () => { applyFolds(); schedule(); });
  noteTables.refresh();

  // ---- toolbar (note-format.js): block, list, character, size, color, highlight chips
  const fmt = mountFormatBar(ed, bar, {
    compact: cfg.compact,
    schedule,
    lineAction,
    insertTable: noteTables.insert,
    fold: foldAtCaret,
    cleanups,
  });
  foldBtn = el("button", "nb txt fold-all", "모두 접기");
  foldBtn.type = "button";
  foldBtn.hidden = true;
  foldBtn.title = "제목 아래 내용을 모두 접거나 펼치기 · Ctrl+Shift+[ / ]";
  foldBtn.setAttribute("aria-pressed", "false");
  foldBtn.addEventListener("mousedown", (e) => e.preventDefault());
  foldBtn.addEventListener("click", foldAll);
  bar.insertBefore(foldBtn, fmt.shortcutSwitch);
  if (!cfg.compact && !cfg.shared) bar.append(status);

  // An image gets its own block (its own line in the markdown), with an empty line after it to keep typing.
  function placeImage(html) {
    const s = getSelection();
    let top = s.anchorNode && ed.contains(s.anchorNode) ? (s.anchorNode.nodeType === 3 ? s.anchorNode.parentElement : s.anchorNode) : null;
    while (top && top !== ed && top.parentElement !== ed) top = top.parentElement;
    if (!top || top === ed) {
      ed.insertAdjacentHTML("beforeend", `<div>${html}</div><div><br></div>`);
      top = ed.lastElementChild;
    } else {
      const empty = !top.textContent.trim() && !top.querySelector("img");
      if (empty) top.innerHTML = html;
      else top.insertAdjacentHTML("afterend", `<div>${html}</div>`);
      const holder = empty ? top : top.nextElementSibling;
      if (!holder.nextElementSibling) holder.insertAdjacentHTML("afterend", "<div><br></div>");
      top = holder.nextElementSibling;
    }
    const r = document.createRange();
    r.selectNodeContents(top);
    r.collapse(true);
    s.removeAllRanges();
    s.addRange(r);
    applyFolds();
  }

  // ---- images: upload, then insert <img data-file="files/…">
  async function insertImage(file) {
    const ext = IMG_EXT[file.type] || ".png";
    setStatus("이미지 저장 중…");
    try {
      const rel = await cfg.upload(file, "image" + ext);
      ed.focus();
      placeImage(`<img src="${cfg.fileUrl(rel)}" data-file="${rel}" alt="">`);
      schedule();
      setStatus("이미지 붙여넣음 · 눌러서 크기 변경");
    } catch (e) {
      setStatus("이미지 실패: " + e.message, true);
    }
  }
  const imagesOf = (dt) => [...(dt?.files || [])].filter((f) => f.type.startsWith("image/"));

  ed.addEventListener("paste", async (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain"); // plain text only keeps the file clean
    // V-001: a table (Excel / Sheets / web) or tab separated text becomes a note table. Excel also puts a picture of the
    // range on the clipboard; text always wins over that picture, which is only the fallback when nothing else is there.
    const hit = clipboardToTable({ html: e.clipboardData.getData("text/html"), text });
    if (hit) {
      noteTables.pasteBlock(hit.block, hit.via);
      return;
    }
    const imgs = text.trim() ? [] : imagesOf(e.clipboardData);
    if (imgs.length) {
      for (const f of imgs) await insertImage(f);
      return;
    }
    if (text) {
      run("insertText", text);
      schedule();
    }
  });
  ed.addEventListener("dragover", (e) => imagesOf(e.dataTransfer).length && e.preventDefault());
  ed.addEventListener("drop", async (e) => {
    const imgs = imagesOf(e.dataTransfer);
    if (!imgs.length) return;
    e.preventDefault();
    for (const f of imgs) await insertImage(f);
  });

  // image size bar: auto / small / fixed px, plus a drag handle (D-12: buttons, not a dropdown)
  const ib = el("div", "imgbar");
  ib.setAttribute("role", "toolbar");
  ib.setAttribute("aria-label", "이미지 크기");
  ib.hidden = true;
  const ibChips = new Map();
  for (const [v, label] of WIDTH_CHOICES) {
    const b = el("button", "chip", label);
    b.type = "button";
    b.title = v === "auto" ? "본문 폭에 맞춰 자동" : v === "small" ? `소형 ${SMALL_PX}px` : v === "orig" ? "원본 크기" : `${v}px 고정`;
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => setWidth(v));
    ibChips.set(v, b);
    ib.append(b);
  }
  const num = el("input", "imgnum");
  num.type = "number";
  num.min = String(MIN_W);
  num.max = "2400";
  num.step = "10";
  num.setAttribute("aria-label", "이미지 너비 (px)");
  num.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); setWidth(String(clampWidth(num.value))); ed.focus(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); hideBar(true); ed.focus(); }
  });
  num.addEventListener("change", () => num.value && setWidth(String(clampWidth(num.value))));
  const dims = el("span", "imgdim", "");
  ib.append(num, el("span", "imgdim", "px"), dims);
  const handle = el("button", "imgrz");
  handle.type = "button";
  handle.hidden = true;
  handle.title = "끌어서 크기 조절";
  handle.setAttribute("aria-label", "이미지 크기 끌어서 조절");
  root.append(ib, handle);

  let img = null; // image the bar belongs to
  let pinned = false; // selected / clicked: stays until something else is done
  let hideT = null;
  const modeOf = (i) => i.dataset.w || "auto";
  function placeBar() {
    if (!img || !img.isConnected) return hideBar(true);
    const r = root.getBoundingClientRect();
    const b = img.getBoundingClientRect();
    ib.style.left = Math.max(4, Math.min(b.left - r.left, r.width - ib.offsetWidth - 4)) + "px";
    const above = b.top - r.top - ib.offsetHeight - 8;
    ib.style.top = (above >= 4 ? above : b.bottom - r.top + 8) + "px";
    handle.style.left = b.right - r.left - 9 + "px";
    handle.style.top = b.bottom - r.top - 9 + "px";
  }
  function paintBar() {
    const m = modeOf(img);
    for (const [v, b] of ibChips) b.setAttribute("aria-pressed", String(v === m));
    num.value = String(/^\d+$/.test(m) ? m : Math.round(img.getBoundingClientRect().width));
    dims.textContent = img.naturalWidth ? `원본 ${img.naturalWidth}×${img.naturalHeight}` : "";
  }
  function showBar(target, pin = false) {
    clearTimeout(hideT);
    if (pin) pinned = true;
    img = target;
    ib.hidden = false;
    handle.hidden = false;
    paintBar();
    placeBar();
    if (!target.complete) target.addEventListener("load", () => { paintBar(); placeBar(); }, { once: true });
  }
  function hideBar(force = false) {
    if (pinned && !force) return;
    clearTimeout(hideT);
    pinned = false;
    ib.hidden = true;
    handle.hidden = true;
    img = null;
  }
  const hideSoon = () => {
    clearTimeout(hideT);
    hideT = setTimeout(() => { if (!ib.matches(":hover") && !handle.matches(":hover") && !ib.contains(document.activeElement)) hideBar(); }, 260);
  };
  function setWidth(v, quiet = false) {
    if (!img) return;
    if (v === "auto") { delete img.dataset.w; img.style.width = ""; }
    else if (v === "orig") { img.dataset.w = "orig"; img.style.width = ""; }
    else if (v === "small") { img.dataset.w = "small"; img.style.width = imgCssWidth("small"); }
    else { const w = String(clampWidth(v)); img.dataset.w = w; img.style.width = w + "px"; }
    if (!img.getAttribute("style")) img.removeAttribute("style");
    paintBar();
    placeBar();
    if (!quiet) schedule();
  }
  ed.addEventListener("mouseover", (e) => {
    if (pinned) return; // a clicked/selected image keeps its bar until something else is done
    if (e.target.tagName === "IMG") showBar(e.target);
    else hideSoon();
  });
  ed.addEventListener("mouseleave", hideSoon);
  ib.addEventListener("mouseleave", hideSoon);
  ed.addEventListener("click", (e) => {
    if (e.target.tagName === "IMG") showBar(e.target, true);
    else if (pinned) hideBar(true);
  });
  handle.addEventListener("pointerdown", (e) => {
    if (!img) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const target = img;
    const x0 = e.clientX;
    const w0 = target.getBoundingClientRect().width;
    const cs = getComputedStyle(ed);
    const maxW = Math.max(MIN_W, ed.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const move = (ev) => {
      const w = Math.max(MIN_W, Math.min(maxW, Math.round((w0 + ev.clientX - x0) / 10) * 10));
      target.dataset.w = String(w);
      target.style.width = w + "px";
      paintBar();
      placeBar();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      pinned = true;
      schedule();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  const onSel = () => { // an image selected with the keyboard (Shift+arrow) shows the bar too
    const s = getSelection();
    if (!s.rangeCount || !ed.contains(s.anchorNode)) return;
    const r = s.getRangeAt(0);
    const n = r.startContainer === r.endContainer && r.endOffset - r.startOffset === 1 ? r.startContainer.childNodes[r.startOffset] : null;
    if (n && n.tagName === "IMG") showBar(n, true);
    else if (pinned && !ib.contains(document.activeElement)) hideBar(true);
  };
  document.addEventListener("selectionchange", onSel);
  cleanups.push(() => document.removeEventListener("selectionchange", onSel));
  const onScroll = () => img && placeBar();
  window.addEventListener("resize", onScroll);
  cleanups.push(() => window.removeEventListener("resize", onScroll));

  // ---- checklist click, heading folding, Enter, shortcuts
  const foldableHeading = "h1[data-fk],h2[data-fk],h3[data-fk]";
  const onHeadingChevron = (e) => e.target.matches(foldableHeading) && e.offsetX < 16;
  ed.addEventListener("click", (e) => {
    const t = e.target;
    if (t.matches("li[data-m]") && e.offsetX >= -24 && e.offsetX < 0) {
      t.dataset.m = t.dataset.m === "x" ? " " : "x";
      schedule();
    } else if (e.detail <= 1 && onHeadingChevron(e)) {
      toggleFold(t);
    }
  });
  ed.addEventListener("dblclick", (e) => {
    const heading = e.target.closest(foldableHeading);
    if (heading?.parentElement !== ed || onHeadingChevron(e)) return;
    e.preventDefault();
    toggleFold(heading);
  });
  let enterFromItem = null;
  ed.addEventListener("keydown", (e) => {
    enterFromItem = null;
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape" && !ib.hidden) { hideBar(true); return; }
    // Ctrl+Alt+1 is already used for heading 1 in rich text. Alt+1 remains the fallback for Ctrl+1.
    const headingOne = (e.ctrlKey || e.metaKey) && e.altKey && (e.code === "Digit1" || e.key === "1");
    const action = headingOne ? null : keyAction(e, editorKeys.on);
    if (["indent", "outdent", "bullet", "cycle", "done", "star", "up", "down"].includes(action)) {
      e.preventDefault();
      lineAction(action);
      return;
    }
    if (action === "enter") enterFromItem = closest("li");
    if (action === "highlight") {
      e.preventDefault();
      fmt.toggleHighlight();
      schedule();
      fmt.sync();
      return;
    }
    fmt.handleKey(e);
  });
  ed.addEventListener("input", (e) => {
    if (e.inputType === "insertParagraph" && enterFromItem) {
      const item = closest("li");
      if (item && item !== enterFromItem) delete item.dataset.m;
    }
    enterFromItem = null;
    schedule();
    applyFolds();
    if (img) placeBar();
  });
  ed.addEventListener("blur", save);
  const onHide = () => { save(); };
  window.addEventListener("pagehide", onHide);
  cleanups.push(() => window.removeEventListener("pagehide", onHide));
  ed.addEventListener("scroll", onScroll);

  root.append(bar, ed);
  if (cfg.compact && !cfg.shared) root.append(status);
  cleanups.push(bindWikiEditor(ed, root));
  markEmpty();
  applyFolds();

  return {
    el: root,
    toolbar: bar,
    flush: save,
    getMd: () => htmlToMd(ed),
    // Replace the text from outside (another view saved). The caller decides when it is safe (not typing).
    setMd(md) {
      loadInto(ed, md || "", cfg.fileUrl);
      noteTables.refresh();
      last = htmlToMd(ed);
      hideBar(true);
      markEmpty();
      applyFolds();
      setStatus("");
    },
    // Take the text another view saved, unless the user is typing here.
    syncFrom(md) {
      if (this.isBusy()) return;
      if ((md || "") !== htmlToMd(ed)) this.setMd(md);
    },
    isBusy: () => ed.contains(document.activeElement) || ib.contains(document.activeElement) || timer !== null || pending > 0,
    contains: (n) => root.contains(n),
    focus: () => ed.focus(),
    destroy() {
      clearTimeout(timer);
      clearTimeout(hideT);
      cleanups.forEach((f) => f());
    },
  };
}

// ---- note page (P3-02): the same editor bound to a page file --------------------------------------
export function renderNote(host, page) {
  const path = page.path;
  const taskId = page.meta?.task_id ?? null;
  const qs = encodeURIComponent(path);
  const fileUrl = (rel) => `/api/pages/file?path=${qs}&name=${encodeURIComponent(rel.replace(/^files\//, ""))}`;
  const ctl = mountNoteColumns(mountEditor, {
    content: page.content || "",
    pagePath: path,
    layout: page.meta?.note_layout,
    saveLayout: (layout) => req("PUT", `/api/pages/layout?path=${qs}`, layout),
    fileUrl,
    // an issue page and the issue memo are one text: fold alike in both places
    foldScope: taskId != null ? `t:${taskId}` : `p:${path}`,
    upload: async (file, name) => (await req("POST", `/api/pages/files?path=${qs}&name=${encodeURIComponent(name)}`, file, true)).file,
    save: async (md) => {
      await req("PUT", `/api/pages?path=${qs}`, { content: md });
      if (taskId != null) hub.emit({ kind: "task", id: taskId, from: "page" });
    },
  });
  current = { flush: ctl.flush, destroy: ctl.destroy };
  host.replaceChildren(ctl.el);
  host.before(mountPptPanel(path)); // V-002: PowerPoint attachments sit above the note
  if (taskId != null) { // the issue's detail panel may edit the same text
    hub.on(async (i) => {
      if (i.kind !== "task" || Number(i.id) !== Number(taskId) || i.from === "page" || ctl.isBusy()) return;
      try {
        const fresh = await api.page(path);
        if (!ctl.isBusy() && fresh.content !== ctl.getMd()) ctl.setMd(fresh.content, fresh.meta?.note_layout);
      } catch { /* page moved or gone: keep what is shown */ }
    });
  }
}
