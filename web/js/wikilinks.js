import { api } from "./api.js";

const MATCH = /\[\[([^\[\]\r\n]+)\]\]/g;
const INCOMPLETE = /(^|[^\\\[])\[\[([^\[\]\r\n]*)$/;
const HIGHLIGHT = "mi-wiki-link";
const EXCLUDED = "code, [data-raw], [data-wiki-literal], [contenteditable=false]";
const key = value => value.trim().normalize("NFC").toLowerCase();
let pages = [];
let byPath = new Map();
let byTitle = new Map();
let counter = 0;

export function pageHash(path) {
  return "#/page/" + path.split("/").map(encodeURIComponent).join("/");
}

export function setWikiPages(tree) {
  pages = [];
  byPath = new Map();
  byTitle = new Map();
  const walk = nodes => nodes.forEach(page => {
    pages.push(page);
    byPath.set(key(page.path), page);
    const k = key(page.title);
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(page);
    walk(page.children);
  });
  walk(tree);
  document.dispatchEvent(new Event("wiki-catalog"));
}

function resolve(value) {
  const k = key(value);
  const titles = byTitle.get(k);
  return byPath.get(k) || (titles?.length === 1 ? titles[0] : undefined);
}

function reference(page) {
  return resolve(page.title) === page && !/[\\\[\]\r\n]/.test(page.title) ? page.title : page.path;
}

function suggestions(query) {
  const q = key(query);
  return pages
    .filter(page => !page.auto && !/[\[\]\r\n]/.test(reference(page)))
    .filter(page => key(page.title).includes(q) || key(page.path).includes(q))
    .sort((a, b) => Number(key(b.title).startsWith(q)) - Number(key(a.title).startsWith(q))
      || a.title.localeCompare(b.title, "ko") || a.path.localeCompare(b.path, "ko"))
    .slice(0, 8);
}

function linkSpans(node) {
  if (node?.nodeType !== Node.TEXT_NODE || node.parentElement?.closest(EXCLUDED)) return [];
  return [...node.data.matchAll(MATCH)].flatMap(match => {
    if (node.data.slice(0, match.index).match(/\\+$/)?.[0].length % 2) return [];
    const page = resolve(match[1]);
    return page ? [{ start: match.index, end: match.index + match[0].length, page }] : [];
  });
}

function textRange(node, start, end) {
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

export function bindWikiEditor(editor, host) {
  const popup = document.createElement("div");
  popup.className = "wiki-suggest";
  popup.id = "wiki-suggest-" + (++counter);
  popup.setAttribute("role", "listbox");
  popup.setAttribute("aria-label", "페이지 링크 제안");
  popup.hidden = true;
  host.append(popup);
  const ranges = [];
  let frame = 0, active = 0, context, items = [], dismissed;

  const highlight = () => {
    frame = 0;
    if (!globalThis.CSS?.highlights || !globalThis.Highlight) return;
    if (!CSS.highlights.has(HIGHLIGHT)) CSS.highlights.set(HIGHLIGHT, new Highlight());
    const group = CSS.highlights.get(HIGHLIGHT);
    for (const range of ranges.splice(0)) group.delete(range);
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node; (node = walker.nextNode());) {
      for (const match of linkSpans(node)) {
        const range = textRange(node, match.start, match.end);
        ranges.push(range);
        group.add(range);
      }
    }
  };
  const enqueue = () => { if (!frame) frame = requestAnimationFrame(highlight); };

  function hide() {
    popup.hidden = true;
    editor.removeAttribute("aria-activedescendant");
    editor.removeAttribute("aria-controls");
    context = null;
  }

  function choose(index) {
    const { node, start, offset } = context || {};
    const page = items[index];
    if (!page || !editor.contains(node)) return;
    const closing = /^[^\[\]\r\n]*\]\]/.exec(node.data.slice(offset))?.[0].length || 0;
    getSelection().removeAllRanges();
    getSelection().addRange(textRange(node, start, offset + closing));
    hide();
    document.execCommand("insertText", false, "[[" + reference(page) + "]]");
  }

  function markActive(scroll = false) {
    [...popup.children].forEach((item, i) => item.setAttribute("aria-selected", String(i === active)));
    const row = popup.children[active];
    editor.setAttribute("aria-activedescendant", row.id);
    if (scroll) row.scrollIntoView({ block: "nearest" });
  }

  function refresh() {
    if (document.activeElement !== editor) return hide();
    const selection = getSelection();
    const node = selection?.anchorNode;
    if (!selection?.isCollapsed || node?.nodeType !== Node.TEXT_NODE || !editor.contains(node)
      || node.parentElement?.closest(EXCLUDED)) return hide();
    const offset = selection.anchorOffset;
    const prefix = node.data.slice(0, offset);
    const match = INCOMPLETE.exec(prefix);
    if (!match || (dismissed?.node === node && dismissed.prefix === prefix)) return hide();
    const fresh = { node, offset, start: offset - match[2].length - 2, prefix };
    if (context?.node === node && context.prefix === prefix && !popup.hidden) return;
    active = 0;
    context = fresh;
    items = suggestions(match[2]);
    if (!items.length) return hide();

    popup.replaceChildren(...items.map((page, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.tabIndex = -1;
      row.id = popup.id + "-" + i;
      row.setAttribute("role", "option");
      const title = document.createElement("span");
      title.textContent = page.title;
      const detail = document.createElement("small");
      detail.textContent = page.path;
      row.append(title, detail);
      row.addEventListener("mousedown", (event) => event.preventDefault());
      row.addEventListener("click", () => choose(i));
      return row;
    }));
    const r = textRange(node, offset, offset).getBoundingClientRect();
    popup.hidden = false;
    popup.style.left = Math.max(12, Math.min(r.left, innerWidth - popup.offsetWidth - 12)) + "px";
    const top = r.bottom + popup.offsetHeight + 16 > innerHeight
      ? Math.max(10, r.top - popup.offsetHeight - 6) : r.bottom + 4;
    popup.style.top = top + "px";
    editor.setAttribute("aria-controls", popup.id);
    markActive();
  }

  function openAt(node, offset) {
    const hit = linkSpans(node).find(({ start, end }) => offset >= start && offset <= end);
    if (!hit || !editor.contains(node)) return false;
    location.hash = pageHash(hit.page.path);
    return true;
  }

  editor.addEventListener("click", (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
    if (range && openAt(range.startContainer, range.startOffset)) event.preventDefault();
  });
  editor.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.altKey && !event.ctrlKey && event.key === "Enter") {
      const selection = getSelection();
      if (openAt(selection?.anchorNode, selection?.anchorOffset)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    if (popup.hidden || !["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === "Escape") { dismissed = context; hide(); }
    else if (event.key === "Enter" || event.key === "Tab") choose(active);
    else {
      active = (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      markActive(true);
    }
  }, true);
  let composing = false;
  const update = () => { if (!composing) refresh(); };
  editor.addEventListener("compositionstart", () => { composing = true; hide(); });
  editor.addEventListener("compositionend", () => { composing = false; update(); });
  editor.addEventListener("input", update);
  editor.addEventListener("blur", hide);
  document.addEventListener("selectionchange", update);
  const updateCatalog = () => {
    enqueue();
    if (context) { context = null; update(); }
  };
  document.addEventListener("wiki-catalog", updateCatalog);
  const onScroll = (event) => { if (event.target !== popup) hide(); };
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", hide);
  const observer = new MutationObserver(enqueue);
  observer.observe(editor, { subtree: true, characterData: true, childList: true });
  enqueue();
  return () => {
    cancelAnimationFrame(frame);
    for (const range of ranges) globalThis.CSS?.highlights?.get(HIGHLIGHT)?.delete(range);
    observer.disconnect();
    document.removeEventListener("selectionchange", update);
    document.removeEventListener("wiki-catalog", updateCatalog);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", hide);
  };
}

export function mountBacklinks(host, path) {
  const info = document.createElement("section");
  info.className = "page-backlinks";
  info.hidden = true;
  host.append(info);
  api.backlinks(path).then(entries => {
    if (!info.isConnected || !entries.length) return;
    const title = document.createElement("h3");
    title.textContent = "이 페이지를 참조하는 페이지";
    const list = document.createElement("ul");
    for (const entry of entries) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = pageHash(entry.path);
      a.textContent = entry.title;
      a.title = entry.path;
      li.append(a);
      list.append(li);
    }
    info.append(title, list);
    info.hidden = false;
  }).catch(() => {
    if (!info.isConnected) return;
    info.textContent = "참조 페이지를 불러오지 못했어요.";
    info.hidden = false;
  });
}
