// Clipboard HTML -> note blocks (V-001). Pure functions: no DOM, no network, so Node can test them.
//
// The browser never gives us a DOM we trust for Excel / OneNote clipboard HTML (it is full of MS Office markup, class
// based styles in <style>, conditional comments), so this module has its own tolerant tokenizer. Output is a small block
// model; the note editor decides where to put the blocks.
//
// V-007 (OneNote paste) extends this file:
//   * `parseHtml` / `styleOf` / `collectRuns` / `runsToMarkdown` are the shared building blocks (inline styles -> runs ->
//     the same markdown the note format stores: **bold** *italic* ~~strike~~ <u> <mark> <span style="color">).
//   * add a block parser with `registerBlockParser(name, fn)`; `htmlToBlocks` runs every parser over the document and
//     returns the first non-null result. A parser gets `(doc, ctx)` and returns `{ type, ... }` or null.
// Blocks today: `{ type: "table", ... }` (see `tableBlockFromGrid`).

import { BASE_PX, COLORS, HLS, SIZES, markdownUrl } from "./mdconv.js";
import { cellSource, parseClipboardTable } from "./note-table-model.js";

// ---------------------------------------------------------------- limits --
export const PASTE_LIMITS = { cells: 10000, rows: 1000, cols: 60 };

// ---------------------------------------------------------------- tokenizer --
const VOID = new Set(["br", "col", "hr", "img", "meta", "link", "input", "wbr", "area", "base", "param", "source", "track"]);
const RAW_TEXT = new Set(["style", "script"]);
const CELL = new Set(["td", "th"]);
const ROW_GROUP = new Set(["thead", "tbody", "tfoot"]);
// opening tag -> tags it implicitly closes (only while they are open inside the same table / list)
const CLOSES = {
  td: ["td", "th"], th: ["td", "th"],
  tr: ["td", "th", "tr"],
  thead: ["td", "th", "tr", "thead", "tbody", "tfoot"], tbody: ["td", "th", "tr", "thead", "tbody", "tfoot"],
  tfoot: ["td", "th", "tr", "thead", "tbody", "tfoot"],
  li: ["li"], p: ["p"], option: ["option"],
};
const SCOPE = { td: "table", th: "table", tr: "table", thead: "table", tbody: "table", tfoot: "table", li: "ul|ol", p: "" };

const NAMED = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", copy: "©", reg: "®", deg: "°",
  plusmn: "±", times: "×", middot: "·", hellip: "…", ndash: "–", mdash: "—",
  ensp: "\u2002", emsp: "\u2003", thinsp: "\u2009", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", micro: "µ",
  le: "≤", ge: "≥", ne: "≠", rarr: "→", larr: "←", uarr: "↑", darr: "↓",
  alpha: "α", beta: "β", mu: "μ", sigma: "σ", Delta: "Δ", delta: "δ", Omega: "Ω",
};

export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name] ?? NAMED[name.toLowerCase()] ?? whole;
  });
}

