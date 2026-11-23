// Note page editor (P3-02): contenteditable + markdown file, autosave, image paste.
// Format conversion lives in mdconv.js. Size/color/highlight toolbar comes in P3-04.
import { BASE_PX, COLORS, HLS, SIZES, htmlToMd, mdToHtml } from "./mdconv.js";

const SIZE_LABELS = ["극소", "소", "보통", "중", "대", "특대"];

const SAVE_DELAY_MS = 700;
const IMG_EXT = { "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp" };

let current = null; // {flush} of the note being edited

export async function flushNote() {
  const c = current;
  current = null;
  if (c) await c.flush();
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

export function renderNote(host, page) {
  loadCss();
  const path = page.path;
  const fileUrl = (rel) =>
    `/api/pages/file?path=${encodeURIComponent(path)}&name=${encodeURIComponent(rel.replace(/^files\//, ""))}`;

  const bar = el("div", "note-bar");
  const status = el("span", "jstatus", "");
  const ed = el("div", "note-editor");
  ed.contentEditable = "true";
  ed.spellcheck = false;
  ed.innerHTML = mdToHtml(page.content || "", fileUrl);
  document.execCommand("defaultParagraphSeparator", false, "div");
  document.execCommand("styleWithCSS", false, true);

  // ---- autosave: one save at a time, retried on the next edit after a failure
  let last = htmlToMd(ed);
  let timer = null;
  let chain = Promise.resolve();
  const setStatus = (t, bad = false) => {
    status.textContent = t;
    status.classList.toggle("error", bad);
  };
  const save = () => {
    clearTimeout(timer);
    const md = htmlToMd(ed);
    if (md === last) return chain;
    setStatus("저장 중…");
    chain = chain
      .then(() => req("PUT", `/api/pages?path=${encodeURIComponent(path)}`, { content: md }))
      .then(() => {
        last = md;
        setStatus(md === htmlToMd(ed) ? "저장됨" : "편집 중…");
      })
      .catch((e) => setStatus("저장 실패: " + e.message, true));
    return chain;
  };
  const schedule = () => {
    setStatus("편집 중…");
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY_MS);
  };
  current = { flush: save };

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
    if (tip) b.title = tip;
    if (color) b.style.background = color;
    else if (color === null) b.classList.add("none");
    b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the selection
    b.addEventListener("click", () => {
      ed.focus();
      fn();
      schedule();
    });
    parent.append(b);
  };
  const group = (name) => {
    const g = el("span", "grp");
    g.append(el("span", "lab", name));
    bar.append(g);
    return g;
  };
  for (const [label, fn, tip] of BTN) addChip(bar, label, fn, tip);
  const gs = group("크기");
  SIZES.forEach((px, i) => addChip(gs, SIZE_LABELS[i], () => setSize(px), `${px}px · Ctrl+Shift+. / ,`));
  const gc = group("글자색");
  COLORS.forEach((c) => addChip(gc, "", () => run("foreColor", c), c, c));
  const gh = group("형광펜");
  addChip(gh, "", () => run("hiliteColor", "transparent"), "형광펜 없음", null);
  HLS.forEach((c, i) => addChip(gh, "", () => run("hiliteColor", c), i ? c : `${c} · Ctrl+Alt+H`, c));
  addChip(bar, "서식 지우기", clearFormat, "Ctrl+Space");
  bar.append(status);

  // ---- images: upload, then insert <img data-file="files/…">
  async function insertImage(file) {
    const ext = IMG_EXT[file.type] || ".png";
    setStatus("이미지 저장 중…");
    try {
      const { file: rel } = await req(
        "POST",
        `/api/pages/files?path=${encodeURIComponent(path)}&name=${encodeURIComponent("image" + ext)}`,
        file,
        true,
      );
      ed.focus();
      run("insertHTML", `<img src="${fileUrl(rel)}" data-file="${rel}" alt=""><br>`);
      schedule();
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

  // ---- checklist click, Enter, shortcuts
  ed.addEventListener("click", (e) => {
    const li = e.target;
    if (li.tagName === "LI" && li.parentElement.classList.contains("cl") && e.offsetX < 24) {
      li.setAttribute("data-chk", li.getAttribute("data-chk") === "1" ? "0" : "1");
      schedule();
    }
  });
  ed.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && closest("ul.cl")) {
      setTimeout(() => {
        const li = closest("li");
        if (li && li.parentElement.classList.contains("cl")) li.setAttribute("data-chk", "0");
      }, 0);
    }
    if (e.key === "Tab") e.preventDefault(); // nested lists are not supported yet
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (e.altKey && k === "h") {
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
  ed.addEventListener("input", schedule);
  ed.addEventListener("blur", save);
  window.addEventListener("pagehide", save);

  host.replaceChildren(bar, ed);
}
