// Cell-range operations for note tables (V-001). Pure functions on the parsed table of note-table-model.js:
// copy / paste / fill / clear / navigation / rich cell rendering. No DOM.

import { inlineToHtml } from "./mdconv.js";
import {
  cellText, clipboardTableText, growTable, setTableCellSource,
} from "./note-table-model.js";

export const PAYLOAD_TYPE = "application/x-mi-planner-cells";

// ---------------------------------------------------------------- rich cell rendering --
// A cell is rich when its text uses the note's inline markup (see mdconv.js). Plain cells are shown as typed.
const RICH = /\*|~~|`|<u>|<mark|<span |\\[\\*`~<]/;
export const isRichCell = (source) => RICH.test(cellText(source));

/** Sanitized HTML of one cell (mdconv's reader: only <b> <i> <s> <u> <mark> <span style="color"> <code> and text). */
export function cellHtml(source) {
  return cellText(source).split("\n").map((line) => inlineToHtml(line, (file) => file)).join("<br>");
}

const ENTITIES = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&amp;": "&" };
/** What the cell shows with the markup applied (used for TSV, sorting and the accessible label). */
export function cellPlain(source) {
  const text = cellText(source);
  if (!RICH.test(text)) return text;
  return cellHtml(source).replace(/<br>/g, "\n").replace(/<[^>]*>/g, "").replace(/&(?:lt|gt|quot|amp);/g, (e) => ENTITIES[e]);
}

const escapeHtml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// ---------------------------------------------------------------- ranges --
export const normalizeRange = (a, b) => ({
  r0: Math.min(a[0], b[0]), r1: Math.max(a[0], b[0]), c0: Math.min(a[1], b[1]), c1: Math.max(a[1], b[1]),
});
export const rangeSize = (rc) => ({ rows: rc.r1 - rc.r0 + 1, cols: rc.c1 - rc.c0 + 1 });
export const wholeTable = (table) => ({ r0: 0, r1: table.rows.length - 1, c0: 0, c1: table.width - 1 });
export const isSingleCell = (rc) => rc.r0 === rc.r1 && rc.c0 === rc.c1;

export function rangeSources(table, rc) {
  const out = [];
  for (let r = rc.r0; r <= rc.r1; r++) {
    const row = table.rows[r];
    const line = [];
    for (let c = rc.c0; c <= rc.c1; c++) line.push(row?.cells[c] ?? "");
    out.push(line);
  }
  return out;
}

/** Tab separated text, the way Excel reads it (quotes only when a cell has a tab, quote or line break). */
export function rangeToTsv(table, rc) {
  return clipboardTableText(rangeSources(table, rc).map((row) => row.map(cellPlain)));
}

/** HTML table for the clipboard: Excel / Sheets / Word read inline styles, so marks become style attributes. */
export function rangeToHtml(table, rc) {
  const rows = rangeSources(table, rc).map((row) => {
    const cells = row.map((source, index) => {
      const align = /^:?-+:$/.test(table.alignments[rc.c0 + index] || "") ? (table.alignments[rc.c0 + index].startsWith(":") ? "center" : "right") : "";
      const inner = RICH.test(cellText(source)) ? cellHtml(source).replace(/<mark /g, "<span ").replace(/<\/mark>/g, "</span>")
        : escapeHtml(cellText(source)).replace(/\n/g, "<br>");
      return "<td" + (align ? ` style="text-align:${align}"` : "") + ">" + inner + "</td>";
    });
    return "<tr>" + cells.join("") + "</tr>";
  });
  return "<table><tbody>" + rows.join("") + "</tbody></table>";
}

/** Lossless copy between note tables (cell source as stored). */
export function rangeToPayload(table, rc) {
  return JSON.stringify({ v: 1, rows: rangeSources(table, rc) });
}

export function parsePayload(text) {
  try {
    const data = JSON.parse(text);
    if (data?.v === 1 && Array.isArray(data.rows) && data.rows.length && data.rows.every((row) => Array.isArray(row) && row.every((v) => typeof v === "string"))) {
      return data.rows;
    }
  } catch { /* not ours */ }
  return null;
}

// ---------------------------------------------------------------- edits (each returns true when something changed) --
export function clearRange(table, rc) {
  let changed = false;
  for (let r = rc.r0; r <= rc.r1; r++) {
    for (let c = rc.c0; c <= rc.c1; c++) changed = setTableCellSource(table, r, c, "") || changed;
  }
  return changed;
}