function readAttributes(source) {
  const attrs = {};
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = re.exec(source))) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Tolerant HTML parser. Returns `{ root, styles }` (`styles` = all <style> text, for class rules). */
export function parseHtml(html) {
  const root = { tag: "#root", attrs: {}, children: [], parent: null };
  let current = root;
  let styles = "";
  const tagRe = /<!--[\s\S]*?-->|<![^>]*>|<\/\s*([a-z][^\s>/]*)\s*>|<([a-z][^\s>/]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let last = 0;
  const addText = (text) => {
    if (text) current.children.push({ text: decodeEntities(text), parent: current });
  };
  const inScope = (tag, scopeTags) => {
    for (let node = current; node && node.tag !== "#root"; node = node.parent) {
      if (node.tag === tag) return node;
      if (scopeTags && scopeTags.split("|").includes(node.tag)) return null;
    }
    return null;
  };
  let match;
  while ((match = tagRe.exec(html))) {
    addText(html.slice(last, match.index));
    last = tagRe.lastIndex;
    if (match[1]) { // closing tag
      const name = match[1].toLowerCase();
      const open = inScope(name, "");
      if (open) current = open.parent;
      continue;
    }
    if (!match[2]) continue; // comment / conditional comment / doctype
    const name = match[2].toLowerCase();
    const attrs = readAttributes(match[3] || "");
    const selfClosed = /\/\s*$/.test(match[3] || "");
    if (RAW_TEXT.has(name)) {
      const close = new RegExp("</" + name + "\\s*>", "i");
      const rest = html.slice(last);
      const end = close.exec(rest);
      const body = end ? rest.slice(0, end.index) : rest;
      if (name === "style") styles += "\n" + body;
      last += end ? end.index + end[0].length : rest.length;
      tagRe.lastIndex = last;
      continue;
    }
    for (const closing of CLOSES[name] || []) {
      const open = inScope(closing, SCOPE[name]);
      if (open) { current = open.parent; break; }
    }
    const node = { tag: name, attrs, children: [], parent: current };
    current.children.push(node);
    if (!VOID.has(name) && !selfClosed) current = node;
  }
  addText(html.slice(last));
  return { root, styles };
}

export function* walk(node) {
  yield node;
  for (const child of node.children || []) yield* walk(child);
}

export const textOf = (node) => node.text ?? (node.children || []).map(textOf).join("");

// ---------------------------------------------------------------- CSS --
function parseDeclarations(css) {
  const out = {};
  for (const part of css.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const name = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).replace(/!important/i, "").trim();
    if (name) out[name] = value;
  }
  return out;
}

/** Simple selectors only (`td`, `.xl65`, `td.xl65`): that is all Excel and Sheets write. */
export function parseStyleSheet(css) {
  const rules = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--|-->/g, "");
  const re = /([^{}@]+)\{([^{}]*)\}/g;
  let match;
  while ((match = re.exec(clean))) {
    const decl = parseDeclarations(match[2]);
    for (const selector of match[1].split(",")) {
      const m = /^\s*([a-z][a-z0-9]*)?((?:\.[\w-]+)*)\s*$/i.exec(selector);
      if (!m || (!m[1] && !m[2])) continue;
      rules.push({ tag: m[1]?.toLowerCase() || "", classes: m[2].split(".").filter(Boolean), decl });
    }
  }
  return rules;
}

/** Declared style of one element: tag rules < class rules < inline `style`. */
export function styleOf(node, rules = []) {
  if (!node.attrs) return {};
  if (node.style) return node.style;
  const classes = (node.attrs.class || "").split(/\s+/).filter(Boolean);
  const merged = {};
  for (const rule of rules) {
    if (rule.tag && rule.tag !== node.tag) continue;
    if (!rule.classes.length && rule.tag) Object.assign(merged, rule.decl);
  }
  for (const rule of rules) {
    if (!rule.classes.length) continue;
    if (rule.tag && rule.tag !== node.tag) continue;
    if (rule.classes.every((name) => classes.includes(name))) Object.assign(merged, rule.decl);
  }
  if (node.attrs.style) Object.assign(merged, parseDeclarations(node.attrs.style));
  if (node.attrs.align && !merged["text-align"]) merged["text-align"] = node.attrs.align.toLowerCase();
  node.style = merged;
  return merged;
}

// ---------------------------------------------------------------- colors --
const NAMED_COLORS = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], yellow: [255, 255, 0], lime: [0, 255, 0],
  blue: [0, 0, 255], green: [0, 128, 0], orange: [255, 165, 0], gray: [128, 128, 128], grey: [128, 128, 128],
  silver: [192, 192, 192], navy: [0, 0, 128], maroon: [128, 0, 0], purple: [128, 0, 128], teal: [0, 128, 128],
  aqua: [0, 255, 255], cyan: [0, 255, 255], fuchsia: [255, 0, 255], magenta: [255, 0, 255], olive: [128, 128, 0],
  pink: [255, 192, 203], brown: [165, 42, 42], gold: [255, 215, 0], violet: [238, 130, 238], lightgreen: [144, 238, 144],
  lightblue: [173, 216, 230], lightyellow: [255, 255, 224], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  darkblue: [0, 0, 139], darkgreen: [0, 100, 0], darkred: [139, 0, 0], coral: [255, 127, 80], salmon: [250, 128, 114],
};

