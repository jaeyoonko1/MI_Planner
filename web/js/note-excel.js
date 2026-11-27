import { editExcelCell, pasteExcelRange, pasteExcelTextRange, readExcelTable, replaceExcelTable } from "./excel-table-block.js";
import { mdToHtml } from "./mdconv.js";
import { hidePasteChip, showPasteChip } from "./paste-chip.js";
import { planPaste } from "./paste-doc.js";
import { toast } from "./toast.js";

const directions = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

export function mountNoteExcel(block, { documentMarkdown, changed }) {
  const id = block.dataset.excelId;
  const undo = [];
  const redo = [];
  let active;
  let field;

  const grid = () => block.querySelector(":scope > .note-excel-grid");
  const location = cell => [cell.dataset.excelRow, cell.dataset.excelColumn];
  const selectorFor = ([row, column]) => `[data-excel-row="${row}"][data-excel-column="${column}"]`;
  const cellAt = (table, [row, column]) => table.rows.find(item => item.id === row).cells[table.columns.indexOf(column)];
  function select(cell, focus = true) {
    if (active && active !== cell) active.tabIndex = -1;
    active = cell;
    active.tabIndex = 0;
    if (focus) active.focus();
  }

  function show(source, position, focus = true, range = false) {
    const template = document.createElement("template");
    template.innerHTML = mdToHtml(source);
    const selector = selectorFor(position);
    const table = grid();
    if (range) {
      // A range can change which coordinates have a visible cell.
      table.tBodies[0].replaceWith(template.content.querySelector(".note-excel-grid > tbody"));
    } else {
      // Keep the cells mounted. A blur may be moving focus to the next cell.
      const replacement = template.content.querySelector(selector);
      const cell = table.querySelector(selector);
      cell.style.cssText = replacement.style.cssText;
      cell.replaceChildren(...replacement.childNodes);
    }
    block.querySelector(":scope > pre > code").textContent = template.content.querySelector("pre > code").textContent;
    block.dataset.src = source;
    if (range || focus) select(table.querySelector(selector), focus);
    changed();
  }

  function remember(entry, focus = true) {
    undo.push(entry);
    if (undo.length > 20) undo.shift();
    redo.length = 0;
    show(entry.after, entry.position, focus, entry.range);
  }

  function restore(from, to, reverse) {
    const entry = from.at(-1);
    const expected = reverse ? entry?.after : entry?.before;
    if (!entry || block.dataset.src !== expected || !readExcelTable(documentMarkdown(), id)) return;
    from.pop();
    to.push(entry);
    show(reverse ? entry.before : entry.after, entry.position, true, entry.range);
  }

  function saveCell(table, position, displayText, focus = true) {
    const before = block.dataset.src;
    const updated = editExcelCell(table, ...position, { displayText, value: null });
    const after = updated && replaceExcelTable(before, id, updated);
    if (!after) {
      toast("셀 값을 저장할 수 없어요. 표의 크기 한도를 확인해 주세요.", { error: true });
      return;
    }
    if (before !== after) remember({ before, after, position }, focus);
  }

  function edit(cell) {
    if (field || !block.hasAttribute("data-excel-visible")) return;
    const table = readExcelTable(documentMarkdown(), id);
    if (!table) return;
    const position = location(cell);
    const sourceCell = cellAt(table, position);
    const previous = block.dataset.src;
    const contents = [...cell.childNodes];
    const input = document.createElement("textarea");
    input.className = "note-table-cell note-excel-field";
    input.rows = 1;
    input.spellcheck = false;
    input.setAttribute("aria-label", `Excel ${cell.parentElement.rowIndex + 1}행 ${Number(cell.dataset.excelX) + 1}열 표시 값`);
    input.title = "Enter 확정 · Esc 취소 · Alt+Enter 줄바꿈";
    input.value = sourceCell?.displayText ?? "";
    const initial = input.value;

    function finish(commit, focus) {
      if (field !== input) return;
      field = null;
      cell.replaceChildren(...contents);
      if (focus) select(cell);
      if (!commit || initial === input.value) return;
      const current = readExcelTable(documentMarkdown(), id);
      if (block.dataset.src !== previous || !current) {
        toast("표가 바뀌었거나 같은 ID의 표가 있어 셀을 저장하지 못했어요.", { error: true });
        return;
      }
      // The input edits the display string. A replacement has no confirmed Excel raw value.
      saveCell(current, position, input.value, focus);
    }

    input.addEventListener("input", event => event.stopPropagation());
    input.addEventListener("paste", event => event.stopPropagation());
    input.addEventListener("blur", () => finish(true, false));
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false, true);
      } else if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (event.altKey) input.setRangeText("\n", input.selectionStart, input.selectionEnd, "end");
        else finish(true, true);
      }
    });
    field = input;
    cell.replaceChildren(input);
    input.focus();
    input.select();
  }

  select(grid().querySelector("td"), false);
  block._tableHistory = {
    editing: () => !!field,
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    undo: () => restore(undo, redo, true),
    redo: () => restore(redo, undo, false),
  };
  block.addEventListener("focusin", event => {
    if (event.target.matches("td[data-excel-row]")) select(event.target, false);
  });
  block.addEventListener("dblclick", event => {
    const cell = event.target.closest("td[data-excel-row]");
    if (!cell) return;
    event.stopPropagation();
    edit(cell);
  });
  block.addEventListener("paste", event => {
    const cell = event.target.closest("td[data-excel-row]");
    if (!cell) return;
    event.stopPropagation();
    event.preventDefault();
    if (field || !block.hasAttribute("data-excel-visible")) return;
    const html = event.clipboardData?.getData("text/html");
    const plan = html && planPaste({ html, keepSingleExcelCell: true });
    const excel = plan?.kind === "table" && plan.block.excel;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!excel && !text.includes("\t")) {
      toast("일반 텍스트를 붙여넣으려면 F2로 셀을 여세요.");
      return;
    }
    const table = readExcelTable(documentMarkdown(), id);
    if (!table) {
      toast("표가 바뀌었거나 같은 ID의 표가 있어 붙여넣지 못했어요.", { error: true });
      return;
    }
    const position = location(cell);
    const result = excel
      ? pasteExcelRange(table, ...position, plan.block)
      : pasteExcelTextRange(table, ...position, text);
    const before = block.dataset.src;
    const after = result.table && replaceExcelTable(before, id, result.table);
    if (!after) {
      const message = {
        bounds: "붙여넣을 범위가 표를 벗어나요.",
        merge: excel ? "붙여넣을 범위가 기존 병합 셀의 일부만 덮어요."
          : "붙여넣을 텍스트 범위가 기존 병합 셀과 겹쳐요.",
        source: "붙여넣을 범위의 크기와 각 행의 열 수를 확인해 주세요.",
      }[result.error] ?? "범위 전체를 붙여넣을 수 없어요. 복사한 범위와 표 크기를 확인해 주세요.";
      toast(message, { error: true });
      return;
    }
    if (before === after) return;
    const values = excel ? pasteExcelRange(table, ...position, plan.block, { valuesOnly: true }) : null;
    const valuesSource = values?.table && replaceExcelTable(before, id, values.table);
    const notes = [];
    if (values?.error === "merge") notes.push("기존 병합에 값이 겹쳐 이 범위는 값만 붙일 수 없어요.");
    else if (excel && !valuesSource) notes.push("표 크기 한도로 이 범위는 값만 붙일 수 없어요.");
    const entry = { before, after, position, range: true };
    remember(entry);
    function isCurrent() {
      return block.isConnected && !field && undo.at(-1) === entry && block.dataset.src === entry.after
        && readExcelTable(documentMarkdown(), id);
    }
    showPasteChip({
      message: excel ? `Excel ${plan.block.rows.length}행 × ${plan.block.cols}열 붙여넣기`
        : "탭 구분 텍스트를 표에 붙여넣었어요.",
      notes,
      canFormat: Boolean(valuesSource && valuesSource !== after) || undefined,
      plainLabel: "값만",
      format: true,
      onFormat: (format) => {
        if (!isCurrent()) {
          hidePasteChip();
          return false;
        }
        entry.after = format ? after : valuesSource;
        show(entry.after, position, false, true);
      },
      onUndo: () => {
        if (isCurrent()) restore(undo, redo, true);
      },
    });
  });
  block.addEventListener("keydown", event => {
    const cell = event.target.closest("td[data-excel-row]");
    if (!cell || !block.hasAttribute("data-excel-visible")) return;
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "F2" || event.key === "Enter") {
      event.preventDefault();
      edit(cell);
    } else if (event.key === "Delete" && !event.shiftKey) {
      event.preventDefault();
      const table = readExcelTable(documentMarkdown(), id);
      if (!table) {
        toast("표가 바뀌었거나 같은 ID의 표가 있어 셀 내용을 지우지 못했어요.", { error: true });
        return;
      }
      const position = location(cell);
      const data = cellAt(table, position);
      if (data && (data.displayText || data.value || data.richText)) saveCell(table, position, "");
    } else if (Object.hasOwn(directions, event.key)) {
      event.preventDefault();
      const [dx, dy] = directions[event.key];
      const x = Number(cell.dataset.excelX) + dx * (dx > 0 ? cell.colSpan : 1);
      const y = cell.parentElement.rowIndex + dy * (dy > 0 ? cell.rowSpan : 1);
      const rows = grid().rows;
      if (x < 0 || y < 0 || y >= rows.length) return;
      for (let r = y; r >= 0; r--) {
        const target = [...rows[r].cells].find(candidate => {
          const left = Number(candidate.dataset.excelX);
          return left <= x && x < left + candidate.colSpan && y < r + candidate.rowSpan;
        });
        if (target) { select(target); break; }
      }
    }
  });
}
