// Markdown (+ allowed inline HTML) <-> editor HTML. Pure functions, no network.
//
// Stored format (D-15, decided in P3-01):
//   blocks : paragraph, # ## ### headings, "- " bullets, "1. " numbers, "- [ ]/[x]" checklist,
//            ![alt](files/name.png) images, optional width {size=small} {size=orig} {width=480} (P2B-10)
//   inline : **bold** *italic* ~~strike~~ `code`, and ONLY these HTML tags:
//            <u>, <mark style="background:#rrggbb">, <span style="color:#rrggbb;font-size:NNpx">
// Anything else is dropped on save (serializer) or shown as plain text (reader).
// Known limits: links are kept as plain text.
//
// P3-02R (D-20 constraints): the file is cut into blocks (mdblocks.js). Every top-level element remembers the exact
// text it was made from (data-src) and what it serialized to when it was loaded (data-sig). On save an element whose
// serialization still equals data-sig is written from data-src, so a block the user did not touch is never changed by
// a single character, and so are the blank lines between blocks (data-gap). Lists nest (2 spaces per level) and keep the
// journal marks [ ] [x] [*] [!] (li data-m); unknown blocks (code fence, table, quote, comment, rule, ####) are shown
// read-only and written back verbatim.

import { IMG_ATTR_RE, imgCssWidth, imgSuffix, parseImgAttr } from "./memocore.js";
import { listTree, segment } from "./mdblocks.js";
import { STEP } from "./lineeditor-core.js";