export function parseColor(value) {
  const v = String(value || "").trim().toLowerCase();
  if (!v || /^(inherit|initial|transparent|none|auto|windowtext|window|currentcolor|windowframe)$/.test(v)) return null;
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{6})/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) return m[4] !== undefined && parseFloat(m[4]) === 0 ? null : [+m[1], +m[2], +m[3]];
  return NAMED_COLORS[v] || null;
}

const distance = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
const nearest = (rgb, presets) => presets.reduce((best, hex) => {
  const d = distance(rgb, parseColor(hex));
  return d < best.d ? { hex, d } : best;
}, { hex: presets[0], d: Infinity }).hex;
function hueOf([r, g, b]) {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b) || 1;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
const chroma = (rgb) => Math.max(...rgb) - Math.min(...rgb);
const nearestHue = (rgb, presets) => presets.reduce((best, hex) => {
  const diff = Math.abs(hueOf(parseColor(hex)) - hueOf(rgb));
  const d = Math.min(diff, 360 - diff);
  return d < best.d ? { hex, d } : best;
}, { hex: presets[0], d: Infinity }).hex;

/** Text color -> nearest note preset; the default text color and near-black/near-white map to "no color". */
export function textPreset(value) {
  const rgb = parseColor(value);
  if (!rgb) return "";
  if (chroma(rgb) < 28 && Math.max(...rgb) < 90) return ""; // black / dark gray = the normal text color
  if (chroma(rgb) < 28 && Math.min(...rgb) > 235) return ""; // white text is invisible on our light highlights; drop
  const hex = chroma(rgb) >= 40 ? nearestHue(rgb, COLORS.slice(1, 6)) : nearest(rgb, COLORS); // a dark navy is blue, not green
  return hex === COLORS[0] ? "" : hex;
}

/** Cell fill -> highlight preset with the closest hue (pale fills keep their color family). White and grays (headers, banding) are dropped: a gray bar is not a highlight. */
export function highlightPreset(value) {
  const rgb = parseColor(value);
  if (!rgb || chroma(rgb) < 30) return "";
  const hue = hueOf(rgb);
  return HLS.reduce((best, hex) => {
    const diff = Math.abs(hueOf(parseColor(hex)) - hue);
    const d = Math.min(diff, 360 - diff);
    return d < best.d ? { hex, d } : best;
  }, { hex: HLS[0], d: Infinity }).hex;
}

// ---------------------------------------------------------------- inline runs --
export const baseStyle = () => ({ b: false, i: false, u: false, s: false, color: "", bg: "" });

export function applyStyle(ctx, node, rules) {
  const next = { ...ctx };
  const tag = node.tag;
  if (tag === "b" || tag === "strong") next.b = true;
  if (tag === "i" || tag === "em" || tag === "cite") next.i = true;
  if (tag === "u" || tag === "ins") next.u = true;
  if (tag === "s" || tag === "strike" || tag === "del") next.s = true;
  if (tag === "font" && node.attrs.color) next.color = textPreset(node.attrs.color);
  if (tag === "a") next.href = safeHref(node.attrs.href);
  if (tag === "mark") next.bg = highlightPreset(styleOf(node, rules).background) || HLS[0];
  const css = styleOf(node, rules);
  const weight = css["font-weight"];
  if (weight) next.b = /^(bold|bolder)$/i.test(weight) || Number(weight) >= 600;
  const fontStyle = css["font-style"];
  if (fontStyle) next.i = /italic|oblique/i.test(fontStyle);
  const deco = (css["text-decoration"] || "") + " " + (css["text-decoration-line"] || "");
  if (deco.trim()) {
    next.u = /underline/.test(deco);
    next.s = /line-through/.test(deco);
  }
  if (css.color) next.color = textPreset(css.color);
  if (ctx.px !== undefined) applySize(next, ctx, node, css); // documents only: tables keep the V-001 behaviour
  const fill = css["background-color"] || css.background || css["mso-highlight"];
  if (fill && !/^(none|transparent)$/i.test(fill.trim())) next.bg = highlightPreset(fill.split(/\s+/)[0]) || (tag === "td" || tag === "th" ? "" : next.bg);
  if (next.href) { next.u = false; next.color = ""; } // the default link look is not a style the user chose
  return next;
}

