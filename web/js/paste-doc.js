// Clipboard HTML -> note document (V-007). Pure functions: no DOM, no network, so Node can test them.
//
// OneNote (desktop and web), Word, Outlook and ordinary web pages put rich HTML on the clipboard. This module reads it with
// the tolerant tokenizer of paste-html.js (so nothing is ever turned into live DOM: scripts, event handlers and external
// resources cannot run or load) and builds a small document model:
//   items: { k: "p" | "h" | "li" | "code" | "hr" | "raw" | "table", ... }
// `docToMarkdown` writes the model as the note's own markdown (D-15 / D-20 / D-21: paragraphs with 2-space indent,
// # .. ### headings, "- " / "1. " lists nested by 2 spaces, "- [ ] / [x] / [*] / [!]" marks, images, GFM tables). The note
// editor then loads that markdown like a file, so the pasted blocks behave exactly like blocks that were typed.
//
// What is mapped: bold / italic / underline / strike, font size -> nearest of the 6 size presets (relative to the document's
// own body size), font color -> nearest of 7, highlight -> nearest of 5, links. What is ignored on purpose: font family,
// margins other than the indent step, line height, borders, alignment outside tables.

import {
  applyStyle, baseStyle, collectRuns, cssPx, excelOverflowOf, hasContentOutsideTables, htmlToBlocks, isExcelHtml,
  pasteNotes, registerBlockParser, runsToLines, runsToMarkdown, styleOf, tableBlockToSource, tableFromNode, textOf,
  tsvToBlock, walk,
} from "./paste-html.js";

export const DOC_LIMITS = { html: 6000000, items: 4000, images: 30, imageBytes: 12 * 1024 * 1024, level: 8 };
export const INDENT_PX = 44; // one indent level: OneNote and Word step by .375in / .5in (36 / 48 px)
const NBSP_LEVEL = 4; // this many leading non-breaking spaces count as one indent level

const BLOCKISH = new Set([
  "p", "div", "section", "article", "header", "footer", "main", "aside", "nav", "center", "blockquote", "form", "fieldset",
  "address", "figure", "figcaption", "dl", "dt", "dd", "details", "summary", "body", "html", "ul", "ol", "table", "pre", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6", "li", "caption", "tbody", "thead", "tfoot", "tr", "td", "th",
]);
const NOT_CONTENT = new Set(["head", "style", "script", "xml", "title", "meta", "link", "template", "noscript", "object", "iframe", "svg", "canvas", "o:p"]);
const HEADING = /^h([1-6])$/;

// ---------------------------------------------------------------- small helpers --
const hiddenNode = (node, rules) => {
  const css = styleOf(node, rules);
  return /^none$/i.test(css.display || "") || /mso-hide:\s*all/i.test(node.attrs?.style || "") || node.attrs?.hidden !== undefined;
};

/** left margin / padding in px (0 when absent or negative) */
function indentPxOf(css) {
  const px = (value) => (value ? cssPx(String(value).trim().split(/\s+/)[0], 16) || 0 : 0);
  let left = px(css["margin-left"]) + px(css["padding-left"]);
  if (css.margin && !css["margin-left"]) {
    const parts = css.margin.trim().split(/\s+/);
    left += px(parts.length === 4 ? parts[3] : parts.length >= 2 ? parts[1] : parts[0]);
  }
  return left > 0 ? left : 0;
}

const levelOf = (px) => Math.min(DOC_LIMITS.level, Math.max(0, Math.round(px / INDENT_PX)));

/** Typed indentation at the very start of a paragraph: tabs, mso-tab-count spans, runs of non-breaking spaces. */
export function leadingIndent(node) {
  let tabs = 0;
  let nbsp = 0;
  let done = false;
  const visit = (n) => {
    if (done) return;
    if (n.text !== undefined) {
      for (const ch of n.text) {
        if (ch === "\t") tabs++;
        else if (ch === " ") nbsp++;
        else if (ch === " " || ch === " ") nbsp += 2;
        else if (/\s/.test(ch)) continue;
        else { done = true; return; }
      }
      return;
    }
    const count = n.tag === "span" ? /mso-tab-count:\s*(\d+)/i.exec(n.attrs?.style || "") : null;
    if (count) { tabs += +count[1]; return; }
    if (n.tag === "br" || n.tag === "img" || n.tag === "input" || NOT_CONTENT.has(n.tag)) { if (n.tag !== "o:p") done = true; return; }
    for (const child of n.children || []) visit(child);
  };
  visit(node);
  return Math.min(DOC_LIMITS.level, tabs + Math.floor(nbsp / NBSP_LEVEL));
}

