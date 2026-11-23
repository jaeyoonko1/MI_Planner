// Markdown file <-> blocks, with every byte kept (P3-02R, D-20 constraints 1, 2, 8). Pure functions, no DOM.
//
// segment(md) cuts a file into blocks and remembers the exact text of each block plus the whitespace after it,
// so  pre + blocks.map(b => b.src + b.gap).join("")  is the original file again. The editor re-writes only the
// blocks the user touched; every other block (and every gap) is emitted from this record unchanged.
//
// Block kinds the editor understands: "p" paragraph, "h" heading (# .. ###), "list" (nested - / 1. items with
// the journal marks [ ] [x] [*] [!]). Everything else is "raw": code fences, tables, quotes, HTML comments,
// rules, #### headings. Raw blocks are shown read-only and written back verbatim.

import { hasTablePipe, tableWidth } from "./note-table-model.js";

export const MARKS = [" ", "x", "*", "!"];

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HR_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const HEAD_RE = /^(#{1,3})[ \t]+(.*)$/;
const DEEP_HEAD_RE = /^#{4,}(?:[ \t]|$)/;
const TABLE_RE = /^\s*\|/;
const QUOTE_RE = /^ {0,3}>/;
const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])(?:[ \t]+(.*))?$/;

const expandTabs = (s) => s.replace(/\t/g, "  ");
const isBlank = (l) => l.trim() === "";

export const listType = (marker) => (/^\d/.test(marker) ? "ol" : "ul");

/** Parses one list line, or returns null. `ind` is the leading width (tab = 2). */
export function parseListLine(line) {
  const m = LIST_RE.exec(line.replace(/\s+$/, ""));
  if (!m) return null;
  const type = listType(m[2]);
  let text = m[3] ?? "";
  let mark = null;
  if (type === "ul") {
    const mm = /^\[([ xX*!])\](?:[ \t]+|$)([\s\S]*)$/.exec(text);
    if (mm) {
      mark = mm[1] === "X" ? "x" : mm[1];
      text = mm[2];
    }
  }
  return { ind: expandTabs(m[1]).length, type, mark, text };
}

/** Index of the last line of the block that starts at line i, and its kind. */
function blockEnd(lines, i) {
  const line = lines[i];
  const trimmed = line.replace(/\s+$/, "");
  let m = FENCE_RE.exec(line);
  if (m) {
    const ch = m[1][0];
    const need = m[1].length;
    const close = new RegExp(`^ {0,3}\\${ch}{${need},}\\s*$`);
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    return { end: Math.min(j, lines.length - 1), kind: "code" };
  }
  if (line.trimStart().startsWith("<!--")) {
    let j = i;
    while (j < lines.length && !lines[j].includes("-->")) j++;
    return { end: Math.min(j, lines.length - 1), kind: "comment" };
  }
  const startsOtherBlock = value => FENCE_RE.test(value) || QUOTE_RE.test(value)
    || HEAD_RE.test(value) || DEEP_HEAD_RE.test(value) || LIST_RE.test(value)
    || value.trimStart().startsWith("<!--");
  const tableHeader = !startsOtherBlock(line) && tableWidth(line, lines[i + 1]);
  if (tableHeader || TABLE_RE.test(line)) {
    let j = tableHeader ? i + 1 : i;
    while (j + 1 < lines.length && !startsOtherBlock(lines[j + 1])) {
      const next = lines[j + 1];
      if (!(tableHeader ? hasTablePipe(next) : TABLE_RE.test(next))) break;
      j++;
    }
    return { end: j, kind: "table" };
  }
  if (QUOTE_RE.test(line)) {
    let j = i;
    while (j + 1 < lines.length && QUOTE_RE.test(lines[j + 1])) j++;
    return { end: j, kind: "quote" };
  }
  if (HR_RE.test(line)) return { end: i, kind: "hr" };
  if (DEEP_HEAD_RE.test(line)) return { end: i, kind: "deep" };
  if (HEAD_RE.test(trimmed)) return { end: i, kind: "h" };
  const first = parseListLine(line);
  if (first) {
    let j = i;
    while (j + 1 < lines.length) {
      const nx = lines[j + 1];
      if (HR_RE.test(nx)) break;
      const p = parseListLine(nx);
      if (!p || (p.ind <= first.ind && p.type !== first.type)) break;
      j++;
    }
    return { end: j, kind: "list" };
  }
  return { end: i, kind: "p" };
}

/**
 * @returns {{eol: string, pre: string, blocks: {kind: string, src: string, gap: string}[]}}
 * joinBlocks(segment(md)) preserves the original line endings.
 */
export function segment(md) {
  const parts = md.split(/(\r\n|\r|\n)/);
  const eol = parts[1] || "\n";
  const lines = [];
  const offs = [];
  let offset = 0;
  for (let i = 0; i < parts.length; i += 2) {
    lines.push(parts[i]);
    offs.push(offset);
    offset += parts[i].length + (parts[i + 1]?.length || 0);
  }
  const blocks = [];
  let i = 0;
  let pre = "";
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++;
      continue;
    }
    const { end, kind } = blockEnd(lines, i);
    const a = offs[i];
    const b = offs[end] + lines[end].length;
    if (!blocks.length) pre = md.slice(0, a);
    blocks.push({ kind, src: md.slice(a, b), a, b });
    i = end + 1;
  }
  if (!blocks.length) return { eol, pre: "", blocks: [], rest: md };
  blocks.forEach((bl, k) => {
    bl.gap = md.slice(bl.b, k + 1 < blocks.length ? blocks[k + 1].a : md.length);
    delete bl.a;
    delete bl.b;
  });
  return { eol, pre, blocks, rest: "" };
}

export const joinBlocks = (seg) => seg.pre + seg.blocks.map((b) => b.src + b.gap).join("") + seg.rest;

/** Nested items of a list block: [{type, mark, text, kids: [...]}] (children are the deeper-indented lines). */
export function listTree(src) {
  const root = { kids: [] };
  const stack = [{ ind: -1, node: root }];
  for (const line of src.split(/\r\n?|\n/)) {
    const p = parseListLine(line);
    if (!p) continue;
    while (stack.length > 1 && stack[stack.length - 1].ind >= p.ind) stack.pop();
    const node = { type: p.type, mark: p.mark, text: p.text, kids: [] };
    stack[stack.length - 1].node.kids.push(node);
    stack.push({ ind: p.ind, node });
  }
  return root.kids;
}