// ---- font size (V-007): px is the inherited computed size, `size` the note preset (0 = the normal text size)
const SIZE_KEYWORDS = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48 };
const FONT_TAG_PX = [0, 10, 13, 16, 18, 24, 32, 48];

export function cssPx(value, parentPx) {
  const v = String(value || "").trim().toLowerCase();
  if (SIZE_KEYWORDS[v]) return SIZE_KEYWORDS[v];
  if (v === "larger") return parentPx * 1.2;
  if (v === "smaller") return parentPx / 1.2;
  const m = /^([\d.]+)\s*(pt|px|em|rem|%|in|cm|mm|pc)?$/.exec(v);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!(n > 0)) return null;
  const px = { pt: n * 4 / 3, px: n, em: n * parentPx, rem: n * 16, "%": n * parentPx / 100, in: n * 96, cm: n * 37.8, mm: n * 3.78, pc: n * 16 }[m[2] || "px"];
  return px > 1 && px < 400 ? px : null;
}

/** Computed px -> nearest note size preset, scaled so the document's own body size reads as the normal size. */
export function sizePreset(px, ref) {
  const scaled = px * BASE_PX / ref;
  const best = SIZES.reduce((a, size) => (Math.abs(size - scaled) < Math.abs(a - scaled) ? size : a), SIZES[0]);
  return best === BASE_PX ? 0 : best;
}

function applySize(next, ctx, node, css) {
  let px = ctx.px;
  if (node.tag === "font" && /^[1-7]$/.test(node.attrs.size || "")) px = FONT_TAG_PX[+node.attrs.size];
  if (css["font-size"]) px = cssPx(css["font-size"], ctx.px) || px;
  next.px = px;
  next.size = px === ctx.px ? ctx.size : sizePreset(px, ctx.ref || 16);
}

const SAFE_HREF = /^(https?:|mailto:|onenote:|ftp:|file:\/\/|\\)/i;
/** Only link schemes that cannot run code; everything else (javascript:, data:, vbscript:) is dropped. */
export function safeHref(value) {
  const v = String(value || "").trim();
  if (!v || /[\u0000-\u001f]/.test(v)) return "";
  return SAFE_HREF.test(v) ? v : "";
}

const BLOCK_TAGS = /^(p|div|li|ul|ol|tr|h[1-6]|blockquote|pre|center)$/;

/**
 * Walk an element and produce runs: `{ text, ...style }` plus `{ br: true }` for line breaks.
 * `ctx` is the inherited style; whitespace is collapsed like a browser would unless `white-space: pre*`.
 */
