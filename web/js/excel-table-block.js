// Candidate Markdown storage for editable Excel tables. Unknown blocks stay in the Markdown source.
import { joinBlocks, segment } from "./mdblocks.js";
import { parseClipboardTable } from "./note-table-model.js";
import { isExcelDimension, isExcelFillPattern, isExcelNumber, isExcelStyle } from "./paste-excel.js";

const OPEN = /^(`{3,}|~{3,})mi-excel-table[ \t]*$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_SOURCE_LENGTH = 4 * 1024 * 1024;
const MAX_ROWS = 1000;
const MAX_COLS = 60;
const MAX_CELLS = 10000;

const isRecord = (value) => Object.getPrototypeOf(value ?? false) === Object.prototype;
export const isExcelTableId = (value) => typeof value === "string" && ID.test(value);
const hasOnly = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
const optionalDimension = (value) => value === undefined || value === null || isExcelDimension(value);
const validStyles = (styles) => isRecord(styles) && Object.entries(styles).every(([key, value]) => isExcelStyle(key, value));
const separator = (value) => value === null || (typeof value === "string" && value.length <= 32);

function validValue(value) {
  if (value === null) return true;
  return isRecord(value) && hasOnly(value, ["type", "raw"]) && typeof value.raw === "string"
    && (value.type === "text" || (value.type === "number" && isExcelNumber(value.raw)));
}

function validRichText(lines) {
  return Array.isArray(lines) && [...lines].every(line => Array.isArray(line) && [...line].every(run =>
    isRecord(run) && hasOnly(run, ["text", "styles"]) && typeof run.text === "string" && validStyles(run.styles)));
}

function validFill(fill) {
  return isRecord(fill) && hasOnly(fill, ["pattern", "foreground"]) && isExcelFillPattern(fill.pattern, fill.foreground);
}

const CELL_KEYS = [
  "displayText", "value", "numberFormat", "rowSpan", "colSpan",
  "styles", "richText", "fillPattern", "width", "height",
];

function validCell(cell) {
  return isRecord(cell) && hasOnly(cell, CELL_KEYS)
    && typeof cell.displayText === "string" && validValue(cell.value)
    && (cell.numberFormat === undefined || cell.numberFormat === null || typeof cell.numberFormat === "string")
    && (cell.styles === undefined || validStyles(cell.styles))
    && (cell.richText === undefined || validRichText(cell.richText))
    && (cell.fillPattern === undefined || validFill(cell.fillPattern))
    && optionalDimension(cell.width) && optionalDimension(cell.height);
}

function validGrid(rows, cols) {
  const ids = new Set();
  const occupied = new Uint8Array(rows.length * cols);
  for (const [r, row] of rows.entries()) {
    if (!isRecord(row) || !hasOnly(row, ["id", "cells", "height"]) || !isExcelTableId(row.id) || ids.has(row.id)
      || !optionalDimension(row.height) || !Array.isArray(row.cells) || row.cells.length !== cols) return false;
    ids.add(row.id);
    for (const [c, cell] of row.cells.entries()) {
      if (cell === null) continue;
      if (!validCell(cell)) return false;
      const rowSpan = cell.rowSpan === undefined ? 1 : cell.rowSpan;
      const colSpan = cell.colSpan === undefined ? 1 : cell.colSpan;
      if (!Number.isInteger(rowSpan) || rowSpan < 1 || rowSpan > rows.length - r
        || !Number.isInteger(colSpan) || colSpan < 1 || colSpan > cols - c) return false;
      for (let y = r; y < r + rowSpan; y++) {
        for (let x = c; x < c + colSpan; x++) {
          const offset = y * cols + x;
          if (occupied[offset]) return false;
          occupied[offset] = 1;
        }
      }
    }
  }
  return true;
}

function validSize(rows, cols) {
  return Number.isInteger(rows) && Number.isInteger(cols) && rows > 0 && rows <= MAX_ROWS
    && cols > 0 && cols <= MAX_COLS && rows * cols <= MAX_CELLS;
}

function isSupported(table) {
  if (!isRecord(table) || !hasOnly(table, ["version", "id", "columns", "rows", "columnWidths", "numberSeparators"])
    || table.version !== 1 || !isExcelTableId(table.id)) return false;
  const { rows, columns, columnWidths, numberSeparators } = table;
  if (!Array.isArray(columns) || !Array.isArray(rows) || !validSize(rows.length, columns.length)
    || ![...columns].every(isExcelTableId)) return false;
  const columnIds = new Set(columns);
  if (columnIds.size !== columns.length) return false;
  const validWidths = columnWidths === undefined || (isRecord(columnWidths)
    && Object.entries(columnWidths).every(([id, width]) => columnIds.has(id) && isExcelDimension(width)));
  const validSeparators = numberSeparators === undefined || (isRecord(numberSeparators)
    && hasOnly(numberSeparators, ["decimal", "thousands"])
    && separator(numberSeparators.decimal) && separator(numberSeparators.thousands));
  return validWidths && validSeparators && validGrid(rows, columns.length);
}

/** Convert the projected Excel clipboard range into the candidate model. The caller assigns fresh IDs. */
export function excelTableFromPaste(block, { id, rowIds, columnIds }) {
  if (!block?.excel || !Array.isArray(block.rows) || !Array.isArray(rowIds) || !Array.isArray(columnIds)
    || !validSize(rowIds.length, columnIds.length)
    || rowIds.length !== block.rows.length || columnIds.length !== block.cols) return null;
  const { columnWidths, rowHeights, cells, numberSeparators } = block.excel;
  if (!Array.isArray(columnWidths) || columnWidths.length !== columnIds.length
    || !Array.isArray(rowHeights) || rowHeights.length !== rowIds.length || !Array.isArray(cells)) return null;
  const columns = [...columnIds];
  const widths = Object.fromEntries(columns.flatMap((key, index) =>
    columnWidths[index] == null ? [] : [[key, columnWidths[index]]]));
  const rows = rowIds.map((key, index) => ({
    id: key,
    height: rowHeights[index] ?? null,
    cells: Array(columns.length).fill(null),
  }));
  for (const { row, col, ...cell } of cells) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || col < 0 || col >= columns.length
      || !rows[row] || rows[row].cells[col] !== null) return null;
    rows[row].cells[col] = cell;
  }
  const table = { version: 1, id, columns, rows, columnWidths: widths, numberSeparators };
  return isSupported(table) ? structuredClone(table) : null;
}

function readPayload(block) {
  if (block.kind !== "code" || block.src.length > MAX_SOURCE_LENGTH) return null;
  const lines = block.src.split(/\r\n?|\n/);
  const open = OPEN.exec(lines[0]);
  if (!open || lines.length < 3) return null;
  const [marker] = open[1];
  const close = new RegExp(`^ {0,3}\\${marker}{${open[1].length},}[ \\t]*$`);
  if (!close.test(lines.at(-1))) return null;
  try {
    return JSON.parse(lines.slice(1, -1).join("\n"));
  } catch {
    return null;
  }
}

/** A readable ID reserves the name even when the grid or version cannot be rendered. */
export function inspectExcelTableBlock(block) {
  const table = readPayload(block);
  return isRecord(table) && isExcelTableId(table.id)
    ? { id: table.id, table: isSupported(table) ? table : null }
    : null;
}

function* tablesWithId(document, id) {
  for (const block of document.blocks) {
    const table = readPayload(block);
    if (isRecord(table) && table.id === id) yield { block, table };
  }
}

// An unsupported block with a readable ID also reserves the ID, so it cannot be silently shadowed.
function findBlock(document, id) {
  let match = null;
  for (const entry of tablesWithId(document, id)) {
    if (match) return null;
    match = entry;
  }
  return match && isSupported(match.table) ? match : null;
}

/** Prepare an independent copy for insertion. Use the whole destination note to check the new ID. */
export function copyExcelTable(table, destinationMarkdown, { id, rowIds, columnIds }) {
  if (!isSupported(table) || !isExcelTableId(id) || id === table.id
    || !Array.isArray(rowIds) || rowIds.length !== table.rows.length
    || !Array.isArray(columnIds) || columnIds.length !== table.columns.length
    || ![...rowIds].every(isExcelTableId) || ![...columnIds].every(isExcelTableId)) return null;
  const originalRows = new Set(table.rows.map(row => row.id));
  const originalColumns = new Set(table.columns);
  if (rowIds.some(key => originalRows.has(key)) || columnIds.some(key => originalColumns.has(key))
    || !tablesWithId(segment(destinationMarkdown), id).next().done) return null;

  const copy = structuredClone(table);
  copy.id = id;
  copy.columns = [...columnIds];
  for (const [index, row] of copy.rows.entries()) row.id = rowIds[index];
  if (table.columnWidths !== undefined) {
    copy.columnWidths = Object.fromEntries(table.columns.flatMap((key, index) =>
      Object.hasOwn(table.columnWidths, key) ? [[columnIds[index], table.columnWidths[key]]] : []));
  }
  return serializeExcelTable(copy) === null ? null : copy;
}

/** Apply a row permutation while keeping the same ordered row IDs inside each vertical merge. */
export function reorderExcelRows(table, rowIds) {
  if (!isSupported(table) || !Array.isArray(rowIds) || rowIds.length !== table.rows.length
    || new Set(rowIds).size !== rowIds.length) return null;
  const rowsById = new Map(table.rows.map(row => [row.id, row]));
  const rows = Array.from(rowIds, id => rowsById.get(id));
  if (rows.includes(undefined)) return null;
  const positions = new Map(rowIds.map((id, index) => [id, index]));
  for (const [index, row] of table.rows.entries()) {
    const span = Math.max(1, ...row.cells.map(cell => cell?.rowSpan ?? 1));
    const start = positions.get(row.id);
    for (let offset = 1; offset < span; offset++) {
      if (rowIds[start + offset] !== table.rows[index + offset].id) return null;
    }
  }
  return { ...table, rows };
}

function withCellValue(cell, displayText, value) {
  const replacement = { ...cell, displayText, value };
  if (cell?.displayText !== displayText || (displayText === "" && value === null)) delete replacement.richText;
  return replacement;
}

/** Edit a cell by stable IDs. A covered coordinate must be edited through its merge anchor. */
export function editExcelCell(table, rowId, columnId, { displayText, value }) {
  if (!isSupported(table) || typeof displayText !== "string" || !validValue(value)) return null;
  const y = table.rows.findIndex(row => row.id === rowId);
  const x = table.columns.indexOf(columnId);
  if (y < 0 || x < 0) return null;
  const row = table.rows[y];
  const cell = row.cells[x];
  if (cell === null) {
    for (let r = 0; r <= y; r++) {
      for (let c = 0; c <= x; c++) {
        const anchor = table.rows[r].cells[c];
        if (anchor && r + (anchor.rowSpan ?? 1) > y && c + (anchor.colSpan ?? 1) > x) return null;
      }
    }
  }
  const rows = [...table.rows];
  rows[y] = { ...row, cells: [...row.cells] };
  rows[y].cells[x] = withCellValue(cell, displayText, value);
  const edited = { ...table, rows };
  return serializeExcelTable(edited) === null ? null : edited;
}

/** Replace a rectangle of cells without resizing the destination or changing its IDs. */
export function pasteExcelRange(table, rowId, columnId, block, { valuesOnly = false } = {}) {
  if (!block?.excel || !Array.isArray(block.rows) || block.truncated) return { error: "source" };
  return replaceExcelRange(table, rowId, columnId, block.rows.length, block.cols, valuesOnly, ids =>
    excelTableFromPaste(block, ids)?.rows.map(row => row.cells));
}

/** Import a rectangular clipboard range as literal display strings without inferring numbers. */
export function pasteExcelTextRange(table, rowId, columnId, text) {
  if (text.length > MAX_SOURCE_LENGTH) return { error: "source" };
  const grid = parseClipboardTable(text, MAX_CELLS);
  const width = grid?.[0].length;
  if (!width || grid.some(row => row.length !== width)) return { error: "source" };
  return replaceExcelRange(table, rowId, columnId, grid.length, width, true, () =>
    grid.map(row => row.map(displayText => displayText ? { displayText, value: null } : null)));
}

function replaceExcelRange(table, rowId, columnId, height, width, valuesOnly, readCells) {
  if (!isSupported(table)) return { error: "source" };
  const y = table.rows.findIndex(row => row.id === rowId);
  const x = table.columns.indexOf(columnId);
  if (!validSize(height, width)) return { error: "source" };
  const bottom = y + height;
  const right = x + width;
  if (y < 0 || x < 0 || bottom > table.rows.length || right > table.columns.length) {
    return { error: "bounds" };
  }
  const covered = valuesOnly ? new Uint8Array(height * width) : null;
  for (let r = 0; r < bottom; r++) {
    for (let c = 0; c < right; c++) {
      const cell = table.rows[r].cells[c];
      if (!cell) continue;
      const endRow = r + (cell.rowSpan ?? 1);
      const endColumn = c + (cell.colSpan ?? 1);
      if (endRow > y && endColumn > x && (r < y || c < x || endRow > bottom || endColumn > right)) {
        return { error: "merge" };
      }
      if (!covered || r < y || c < x) continue;
      for (let ry = r; ry < endRow; ry++) {
        for (let cx = c; cx < endColumn; cx++) {
          if (ry !== r || cx !== c) covered[(ry - y) * width + cx - x] = 1;
        }
      }
    }
  }
  const source = readCells({
    id: table.id,
    rowIds: table.rows.slice(y, bottom).map(row => row.id),
    columnIds: table.columns.slice(x, right),
  });
  if (!source) return { error: "source" };
  const rows = [...table.rows];
  for (const [offset, row] of source.entries()) {
    const destination = rows[y + offset];
    const cells = [...destination.cells];
    for (const [c, cell] of row.entries()) {
      if (!valuesOnly) {
        cells[x + c] = cell;
      } else if (covered[offset * width + c]) {
        if (cell?.displayText || cell?.value) return { error: "merge" };
      } else if (cell || cells[x + c]) {
        cells[x + c] = withCellValue(cells[x + c], cell?.displayText ?? "", cell?.value ?? null);
      }
    }
    rows[y + offset] = { ...destination, cells };
  }
  return { table: { ...table, rows } };
}

export function readExcelTable(markdown, id) {
  return isExcelTableId(id) ? findBlock(segment(markdown), id)?.table ?? null : null;
}

export function serializeExcelTable(table, eol = "\n") {
  if (!isSupported(table) || !["\n", "\r\n", "\r"].includes(eol)) return null;
  const json = JSON.stringify(table, null, 2).replaceAll("\n", eol);
  const source = ["```mi-excel-table", json, "```"].join(eol);
  return source.length <= MAX_SOURCE_LENGTH ? source : null;
}

/** Replace one unambiguous table with the same ID, preserving every other block and separator. */
export function replaceExcelTable(markdown, id, replacement) {
  if (!isExcelTableId(id) || replacement?.id !== id) return null;
  const document = segment(markdown);
  const match = findBlock(document, id);
  if (!match) return null;
  const eol = match.block.src.match(/\r\n?|\n/)[0];
  const source = serializeExcelTable(replacement, eol);
  if (source === null) return null;
  match.block.src = source;
  return joinBlocks(document);
}