/** Paste a grid of cell sources with its top-left cell at (r, c); grows the table when it does not fit. */
export function pasteSources(table, r, c, grid) {
  const cols = Math.max(...grid.map((row) => row.length));
  let changed = growTable(table, r, c, grid.length, cols);
  grid.forEach((row, dr) => row.forEach((source, dc) => {
    changed = setTableCellSource(table, r + dr, c + dc, source) || changed;
  }));
  return changed;
}

/** A single copied value pasted onto a bigger selection fills the whole selection (Excel does the same). */
export function pasteIntoRange(table, rc, grid) {
  if (grid.length === 1 && grid[0].length === 1 && !isSingleCell(rc)) {
    let changed = false;
    for (let r = rc.r0; r <= rc.r1; r++) for (let c = rc.c0; c <= rc.c1; c++) changed = setTableCellSource(table, r, c, grid[0][0]) || changed;
    return changed;
  }
  return pasteSources(table, rc.r0, rc.c0, grid);
}

/** Ctrl+D: the top row of the selection goes down; one selected row copies from the row above. */
export function fillDown(table, rc) {
  const fromRow = rc.r1 > rc.r0 ? rc.r0 : rc.r0 - 1;
  if (fromRow < 0) return false;
  let changed = false;
  for (let r = fromRow === rc.r0 ? rc.r0 + 1 : rc.r0; r <= rc.r1; r++) {
    for (let c = rc.c0; c <= rc.c1; c++) changed = setTableCellSource(table, r, c, table.rows[fromRow].cells[c] ?? "") || changed;
  }
  return changed;
}

/** Ctrl+R: the left column of the selection goes right; one selected column copies from the column to its left. */
export function fillRight(table, rc) {
  const fromCol = rc.c1 > rc.c0 ? rc.c0 : rc.c0 - 1;
  if (fromCol < 0) return false;
  let changed = false;
  for (let r = rc.r0; r <= rc.r1; r++) {
    const value = table.rows[r].cells[fromCol] ?? "";
    for (let c = fromCol === rc.c0 ? rc.c0 + 1 : rc.c0; c <= rc.c1; c++) changed = setTableCellSource(table, r, c, value) || changed;
  }
  return changed;
}

// ---------------------------------------------------------------- sort: ascending -> descending -> off --
/** Next state of a header toggle chip. */
export const nextSortDirection = (current) => (current === 1 ? -1 : current === -1 ? 0 : 1);

/** Put the body rows back into the order they had before sorting (rows added or removed since are kept at the end). */
export function restoreRowOrder(table, original) {
  const body = table.rows.slice(1);
  const known = original.filter((row) => body.includes(row));
  const extra = body.filter((row) => !original.includes(row));
  const ordered = [...known, ...extra];
  if (ordered.every((row, index) => row === body[index])) return false;
  table.rows.splice(1, body.length, ...ordered);
  return true;
}

// ---------------------------------------------------------------- navigation --
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/** Arrow / Home / End movement. `ctrl` jumps to the edge of the table. */
export function moveCursor([r, c], key, { rows, cols }, ctrl = false) {
  if (key === "ArrowUp") return [ctrl ? 0 : clamp(r - 1, 0, rows - 1), c];
  if (key === "ArrowDown") return [ctrl ? rows - 1 : clamp(r + 1, 0, rows - 1), c];
  if (key === "ArrowLeft") return [r, ctrl ? 0 : clamp(c - 1, 0, cols - 1)];
  if (key === "ArrowRight") return [r, ctrl ? cols - 1 : clamp(c + 1, 0, cols - 1)];
  if (key === "Home") return ctrl ? [0, 0] : [r, 0];
  if (key === "End") return ctrl ? [rows - 1, cols - 1] : [r, cols - 1];
  return [r, c];
}

/** Tab / Shift+Tab: next cell in reading order. `append` is true when Tab leaves the last cell (the table adds a row). */
export function tabTarget([r, c], { rows, cols }, back = false) {
  if (back) return c > 0 ? { pos: [r, c - 1] } : r > 0 ? { pos: [r - 1, cols - 1] } : { pos: [r, c] };
  if (c < cols - 1) return { pos: [r, c + 1] };
  if (r < rows - 1) return { pos: [r + 1, 0] };
  return { pos: [r, c], append: true };
}