export function collectRuns(node, ctx, rules, out = [], state = { pre: false }) {
  for (const child of node.children || []) {
    if (child.text !== undefined) {
      let text = child.text.replace(/[​﻿]/g, "");
      if (!state.pre) text = text.replace(/[ \t\r\n\f]+/g, " ");
      else text = text.replace(/\r\n?/g, "\n");
      if (text) {
        if (state.pre && text.includes("\n")) {
          text.split("\n").forEach((part, index) => {
            if (index) out.push({ br: true });
            if (part) out.push({ text: part, ...ctx });
          });
        } else {
          out.push({ text, ...ctx });
        }
      }
      continue;
    }
    if (child.tag === "br") { out.push({ br: true }); continue; }
    if (child.tag === "img" && state.image) { // documents (V-007): the callback returns `{ image }`, `{ tag }` or null
      const run = state.image(child);
      if (run) out.push(run);
      continue;
    }
    if (["style", "script", "head", "xml", "o:p", "img", "col", "input", "meta", "link", "title", "object", "iframe", "svg", "canvas", "template", "noscript"].includes(child.tag)) continue;
    const css = styleOf(child, rules);
    if (/^none$/i.test(css.display || "") || /mso-hide:\s*all/i.test(child.attrs.style || "")) continue;
    if (/mso-list:\s*ignore/i.test(child.attrs.style || "")) continue; // Word's own bullet / number text
    if (child.tag === "span" && /mso-tab-count/i.test(child.attrs.style || "")) { // a typed tab: collapsed to one space
      out.push({ text: " ", ...ctx });
      continue;
    }
    const pre = state.pre || /^pre/.test(css["white-space"] || "") || child.tag === "pre";
    const nextCtx = applyStyle(ctx, child, rules);
    if (BLOCK_TAGS.test(child.tag) && out.length && !out[out.length - 1].br) out.push({ br: true });
    collectRuns(child, nextCtx, rules, out, { pre, image: state.image });
    if (BLOCK_TAGS.test(child.tag) && out.length && !out[out.length - 1].br) out.push({ br: true });
  }
  return out;
}

const sameStyle = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.color === b.color && a.bg === b.bg
  && a.size === b.size && a.href === b.href;
const isMark = (run) => run.image || run.tag; // document runs that are not text: kept apart, never trimmed or merged

/** Trim line edges, drop empty lines at the ends, merge neighbours with the same style. Returns an array of lines. */
export function runsToLines(runs) {
  const lines = [[]];
  for (const run of runs) {
    if (run.br) { lines.push([]); continue; }
    const line = lines[lines.length - 1];
    if (isMark(run)) { line.push({ ...run }); continue; }
    let text = run.text.replace(/ /g, " ");
    const prev = line[line.length - 1];
    if (prev && !isMark(prev) && prev.text.endsWith(" ")) text = text.replace(/^ +/, ""); // a browser collapses "a " + " b"
    if (!text) continue;
    if (prev && !isMark(prev) && sameStyle(prev, run)) prev.text += text;
    else line.push({ ...run, text });
  }
  const textOf = (run) => (isMark(run) ? "x" : run.text);
  for (const line of lines) {
    if (line.length && !isMark(line[0])) line[0].text = line[0].text.replace(/^ +/, "");
    if (line.length && !isMark(line[line.length - 1])) line[line.length - 1].text = line[line.length - 1].text.replace(/ +$/, "");
    while (line.length && !textOf(line[line.length - 1])) line.pop();
    while (line.length && !textOf(line[0])) line.shift();
  }
  while (lines.length && !lines[lines.length - 1].length) lines.pop();
  while (lines.length && !lines[0].length) lines.shift();
  return lines;
}

const ESCAPABLE_TAG = /<(?=\/?(?:u|mark|span)[\s>])/g;
/** Text that must not be read as markup when it is stored verbatim inside a cell. */
export function escapeInline(text) {
  return text
    .replace(/\\(?=[\\*`~<])/g, "\\\\")
    .replace(/([*`])/g, "\\$1")
    .replace(/~(?=~)|(?<=~)~/g, "\\~")
    .replace(ESCAPABLE_TAG, "\\<");
}

