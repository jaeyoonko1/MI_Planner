const DELIMITER = /^:?-+:?$/;

function splitRow(line) {
  const cells = [""];
  let backslashes = 0;
  let pipes = 0;
  let trailing = false;
  for (const char of line) {
    if (char === "|" && backslashes % 2 === 0) {
      cells.push("");
      pipes++;
      trailing = true;
    } else {
      cells[cells.length - 1] += char;
      if (char.trim()) trailing = false;
    }
    backslashes = char === "\\" ? backslashes + 1 : 0;
  }
  if (line.trimStart().startsWith("|")) cells.shift();
  if (trailing) cells.pop();
  return { cells: cells.map(cell => cell.trim()), pipes };
}

export function tableWidth(header, delimiter) {
  if (!delimiter || /^(?: {4}|\t)/.test(header) || /^(?: {4}|\t)/.test(delimiter)) return 0;
  const first = splitRow(header);
  const second = splitRow(delimiter);
  return first.pipes && second.cells.length === first.cells.length && second.cells.every(cell => DELIMITER.test(cell))
    ? first.cells.length : 0;
}

export const hasTablePipe = line => splitRow(line).pipes > 0;

export function parseNoteTable(source) {
  const lines = source.split(/(\r\n|\r|\n)/);
  const width = tableWidth(lines[0], lines[2]);
  if (!width) return null;
  const row = (raw) => ({ raw, cells: splitRow(raw).cells });
  const rows = [row(lines[0])];
  for (let index = 4; index < lines.length; index += 2) rows.push(row(lines[index]));
  return {
    rows, width, delimiter: lines[2],
    alignments: splitRow(lines[2]).cells,
    breaks: lines.filter((_, index) => index % 2 === 1),
  };
}

const serializeRow = cells => "| " + cells.join(" | ") + " |";

export function writeNoteTable(table) {
  const lines = table.rows.map(row => row.raw ?? serializeRow(row.cells));
  lines.splice(1, 0, table.delimiter ?? serializeRow(table.alignments));
  const fallback = table.breaks[0] || "\n";
  return lines.map((line, index) => index ? (table.breaks[index - 1] || fallback) + line : line).join("");
}

// Use reversible Markdown-safe text for literal clipboard pipes and line breaks.
export const cellText = value => (value || "")
  .replace(/(\\+)\|/g, (whole, slashes) => slashes.length % 2 ? "\\".repeat((slashes.length - 1) / 2) + "|" : whole)
  .replace(/<br\s*\/?>|&#9;|&#32;|&amp;|&lt;/gi, token => {
    if (token.startsWith("<")) return "\n";
    return { "&#9;": "\t", "&#32;": " ", "&amp;": "&", "&lt;": "<" }[token.toLowerCase()];
  });

// The only inline markup a cell may carry (same tags as mdconv.js): <u>, <mark>, <span style="color">. Any other "<" is text.
const KEEP_TAG = /<(?!(?:\/(?:u|mark|span)|u|mark(?: style="background:#[0-9a-fA-F]{6}")?|span style="color:#[0-9a-fA-F]{6}")>)/g;

export function cellSource(text) {
  return text.replace(/&/g, "&amp;").replace(KEEP_TAG, "&lt;")
    .replace(/(\\*)\|/g, (_, slashes) => "\\".repeat(slashes.length * 2 + 1) + "|")
    .replace(/\r\n|\r|\n/g, "<br>").replace(/\t/g, "&#9;")
    .replace(/^ +| +$/g, spaces => "&#32;".repeat(spaces.length));
}

export function setTableCell(table, rowIndex, column, text) {
  const row = table.rows[rowIndex];
  if (cellText(row.cells[column]) === text) return false;
  while (row.cells.length < table.width) row.cells.push("");
  row.cells[column] = cellSource(text);
  row.raw = null;
  return true;
}

// Store a cell from ready-made cell source (as it appears between the pipes). Returns true when it changed.
export function setTableCellSource(table, rowIndex, column, source) {
  const row = table.rows[rowIndex];
  if ((row.cells[column] ?? "") === source) return false;
  while (row.cells.length < table.width) row.cells.push("");
  row.cells[column] = source;
  row.raw = null;
  return true;
}

// Grow the table so that `rows` x `cols` cells starting at (rowIndex, column) exist. New header cells get "열 N".
export function growTable(table, rowIndex, column, rows, cols) {
  let changed = false;
  const needed = column + cols;
  if (needed > table.width) {
    changed = true;
    table.width = needed;
    table.delimiter = null;
    while (table.alignments.length < needed) table.alignments.push("---");
    for (const [index, row] of table.rows.entries()) {
      while (row.cells.length < needed) row.cells.push(index ? "" : "열 " + (row.cells.length + 1));
      row.raw = null;
    }
  }
  while (table.rows.length < rowIndex + rows) {
    table.rows.push({ raw: null, cells: Array(table.width).fill("") });
    changed = true;
  }
  return changed;
}

export function pasteTableCells(table, rowIndex, column, values) {
  const needed = column + Math.max(...values.map(row => row.length));
  let changed = false;
  if (needed > table.width) {
    changed = true;
    table.width = needed;
    table.delimiter = null;
    while (table.alignments.length < needed) table.alignments.push("---");
    for (const [index, row] of table.rows.entries()) {
      while (row.cells.length < needed) {
        row.cells.push(index ? "" : "열 " + (row.cells.length + 1));
      }
      row.raw = null;
    }
  }
  values.forEach((row, offset) => {
    const target = rowIndex + offset;
    if (!table.rows[target]) {
      table.rows[target] = { raw: null, cells: Array(table.width).fill("") };
      changed = true;
    }
    row.forEach((value, index) => {
      changed = setTableCell(table, target, column + index, value) || changed;
    });
  });
  return changed;
}