// ---------------------------------------------------------------- tags / to-do marks --
const GLYPH = {
  "☐": " ", "□": " ", "❏": " ", "❐": " ", "❑": " ", "⬜": " ", "🔲": " ",
  "☑": "x", "☒": "x", "✅": "x", "✔": "x", "✓": "x", "🗹": "x",
  "★": "*", "☆": "*", "⭐": "*", "✰": "*", "🌟": "*",
  "❗": "!", "❕": "!", "‼": "!",
};

function tagMark(value) {
  const v = String(value || "").toLowerCase();
  if (!v) return null;
  if (/to-?do/.test(v) && /(complete|checked|done)/.test(v)) return "x";
  if (/to-?do|checkbox/.test(v)) return " ";
  if (/important|critical|urgent/.test(v)) return "!";
  if (/\bstar\b/.test(v)) return "*";
  return null;
}

/** OneNote To Do tags travel as small pictures with an alt text; the clipboard has no other record of them. */
function tagFromImage(alt, small) {
  const a = String(alt || "").toLowerCase();
  if (!a || !small) return null;
  if (/(to ?do|check ?box|task|할 ?일|확인란)/.test(a)) return /(complete|checked|done|완료)/.test(a) ? "x" : " ";
  if (/(important|critical|중요)/.test(a)) return "!";
  if (/(star|별)/.test(a)) return "*";
  return null;
}

function nodeMark(node) {
  const own = node.attrs || {};
  if (own["data-m"] !== undefined && " x*!".includes(own["data-m"]) && own["data-m"].length === 1) return own["data-m"]; // this app's own copy
  let mark = tagMark(own["data-tag"]);
  if (mark !== null) return mark;
  const first = (node.children || []).find((c) => c.tag);
  mark = first && first.tag !== "ul" && first.tag !== "ol" ? tagMark(first.attrs?.["data-tag"]) : null;
  if (mark !== null) return mark;
  for (const n of walk(node)) { // a real checkbox before the first text
    if (n.text !== undefined && /\S/.test(n.text)) break;
    if (n.tag === "input" && /checkbox/i.test(n.attrs.type || "")) return n.attrs.checked !== undefined ? "x" : " ";
    if (n.tag === "ul" || n.tag === "ol") break;
  }
  return null;
}

/** Takes the mark (tag runs, a leading glyph, attributes) out of the first line. Returns the mark or null. */
function takeMark(node, lines) {
  let mark = nodeMark(node);
  const first = lines[0];
  if (!first) return mark;
  for (let k = first.length - 1; k >= 0; k--) {
    if (first[k].tag === undefined) continue;
    mark = first[k].tag;
    first.splice(k, 1);
  }
  const head = first[0];
  if (head && head.text) {
    const [ch] = head.text;
    const glyph = GLYPH[ch];
    if (glyph) {
      mark = glyph;
      head.text = head.text.slice(ch.length).replace(/^\s+/, "");
      if (!head.text) first.shift();
    }
  }
  return mark;
}

