import {
  TABLE_CONFIRM_CELLS, cellText, deleteTableColumns, deleteTableRows, insertTableColumns,
  insertTableRows, parseClipboardTable, parseNoteTable, setTableCell, setTableCellSource, sortTableRows,
  tableFilledCells, tableHeaderBlank, toggleTableHeader, writeNoteTable, cellSource,
} from "./note-table-model.js";
import {
  PAYLOAD_TYPE, cellHtml, cellPlain, clearRange, fillDown, fillRight, isRichCell, moveCursor, nextSortDirection,
  normalizeRange, parsePayload, pasteIntoRange, rangeToHtml, rangeToPayload, rangeToTsv, restoreRowOrder, tabTarget,
} from "./note-table-range.js";
import { blockSources, clipboardToTable, pasteNotes, tableBlockToSource } from "./paste-html.js";
import { hidePasteChip, showPasteChip } from "./paste-chip.js";
import { toast } from "./toast.js";

// Inside a table cell the innermost scope wins: these keys edit the table, not the note columns (V-008).
export const TABLE_KEY_HELP = [
  ["방향키 / Shift+방향키", "칸 이동 / 범위 선택 (Ctrl+방향키는 표 끝까지, 마우스 드래그·Shift+클릭도 가능)"],
  ["Ctrl+A / Shift+Space / Ctrl+Space", "표 전체 / 행 / 열 선택"],
  ["Enter / Shift+Enter / Tab / Shift+Tab", "아래 / 위 / 오른쪽 / 왼쪽 칸으로 (마지막 칸에서 Tab은 행 추가)"],
  ["F2 · 더블클릭 · 그냥 입력", "칸 편집 (입력하면 내용을 바꿔 써요) · Esc 취소 · Alt+Enter 줄바꿈"],
  ["Delete", "선택한 칸 지우기"],
  ["Ctrl+C / X / V", "범위 복사·잘라내기·붙여넣기 (엑셀과 서식 포함 교환, Ctrl+Shift+V는 텍스트만)"],
  ["Ctrl+D / Ctrl+R", "아래로 / 오른쪽으로 채우기 (한 칸이면 위 / 왼쪽 칸 값 복사)"],
  ["Alt+Shift+↑ / ↓", "현재 행의 위 / 아래에 행 삽입 (여러 칸을 선택했으면 그 수만큼)"],
  ["Alt+Shift+← / →", "현재 열의 왼쪽 / 오른쪽에 열 삽입"],
  ["Alt+Shift+Delete", "선택한 행 삭제"],
  ["Alt+Shift+Backspace", "선택한 열 삭제"],
  ["Alt+Shift+H", "머리글 행 켜기 / 끄기"],
  ["Esc", "칸 선택에서 표 전체 선택 (Delete·Backspace로 표 삭제, Enter로 다시 편집)"],
  ["Ctrl+Z / Ctrl+Y", "표 편집 되돌리기 / 다시 실행 (칸 편집 중에는 그 칸의 입력만)"],
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

const HISTORY_LIMIT = 100;
const MIN_COL = 56;

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

// host: { changed, removeBlock(block, message), leave(block, direction) }
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
  const scroller = element("div", "note-table-scroll");
  scroller.append(grid);

  let start = [0, 0];
  let end = start;
  let mode = "select"; // "select": arrows move the cell, typing replaces it · "edit": the text caret is live
  let editField = null;
  let editBase = null;
  let internal = false; // our own focus() calls must not reset the selection
  let sort = null; // { column, direction }
  let sortBase = null; // body rows in their original order, kept while a sort chip is on
  let confirmStrip = null;
  let colWidths = null; // session only: Markdown has nowhere to store a column width
  let fields = [];
  let cells = [];
  let painted = [];
  let dragging = false;
  let textOnlyPaste = false;
  const undoStack = [];
  const redoStack = [];
  const tool = {};

  const position = field => [Number(field.dataset.row), Number(field.dataset.column)];
  const fieldAt = ([row, column]) => fields[row]?.[column];
  const rect = () => normalizeRange(start, end);
  const sizeOf = () => ({ rows: table.rows.length, cols: table.width });
  const range = () => {
    const rc = rect();
    return { firstRow: rc.r0, lastRow: rc.r1, firstCol: rc.c0, lastCol: rc.c1, rows: rc.r1 - rc.r0 + 1, cols: rc.c1 - rc.c0 + 1 };
  };
  const announce = message => { status.textContent = message; };
  const selection = () => ({ start: [...start], end: [...end] });

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
    for (const cell of painted) { cell.removeAttribute("data-selected"); cell.removeAttribute("data-edge"); }
    painted = [];
    const rc = rect();
    const single = rc.r0 === rc.r1 && rc.c0 === rc.c1;
    for (let row = rc.r0; row <= rc.r1; row++) {
      for (let col = rc.c0; col <= rc.c1; col++) {
        const cell = cells[row]?.[col];
        if (!cell) continue;
        cell.setAttribute("data-selected", "");
        if (!single) {
          cell.dataset.edge = (row === rc.r0 ? "t" : "") + (row === rc.r1 ? "b" : "") + (col === rc.c0 ? "l" : "") + (col === rc.c1 ? "r" : "");
        }
        painted.push(cell);
      }
    }
    paintTools();
  }

  function setSelection(a, b = a) {
    start = a;
    end = b;
    paintSelection();
  }

  function focusCell(pos) {
    const field = fieldAt(pos);
    if (!field) return;
    internal = true;
    field.focus();
    field.select();
    internal = false;
    field.closest("td, th")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function save() {
    block.dataset.src = writeNoteTable(table);
    changed();
  }

  // ---- table-level undo / redo: every committed change (edit, paste, fill, sort, structure) is one entry ----
  function record(before, saved) {
    const after = writeNoteTable(table);
    if (after === before) return;
    undoStack.push({ before, after, saved, savedAfter: selection() });
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
  }

  function restoreTo(source, saved, message) {
    if (!block.isConnected) return false;
    closeConfirm();
    mode = "select";
    editField = null;
    table = parseNoteTable(source);
    sort = null;
    sortBase = null;
    start = saved.start;
    end = saved.end;
    render();
    focusCell(end);
    save();
    announce(message);
    return true;
  }

  function undoLocal() {
    commitEdit();
    const entry = undoStack.pop();
    if (!entry) return false;
    redoStack.push(entry);
    return restoreTo(entry.before, entry.saved, "되돌렸어요");
  }

  function redoLocal() {
    commitEdit();
    const entry = redoStack.pop();
    if (!entry) return false;
    undoStack.push(entry);
    return restoreTo(entry.after, entry.savedAfter, "다시 실행했어요");
  }

  block._tableHistory = {
    undo: undoLocal, redo: redoLocal, editing: () => mode === "edit",
    canUndo: () => undoStack.length > 0, canRedo: () => redoStack.length > 0,
  };

  // Run a change on the table model as one undoable step. `change()` returns true when something changed.
  function mutate(message, change, focus = end, selectAfter = null) {
    commitEdit();
    const before = writeNoteTable(table);
    const saved = selection();
    if (!change()) { announce("바뀐 내용이 없어요"); return false; }
    sort = null;
    sortBase = null;
    if (selectAfter) setSelection(...selectAfter);
    else setSelection(start, end);
    render();
    focusCell(focus);
    save();
    record(before, saved);
    announce(message);
    return true;
  }

  function commit(message, before, saved, focus) {
    sort = null;
    sortBase = null;
    start = end = focus;
    render();
    focusCell(end);
    save();
    record(before, saved);
    announce(message);
    toast(message, { action: { label: "되돌리기", run: () => {
      if (!undoLocal()) throw new Error("되돌릴 내용이 없어요.");
    } } });
  }

  // ---- structure edits ----
  function insertRows(below) {
    commitEdit();
    const r = range();
    if (!below && r.firstRow === 0) return announce("머리글 위에는 행을 넣을 수 없어요. 머리글을 끄려면 Alt+Shift+H");
    const before = writeNoteTable(table);
    const saved = selection();
    const first = insertTableRows(table, below ? r.lastRow + 1 : r.firstRow, r.rows);
    commit(r.rows + "개 행을 " + (below ? "아래" : "위") + "에 삽입했어요", before, saved, [first, saved.end[1]]);
  }

  function insertColumns(right) {
    commitEdit();
    const r = range();
    const before = writeNoteTable(table);
    const saved = selection();
    const first = insertTableColumns(table, right ? r.lastCol + 1 : r.firstCol, r.cols);
    commit(r.cols + "개 열을 " + (right ? "오른쪽" : "왼쪽") + "에 삽입했어요", before, saved, [saved.end[0], first]);
  }

  function deleteRows() {
    commitEdit();
    const r = range();
    const before = writeNoteTable(table);
    const saved = selection();
    const result = deleteTableRows(table, r.firstRow, r.lastRow);
    if (result.empty) return askRemoveTable("마지막 행이라 표 전체가 삭제돼요.", true);
    commit(r.rows + "개 행을 삭제했어요", before, saved, [Math.min(r.firstRow, table.rows.length - 1), saved.end[1]]);
  }

  function deleteColumns() {
    commitEdit();
    const r = range();
    const before = writeNoteTable(table);
    const saved = selection();
    const result = deleteTableColumns(table, r.firstCol, r.lastCol);
    if (result.empty) return askRemoveTable("마지막 열이라 표 전체가 삭제돼요.", true);
    if (colWidths) colWidths.splice(r.firstCol, r.cols);
    commit(r.cols + "개 열을 삭제했어요", before, saved, [saved.end[0], Math.min(r.firstCol, table.width - 1)]);
  }

  function flipHeader() {
    commitEdit();
    const before = writeNoteTable(table);
    const saved = selection();
    const result = toggleTableHeader(table);
    if (!result) return announce("본문 행이 없어서 머리글을 끌 수 없어요.");
    commit(result === "off" ? "머리글을 껐어요" : "머리글을 켰어요", before, saved, [0, saved.end[1]]);
  }

  function appendRow() {
    const before = writeNoteTable(table);
    const saved = selection();
    const first = insertTableRows(table, table.rows.length, 1);
    commit("행을 추가했어요", before, saved, [first, 0]);
  }

  // ---- whole table delete: asks only when the table holds more than a few filled cells ----
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

  // ---- sort chips: off -> ascending -> descending -> off (off puts the rows back in their original order) ----
  function sortBy(column) {
    commitEdit();
    const direction = nextSortDirection(sort?.column === column ? sort.direction : 0);
    const before = writeNoteTable(table);
    const saved = selection();
    if (!sort) sortBase = table.rows.slice(1);
    if (direction) {
      sortTableRows(table, column, direction, cellPlain);
      sort = { column, direction };
    } else {
      restoreRowOrder(table, sortBase);
      sort = null;
      sortBase = null;
    }
    setSelection([0, column]);
    render();
    grid.querySelector('[data-sort="' + column + '"]')?.focus();
    save();
    record(before, saved);
    announce(direction > 0 ? (column + 1) + "열 오름차순" : direction < 0 ? (column + 1) + "열 내림차순" : "정렬을 껐어요");
  }

  // ---- cell edit mode ----
  function refreshView(field) {
    const box = field.closest(".note-table-cellbox");
    const [row, column] = position(field);
    const source = table.rows[row]?.cells[column] ?? "";
    const rich = isRichCell(source);
    if (rich) { box.dataset.rich = "1"; box.querySelector(".note-table-view").innerHTML = cellHtml(source); }
    else { box.removeAttribute("data-rich"); box.querySelector(".note-table-view").textContent = ""; }
  }

  function beginEdit(field, atEnd = false) {
    if (mode === "edit" && editField === field) return;
    commitEdit();
    mode = "edit";
    editField = field;
    editBase = { source: writeNoteTable(table), value: field.value, saved: selection() };
    field.closest(".note-table-cellbox").dataset.editing = "1";
    if (atEnd) field.setSelectionRange(field.value.length, field.value.length);
    announce("편집 중 · Enter 확정 · Esc 취소");
  }

  function endEdit() {
    const field = editField;
    mode = "select";
    editField = null;
    field?.closest(".note-table-cellbox")?.removeAttribute("data-editing");
    if (field?.isConnected) refreshView(field);
    return field;
  }

  function commitEdit() {
    if (mode !== "edit") return;
    const base = editBase;
    endEdit();
    announce("");
    if (base) record(base.source, base.saved);
  }

  function cancelEdit() {
    if (mode !== "edit") return;
    const field = editField;
    const [row, column] = position(field);
    field.value = editBase.value;
    setTableCell(table, row, column, field.value);
    save();
    endEdit();
    field.select();
    announce("편집을 취소했어요");
  }

  // ---- clipboard ----
  function copyPayload(data) {
    const rc = rect();
    data.setData("text/plain", rangeToTsv(table, rc));
    data.setData("text/html", rangeToHtml(table, rc));
    data.setData(PAYLOAD_TYPE, rangeToPayload(table, rc));
  }

  async function copyFromButton() {
    try {
      await navigator.clipboard.writeText(rangeToTsv(table, rect()));
      status.textContent = "선택 영역을 복사했습니다.";
    } catch {
      fieldAt(end)?.focus();
      status.textContent = "Ctrl+C로 복사하세요.";
    }
  }

  function clearSelection() {
    const rc = rect();
    const count = (rc.r1 - rc.r0 + 1) * (rc.c1 - rc.c0 + 1);
    mutate(count + "칸을 지웠어요", () => clearRange(table, rc));
  }

  // The grid to paste: our own payload, then clipboard HTML table, then tab separated text.
  function clipboardGrid(data, format) {
    const payload = parsePayload(data.getData(PAYLOAD_TYPE));
    if (payload) return { grid: format ? payload : payload.map(row => row.map(source => cellSource(cellPlain(source)))), notes: [], formatted: format };
    const hit = clipboardToTable({ html: data.getData("text/html"), text: data.getData("text/plain") });
    if (hit) return { grid: blockSources(hit.block, format), notes: pasteNotes(hit.block), formatted: format && hit.block.hasFormat };
    return null;
  }

  function pasteGrid(grid, notes) {
    const rc = rect();
    const rows = grid.length;
    const cols = Math.max(...grid.map(row => row.length));
    const single = rows === 1 && cols === 1;
    const fill = single && !(rc.r0 === rc.r1 && rc.c0 === rc.c1);
    const target = fill ? [[rc.r0, rc.c0], [rc.r1, rc.c1]] : [[rc.r0, rc.c0], [rc.r0 + rows - 1, rc.c0 + cols - 1]];
    const ok = mutate((fill ? "선택한 칸을 같은 값으로 채웠어요" : rows + "×" + cols + " 칸을 붙여넣었어요"),
      () => pasteIntoRange(table, rc, grid), target[1], target);
    if (ok && notes.length) toast(notes.join(" · "));
  }

  block.addEventListener("copy", event => {
    const field = fieldFrom(event);
    if (!field || !event.clipboardData || mode === "edit") return;
    event.preventDefault();
    copyPayload(event.clipboardData);
  });
  block.addEventListener("cut", event => {
    const field = fieldFrom(event);
    if (!field || !event.clipboardData || mode === "edit") return;
    event.preventDefault();
    copyPayload(event.clipboardData);
    clearSelection();
  });
  block.addEventListener("paste", event => {
    const field = fieldFrom(event);
    if (!field) return;
    event.stopPropagation();
    const data = event.clipboardData;
    if (!data) return;
    const format = !textOnlyPaste;
    textOnlyPaste = false;
    const result = clipboardGrid(data, format);
    if (result) {
      event.preventDefault();
      commitEdit();
      pasteGrid(result.grid, result.notes);
      return;
    }
    const text = data.getData("text/plain") || "";
    if (mode === "edit" && !/[\t\r\n]/.test(text)) return; // plain text into the open cell: the browser does it
    if (!text) return;
    event.preventDefault();
    commitEdit();
    pasteGrid(parseClipboardTable(text).map(row => row.map(cellSource)), []);
  });

  // ---- rendering ----
  function makeRow(row, index) {
    const tr = element("tr");
    fields[index] = [];
    cells[index] = [];
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
      const box = element("div", "note-table-cellbox");
      const view = element("div", "note-table-view");
      view.setAttribute("aria-hidden", "true");
      box.append(input, view);
      if (isRichCell(row.cells[column] ?? "")) {
        box.dataset.rich = "1";
        view.innerHTML = cellHtml(row.cells[column]);
      }
      fields[index][column] = input;
      cells[index][column] = cell;
      if (index) {
        cell.append(box);
      } else {
        cell.scope = "col";
        const active = sort?.column === column;
        const label = active ? (sort.direction > 0 ? "↑" : "↓") : "↕";
        const sortButton = button(label, () => sortBy(column));
        sortButton.dataset.sort = String(column);
        sortButton.setAttribute("aria-label", (column + 1) + "열 " + (!active ? "오름차순 정렬" : sort.direction > 0 ? "내림차순 정렬" : "정렬 끄기"));
        if (active) cell.setAttribute("aria-sort", sort.direction > 0 ? "ascending" : "descending");
        const header = element("div", "note-table-header");
        header.append(box, sortButton);
        cell.append(header);
        const handle = element("span", "note-table-resize");
        handle.dataset.column = String(column);
        handle.title = "끌어서 열 너비 조절 · 더블클릭으로 원래대로 (이 화면에서만 유지)";
        cell.append(handle);
      }
      tr.append(cell);
    }
    return tr;
  }

  function applyWidths() {
    const columns = grid.querySelectorAll("col");
    if (!colWidths) { grid.style.tableLayout = ""; grid.style.width = ""; return; }
    colWidths.length = table.width;
    columns.forEach((col, index) => { col.style.width = (colWidths[index] || MIN_COL * 2) + "px"; });
    grid.style.tableLayout = "fixed";
    grid.style.width = colWidths.reduce((sum, w) => sum + (w || MIN_COL * 2), 0) + "px";
  }

  function render() {
    fields = [];
    cells = [];
    painted = [];
    const head = element("thead");
    const body = element("tbody");
    head.append(makeRow(table.rows[0], 0));
    table.rows.slice(1).forEach((row, index) => body.append(makeRow(row, index + 1)));
    const columns = element("colgroup");
    for (let column = 0; column < table.width; column++) columns.append(element("col"));
    grid.replaceChildren(columns, head, body);
    applyWidths();
    start = [Math.min(start[0], table.rows.length - 1), Math.min(start[1], table.width - 1)];
    end = [Math.min(end[0], table.rows.length - 1), Math.min(end[1], table.width - 1)];
    paintSelection();
  }

  // ---- column width drag (session only) ----
  grid.addEventListener("pointerdown", event => {
    const handle = event.target.closest(".note-table-resize");
    if (!handle) return;
    event.preventDefault();
    event.stopPropagation();
    const column = Number(handle.dataset.column);
    if (!colWidths) colWidths = [...grid.querySelectorAll("thead th")].map(th => Math.round(th.getBoundingClientRect().width));
    const startX = event.clientX;
    const startWidth = colWidths[column];
    handle.setPointerCapture(event.pointerId);
    handle.dataset.active = "1";
    const move = e => {
      colWidths[column] = Math.max(MIN_COL, Math.round(startWidth + e.clientX - startX));
      applyWidths();
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.removeAttribute("data-active");
      announce("열 너비는 이 화면에서만 유지돼요");
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
  grid.addEventListener("dblclick", event => {
    if (!event.target.closest(".note-table-resize")) return;
    colWidths = null;
    applyWidths();
  });

  // ---- selection with the pointer ----
  const fieldFrom = event => event.target.closest?.("textarea.note-table-cell");
  const fieldUnder = event => {
    const cell = event.target.closest?.("td, th");
    return cell?.querySelector("textarea.note-table-cell") || null;
  };

  block.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    const field = fieldUnder(event);
    if (!field || event.target.closest("button, .note-table-resize")) return;
    if (mode === "edit" && field === editField) return; // native caret inside the cell being edited
    event.preventDefault();
    commitEdit();
    const pos = position(field);
    setSelection(event.shiftKey ? start : pos, pos);
    focusCell(pos);
    dragging = true;
  });
  block.addEventListener("mousemove", event => {
    if (!dragging) return;
    if (!(event.buttons & 1)) { dragging = false; return; }
    const field = fieldUnder(event);
    if (!field) return;
    const pos = position(field);
    if (pos[0] === end[0] && pos[1] === end[1]) return;
    setSelection(start, pos);
  });
  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    focusCell(end);
  });
  block.addEventListener("dblclick", event => {
    const field = fieldUnder(event);
    if (!field || event.target.closest("button, .note-table-resize")) return;
    event.preventDefault();
    beginEdit(field, true);
    field.focus();
  });

  block.addEventListener("focusin", event => {
    const field = fieldFrom(event);
    if (!field || internal) return;
    if (mode === "edit" && field !== editField) commitEdit();
    if (mode === "edit") return;
    const pos = position(field);
    if (!block.contains(event.relatedTarget)) announce("F2 또는 더블클릭으로 편집 · 방향키로 이동");
    if (pos[0] !== end[0] || pos[1] !== end[1] || start === end) setSelection(pos);
    field.select();
  });
  block.addEventListener("focusout", event => {
    if (!block.contains(event.relatedTarget)) { commitEdit(); dragging = false; }
  });
  block.addEventListener("focus", event => {
    if (event.target === block) announce("표를 선택했어요 · Delete로 삭제 · Enter로 편집");
  });
  block.addEventListener("blur", event => {
    if (event.target === block) announce("");
  });

  function editCell(event) {
    const field = fieldFrom(event);
    if (!field) return;
    event.stopPropagation();
    if (event.isComposing) return;
    if (mode !== "edit") beginEdit(field);
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

  // ---- keyboard ----
  const SHORTCUTS = {
    ArrowUp: () => insertRows(false),
    ArrowDown: () => insertRows(true),
    ArrowLeft: () => insertColumns(false),
    ArrowRight: () => insertColumns(true),
    Delete: deleteRows,
    Backspace: deleteColumns,
  };

  function go(pos, extend = false) {
    if (extend) setSelection(start, pos);
    else setSelection(pos);
    focusCell(pos);
  }

  function selectKey(event) {
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    if (mod && !event.altKey) {
      const k = key.toLowerCase();
      if (k === "a") { event.preventDefault(); setSelection([0, 0], [table.rows.length - 1, table.width - 1]); return; }
      if (k === "d") { event.preventDefault(); const rc = rect(); mutate("아래로 채웠어요", () => fillDown(table, rc)); return; }
      if (k === "r") { event.preventDefault(); const rc = rect(); mutate("오른쪽으로 채웠어요", () => fillRight(table, rc)); return; }
      if (k === "v" && event.shiftKey) { textOnlyPaste = true; setTimeout(() => { textOnlyPaste = false; }, 600); return; }
      if (key === " ") { event.preventDefault(); setSelection([0, end[1]], [table.rows.length - 1, end[1]]); return; }
      if (!key.startsWith("Arrow") && key !== "Home" && key !== "End") return;
    }
    if (key === " " && event.shiftKey) { event.preventDefault(); setSelection([end[0], 0], [end[0], table.width - 1]); return; }
    if (key.startsWith("Arrow") || key === "Home" || key === "End") {
      event.preventDefault();
      go(moveCursor(end, key, sizeOf(), mod), event.shiftKey);
    } else if (key === "Tab") {
      event.preventDefault();
      const target = tabTarget(end, sizeOf(), event.shiftKey);
      if (target.append) appendRow();
      else go(target.pos);
    } else if (key === "Enter") {
      event.preventDefault();
      go(moveCursor(end, event.shiftKey ? "ArrowUp" : "ArrowDown", sizeOf()));
    } else if (key === "F2") {
      event.preventDefault();
      beginEdit(fieldAt(end), true);
    } else if (key === "Delete" || key === "Backspace") {
      event.preventDefault();
      clearSelection();
    } else if (key === "Escape") {
      event.preventDefault();
      block.focus();
    } else if (key.length === 1 && !mod && !event.altKey) {
      beginEdit(fieldAt(end)); // the cell text is selected, so the typed character replaces it
    }
  }

  function editKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    } else if (event.key === "Enter" && event.altKey) {
      event.preventDefault();
      editField.setRangeText("\n", editField.selectionStart, editField.selectionEnd, "end");
      editField.dispatchEvent(new Event("input", { bubbles: true }));
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      commitEdit();
      go(moveCursor(end, "ArrowDown", sizeOf()));
    } else if (event.key === "Tab") {
      event.preventDefault();
      const target = tabTarget(end, sizeOf(), event.shiftKey);
      commitEdit();
      if (target.append) appendRow();
      else go(target.pos);
    }
  }

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
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        host.leave(block, event.key === "ArrowUp" ? -1 : 1);
      }
      return;
    }
    if (!field && !event.target.closest("button")) return;
    event.stopPropagation();
    if (!field) return;
    if (event.isComposing || event.keyCode === 229) {
      if (mode === "select") beginEdit(field); // a Korean / Japanese composition starts: replace the cell text
      return;
    }
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
      const run = event.code === "KeyH" ? flipHeader : SHORTCUTS[event.key];
      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }
    if (mode === "edit") editKey(event);
    else selectKey(event);
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
  block.replaceChildren(tools, help, scroller);
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

  // ---- undo for editor-level changes (table removed / pasted). Typing afterwards hands undo back to the
  // browser, so a stale entry is dropped instead of restoring over newer text. Edits inside a table use the
  // table's own history (mountTable) ----
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

  editor.addEventListener("input", event => {
    if (event.target.closest?.("[data-k='table']")) return; // cell typing is the table's own history
    undoStack.forEach(entry => { entry.stale = true; });
  }, true);
  editor.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;
    const k = event.key.toLowerCase();
    const undoKey = (k === "z" || event.code === "KeyZ") && !event.shiftKey;
    const redoKey = k === "y" || event.code === "KeyY" || ((k === "z" || event.code === "KeyZ") && event.shiftKey);
    if (!undoKey && !redoKey) return;
    const history = event.target.closest?.("[data-k='table']")?._tableHistory;
    if (history) {
      if (history.editing()) return; // inside a cell being edited the browser's own text undo applies
      if (undoKey ? history.canUndo() : history.canRedo()) {
        event.preventDefault();
        event.stopPropagation();
        (undoKey ? history.undo : history.redo)();
        return;
      }
    }
    if (!undoKey) return;
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

  const editable = node => node && !node.matches("[data-raw]");
  const emptyLine = node => editable(node) && !node.textContent.trim() && !node.querySelector("img, ul, ol");

  // Move the caret out of a selected table into the line above (-1) or below (1).
  function leave(block, direction) {
    const target = direction < 0 ? block.previousElementSibling : block.nextElementSibling;
    if (editable(target)) return placeCaret(target, direction > 0);
    const paragraph = Object.assign(element("div"), { innerHTML: "<br>" });
    if (direction < 0) block.before(paragraph); else block.after(paragraph);
    placeCaret(paragraph, true);
    changed();
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

  const host = { changed, removeBlock, leave };

  // The top-level editor line that holds the caret (or null).
  function caretTop() {
    const anchor = getSelection()?.anchorNode;
    let top = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    while (top && top !== editor && top.parentElement !== editor) top = top.parentElement;
    return top && top !== editor && editor.contains(top) ? top : null;
  }

  function place(block, replace) {
    const top = caretTop();
    if (top && replace && emptyLine(top)) top.replaceWith(block);
    else if (top) top.after(block);
    else editor.append(block);
    if (block === editor.lastElementChild) {
      const paragraph = element("div");
      paragraph.append(document.createElement("br"));
      block.after(paragraph);
    }
  }

  function insert() {
    const block = makeBlock(["| 열 1 | 열 2 |", "| --- | --- |", "|  |  |"].join(editor.dataset.eol || "\n"));
    place(block, false);
    refresh();
    block.querySelector("textarea")?.focus();
    changed();
  }

  // Paste a converted clipboard table (V-001). Returns after showing the paste options bar.
  function pasteBlock(tableBlock, via) {
    const eol = editor.dataset.eol || "\n";
    const top = caretTop();
    const replaced = top && emptyLine(top) ? top : null;
    let format = true;
    let current = makeBlock(tableBlockToSource(tableBlock, { format, eol }));
    place(current, true);
    refresh();
    changed();
    current.querySelector("textarea")?.focus();
    const entry = remember(() => {
      if (!editor.isConnected || !current.isConnected) return false;
      if (replaced) current.replaceWith(replaced); else current.remove();
      changed();
      return true;
    });
    const restyle = value => {
      format = value;
      const next = makeBlock(tableBlockToSource(tableBlock, { format, eol }));
      current.replaceWith(next);
      current = next;
      refresh();
      changed();
      current.querySelector("textarea")?.focus();
    };
    const size = tableBlock.rows.length + "행 × " + tableBlock.cols + "열";
    showPasteChip({
      message: (via === "html" ? "표로 붙여넣었어요 · " : "탭 구분 텍스트를 표로 붙여넣었어요 · ") + size,
      notes: pasteNotes(tableBlock),
      canFormat: tableBlock.hasFormat,
      format,
      onFormat: restyle,
      onUndo: () => {
        if (current.isConnected) { undoStack.splice(undoStack.indexOf(entry), 1); entry.run(); }
        else toast("이미 표가 바뀌어서 되돌릴 수 없어요.", { error: true });
      },
    });
  }

  editor.addEventListener("focusin", event => {
    if (!event.target.closest?.("[data-k='table']")) hidePasteChip();
  });

  // for other paste handlers (V-007 documents) that put blocks into the editor and want the same undo behaviour
  function forget(entry) {
    const index = undoStack.indexOf(entry);
    if (index >= 0) undoStack.splice(index, 1);
  }

  return { refresh, insert, pasteBlock, remember, forget };
}
