import {
  cellText, clipboardTableText, parseClipboardTable, parseNoteTable, pasteTableCells,
  setTableCell, sortTableRows, writeNoteTable,
} from "./note-table-model.js";

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label, activate) {
  const control = element("button", "chip", label);
  control.type = "button";
  control.addEventListener("click", activate);
  return control;
}

function mountTable(block, table, changed) {
  const tools = element("div", "note-table-tools");
  const status = element("span", "note-table-status");
  status.setAttribute("role", "status");
  const grid = element("table", "note-table-grid");
  grid.setAttribute("aria-label", "노트 표");
  let start = [0, 0];
  let end = start;
  let sort = null;

  const position = field => [Number(field.dataset.row), Number(field.dataset.column)];
  const coordinates = () => [
    Math.min(start[0], end[0]), Math.max(start[0], end[0]),
    Math.min(start[1], end[1]), Math.max(start[1], end[1]),
  ];
  const fieldAt = ([row, column]) => grid.querySelector(
    '[data-row="' + row + '"][data-column="' + column + '"]'
  );
  function paintSelection() {
    const [firstRow, lastRow, firstCol, lastCol] = coordinates();
    for (const field of grid.querySelectorAll("textarea")) {
      const [row, col] = position(field);
      field.parentElement.toggleAttribute("data-selected", row >= firstRow && row <= lastRow && col >= firstCol && col <= lastCol);
    }
  }

  function select(pos, extend = false) {
    if (!extend) start = pos;
    end = pos;
    paintSelection();
  }

  function save() {
    block.dataset.src = writeNoteTable(table);
    changed();
  }

  function copyText() {
    const [firstRow, lastRow, firstCol, lastCol] = coordinates();
    return clipboardTableText(table.rows.slice(firstRow, lastRow + 1).map(row =>
      Array.from({ length: lastCol - firstCol + 1 }, (_, offset) => cellText(row.cells[firstCol + offset]))
    ));
  }

  async function copyFromButton() {
    try {
      await navigator.clipboard.writeText(copyText());
      status.textContent = "선택 영역을 복사했습니다.";
    } catch {
      fieldAt(end)?.focus();
      status.textContent = "Ctrl+C로 복사하세요.";
    }
  }

  function addRow() {
    const row = table.rows.length;
    if (pasteTableCells(table, row, 0, [[""]])) {
      sort = null;
      select([row, 0]);
      render();
      fieldAt(end)?.focus();
      save();
    }
  }

  function sortBy(column) {
    const direction = sort?.column === column ? -sort.direction : 1;
    sort = { column, direction };
    const reordered = sortTableRows(table, column, direction);
    select([0, column]);
    render();
    grid.querySelector('[data-sort="' + column + '"]')?.focus();
    if (reordered) save();
  }

  function makeRow(row, index) {
    const tr = element("tr");
    for (let column = 0; column < table.width; column++) {
      const cell = element(index ? "td" : "th");
      const alignment = table.alignments[column] || "";
      if (alignment.endsWith(":")) cell.dataset.align = alignment.startsWith(":") ? "center" : "right";
      const input = element("textarea", "note-table-cell");
      input.rows = 1;
      input.spellcheck = false;
      input.dataset.row = String(index);
      input.dataset.column = String(column);
      input.value = cellText(row.cells[column]);
      input.setAttribute("aria-label", index ? index + "행 " + (column + 1) + "열" : (column + 1) + "열 제목");
      if (index) {
        cell.append(input);
      } else {
        cell.scope = "col";
        const active = sort?.column === column;
        const sortButton = button(active ? (sort.direction > 0 ? "↑" : "↓") : "↕", () => sortBy(column));
        sortButton.dataset.sort = String(column);
        sortButton.setAttribute("aria-label", (column + 1) + "열 " + (active && sort.direction > 0 ? "내림차순" : "오름차순") + " 정렬");
        if (active) cell.setAttribute("aria-sort", sort.direction > 0 ? "ascending" : "descending");
        const header = element("div", "note-table-header");
        header.append(input, sortButton);
        cell.append(header);
      }
      tr.append(cell);
    }
    return tr;
  }

  function render() {
    const head = element("thead");
    const body = element("tbody");
    head.append(makeRow(table.rows[0], 0));
    table.rows.slice(1).forEach((row, index) => body.append(makeRow(row, index + 1)));
    grid.replaceChildren(head, body);
    paintSelection();
  }

  const fieldFrom = event => event.target.closest("textarea.note-table-cell");
  block.addEventListener("focusin", event => {
    const field = fieldFrom(event);
    if (field && field !== fieldAt(end)) select(position(field));
  });
  block.addEventListener("pointerdown", event => {
    const field = fieldFrom(event);
    if (field) select(position(field), event.shiftKey);
  });
  function editCell(event) {
    const field = fieldFrom(event);
    if (!field) return;
    event.stopPropagation();
    if (event.isComposing) return;
    const [row, column] = position(field);
    if (setTableCell(table, row, column, field.value)) {
      // A value edit invalidates the displayed sort order until the next sort.
      if (sort && column === sort.column && row > 0) {
        grid.querySelector("[aria-sort]")?.removeAttribute("aria-sort");
        const sortButton = grid.querySelector("[data-sort='" + sort.column + "']");
        sortButton.textContent = "↕";
        sortButton.setAttribute("aria-label", column + 1 + "열 오름차순 정렬");
        sort = null;
      }
      save();
    }
  }
  block.addEventListener("input", editCell);
  block.addEventListener("compositionend", editCell);
  block.addEventListener("keydown", event => {
    const field = fieldFrom(event);
    if (!field && !event.target.closest("button")) return;
    event.stopPropagation();
    if (!field || event.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const [row, col] = position(field);
      fieldAt([Math.min(row + 1, table.rows.length - 1), col])?.focus();
    }
  });
  block.addEventListener("copy", event => {
    const field = fieldFrom(event);
    if (!field || !event.clipboardData || (start === end && field.selectionStart !== field.selectionEnd)) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", copyText());
  });
  block.addEventListener("paste", event => {
    const field = fieldFrom(event);
    if (!field) return;
    event.stopPropagation();
    const text = event.clipboardData?.getData("text/plain") || "";
    const spreadsheet = /<table[\s>]/i.test(event.clipboardData?.getData("text/html") || "");
    if (!spreadsheet && !/[\t\r\n]/.test(text)) return;
    event.preventDefault();
    const pos = position(field);
    const values = parseClipboardTable(text);
    if (pasteTableCells(table, ...pos, values)) {
      sort = null;
      start = pos;
      end = [pos[0] + values.length - 1, pos[1] + Math.max(...values.map(row => row.length)) - 1];
      render();
      fieldAt(end)?.focus();
      save();
    }
  });

  tools.append(button("행 추가", addRow), button("선택 복사", copyFromButton), status);
  block.classList.add("note-table");
  block.removeAttribute("title");
  block.replaceChildren(tools, grid);
  render();
}

export function bindNoteTables(editor, changed) {
  const mounted = new WeakSet();
  function refresh() {
    for (const block of editor.querySelectorAll(":scope > [data-raw][data-k='table']")) {
      if (mounted.has(block)) continue;
      const table = parseNoteTable(block.dataset.src);
      if (table) {
        mountTable(block, table, changed);
        mounted.add(block);
      }
    }
  }

  function insert() {
    const selection = getSelection();
    const anchor = selection?.anchorNode;
    let top = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    while (top && top !== editor && top.parentElement !== editor) top = top.parentElement;
    const block = element("div", "raw");
    block.contentEditable = "false";
    block.dataset.raw = "1";
    block.dataset.k = "table";
    block.dataset.src = ["| 열 1 | 열 2 |", "| --- | --- |", "|  |  |"].join(editor.dataset.eol || "\n");
    if (top && top !== editor && editor.contains(top)) top.after(block);
    else editor.append(block);
    if (block === editor.lastElementChild) {
      const paragraph = element("div");
      paragraph.append(document.createElement("br"));
      block.after(paragraph);
    }
    refresh();
    block.querySelector("textarea")?.focus();
    changed();
  }

  return { refresh, insert };
}
