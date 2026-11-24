import {
  TABLE_CONFIRM_CELLS, cellText, clipboardTableText, deleteTableColumns, deleteTableRows, insertTableColumns,
  insertTableRows, parseClipboardTable, parseNoteTable, pasteTableCells, setTableCell, sortTableRows,
  tableFilledCells, tableHeaderBlank, toggleTableHeader, writeNoteTable,
} from "./note-table-model.js";
import { toast } from "./toast.js";

// Inside a table cell the innermost scope wins: these Alt+Shift keys edit the table, not the note columns (V-008).
export const TABLE_KEY_HELP = [
  ["Alt+Shift+↑ / ↓", "현재 행의 위 / 아래에 행 삽입 (여러 칸을 선택했으면 그 수만큼)"],
  ["Alt+Shift+← / →", "현재 열의 왼쪽 / 오른쪽에 열 삽입"],
  ["Alt+Shift+Delete", "선택한 행 삭제"],
  ["Alt+Shift+Backspace", "선택한 열 삭제"],
  ["Alt+Shift+H", "머리글 행 켜기 / 끄기"],
  ["Esc", "칸에서 표 전체 선택 (Delete·Backspace로 표 삭제, Enter로 다시 편집)"],
  ["Ctrl+Z", "방금 한 표 삭제·행·열 변경 되돌리기"],
];

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  rowAbove: "M2.5 8.5h11v5h-11z M8 1.5v4 M6 3.5h4",
  rowBelow: "M2.5 2.5h11v5h-11z M8 10.5v4 M6 12.5h4",
  rowDelete: "M2.5 5.5h11v5h-11z M6 8h4",
  colLeft: "M8.5 2.5h5v11h-5z M1.5 8h4 M3.5 6v4",
  colRight: "M2.5 2.5h5v11h-5z M10.5 8h4 M12.5 6v4",
  colDelete: "M5.5 2.5h5v11h-5z M6.8 8h2.4",
  header: "M2.5 2.5h11v11h-11z M2.5 6.5h11 M7 6.5v7",
  keys: "M2 4.5h12v7H2z M4.5 7h1 M7.5 7h1 M10.5 7h1 M5 9.5h6",
  remove: "M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 8.5h5.8l.6-8.5 M7 7v4 M9 7v4",
};

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

function iconButton(id, label, activate) {
  const control = element("button", "note-col-btn");
  control.type = "button";
  control.title = label;
  control.setAttribute("aria-label", label.split(" · ")[0]);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[id]);
  svg.append(path);
  control.append(svg);
  control.addEventListener("mousedown", event => event.preventDefault()); // keep the cell focus and selection
  control.addEventListener("click", activate);
  return control;
}

