// Note columns and column rows (P3-03, V-008). Pure functions, no DOM, so Node can test them.
//
// File format (docs/SPEC.md): `<!-- column -->` starts the next column in the same row, `<!-- row -->` starts a new
// row of columns below. A file without markers is one column and is never rewritten by this module.
// `parts[i]` is the text of one column, `separators[i]` the marker (+ its line break) between part i and i + 1.
import { segment } from "./mdblocks.js";

const BOUNDARY = "<!-- column -->";
const ROW_BOUNDARY = "<!-- row -->";
export const MAX_COLUMNS = 4;
export const MAX_ROWS = 6;
const ENDING = /(?:\r\n|\r|\n)$/;
const BEGINNING = /^(?:\r\n|\r|\n)/;

export const isRowSeparator = (separator) => separator.startsWith(ROW_BOUNDARY);

export function splitColumns(md) {
  const { blocks, eol, pre } = segment(md);
  const parts = [];
  const separators = [];
  let pos = pre.length;
  let start = 0;
  let inRow = 1;
  let rows = 1;
  for (const block of blocks) {
    const column = block.kind === "comment" && block.src === BOUNDARY && inRow < MAX_COLUMNS;
    const row = block.kind === "comment" && block.src === ROW_BOUNDARY && rows < MAX_ROWS;
    if (column || row) {
      parts.push(md.slice(start, pos));
      const following = BEGINNING.exec(block.gap)?.[0] || "";
      separators.push(block.src + following);
      start = pos + block.src.length + following.length;
      if (row) { rows++; inRow = 1; } else inRow++;
    }
    pos += block.src.length + block.gap.length;
  }
  parts.push(md.slice(start));
  return { parts, separators, eol };
}

export function joinColumns({ parts, separators, eol }) {
  let md = parts[0];
  separators.forEach((separator, i) => {
    if (md && !ENDING.test(md)) md += eol;
    md += separator;
    const next = parts[i + 1];
    if (next && !ENDING.test(separator)) md += eol;
    md += next;
  });
  return md;
}

/** Part indexes grouped by row: `[[0, 1], [2]]` is two columns above one. */
export function rowsOf(separators) {
  const rows = [[0]];
  separators.forEach((separator, i) => {
    if (isRowSeparator(separator)) rows.push([i + 1]);
    else rows.at(-1).push(i + 1);
  });
  return rows;
}

export const rowIndexOf = (rows, index) => rows.findIndex((row) => row.includes(index));

const kinds = (separators) => separators.map((s) => (isRowSeparator(s) ? "r" : "c")).join("");

// An unfinished fenced block or comment absorbs a new boundary. Leave the text untouched then.
function verified(proposal) {
  const split = splitColumns(joinColumns(proposal));
  const ok = split.parts.length === proposal.parts.length && kinds(split.separators) === kinds(proposal.separators);
  return ok ? proposal : null;
}

/** New empty column at the end of the last row (the original "단 추가"). */
export function appendColumn(document) {
  const rows = rowsOf(document.separators);
  return insertColumn(document, rows.at(-1).at(-1), "right");
}

/** New empty column left or right of part `index`, inside the same row. */
export function insertColumn(document, index, side) {
  const rows = rowsOf(document.separators);
  if (rows[rowIndexOf(rows, index)].length >= MAX_COLUMNS) return null;
  const parts = [...document.parts];
  const separators = [...document.separators];
  parts.splice(side === "left" ? index : index + 1, 0, "");
  separators.splice(index, 0, BOUNDARY + document.eol);
  return verified({ ...document, parts, separators });
}

/** New empty one-column row right below row `row`. */
export function addRowBelow(document, row) {
  const rows = rowsOf(document.separators);
  if (rows.length >= MAX_ROWS) return null;
  const last = rows[row].at(-1);
  const parts = [...document.parts];
  const separators = [...document.separators];
  parts.splice(last + 1, 0, "");
  separators.splice(last, 0, ROW_BOUNDARY + document.eol);
  return verified({ ...document, parts, separators });
}

const hasText = (text) => text.trim() !== "";

function mergeText(first, second, eol) {
  if (!hasText(first)) return second;
  if (!hasText(second)) return first;
  // exactly one blank line between the two texts, whatever the first one already ends with
  let trailing = 0;
  for (let rest = first; ENDING.test(rest); trailing++) rest = rest.replace(ENDING, "");
  return first + eol.repeat(Math.max(0, 2 - trailing)) + second;
}