export const SIZES = [11, 13, 15, 18, 22, 28]; // px presets (6 steps)
export const BASE_PX = 15;
export const COLORS = ["#1f2430", "#d93025", "#e8710a", "#188038", "#1a73e8", "#7b1fa2", "#6b7280"];
export const HLS = ["#fff176", "#a5f3a5", "#a5d8ff", "#ffc9de", "#ffd8a8"];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const WIKI_TOKEN = /\[\[[^\x00\[\]\\\r\n]+\]\]/g;
const escAttr = (s) => esc(s).replace(/"/g, "&quot;").replace(/\r/g, "&#13;");

// ---------------------------------------------------------------- reader --
function inlineToHtml(text, fileUrl) {
  const hold = [];
  const put = (html) => {
    hold.push(html);
    return `\u0000${hold.length - 1}\u0000`;
  };
  let s = text.replace(/\u0000/g, "");
  s = s.replace(/\\([\\*`~<>[\]!#\-.+_)|])/g, (_, c, offset, line) => put(
    c === "[" && line[offset + 2] === "[" ? '<span data-wiki-literal>[</span>' : esc(c)
  ));
  s = s.replace(new RegExp(`!\\[([^\\]]*)\\]\\((files\\/[^)\\s]+)\\)(${IMG_ATTR_RE})`, "g"), (_, alt, f, attr) => {
    const w = parseImgAttr(attr);
    const css = imgCssWidth(w);
    return put(`<img src="${escAttr(fileUrl(f))}" data-file="${escAttr(f)}" alt="${escAttr(alt)}"${w ? ` data-w="${w}"` : ""}${css ? ` style="width:${css}"` : ""}>`);
  });
  s = s.replace(/`([^`]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
  s = s.replace(WIKI_TOKEN, (token) => put(esc(token)));
  s = s.replace(/<(\/?)u>/gi, (_, c) => put(`<${c}u>`));
  // the journal writes a bare <mark> (default yellow); older notes wrote <mark style="background:#rrggbb">.
  // data-s remembers the styled spelling of the default colour so it is written back the way it was read.
  s = s.replace(/<mark style="background:(#[0-9a-fA-F]{6})">/gi, (_, c) =>
    put(`<mark${c.toLowerCase() === HLS[0] ? ' data-s="1"' : ""} style="background:${c}">`));
  s = s.replace(/<mark>/gi, () => put(`<mark style="background:${HLS[0]}">`));
  s = s.replace(/<\/mark>/gi, () => put("</mark>"));
  s = s.replace(/<span style="([^"]*)">/gi, (_, css) => {
    const color = /color:\s*(#[0-9a-fA-F]{6})/.exec(css);
    const size = /font-size:\s*(\d{1,2})px/.exec(css);
    const decl = [color && `color:${color[1]}`, size && `font-size:${size[1]}px`].filter(Boolean).join(";");
    return put(decl ? `<span style="${decl}">` : "<span>");
  });
  s = s.replace(/<\/span>/gi, () => put("</span>"));
  s = esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]);
}

const HEAD_RE = /^(#{1,3})[ \t]+(.*)$/;

function listHtml(nodes, inl, forceType) {
  let out = "";
  let i = 0;
  while (i < nodes.length) {
    const t = forceType || nodes[i].type;
    let items = "";
    while (i < nodes.length && (forceType || nodes[i].type === t)) {
      const n = nodes[i++];
      const body = inl(n.text);
      const kids = n.kids.length ? listHtml(n.kids, inl) : "";
      items += `<li${n.mark !== null && t === "ul" ? ` data-m="${n.mark}"` : ""}>${body || (kids ? "" : "<br>")}${kids}</li>`;
    }
    out += `<${t}>${items}</${t}>`;
  }
  return out;
}

// Read-only look of a block the editor does not understand. The text is kept in data-src, never re-derived.
function rawHtml(b, at) {
  const lines = b.src.split(/\r\n?|\n/);
  let inner;
  if (b.kind === "code") {
    const lang = (/^ {0,3}(?:`{3,}|~{3,})\s*(\S*)/.exec(lines[0]) || [])[1] || "";
    const body = lines.slice(1);
    if (body.length && /^ {0,3}(?:`{3,}|~{3,})\s*$/.test(body[body.length - 1])) body.pop();
    inner = `<pre>${lang ? `<span class="rb-tag">${esc(lang)}</span>` : ""}<code>${esc(body.join("\n"))}</code></pre>`;
  } else if (b.kind === "table") {
    const rows = lines.map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
    const sep = rows.length > 1 && rows[1].every((c) => /^:?-+:?$/.test(c) || c === "");
    const cell = (tag) => (c) => `<${tag}>${esc(c)}</${tag}>`;
    const head = sep ? `<thead><tr>${rows[0].map(cell("th")).join("")}</tr></thead>` : "";
    const body = (sep ? rows.slice(2) : rows).map((r) => `<tr>${r.map(cell("td")).join("")}</tr>`).join("");
    inner = `<table>${head}<tbody>${body}</tbody></table>`;
  } else if (b.kind === "quote") {
    inner = `<blockquote>${lines.map((l) => esc(l.replace(/^ {0,3}> ?/, ""))).join("<br>")}</blockquote>`;
  } else if (b.kind === "hr") {
    inner = "<hr>";
  } else {
    inner = `<code class="rb-plain">${esc(b.src)}</code>`;
  }
  return `<div class="raw"${at} data-raw="1" data-k="${b.kind}" contenteditable="false" title="앱이 편집하지 않는 블록이에요. 파일에는 원문 그대로 남아요.">${inner}</div>`;
}

export function mdToHtml(md, fileUrl = (f) => f) {
  const seg = segment(md);
  const inl = (t) => inlineToHtml(t, fileUrl);
  const out = seg.blocks.map((b, k) => {
    const at = ` data-src="${escAttr(b.src)}" data-gap="${escAttr(b.gap)}" data-i="${k}"`
      + (k === 0 && seg.pre ? ` data-pre="${escAttr(seg.pre)}"` : "")
      + (k === seg.blocks.length - 1 ? ' data-end="1"' : "");
    if (b.kind === "h") {
      const m = HEAD_RE.exec(b.src.replace(/\s+$/, ""));
      return `<h${m[1].length}${at}>${inl(m[2])}</h${m[1].length}>`;
    }
    if (b.kind === "p") {
      const spaces = b.src.match(/^(?: {2})*/)[0].length;
      const depth = spaces / STEP;
      const indent = depth ? ` data-indent="${depth}" style="--note-depth:${Math.min(depth, 10)}"` : "";
      return `<div${at}${indent}>${inl(b.src.trim())}</div>`;
    }
    if (b.kind === "list") {
      const tree = listTree(b.src);
      return listHtml(tree, inl, tree[0].type).replace(/^<(ul|ol)>/, `<$1${at}>`);
    }
    return rawHtml(b, at);
  });
  return out.join("") || "<div><br></div>";
}

/** Fills `root` from markdown and records, per block, what it serializes to now (the "untouched" test on save). */
export function loadInto(root, md, fileUrl) {
  root.innerHTML = mdToHtml(md, fileUrl);
  root.dataset.eol = md.match(/\r\n|\r|\n/)?.[0] || "\n";
  for (const n of root.children) {
    if (!n.hasAttribute("data-src") || n.hasAttribute("data-raw")) continue;
    const t = [];
    elementBlocks(n, t);
    n.setAttribute("data-sig", t.map((b) => b.text).join("\n\n"));
  }
}

// ------------------------------------------------------------ serializer --
function hex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || "");
  if (!m) return /^#[0-9a-f]{6}$/i.test(c || "") ? c.toLowerCase() : null;
  if (m[4] !== undefined && +m[4] === 0) return null;
  return "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("");
}

const escPlain = (t) =>
  t.replace(/\u00a0/g, " ").replace(/([\\*`~<])/g, "\\$1").replace(/!\[/g, "\\!\\[");
function escText(text) {
  let out = "", offset = 0;
  for (const match of text.matchAll(WIKI_TOKEN)) {
    const prefix = text.slice(offset, match.index);
    const escapes = prefix.match(/\\+$/)?.[0].length || 0;
    out += escapes % 2
      ? escPlain(prefix.slice(0, -1)) + "\\" + match[0]
      : escPlain(prefix) + match[0];
    offset = match.index + match[0].length;
  }
  return out + escPlain(text.slice(offset));
}

function inl(node) {
  let s = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      s += escText(n.textContent);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const t = n.tagName.toLowerCase();
    if (n.hasAttribute("data-wiki-literal") && n.textContent === "[") {
      s += "\\[";
      continue;
    }
    if (t === "br") {
      s += "\n";
      continue;
    }
    if (t === "img") {
      const f = n.getAttribute("data-file");
      if (f) s += `![${(n.getAttribute("alt") || "").replace(/[\]\n]/g, "")}](${f})${imgSuffix(n.getAttribute("data-w"))}`;
      continue;
    }
    if (t === "code") {
      const c = n.textContent;
      if (c && !c.includes("`")) s += `\`${c}\``;
      else s += escText(c);
      continue;
    }
    if (/^(ul|ol|div|p|h[1-6]|li)$/.test(t)) {
      s += inl(n); // stray nested block inside an inline run
      continue;
    }
    let inner = inl(n);
    if (!inner) continue;
    const st = n.style || {};
    const fw = st.fontWeight;
    if (t === "b" || t === "strong" || fw === "bold" || +fw >= 600) inner = `**${inner}**`;
    if (t === "i" || t === "em" || st.fontStyle === "italic") inner = `*${inner}*`;
    const deco = st.textDecorationLine || st.textDecoration || "";
    if (t === "s" || t === "strike" || t === "del" || deco.includes("line-through")) inner = `~~${inner}~~`;
    if (t === "u" || deco.includes("underline")) inner = `<u>${inner}</u>`;
    const bg = hex(st.backgroundColor);
    if (bg) {
      // default yellow is the journal's bare <mark>, unless the file spelled it with a style
      inner = bg === HLS[0] && !n.hasAttribute("data-s") ? `<mark>${inner}</mark>` : `<mark style="background:${bg}">${inner}</mark>`;
    }
    const col = hex(st.color);
    const fs = parseFloat(st.fontSize);
    const css = [];
    if (col && COLORS.includes(col) && col !== COLORS[0]) css.push(`color:${col}`);
    if (fs && SIZES.includes(fs) && fs !== BASE_PX) css.push(`font-size:${fs}px`);
    if (css.length) inner = `<span style="${css.join(";")}">${inner}</span>`;
    s += inner;
  }
  return s;
}

// Line-start characters that would be read as block markers must be escaped.
const LINE_START = /^(#{1,6}(?:\s|$)|[-+](?:\s|$)|-{3,}\s*$|_{3,}\s*$|[>|])/;
function paragraphText(raw) {
  const lines = raw.split("\n").map((l) => l.replace(/^\s+|\s+$/g, ""));
  return lines
    .filter((l, i) => l || (i > 0 && i < lines.length - 1))
    .map((l) => (LINE_START.test(l) ? "\\" + l : l.replace(/^(\d+)([.)])(\s|$)/, "$1\\$2$3")))
    .join("\n");
}

export const MARK_VALUES = [" ", "x", "*", "!"];

function itemText(li) {
  const body = document.createElement("div");
  const subs = [];
  for (const c of li.childNodes) {
    if (c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName)) subs.push(c);
    else body.append(c.cloneNode(true));
  }
  const text = inl(body).replace(/\s*\n\s*/g, " ").trim();
  return { text: /^\[[ xX*!]\](\s|$)/.test(text) ? "\\" + text : text, subs };
}

function listLines(list, depth, out) {
  const ordered = list.tagName === "OL";
  let i = 0;
  for (const li of list.children) {
    if (/^(UL|OL)$/.test(li.tagName)) { // a list directly inside a list (browser indent output)
      listLines(li, depth + 1, out);
      continue;
    }
    if (li.tagName !== "LI") continue;
    i++;
    const { text, subs } = itemText(li);
    const m = li.getAttribute("data-m");
    const mark = !ordered && MARK_VALUES.includes(m) ? `[${m}] ` : "";
    out.push((" ".repeat(depth * 2) + (ordered ? `${i}. ` : "- ") + mark + text).replace(/\s+$/, ""));
    subs.forEach((s) => listLines(s, depth + 1, out));
  }
}

const BLOCK_CHILD = /^(div|p|h[1-6]|ul|ol)$/i;

function elementBlocks(n, out) {
  const t = n.tagName.toLowerCase();
  if (/^h[1-6]$/.test(t)) {
    const text = inl(n).replace(/\s*\n\s*/g, " ").trim();
    if (text) out.push({ text: "#".repeat(Math.min(+t[1], 3)) + " " + text });
  } else if (t === "ul" || t === "ol") {
    const lines = [];
    listLines(n, 0, lines);
    if (lines.length) out.push({ text: lines.join("\n"), list: true });
  } else if ([...n.children].some((c) => BLOCK_CHILD.test(c.tagName))) {
    blocks(n, out);
  } else {
    const text = paragraphText(inl(n));
    if (text.trim()) {
      const depth = Number(n.dataset.indent) || 0;
      const prefix = " ".repeat(depth * STEP);
      out.push({ text: prefix ? text.replace(/^/gm, prefix) : text });
    }
  }
}

const BLOCK_TAG = /^(div|p|h[1-6]|ul|ol|blockquote|pre|table)$/;

function blocks(root, out, top = false) {
  let loose = [];
  const flushLoose = () => {
    const wrap = document.createElement("div");
    loose.forEach((n) => wrap.append(n.cloneNode(true)));
    loose = [];
    const text = paragraphText(inl(wrap));
    if (text.trim()) out.push({ text });
  };
  for (const n of root.childNodes) {
    const t = n.nodeType === 1 ? n.tagName.toLowerCase() : "";
    if (!t || !BLOCK_TAG.test(t)) {
      loose.push(n);
      continue;
    }
    flushLoose();
    if (!top) {
      elementBlocks(n, out);
      continue;
    }
    // top level: an untouched block is written from the text it was read from
    const src = n.getAttribute("data-src");
    if (src !== null && n.hasAttribute("data-raw")) {
      out.push({ text: src, el: n, end: true, original: true });
      continue;
    }
    const mine = [];
    elementBlocks(n, mine);
    if (src !== null && n.getAttribute("data-sig") === mine.map((b) => b.text).join("\n\n")) {
      out.push({ text: src, el: n, end: true, original: true });
    } else {
      mine.forEach((b, k) => out.push({ ...b, el: n, end: k === mine.length - 1 }));
    }
  }
  flushLoose();
}

// Blank lines between blocks come from the file when both neighbours are still neighbours; otherwise one blank line.
function assemble(pieces, root) {
  if (!pieces.length) return "";
  const num = (e, a) => (e && e.hasAttribute(a) ? +e.getAttribute(a) : NaN);
  let res = "";
  const eol = root.dataset?.eol || "\n";
  const first = pieces[0].el;
  if (first && num(first, "data-i") === 0 && first.hasAttribute("data-pre")) res += first.getAttribute("data-pre");
  pieces.forEach((p, k) => {
    res += p.original ? p.text : p.text.replace(/\n/g, eol);
    const nx = pieces[k + 1];
    const el = p.el;
    const keep = el && p.end && el.hasAttribute("data-gap");
    if (!nx) res += keep && el.hasAttribute("data-end") ? el.getAttribute("data-gap") : eol;
    else res += keep && nx.el && nx.el !== el && num(nx.el, "data-i") === num(el, "data-i") + 1 ? el.getAttribute("data-gap") : eol + eol;
  });
  return res;
}

export function htmlToMd(root) {
  const pieces = [];
  blocks(root, pieces, true);
  return assemble(pieces, root);
}