function wrapRun(run) {
  const [, lead, core, trail] = /^( *)([\s\S]*?)( *)$/.exec(run.text);
  if (!core) return escapeInline(run.text);
  let out = escapeInline(core);
  if (run.b) out = `**${out}**`;
  if (run.i) out = `*${out}*`;
  if (run.s) out = `~~${out}~~`;
  if (run.u) out = `<u>${out}</u>`;
  if (run.bg) out = HLS[0] === run.bg ? `<mark>${out}</mark>` : `<mark style="background:${run.bg}">${out}</mark>`;
  const css = [];
  if (run.color) css.push(`color:${run.color}`);
  if (run.size) css.push(`font-size:${run.size}px`);
  if (css.length) out = `<span style="${css.join(";")}">${out}</span>`;
  return lead + out + trail;
}

const hasStyle = (run) => run.b || run.i || run.u || run.s || run.color || run.bg || run.size;
const runMarkdown = (run, format) => (format && hasStyle(run) ? wrapRun(run) : escapeInline(run.text));

function linkMarkdown(runs, format) {
  const href = runs[0].href;
  const raw = runs.map((run) => run.text).join("");
  if (!raw.trim()) return "";
  const [, lead, , trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(raw);
  const text = runs.map((run) => runMarkdown(run, format)).join("").trim();
  if (raw.trim() === href.trim()) return lead + escapeInline(href.trim()) + trail; // the link text is the address
  return lead + `[${text.replace(/[\[\]]/g, (ch) => (ch === "[" ? "(" : ")"))}](${markdownUrl(href)})` + trail;
}

function imageMarkdown(image, refs) {
  const rel = refs?.get(image.src);
  if (!rel) return "";
  const alt = String(image.alt || "").replace(/[\]\[\r\n]+/g, " ").trim().slice(0, 80);
  return `![${/automatically generated|자동 생성|^(image|picture|그림|이미지)$/i.test(alt) ? "" : alt}](${rel})`;
}

function lineMarkdown(line, format, refs) {
  let out = "";
  for (let i = 0; i < line.length;) {
    const run = line[i];
    if (run.image) { out += imageMarkdown(run.image, refs); i++; continue; }
    if (run.tag) { i++; continue; }
    if (format && run.href) {
      let j = i;
      while (j < line.length && !isMark(line[j]) && line[j].href === run.href) j++;
      out += linkMarkdown(line.slice(i, j), format);
      i = j;
      continue;
    }
    out += runMarkdown(run, format);
    i++;
  }
  return out;
}

/** Lines of runs -> markdown text (lines joined by "\n"). With `format: false` only the text is kept. `refs`: image src -> stored file. */
export function runsToMarkdown(lines, format = true, refs = null) {
  return lines.map((line) => lineMarkdown(line, format, refs)).join("\n");
}

// ---------------------------------------------------------------- table --
const MAX_SPAN = 1000;
const toInt = (value, fallback = 1) => Math.min(Math.max(parseInt(value, 10) || fallback, 1), MAX_SPAN);

function rowsOfTable(table) {
  const rows = [];
  const visit = (node) => {
    for (const child of node.children || []) {
      if (child.tag === "tr") rows.push(child);
      else if (ROW_GROUP.has(child.tag) || child.tag === "colgroup") visit(child);
      else if (child.tag && child.tag !== "table" && !CELL.has(child.tag) && child.children) visit(child);
    }
  };
  visit(table);
  return rows;
}

const alignOf = (css) => {
  const a = String(css["text-align"] || "").toLowerCase();
  return a === "center" ? "center" : a === "right" || a === "end" ? "right" : a === "left" ? "left" : "";
};

/**
 * <table> node -> grid block. Merged cells are expanded: a horizontal merge leaves blank cells, a vertical merge
 * repeats the value (so a sort keeps the group label). Returns the block model used by `tableBlockToSource`.
 */
export function tableFromNode(tableNode, rules, limits = PASTE_LIMITS) {
  const rowNodes = rowsOfTable(tableNode).filter((row) => !/^none$/i.test(styleOf(row, rules).display || ""));
  const grid = [];
  const occupied = []; // occupied[r][c] = { from: [r0,c0] }
  let totalCols = 0;
  let merged = 0;
  const maxRows = Math.min(rowNodes.length, limits.rows);
  rowNodes.forEach((rowNode, r) => {
    let c = 0;
    const cells = (rowNode.children || []).filter((n) => CELL.has(n.tag) && !/^none$/i.test(styleOf(n, rules).display || ""));
    for (const cellNode of cells) {
      while (occupied[r]?.[c]) c++;
      const colspan = toInt(cellNode.attrs.colspan);
      const rowspan = toInt(cellNode.attrs.rowspan);
      if (colspan > 1 || rowspan > 1) merged++;
      if (r < maxRows) {
        const origin = { r, c, colspan, rowspan, node: cellNode };
        const css = styleOf(cellNode, rules);
        const ctx = applyStyle(baseStyle(), cellNode, rules);
        const lines = runsToLines(collectRuns(cellNode, ctx, rules));
        origin.lines = lines;
        origin.align = alignOf(css);
        for (let dr = 0; dr < rowspan && r + dr < maxRows; dr++) {
          for (let dc = 0; dc < colspan; dc++) {
            (occupied[r + dr] ||= [])[c + dc] = { from: origin, dr, dc };
          }
        }
      }
      c += colspan;
    }
    totalCols = Math.max(totalCols, c);
  });
  const cols = Math.min(totalCols, limits.cols);
  for (let r = 0; r < maxRows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const slot = occupied[r]?.[c];
      if (!slot) { row.push({ md: "", plain: "", align: "" }); continue; }
      const { from, dr, dc } = slot;
      if (dc) { row.push({ md: "", plain: "", align: from.align }); continue; } // horizontal merge: blank
      row.push({
        md: runsToMarkdown(from.lines, true),
        plain: runsToMarkdown(from.lines, false),
        align: from.align,
        repeated: dr > 0,
      });
    }
    grid.push(row);
  }
  return finishBlock(grid, { merged, totalRows: rowNodes.length, totalCols });
}