// host: { changed, remember(run) -> entry, undo(entry) -> bool, removeBlock(block, message) }
function mountTable(block, table, host) {
  const changed = host.changed;
  const tools = element("div", "note-table-tools");
  tools.setAttribute("role", "toolbar");
  tools.setAttribute("aria-label", "표 도구");
  const status = element("span", "note-table-status");
  status.setAttribute("role", "status");
  block.tabIndex = 0;
  block.setAttribute("role", "group");
  block.setAttribute("aria-label", "표 · Esc로 선택, Delete로 삭제");
  const grid = element("table", "note-table-grid");
  grid.setAttribute("aria-label", "노트 표");
  let start = [0, 0];
  let end = start;
  let sort = null;
  let confirmStrip = null;
  const tool = {};

  const position = field => [Number(field.dataset.row), Number(field.dataset.column)];
  const coordinates = () => [
    Math.min(start[0], end[0]), Math.max(start[0], end[0]),
    Math.min(start[1], end[1]), Math.max(start[1], end[1]),
  ];
  const fieldAt = ([row, column]) => grid.querySelector(
    '[data-row="' + row + '"][data-column="' + column + '"]'
  );
  const range = () => {
    const [firstRow, lastRow, firstCol, lastCol] = coordinates();
    return { firstRow, lastRow, firstCol, lastCol, rows: lastRow - firstRow + 1, cols: lastCol - firstCol + 1 };
  };
  const announce = message => { status.textContent = message; };

  function paintTools() {
    if (!tool.rowAbove) return;
    const r = range();
    tool.rowAbove.disabled = r.firstRow === 0;
    tool.rowDelete.title = (r.rows > 1 ? "선택한 " + r.rows + "개 행 삭제" : "이 행 삭제") + " · Alt+Shift+Delete";
    tool.colDelete.title = (r.cols > 1 ? "선택한 " + r.cols + "개 열 삭제" : "이 열 삭제") + " · Alt+Shift+Backspace";
    const blank = tableHeaderBlank(table);
    tool.header.setAttribute("aria-pressed", String(!blank));
    tool.header.disabled = blank && table.rows.length < 2;
  }

  function paintSelection() {
    const [firstRow, lastRow, firstCol, lastCol] = coordinates();
    for (const field of grid.querySelectorAll("textarea")) {
      const [row, col] = position(field);
      field.parentElement.toggleAttribute("data-selected", row >= firstRow && row <= lastRow && col >= firstCol && col <= lastCol);
    }
    paintTools();
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

  // ---- structure edits: one undo entry per change (V-008 pattern: toast button + Ctrl+Z) ----------
  const selection = () => ({ start: [...start], end: [...end] });

  function restoreTo(source, saved) {
    if (!block.isConnected) return false;
    closeConfirm();
    table = parseNoteTable(source);
    sort = null;
    start = saved.start;
    end = saved.end;
    render();
    fieldAt(end)?.focus();
    save();
    announce("되돌렸어요");
    return true;
  }

  function commit(message, before, saved, focus) {
    const entry = host.remember(() => restoreTo(before, saved));
    sort = null;
    start = end = focus;
    render();
    fieldAt(end)?.focus();
    save();
    announce(message);
    toast(message, { action: { label: "되돌리기", run: () => {
      if (!host.undo(entry)) throw new Error("그 뒤에 편집해서 되돌릴 수 없어요.");
    } } });
  }

  function insertRows(below) {
    const r = range();
    if (!below && r.firstRow === 0) return announce("머리글 위에는 행을 넣을 수 없어요. 머리글을 끄려면 Alt+Shift+H");
    const before = writeNoteTable(table);
    const saved = selection();
    const first = insertTableRows(table, below ? r.lastRow + 1 : r.firstRow, r.rows);
    commit(r.rows + "개 행을 " + (below ? "아래" : "위") + "에 삽입했어요", before, saved, [first, saved.end[1]]);
  }

  function insertColumns(right) {
    const r = range();
    const before = writeNoteTable(table);
    const saved = selection();
    const first = insertTableColumns(table, right ? r.lastCol + 1 : r.firstCol, r.cols);
    commit(r.cols + "개 열을 " + (right ? "오른쪽" : "왼쪽") + "에 삽입했어요", before, saved, [saved.end[0], first]);
  }

  function deleteRows() {
    const r = range();
    const before = writeNoteTable(table);
    const saved = selection();
    const result = deleteTableRows(table, r.firstRow, r.lastRow);
    if (result.empty) return askRemoveTable("마지막 행이라 표 전체가 삭제돼요.", true);
    commit(r.rows + "개 행을 삭제했어요", before, saved, [Math.min(r.firstRow, table.rows.length - 1), saved.end[1]]);
  }

  function deleteColumns() {
    const r = range();
    const before = writeNoteTable(table);
    const saved = selection();
    const result = deleteTableColumns(table, r.firstCol, r.lastCol);
    if (result.empty) return askRemoveTable("마지막 열이라 표 전체가 삭제돼요.", true);
    commit(r.cols + "개 열을 삭제했어요", before, saved, [saved.end[0], Math.min(r.firstCol, table.width - 1)]);
  }

  function flipHeader() {
    const before = writeNoteTable(table);
    const saved = selection();
    const result = toggleTableHeader(table);
    if (!result) return announce("본문 행이 없어서 머리글을 끌 수 없어요.");
    commit(result === "off" ? "머리글을 껐어요" : "머리글을 켰어요", before, saved, [0, saved.end[1]]);
  }

  // ---- whole table delete: asks only when the table holds more than a few filled cells --------------
  function closeConfirm(refocus = false) {
    if (!confirmStrip) return;
    confirmStrip.remove();
    confirmStrip = null;
    if (refocus) (fieldAt(end) || block).focus();
  }

  function removeTable() {
    closeConfirm();
    host.removeBlock(block, "표를 삭제했어요");
  }

  // `always`: a row / column delete would leave nothing, so the question is asked even for a nearly empty table.
  function askRemoveTable(reason = "", always = false) {
    const filled = tableFilledCells(table);
    if (!always && filled <= TABLE_CONFIRM_CELLS) return removeTable();
    closeConfirm();
    const strip = element("div", "note-table-confirm");
    strip.setAttribute("role", "alertdialog");
    strip.setAttribute("aria-label", "표 삭제 확인");
    const title = element("span", "note-table-confirm-t", reason || "표 전체를 삭제할까요?");
    const detail = element("span", "note-table-confirm-d",
      (filled ? "내용이 있는 칸 " + filled + "개가 함께 사라져요. " : "") + "삭제 뒤에도 Ctrl+Z로 되돌릴 수 있어요.");
    const confirm = button("표 삭제", removeTable);
    confirm.classList.add("danger");
    const cancel = button("취소", () => closeConfirm(true));
    strip.append(title, detail, confirm, cancel);
    strip.addEventListener("keydown", event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeConfirm(true); }
    });
    tools.after(strip);
    confirmStrip = strip;
    cancel.focus();
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
    if (!index && tableHeaderBlank(table)) tr.dataset.blank = "1";
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
  block.addEventListener("focus", event => {
    if (event.target === block) announce("표를 선택했어요 · Delete로 삭제 · Enter로 편집");
  });
  block.addEventListener("blur", event => {
    if (event.target === block) announce("");
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
      if (row === 0) paintTools();
      save();
    }
  }
  block.addEventListener("input", editCell);
  block.addEventListener("compositionend", editCell);

  const SHORTCUTS = {
    ArrowUp: () => insertRows(false),
    ArrowDown: () => insertRows(true),
    ArrowLeft: () => insertColumns(false),
    ArrowRight: () => insertColumns(true),
    Delete: deleteRows,
    Backspace: deleteColumns,
  };
  block.addEventListener("keydown", event => {
    const field = fieldFrom(event);
    // The table block itself is "selected": Delete / Backspace removes the whole table, Enter goes back to the cells.
    if (event.target === block) {
      if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        event.stopPropagation();
        askRemoveTable();
      } else if (event.key === "Enter") {
        event.preventDefault();
        event.stopPropagation();
        (fieldAt(end) || fieldAt([0, 0]))?.focus();
      }
      return;
    }
    if (!field && !event.target.closest("button")) return;
    event.stopPropagation();
    if (!field || event.isComposing || event.keyCode === 229) return;
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const run = event.code === "KeyH" ? flipHeader : SHORTCUTS[event.key];
      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      block.focus();
      return;
    }
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

  // ---- toolbar: icon buttons (aria-label + title with the shortcut), hover / focus shows them fully ----
  const group = (...controls) => {
    const node = element("span", "note-table-group");
    node.setAttribute("role", "group");
    node.append(...controls);
    return node;
  };
  tool.rowAbove = iconButton("rowAbove", "위에 행 삽입 · Alt+Shift+↑", () => insertRows(false));
  tool.rowBelow = iconButton("rowBelow", "아래에 행 삽입 · Alt+Shift+↓", () => insertRows(true));
  tool.rowDelete = iconButton("rowDelete", "이 행 삭제 · Alt+Shift+Delete", deleteRows);
  tool.colLeft = iconButton("colLeft", "왼쪽에 열 삽입 · Alt+Shift+←", () => insertColumns(false));
  tool.colRight = iconButton("colRight", "오른쪽에 열 삽입 · Alt+Shift+→", () => insertColumns(true));
  tool.colDelete = iconButton("colDelete", "이 열 삭제 · Alt+Shift+Backspace", deleteColumns);
  tool.header = iconButton("header", "머리글 행 켜기·끄기 · Alt+Shift+H", flipHeader);
  tool.remove = iconButton("remove", "표 삭제 · 표를 선택하고 Delete", () => askRemoveTable());
  tool.keys = iconButton("keys", "표 단축키 보기", () => {
    const open = help.hidden;
    help.hidden = !open;
    tool.keys.setAttribute("aria-expanded", String(open));
  });
  tool.keys.setAttribute("aria-expanded", "false");
  tool.rowDelete.classList.add("danger");
  tool.colDelete.classList.add("danger");
  tool.remove.classList.add("danger");
  const help = element("dl", "note-layout-help note-table-help");
  help.hidden = true;
  for (const [keys, text] of TABLE_KEY_HELP) {
    const dt = element("dt");
    dt.append(element("kbd", "", keys));
    help.append(dt, element("dd", "", text));
  }
  const spacer = element("span", "note-table-spacer");
  tools.append(
    group(tool.rowAbove, tool.rowBelow, tool.rowDelete),
    group(tool.colLeft, tool.colRight, tool.colDelete),
    group(tool.header),
    button("선택 복사", copyFromButton),
    spacer, status,
    group(tool.keys, tool.remove),
  );
  block.classList.add("note-table");
  block.removeAttribute("title");
  block.replaceChildren(tools, help, grid);
  render();
}