// ---- structure edits (V-009). Pure functions on the parsed table; rows that change lose their `raw`
// text (they are re-serialized), untouched rows keep it so unedited tables stay byte-identical.
const blankRow = width => ({ raw: null, cells: Array(width).fill("") });
const padCells = (cells, width) => Array.from({ length: width }, (_, index) => cells[index] ?? "");
const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

// A table with at most this many filled cells is deleted without a confirmation question.
export const TABLE_CONFIRM_CELLS = 3;
const PLACEHOLDER_HEADER = /^열 \d+$/;

export function tableFilledCells(table) {
  let count = 0;
  table.rows.forEach((row, index) => {
    for (const cell of row.cells) {
      const text = cellText(cell).trim();
      if (text && !(index === 0 && PLACEHOLDER_HEADER.test(text))) count++;
    }
  });
  return count;
}

// Insert `count` empty body rows at `index` (1 = right under the header). Returns the first new row index.
export function insertTableRows(table, index, count = 1) {
  const at = clamp(index, 1, table.rows.length);
  table.rows.splice(at, 0, ...Array.from({ length: count }, () => blankRow(table.width)));
  return at;
}

// Delete rows from..to (inclusive). Returns { empty: true } without changing anything when no row would be
// left. Deleting the header row promotes the next row to the header.
export function deleteTableRows(table, from, to = from) {
  const first = clamp(Math.min(from, to), 0, table.rows.length - 1);
  const last = clamp(Math.max(from, to), 0, table.rows.length - 1);
  const keep = table.rows.filter((_, index) => index < first || index > last);
  if (!keep.length) return { empty: true };
  if (first === 0) keep[0] = { raw: null, cells: padCells(keep[0].cells, table.width) };
  table.rows = keep;
  return { empty: false, removed: last - first + 1 };
}

// Insert `count` empty columns so the first new one gets index `index` (0..width).
export function insertTableColumns(table, index, count = 1) {
  const at = clamp(index, 0, table.width);
  for (const [rowIndex, row] of table.rows.entries()) {
    const cells = padCells(row.cells, table.width);
    cells.splice(at, 0, ...Array.from({ length: count }, (_, k) => rowIndex ? "" : "열 " + (table.width + k + 1)));
    row.cells = cells;
    row.raw = null;
  }
  table.alignments.splice(at, 0, ...Array(count).fill("---"));
  table.width += count;
  table.delimiter = null;
  return at;
}

// Delete columns from..to (inclusive). { empty: true } (nothing changed) when no column would be left.
export function deleteTableColumns(table, from, to = from) {
  const first = clamp(Math.min(from, to), 0, table.width - 1);
  const last = clamp(Math.max(from, to), 0, table.width - 1);
  const count = last - first + 1;
  if (count >= table.width) return { empty: true };
  for (const row of table.rows) {
    const cells = padCells(row.cells, table.width);
    cells.splice(first, count);
    row.cells = cells;
    row.raw = null;
  }
  table.alignments.splice(first, count);
  table.width -= count;
  table.delimiter = null;
  return { empty: false, removed: count };
}

export const tableHeaderBlank = table => table.rows[0].cells.every(cell => !cell.trim());

// Markdown always has a header row: "off" pushes the header text down into the first body row and leaves a
// blank header, "on" turns the first body row into the header again. Returns "off" | "on" | null (nothing to do).
export function toggleTableHeader(table) {
  if (!tableHeaderBlank(table)) {
    const old = table.rows[0];
    table.rows.splice(0, 1, blankRow(table.width), { raw: null, cells: padCells(old.cells, table.width) });
    return "off";
  }
  if (table.rows.length < 2) return null;
  const next = table.rows[1];
  table.rows.splice(0, 2, { raw: null, cells: padCells(next.cells, table.width) });
  return "on";
}

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function sortTableRows(table, column, direction, read = cellText) {
  const previous = table.rows.slice(1);
  const ordered = [...previous].sort((a, b) => {
    const first = read(a.cells[column]);
    const second = read(b.cells[column]);
    if (!first || !second) return Number(!first) - Number(!second);
    const firstNumber = NUMBER.test(first) && Number.isFinite(Number(first));
    const secondNumber = NUMBER.test(second) && Number.isFinite(Number(second));
    if (firstNumber && secondNumber) return (Number(first) - Number(second)) * direction;
    if (firstNumber !== secondNumber) return (Number(secondNumber) - Number(firstNumber)) * direction;
    return collator.compare(first, second) * direction;
  });
  if (ordered.every((row, index) => row === previous[index])) return false;
  table.rows.splice(1, previous.length, ...ordered);
  return true;
}

export function parseClipboardTable(text, maxCells = Infinity) {
  const grid = [[]];
  let cellCount = 0;
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      value += '"';
      index++;
    } else if (char === '"' && quoted) {
      quoted = false;
    } else if (char === '"' && !value && text.indexOf('"', index + 1) !== -1) {
      quoted = true;
    } else if (!quoted && /[\t\r\n]/.test(char)) {
      if (++cellCount > maxCells) return null;
      grid.at(-1).push(value);
      value = "";
      if (char !== "\t") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        if (index === text.length - 1) return grid;
        grid.push([]);
      }
    } else {
      value += char;
    }
  }
  if (cellCount >= maxCells) return null;
  grid.at(-1).push(value);
  return grid;
}

export function clipboardTableText(rows) {
  return rows.map(row => row.map(value => /["\r\n\t]/.test(value)
    ? '"' + value.replace(/"/g, '""') + '"' : value).join("\t")).join("\r\n");
}