// ---------------------------------------------------------------- images --
/** What a pasted <img> points at. Only data:, blob: and this app's own files can be read; the rest is never fetched. */
export function classifyImageSrc(src) {
  const s = String(src || "").trim();
  if (/^data:image\//i.test(s)) return "data";
  if (/^blob:/i.test(s)) return "blob";
  if (/^\/api\//.test(s)) return "app";
  if (/^file:/i.test(s) || /^[a-z]:[\\/]/i.test(s) || s.startsWith("\\\\")) return "file";
  if (/^https?:/i.test(s)) return "web";
  return "other";
}

const IMAGE_TYPES = { "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/bmp": ".bmp" };

/** data:image/png;base64,... -> { type, ext, bytes } or null (unknown type such as svg / emf, broken data). */
export function decodeDataUri(src) {
  const m = /^data:(image\/[a-z0-9.+-]+)((?:;[^,;]*)*),([\s\S]*)$/i.exec(String(src || "").trim());
  if (!m) return null;
  const type = m[1].toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) return null;
  try {
    if (/;base64/i.test(m[2])) {
      const bin = atob(m[3].replace(/\s+/g, ""));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return bytes.length ? { type: type === "image/jpg" ? "image/jpeg" : type, ext, bytes } : null;
    }
    const bin = decodeURIComponent(m[3]);
    return bin ? { type, ext, bytes: new TextEncoder().encode(bin) } : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- document walk --
function detectSource(root) {
  let seen = 0;
  for (const node of walk(root)) {
    if (++seen > 600) break;
    if (node.tag === "meta" && /^generator$/i.test(node.attrs.name || "")) {
      const g = node.attrs.content || "";
      if (/onenote/i.test(g)) return "OneNote";
      if (/outlook/i.test(g)) return "Outlook";
      if (/word/i.test(g)) return "Word";
    }
    if (/\b(OutlineElement|TextRun|NormalTextRun|ListContainerWrapper)\b/.test(node.attrs?.class || "")) return "OneNote 웹";
    if (/\bMso[A-Z]\w*/.test(node.attrs?.class || "")) return "Word";
  }
  return "";
}

function msoListLevel(css) {
  const m = /level(\d+)/i.exec(css["mso-list"] || "");
  return m ? +m[1] : 0;
}

function wordMarker(node) {
  for (const n of walk(node)) {
    if (n.attrs && /mso-list:\s*ignore/i.test(n.attrs.style || "")) return textOf(n).replace(/[\s ]+/g, " ").trim();
  }
  return null;
}

const ORDERED_MARKER = /^(\(?\d+|[a-z]{1,3}|[ivxlcdm]+)[.)]$/i;
const LEADING_SYMBOL = /^[\s ]*(?:[·•o§Ø●■□◦▪\-–—]|\(?\d+[.)]|\(?[a-z][.)])[\s ]+/i;

/** Several lines inside one list item become one line (a markdown list item is a single line). */
function mergeLines(lines) {
  const merged = [];
  for (const line of lines) {
    const last = merged.findLast((run) => run.text !== undefined);
    if (last && line.length) merged.push({ ...last, text: " ", href: undefined });
    merged.push(...line);
  }
  return runsToLines(merged)[0] || [];
}

function walkDocument(body, doc, rules) {
  const st = {
    rules,
    items: [],
    images: new Map(),
    truncated: false,
    image(node) {
      const css = styleOf(node, rules);
      const num = (v) => (v ? parseFloat(v) || 0 : 0);
      const w = num(node.attrs.width) || num(css.width);
      const h = num(node.attrs.height) || num(css.height);
      const src = (node.attrs.src || "").trim();
      const tag = tagFromImage(node.attrs.alt || node.attrs.title, (w && w <= 32) || (h && h <= 32) || (!w && !h));
      if (tag !== null) return { tag };
      if (!src || (w && w <= 2) || (h && h <= 2)) return null;
      if (!st.images.has(src)) {
        if (st.images.size >= DOC_LIMITS.images) { st.skippedImages = (st.skippedImages || 0) + 1; return null; }
        st.images.set(src, { src, alt: node.attrs.alt || "" });
      }
      return { image: st.images.get(src) };
    },
  };
  const push = (item) => {
    if (st.items.length >= DOC_LIMITS.items) { st.truncated = true; return; }
    st.items.push(item);
  };

  const emitList = (list, ctx) => {
    const ordered = list.tag === "ol";
    const depth = ctx.listDepth + 1;
    for (const child of list.children) {
      if (child.text !== undefined || NOT_CONTENT.has(child.tag) || hiddenNode(child, rules)) continue;
      if (child.tag === "li") emitListItem(child, ordered, depth, ctx);
      else if (child.tag === "ul" || child.tag === "ol") emitList(child, { ...ctx, listDepth: depth }); // OneNote nests lists directly
      else {
        const loose = [];
        walkChild(child, { ...ctx, listDepth: depth }, loose);
        flushLoose(loose, { ...ctx, listDepth: depth });
      }
    }
  };

  const emitListItem = (li, ordered, depth, ctx) => {
    const aria = parseInt(li.attrs["data-aria-level"], 10);
    const structural = aria > 0 ? aria - 1 : depth;
    const style = applyStyle(ctx.style, li, rules);
    const content = { tag: "li", attrs: li.attrs, children: li.children.filter((c) => c.tag !== "ul" && c.tag !== "ol"), parent: li.parent };
    const lines = runsToLines(collectRuns(content, style, rules, [], { image: st.image }));
    const mark = takeMark(li, lines);
    const line = mergeLines(lines);
    if (line.length) push({ k: "li", depth: structural + ctx.baseDepth, ordered: ordered && mark === null, mark, lines: [line] });
    for (const nested of li.children) {
      if (nested.tag === "ul" || nested.tag === "ol") emitList(nested, { ...ctx, listDepth: structural, style });
    }
  };

  /** A block whose children are only inline: one item per line. */
  const emitLeaf = (node, ctx, excelOverflow = null) => {
    const css = styleOf(node, rules);
    const style = applyStyle(ctx.style, node, rules);
    const lead = leadingIndent(node);
    const level = Number(node.attrs?.["data-indent"]) || 0;
    const mso = msoListLevel(css);
    const headingClass = /^(?:Heading|MsoHeading)\s*([1-6])$/i.exec((node.attrs?.class || "").split(/\s+/)[0] || "");
    const lines = runsToLines(collectRuns(node, style, rules, [], { image: st.image, excelOverflow }));
    if (!lines.length) return;
    if (excelOverflow) st.hasExcelOverflow = true;
    const indent = Math.min(DOC_LIMITS.level, levelOf(ctx.indentPx + indentPxOf(css)) + lead + level);
    if (mso) {
      const marker = wordMarker(node);
      let ordered = marker !== null && ORDERED_MARKER.test(marker);
      if (marker === null && lines[0][0]?.text) { // the bullet span did not survive the clipboard: strip it from the text
        const m = LEADING_SYMBOL.exec(lines[0][0].text);
        if (m) { ordered = /\d|[a-z][.)]/i.test(m[0]) && /[.)]/.test(m[0]); lines[0][0].text = lines[0][0].text.slice(m[0].length); }
      }
      const mark = takeMark(node, lines);
      const line = mergeLines(lines);
      if (line.length) push({ k: "li", depth: mso - 1 + ctx.baseDepth, ordered: ordered && mark === null, mark, lines: [line] });
      return;
    }
    const heading = HEADING.exec(node.tag) || headingClass;
    if (heading) {
      const line = mergeLines(lines).map((run) => (run.text === undefined ? run : { ...run, b: false, size: 0 }));
      if (line.some((run) => run.text || run.image)) push({ k: "h", level: Math.min(3, +heading[1]), lines: [line] });
      return;
    }
    const tagged = takeMark(node, lines);
    for (const line of lines) {
      if (!line.length) continue;
      if (tagged !== null && line === lines[0]) push({ k: "li", depth: indent + ctx.baseDepth, ordered: false, mark: tagged, lines: [line] });
      else push({ k: "p", level: indent, lines: [line] });
    }
  };

  const hasBlockChild = (node) => (node.children || []).some((c) => c.tag && BLOCKISH.has(c.tag) && c.tag !== "td" && c.tag !== "th");

  function walkChild(child, ctx, loose) {
    if (child.text !== undefined) { loose.push(child); return; }
    if (NOT_CONTENT.has(child.tag) || hiddenNode(child, rules)) return;
    const tag = child.tag;
    if (!BLOCKISH.has(tag)) { loose.push(child); return; }
    flushLoose(loose, ctx);
    if (child.attrs["data-raw"] !== undefined && child.attrs["data-src"]) { // a block copied from a note: its text is the truth
      push({ k: "raw", src: child.attrs["data-src"] });
      return;
    }
    if (tag === "ul" || tag === "ol") { emitList(child, { ...ctx, listDepth: ctx.listDepth ?? -1 }); return; }
    if (tag === "li") { emitListItem(child, false, (ctx.listDepth ?? -1) + 1, ctx); return; }
    if (tag === "table") { emitTable(child, ctx); return; }
    if (tag === "hr") { push({ k: "hr" }); return; }
    if (tag === "pre") {
      const text = textOf(child).replace(/\r\n?/g, "\n").replace(/^\n+|\s+$/g, "");
      if (text.trim()) push({ k: "code", text });
      return;
    }
    const css = styleOf(child, rules);
    const mso = msoListLevel(css);
    if (HEADING.test(tag) || mso || !hasBlockChild(child)) { emitLeaf(child, ctx); return; }
    const next = { ...ctx, style: applyStyle(ctx.style, child, rules), indentPx: ctx.indentPx + indentPxOf(css) + (tag === "blockquote" ? INDENT_PX : 0) };
    walkChildren(child, next);
  }

  function flushLoose(loose, ctx) {
    if (!loose.length) return;
    const nodes = loose.splice(0);
    if (!nodes.some((n) => (n.text !== undefined ? /[^\s ]/.test(n.text) : n.tag === "img" || n.tag === "br" || textOf(n).trim()))) return;
    emitLeaf({ tag: "div", attrs: {}, children: nodes, parent: null }, ctx);
  }

  function walkChildren(node, ctx) {
    const loose = [];
    for (const child of node.children || []) walkChild(child, ctx, loose);
    flushLoose(loose, ctx);
  }

  function emitTable(node, ctx) {
    const cells = [...walk(node)].filter((n) => n.tag === "td" || n.tag === "th");
    if (cells.length === 1) {
      const cell = cells[0];
      const excelOverflow = isExcelHtml(doc) && !hasContentOutsideTables(doc.root) && excelOverflowOf(cell);
      if (excelOverflow) {
        if (!hiddenNode(cell, rules) && !hiddenNode(cell.parent, rules)) emitLeaf(cell, ctx, excelOverflow);
      } else { // a layout table (Outlook) or an ordinary single cell
        walkChildren(cell, { ...ctx, style: applyStyle(ctx.style, cell, rules) });
      }
      return;
    }
    const block = tableFromNode(node, rules);
    if (block.rows.length) push({ k: "table", block });
  }

  return { st, walkChildren, emitTable };
}

/** Font size of the document's normal text, in px: the size most characters have (11pt when the document has no clear body). */
function referenceSize(body, rules, startPx) {
  const histogram = new Map();
  const runs = collectRuns(body, { ...baseStyle(), px: startPx, size: 0, ref: 16 }, rules, []);
  for (const run of runs) {
    if (run.text === undefined) continue;
    const key = Math.round(run.px * 2) / 2;
    histogram.set(key, (histogram.get(key) || 0) + run.text.trim().length);
  }
  let best = 0;
  let bestWeight = 0;
  for (const [px, weight] of histogram) if (weight > bestWeight) { best = px; bestWeight = weight; }
  // 11pt, 12pt and the browser default 16px all read as the normal size; a document that is clearly smaller or larger sets its own
  return best >= 11 && best <= 20 && (best < 14 || best > 16.5) ? best : (11 * 4) / 3;
}

const bodyOf = (root) => {
  for (const node of walk(root)) if (node.tag === "body") return node;
  return root;
};

/** Parser registered with paste-html.js: any clipboard HTML that is more than a table becomes a document block. */
export function documentFromParsed(parsed) {
  const { root } = parsed;
  const rules = parsed.rules || [];
  const body = bodyOf(root);
  const bodyCss = body.tag === "body" ? styleOf(body, rules) : {};
  const startPx = cssPx(bodyCss["font-size"], 16) || 16;
  const ref = referenceSize(body, rules, startPx);
  const { st, walkChildren } = walkDocument(body, parsed, rules);
  const style = { ...baseStyle(), px: startPx, size: 0, ref };
  walkChildren(body, { style, indentPx: 0, listDepth: -1, baseDepth: 0 });
  const items = st.items;
  const block = {
    type: "doc",
    items,
    images: [...st.images.values()],
    source: detectSource(root),
    truncated: st.truncated,
    skippedImages: st.skippedImages || 0,
    hasExcelOverflow: Boolean(st.hasExcelOverflow),
  };
  block.hasFormat = items.some((item) => (item.lines || []).some((line) => line.some((run) => run.b || run.i || run.u || run.s || run.color || run.bg || run.size || run.href))
    || (item.k === "table" && item.block.hasFormat));
  block.stats = docStats(block);
  return block;
}

registerBlockParser("document", documentFromParsed); // runs after the table parser, which keeps sheets that are only a table

function docStats(block) {
  const stats = { paragraphs: 0, headings: 0, items: 0, todos: 0, tables: 0, code: 0, images: block.images.length };
  for (const item of block.items) {
    if (item.k === "p") stats.paragraphs++;
    else if (item.k === "h") stats.headings++;
    else if (item.k === "li") { stats.items++; if (item.mark !== null) stats.todos++; }
    else if (item.k === "table") stats.tables++;
    else if (item.k === "code" || item.k === "raw") stats.code++;
  }
  return stats;
}

// ---------------------------------------------------------------- markdown --
const LINE_START = /^(#{1,6}(?:\s|$)|[-+](?:\s|$)|-{3,}\s*$|_{3,}\s*$|[>|]|<!--)/;
/** Line-start characters that would be read as a block marker must be escaped (same rule as mdconv's paragraphText). */
export function escapeLineStart(text) {
  if (LINE_START.test(text)) return "\\" + text;
  return text.replace(/^(\d+)([.)])(\s|$)/, "$1\\$2$3");
}

const lineText = (item, format, refs) => runsToMarkdown(item.lines, format, refs).trim();

function listBlocks(group, format, refs, eol) {
  if (!group.length) return [];
  const shift = Math.min(...group.map((item) => item.depth));
  const blocks = [];
  let lines = [];
  let prev = -1;
  const levels = []; // levels[d] = { ordered, n }
  let rootOrdered = null;
  for (const item of group) {
    const text = lineText(item, format, refs);
    if (!text && item.mark === null) continue;
    const depth = Math.max(0, Math.min(item.depth - shift, prev + 1, DOC_LIMITS.level));
    const ordered = item.ordered;
    if (depth === 0 && rootOrdered !== null && rootOrdered !== ordered) { // a different list type starts a new block
      blocks.push(lines.join(eol));
      lines = [];
      levels.length = 0;
    }
    if (depth === 0) rootOrdered = ordered;
    levels.length = depth + 1;
    if (!levels[depth] || levels[depth].ordered !== ordered) levels[depth] = { ordered, n: 0 };
    levels[depth].n++;
    const body = /^\[[ xX*!]\](\s|$)/.test(text) ? "\\" + text : text;
    const mark = item.mark !== null ? `[${item.mark}] ` : "";
    lines.push(`${"  ".repeat(depth)}${ordered ? `${levels[depth].n}. ` : "- "}${mark}${body}`.replace(/\s+$/, ""));
    prev = depth;
  }
  if (lines.length) blocks.push(lines.join(eol));
  return blocks;
}

/**
 * Document block -> note markdown. `format: false` keeps the structure (paragraphs, lists, headings, to-dos, pictures) but
 * drops bold / color / size / links. `refs`: image src -> stored `files/...` path (images without one are left out).
 */
export function docToMarkdown(block, { format = true, refs = new Map(), eol = "\n" } = {}) {
  const out = [];
  let group = [];
  const flush = () => { out.push(...listBlocks(group, format, refs, eol)); group = []; };
  for (const item of block.items) {
    if (item.k === "li") { group.push(item); continue; }
    flush();
    if (item.k === "p") {
      const text = lineText(item, format, refs);
      if (text) out.push("  ".repeat(item.level) + escapeLineStart(text));
    } else if (item.k === "h") {
      const text = lineText(item, format, refs);
      if (text) out.push("#".repeat(item.level) + " " + text);
    } else if (item.k === "code") {
      const fence = "`".repeat(Math.max(3, ...(item.text.match(/`+/g) || []).map((m) => m.length + 1)));
      out.push([fence, ...item.text.split("\n"), fence].join(eol));
    } else if (item.k === "hr") {
      out.push("---");
    } else if (item.k === "raw") {
      out.push(item.src.replace(/\r\n?|\n/g, eol).replace(/\s+$/, ""));
    } else if (item.k === "table") {
      out.push(tableBlockToSource(item.block, { format, eol }));
    }
  }
  flush();
  return out.length ? out.join(eol + eol) + eol : "";
}

/** True when the document has anything that can be written (text, a table, a picture that was stored). */
export function docHasContent(block, refs = new Map()) {
  return block.items.some((item) => {
    if (item.k === "table" || item.k === "code" || item.k === "raw" || item.k === "hr") return true;
    return (item.lines || []).some((line) => line.some((run) => (run.image ? refs.has(run.image.src) : run.text)));
  });
}

/** True when the document is just one plain line: the old plain-text paste is better then (it keeps typing inline). */
export function isPlainLine(block) {
  if (block.items.length !== 1 || block.images.length) return false;
  const item = block.items[0];
  return item.k === "p" && !item.level && !block.hasFormat;
}

/** One inline phrase (no list / heading / indent / picture): pasted into the line the caret is in. */
export function isInlineDoc(block) {
  const item = block.items[0];
  return block.items.length === 1 && item.k === "p" && !item.level && !block.images.length;
}

/** The only paragraph, as an inline markdown fragment (for pasting a formatted phrase in the middle of a line). */
export function inlineMarkdown(block, format = true) {
  const item = block.items[0];
  return item?.k === "p" ? lineText(item, format, null) : "";
}

// ---------------------------------------------------------------- entry points --
/** Counts for the paste bar: "문단 8 · 목록 5 · 표 1 · 그림 2". */
export function describeDoc(block, storedImages = block.images.length) {
  const s = block.stats;
  const parts = [];
  if (s.headings) parts.push("제목 " + s.headings);
  if (s.paragraphs) parts.push("문단 " + s.paragraphs);
  if (s.items) parts.push("목록 " + s.items + (s.todos ? " (할일 " + s.todos + ")" : ""));
  if (s.tables) parts.push("표 " + s.tables);
  if (s.code) parts.push("코드·원문 블록 " + s.code);
  if (storedImages) parts.push("그림 " + storedImages);
  return parts.join(" · ");
}

/** Notes about what could not be taken over. `failed`: counts from the picture step. */
export function docNotes(block, failed = {}) {
  const notes = [];
  if (failed.file) notes.push("그림 " + failed.file + "개는 내 컴퓨터의 파일 경로라 브라우저가 읽을 수 없어요. 원노트에서 그림만 따로 복사해 붙이면 들어가요");
  if (failed.web) notes.push("그림 " + failed.web + "개는 인터넷 주소라 가져오지 않았어요 (외부 접속 금지)");
  if (failed.unsupported) notes.push("그림 " + failed.unsupported + "개는 지원하지 않는 형식(EMF·SVG 등)이에요");
  if (failed.big) notes.push("그림 " + failed.big + "개는 " + Math.round(DOC_LIMITS.imageBytes / 1048576) + "MB가 넘어 건너뛰었어요");
  if (failed.error) notes.push("그림 " + failed.error + "개는 저장하지 못했어요");
  if (block.skippedImages) notes.push("그림은 " + DOC_LIMITS.images + "개까지만 가져와요 (" + block.skippedImages + "개 건너뜀)");
  if (block.truncated) notes.push("내용이 많아 앞쪽 " + DOC_LIMITS.items.toLocaleString("ko-KR") + "줄만 붙였어요");
  for (const item of block.items) if (item.k === "table") notes.push(...pasteNotes(item.block));
  return [...new Set(notes)].slice(0, 4);
}

/**
 * Clipboard -> what to paste: `{ kind: "table", block, via }`, `{ kind: "doc", block }` or null (plain text paste).
 * Order: a sheet (only a table) > a document (anything richer than one plain line) > tab separated text.
 */
export function planPaste({ html = "", text = "", keepSingleExcelCell = false }) {
  let block = null;
  if (html.trim()) {
    try {
      const input = html.length > DOC_LIMITS.html && !/<table[\s>]/i.test(html.slice(0, 20000)) ? html.slice(0, DOC_LIMITS.html) : html;
      block = htmlToBlocks(input, { keepSingleExcelCell });
    } catch {
      block = null; // hostile / absurdly nested HTML: the plain text is still pasted
    }
  }
  if (block?.type === "table" && block.rows.length) return { kind: "table", block, via: "html" };
  if (block?.type === "doc" && (block.items.length || block.images.length)) {
    if (!isPlainLine(block) || (block.hasExcelOverflow && !text)) return { kind: "doc", block };
  }
  const tsv = tsvToBlock(text);
  return tsv ? { kind: "table", block: tsv, via: "tsv" } : null;
}