/** The column that receives the content of part `index` when it is deleted (before it, else after it). */
export function mergeTarget(separators, index) {
  const rows = rowsOf(separators);
  const r = rowIndexOf(rows, index);
  const row = rows[r];
  const pos = row.indexOf(index);
  if (row.length > 1) return pos ? row[pos - 1] : row[1];
  return r ? rows[r - 1].at(-1) : rows[1]?.[0] ?? -1;
}

/**
 * Remove part `index` (and its marker). `merge` appends its text to mergeTarget(); `drop` discards it.
 * A column that is alone in its row removes the whole row. Returns {parts, separators, eol, target, merged}
 * where `target` (index before the removal) and `merged` (its new text) are set only when text moved.
 */
export function deleteColumn(document, index, mode) {
  if (document.parts.length < 2) return null;
  const rows = rowsOf(document.separators);
  const row = rows[rowIndexOf(rows, index)];
  const parts = [...document.parts];
  const separators = [...document.separators];
  const target = mergeTarget(document.separators, index);
  let merged = null;
  if (mode === "merge" && hasText(parts[index])) {
    merged = target < index ? mergeText(parts[target], parts[index], document.eol) : mergeText(parts[index], parts[target], document.eol);
    parts[target] = merged;
  }
  const marker = row.length > 1 ? (row[0] === index ? index : index - 1) : (index ? index - 1 : index);
  parts.splice(index, 1);
  separators.splice(marker, 1);
  const next = verified({ ...document, parts, separators });
  return next && { ...next, target: merged === null ? -1 : target, merged };
}

const equalWidths = (count) => {
  const base = Math.floor(100 / count);
  return Array.from({ length: count }, (_, i) => base + Number(i < 100 % count));
};

const validRow = (widths, count) => Array.isArray(widths) && widths.length === count
  && widths.every((width) => Number.isInteger(width) && width > 0)
  && widths.reduce((sum, width) => sum + width, 0) === 100;

/**
 * Layout for `shape` = columns per row (a plain number is one row). `meta` is the stored note_layout:
 * `{mode, widths}` for one row, `{mode, rows: [[...], ...]}` for several. Invalid rows fall back to equal widths.
 */
export function layoutFor(meta, shape) {
  const counts = Array.isArray(shape) ? shape : [shape];
  const mode = meta?.mode === "scroll" ? "scroll" : "fit";
  const stored = Array.isArray(meta?.rows) ? meta.rows : counts.length === 1 && meta?.widths ? [meta.widths] : [];
  const usable = stored.length === counts.length;
  return { mode, rows: counts.map((count, i) => (usable && validRow(stored[i], count) ? [...stored[i]] : equalWidths(count))) };
}

/** The part of the layout that is stored in `_page.json`. One-row notes keep the original `{mode, widths}` shape. */
export function layoutMeta(layout) {
  if (layout.rows.length > 1) return { mode: layout.mode, rows: layout.rows.map((row) => [...row]) };
  return layout.rows[0].length > 1 ? { mode: layout.mode, widths: [...layout.rows[0]] } : { mode: layout.mode };
}

export function resizePair(widths, index, left) {
  const total = widths[index] + widths[index + 1];
  const min = Math.min(10, Math.floor(total / 2));
  const next = [...widths];
  next[index] = Math.min(total - min, Math.max(min, Math.round(left)));
  next[index + 1] = total - next[index];
  return next;
}

/** Row widths after a column was inserted next to `pos`: the new column takes half of its neighbour. */
export function widthsAfterInsert(widths, pos, side) {
  const width = widths[pos];
  if (width < 2) return equalWidths(widths.length + 1);
  const added = Math.floor(width / 2);
  const kept = width - added;
  const next = [...widths];
  next.splice(pos, 1, ...(side === "left" ? [added, kept] : [kept, added]));
  return next;
}

/** Row widths after the column at `pos` was removed: its width goes to the column that received the content. */
export function widthsAfterDelete(widths, pos) {
  const next = [...widths];
  const heir = pos ? pos - 1 : 1;
  next[heir] += next[pos];
  next.splice(pos, 1);
  return next;
}
