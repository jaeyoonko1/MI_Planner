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

function cellSource(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;")
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

const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function sortTableRows(table, column, direction) {
  const previous = table.rows.slice(1);
  const ordered = [...previous].sort((a, b) => {
    const first = cellText(a.cells[column]);
    const second = cellText(b.cells[column]);
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

export function parseClipboardTable(text) {
  const grid = [[]];
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
  grid.at(-1).push(value);
  return grid;
}

export function clipboardTableText(rows) {
  return rows.map(row => row.map(value => /["\r\n\t]/.test(value)
    ? '"' + value.replace(/"/g, '""') + '"' : value).join("\t")).join("\r\n");
}