function finishBlock(grid, info) {
  const cols = Math.max(0, ...grid.map((row) => row.length));
  for (const row of grid) while (row.length < cols) row.push({ md: "", plain: "", align: "" });
  let truncated = null;
  let rows = grid;
  const total = { rows: info.totalRows ?? rows.length, cols: info.totalCols ?? cols };
  if (rows.length * cols > PASTE_LIMITS.cells) {
    const keep = Math.max(2, Math.floor(PASTE_LIMITS.cells / Math.max(cols, 1)));
    rows = rows.slice(0, keep);
  }
  if (rows.length < total.rows || cols < total.cols) {
    truncated = { rows: total.rows, cols: total.cols, keptRows: rows.length, keptCols: cols };
  }
  const aligns = Array.from({ length: cols }, (_, c) => {
    const counts = { left: 0, center: 0, right: 0 };
    let filled = 0;
    rows.slice(1).forEach((row) => {
      if (row[c].md) filled++;
      if (row[c].md && row[c].align) counts[row[c].align]++;
    });
    const top = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];
    return top[1] > filled / 2 && top[0] !== "left" ? top[0] : "";
  });
  let hasFormat = false;
  for (const row of rows) for (const cell of row) if (cell.md !== cell.plain) hasFormat = true;
  hasFormat = hasFormat || aligns.some(Boolean);
  return {
    type: "table", rows, cols, aligns, hasFormat, merged: info.merged || 0, truncated,
    repeated: rows.some((row) => row.some((cell) => cell.repeated)),
  };
}

/** Block model -> GFM table source. `format: false` keeps the text only (no bold/colors/highlights/alignment). */
export function tableBlockToSource(block, { format = true, eol = "\n" } = {}) {
  const field = (cell) => cellSource(format ? cell.md : cell.plain);
  const line = (cells) => "| " + cells.join(" | ") + " |";
  const delimiter = block.aligns.map((a) => (!format ? "---" : a === "center" ? ":---:" : a === "right" ? "---:" : "---"));
  const lines = block.rows.map((row) => line(row.map(field)));
  lines.splice(1, 0, line(delimiter));
  if (lines.length === 2) lines.push(line(Array(block.cols).fill("")));
  return lines.join(eol);
}

