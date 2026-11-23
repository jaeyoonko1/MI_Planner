// Rich note editor (P3-02, P3-04) — one component used by note pages AND by an issue's memo (P2B-10).
// contenteditable + markdown (mdconv.js). The caller supplies how to save, how to upload an image and how to
// turn a `files/x.png` reference into a URL, so the same editor works for a page and for an issue memo.
// Images: paste / drop -> upload -> <img data-file="files/…">; width auto | small | fixed px (memocore.js).
// Folding: headings fold their section; the state is kept in settings (foldstore.js), never in the file.
import { api } from "./api.js";
import { getFolds, setFolds } from "./foldstore.js";
import { hub } from "./hub.js";
import { BASE_PX, COLORS, HLS, SIZES, htmlToMd, mdToHtml } from "./mdconv.js";
import { MIN_W, SMALL_PX, clampWidth, foldPlan, imgCssWidth, ownerHeading, pruneFolds } from "./memocore.js";

const SIZE_LABELS = ["극소", "소", "보통", "중", "대", "특대"];
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
  const root = el("div", "rich" + (cfg.compact ? " compact" : ""));
  const bar = el("div", "note-bar");
  const status = el("span", cfg.compact ? "memo-stat" : "jstatus", "");
  const ed = el("div", "note-editor");
  ed.contentEditable = "true";
  ed.spellcheck = false;
  ed.setAttribute("role", "textbox");
  ed.setAttribute("aria-multiline", "true");
  ed.setAttribute("aria-label", cfg.label || "본문");
  if (cfg.placeholder) ed.dataset.ph = cfg.placeholder;
  ed.innerHTML = mdToHtml(cfg.content || "", cfg.fileUrl);
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
  };
  const markEmpty = () => ed.classList.toggle("is-empty", !ed.textContent.trim() && !ed.querySelector("img"));
  const save = () => {
    clearTimeout(timer);
    timer = null;
    const md = htmlToMd(ed);
    if (md === last) return chain;
    setStatus("저장 중…");
    pending++;
    chain = chain
      .then(() => cfg.save(md))
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
  const setBlock = (tag) => {
    const cur = closest("h1,h2,h3");
    run("formatBlock", cur && cur.tagName === tag.toUpperCase() ? "div" : tag);
  };
  const toggleChecklist = () => {
    let ul = closest("ul");
    if (!ul) {
      run("insertUnorderedList");
      ul = closest("ul");
    }
    if (!ul) return;
    ul.classList.toggle("cl");
    if (ul.classList.contains("cl")) {
      [...ul.children].forEach((li) => li.getAttribute("data-chk") || li.setAttribute("data-chk", "0"));
    }
  };

  // size: apply the browser's largest size, then rewrite it to a preset px value
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
  const stepSize = (dir) => {
    const n = getSelection().anchorNode;
    const e = n && (n.nodeType === 3 ? n.parentElement : n);
    if (!e || !ed.contains(e)) return;
    const cur = parseFloat(getComputedStyle(e).fontSize);
    let i = SIZES.findIndex((z) => z >= cur - 0.5);
    if (i < 0) i = SIZES.length - 1;
    setSize(SIZES[Math.max(0, Math.min(SIZES.length - 1, i + dir))]);
  };
  const toggleHighlight = () => {
    const n = getSelection().anchorNode;
    const e = n && (n.nodeType === 3 ? n.parentElement : n);
    const bg = e ? getComputedStyle(e).backgroundColor : "";
    const has = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    run("hiliteColor", has ? "transparent" : HLS[0]);
  };
  const clearFormat = () => {
    run("removeFormat");
    run("hiliteColor", "transparent");
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

  // ---- toolbar
  const BTN = [
    ["본문", () => run("formatBlock", "div"), "Ctrl+Alt+0"],
    ["제목1", () => setBlock("h1"), "Ctrl+Alt+1"],
    ["제목2", () => setBlock("h2"), "Ctrl+Alt+2"],
    ["제목3", () => setBlock("h3"), "Ctrl+Alt+3"],
    ["• 목록", () => run("insertUnorderedList"), ""],
    ["1. 목록", () => run("insertOrderedList"), ""],
    ["☑ 체크", toggleChecklist, ""],
    ["B", () => run("bold"), "Ctrl+B"],
    ["I", () => run("italic"), "Ctrl+I"],
    ["U", () => run("underline"), "Ctrl+U"],
    ["S", () => run("strikeThrough"), "Ctrl+-"],
  ];
  const addChip = (parent, label, fn, tip, color) => {
    const b = el("button", color === undefined ? "chip" : "chip sw", label);
    b.type = "button";
    if (tip) { b.title = tip; b.setAttribute("aria-label", tip); }
    if (label && !tip) b.setAttribute("aria-label", label);
    if (color) b.style.background = color;
    else if (color === null) b.classList.add("none");
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("click", () => {
      ed.focus();
      fn();
      schedule();
    });
    parent.append(b);
    return b;
  };
  const group = (name) => {
    const g = el("span", "grp");
    g.append(el("span", "lab", name));
    bar.append(g);
    return g;
  };
  for (const [label, fn, tip] of BTN) addChip(bar, label, fn, tip ? `${label} · ${tip}` : label);
  if (!cfg.compact) {
    const gs = group("크기");
    SIZES.forEach((px, i) => addChip(gs, SIZE_LABELS[i], () => setSize(px), `${px}px · Ctrl+Shift+. / ,`));
    const gc = group("글자색");
    COLORS.forEach((c) => addChip(gc, "", () => run("foreColor", c), c, c));
  }
  const gh = group("형광펜");
  addChip(gh, "", () => run("hiliteColor", "transparent"), "형광펜 없음", null);
  HLS.forEach((c, i) => addChip(gh, "", () => run("hiliteColor", c), i ? c : `${c} · Ctrl+Alt+H`, c));
  addChip(bar, "서식 지우기", clearFormat, "서식 지우기 · Ctrl+Space");
  foldBtn = el("button", "chip fold-all", "모두 접기");
  foldBtn.type = "button";
  foldBtn.hidden = true;
  foldBtn.title = "제목 아래 내용을 모두 접거나 펼쳐요 (Ctrl+Shift+[ / ])";
  foldBtn.setAttribute("aria-pressed", "false");
  foldBtn.addEventListener("mousedown", (e) => e.preventDefault());
  foldBtn.addEventListener("click", foldAll);
  bar.append(foldBtn);
  if (!cfg.compact) bar.append(status);

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
    const imgs = imagesOf(e.clipboardData);
    if (imgs.length) {
      for (const f of imgs) await insertImage(f);
      return;
    }
    const text = e.clipboardData.getData("text/plain"); // plain text only keeps the file clean
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

  // ---- checklist click, folding chevron, Enter, shortcuts
  ed.addEventListener("click", (e) => {
    const t = e.target;
    if (t.tagName === "LI" && t.parentElement.classList.contains("cl") && e.offsetX < 24) {
      t.setAttribute("data-chk", t.getAttribute("data-chk") === "1" ? "0" : "1");
      schedule();
    } else if (/^H[1-3]$/.test(t.tagName) && t.dataset.fk && e.offsetX < 22) {
      toggleFold(t);
    }
  });
  ed.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Escape" && !ib.hidden) { hideBar(true); return; }
    if (e.key === "Enter" && closest("ul.cl")) {
      setTimeout(() => {
        const li = closest("li");
        if (li && li.parentElement.classList.contains("cl")) li.setAttribute("data-chk", "0");
      }, 0);
    }
    if (e.key === "Tab") e.preventDefault(); // nested lists are not supported yet
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && !e.altKey && (e.code === "BracketLeft" || e.code === "BracketRight")) {
      e.preventDefault();
      foldAtCaret(e.code === "BracketLeft");
    } else if (e.altKey && k === "h") {
      e.preventDefault();
      toggleHighlight();
      schedule();
    } else if (e.shiftKey && !e.altKey && (e.key === "." || e.key === ">" || e.key === "," || e.key === "<")) {
      e.preventDefault();
      stepSize(e.key === "." || e.key === ">" ? 1 : -1);
      schedule();
    } else if (!e.altKey && !e.shiftKey && e.key === " ") {
      e.preventDefault();
      clearFormat();
      schedule();
    } else if (e.altKey && /^[0-3]$/.test(e.key)) {
      e.preventDefault();
      if (e.key === "0") run("formatBlock", "div");
      else setBlock("h" + e.key);
      schedule();
    } else if (!e.altKey && !e.shiftKey && e.key === "-") {
      e.preventDefault();
      run("strikeThrough");
      schedule();
    }
  });
  ed.addEventListener("input", () => {
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
  if (cfg.compact) root.append(status);
  markEmpty();
  applyFolds();

  return {
    el: root,
    flush: save,
    getMd: () => htmlToMd(ed),
    // Replace the text from outside (another view saved). The caller decides when it is safe (not typing).
    setMd(md) {
      ed.innerHTML = mdToHtml(md || "", cfg.fileUrl);
      last = htmlToMd(ed);
      hideBar(true);
      markEmpty();
      applyFolds();
      setStatus("");
    },
    // Take the text another view saved, unless the user is typing here.
    syncFrom(md) {
      if (this.isBusy()) return;
      if ((md || "").trim() !== htmlToMd(ed).trim()) this.setMd(md);
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
  const ctl = mountEditor({
    content: page.content || "",
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
  if (taskId != null) { // the issue's detail panel may edit the same text
    hub.on(async (i) => {
      if (i.kind !== "task" || Number(i.id) !== Number(taskId) || i.from === "page" || ctl.isBusy()) return;
      try {
        const fresh = await api.page(path);
        if (!ctl.isBusy() && fresh.content !== ctl.getMd()) ctl.setMd(fresh.content);
      } catch { /* page moved or gone: keep what is shown */ }
    });
  }
}