export function bindNoteTables(editor, changed) {
  const mounted = new WeakSet();
  const undoStack = [];

  function refresh() {
    for (const block of editor.querySelectorAll(":scope > [data-raw][data-k='table']")) {
      if (mounted.has(block)) continue;
      const table = parseNoteTable(block.dataset.src);
      if (table) {
        mountTable(block, table, host);
        mounted.add(block);
      }
    }
  }

  // ---- undo for table-level changes (same rule as the note columns: typing afterwards hands undo back
  // to the browser, so a stale entry is dropped instead of restoring over newer text) ----
  function remember(run) {
    const entry = { run, stale: false };
    undoStack.push(entry);
    if (undoStack.length > 20) undoStack.shift();
    return entry;
  }

  function undo(entry = undoStack.at(-1)) {
    if (!entry || entry !== undoStack.at(-1)) return false;
    if (entry.stale || !editor.isConnected) {
      undoStack.length = 0;
      return false;
    }
    undoStack.pop();
    return entry.run() !== false;
  }

  editor.addEventListener("input", () => undoStack.forEach(entry => { entry.stale = true; }), true);
  editor.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    const z = event.key.toLowerCase() === "z" || event.code === "KeyZ";
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey || !z) return;
    const entry = undoStack.at(-1);
    if (!entry || entry.stale) return;
    event.preventDefault();
    event.stopPropagation(); // the note columns' own undo (V-008) must not run for the same key press
    undo(entry);
  }, true);

  function makeBlock(source) {
    const block = element("div", "raw");
    block.contentEditable = "false";
    block.dataset.raw = "1";
    block.dataset.k = "table";
    block.dataset.src = source;
    return block;
  }

  function placeCaret(target, atStart) {
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(atStart);
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // Remove a whole table block, keep an editable line to land on, and offer an undo that puts it back in place.
  function removeBlock(block, message) {
    const source = block.dataset.src;
    const index = [...editor.children].indexOf(block);
    if (index < 0) return;
    const next = block.nextElementSibling;
    const previous = block.previousElementSibling;
    block.remove();
    if (!editor.children.length) editor.append(Object.assign(element("div"), { innerHTML: "<br>" }));
    const editable = node => node && !node.matches("[data-raw]");
    if (editable(next)) placeCaret(next, true);
    else if (editable(previous)) placeCaret(previous, false);
    else {
      const paragraph = Object.assign(element("div"), { innerHTML: "<br>" });
      (next || previous || editor.lastElementChild).before(paragraph);
      placeCaret(paragraph, true);
    }
    changed();
    const entry = remember(() => {
      if (!editor.isConnected) return false;
      const restored = makeBlock(source);
      editor.insertBefore(restored, editor.children[index] || null);
      refresh();
      restored.focus();
      changed();
      return true;
    });
    toast(message, { action: { label: "되돌리기", run: () => {
      if (!undo(entry)) throw new Error("그 뒤에 편집해서 되돌릴 수 없어요.");
    } } });
  }

  const host = { changed, remember, undo, removeBlock };

  function insert() {
    const selection = getSelection();
    const anchor = selection?.anchorNode;
    let top = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    while (top && top !== editor && top.parentElement !== editor) top = top.parentElement;
    const block = makeBlock(["| 열 1 | 열 2 |", "| --- | --- |", "|  |  |"].join(editor.dataset.eol || "\n"));
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