// ---------------------------------------------------------------- entry points --
const blockParsers = [];
export function registerBlockParser(name, parse) {
  blockParsers.push({ name, parse });
}

/** True when something other than tables (text, pictures) is in the clipboard HTML: then it is a document (V-007), not a sheet. */
export function hasContentOutsideTables(root) {
  const SKIP = new Set(["style", "script", "head", "xml", "title", "table", "o:p"]);
  const visit = (node) => {
    for (const child of node.children || []) {
      if (child.text !== undefined) { if (/[^\s ​﻿]/.test(child.text)) return true; continue; }
      if (SKIP.has(child.tag)) continue;
      if (child.tag === "img" || visit(child)) return true;
    }
    return false;
  };
  return visit(root);
}

registerBlockParser("table", (doc) => {
  const table = [...walk(doc.root)].find((node) => node.tag === "table");
  if (!table || hasContentOutsideTables(doc.root)) return null;
  // one single cell is a copied value (Excel) or a layout wrapper (Outlook), not a table: the document parser takes it
  return [...walk(table)].filter((node) => CELL.has(node.tag)).length > 1 ? tableFromNode(table, doc.rules) : null;
});

/** Parse clipboard HTML once, then ask every registered block parser. */
export function htmlToBlocks(html) {
  const doc = parseHtml(html);
  doc.rules = parseStyleSheet(doc.styles);
  for (const { parse } of blockParsers) {
    const block = parse(doc);
    if (block) return block;
  }
  return null;
}

/** Block -> grid of cell sources (what the note table stores), for pasting into existing cells. */
export function blockSources(block, format = true) {
  return block.rows.map((row) => row.map((cell) => cellSource(format ? cell.md : cell.plain)));
}

/** Tab separated text (what Excel puts in text/plain) -> grid block, or null when it is not tabular. */
export function tsvToBlock(text) {
  if (!/\t/.test(text)) return null;
  const grid = parseClipboardTable(text.replace(/\r\n?/g, "\n"));
  while (grid.length && grid[grid.length - 1].length === 1 && !grid[grid.length - 1][0]) grid.pop();
  if (grid.length < 2) return null;
  const tabbed = grid.filter((row) => row.length > 1).length;
  if (tabbed < grid.length * 0.6) return null; // prose that merely contains a tab
  const cells = grid.slice(0, PASTE_LIMITS.rows).map((row) => row.slice(0, PASTE_LIMITS.cols).map((value) => {
    const plain = escapeInline(value);
    return { md: plain, plain, align: "" };
  }));
  const cols = Math.max(...grid.map((row) => row.length));
  return finishBlock(cells, { merged: 0, totalRows: grid.length, totalCols: cols });
}

/** `{ html, text }` from the clipboard -> a table block (or null). HTML wins; plain TSV is the fallback. */
export function clipboardToTable({ html = "", text = "" }) {
  if (/<table[\s>]/i.test(html)) {
    const block = htmlToBlocks(html);
    if (block?.type === "table" && block.rows.length) return { block, via: "html" };
  }
  const block = tsvToBlock(text);
  return block ? { block, via: "tsv" } : null;
}

/** One-line description of what was lost, for the paste toast. */
export function pasteNotes(block) {
  const notes = [];
  if (block.merged) notes.push("병합 셀 " + block.merged + "개를 풀었어요 (가로는 빈 칸, 세로는 값 반복)");
  if (block.truncated) {
    const t = block.truncated;
    notes.push(t.rows + "행 × " + t.cols + "열 중 앞 " + t.keptRows + "행 × " + t.keptCols + "열만 붙였어요 (한도 "
      + PASTE_LIMITS.cells.toLocaleString("ko-KR") + "칸)");
  }
  return notes;
}
