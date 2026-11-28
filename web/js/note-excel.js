import {
  clearExcelRange, copyExcelRange, editExcelCell, EXCEL_RANGE_TYPE, fillExcelRange,
  pasteCopiedExcelRange, pasteExcelRange, pasteExcelTextRange, readExcelTable, replaceExcelTable,
} from "./excel-table-block.js";
import { registerContext } from "./contextmenu.js";
import { mdToHtml } from "./mdconv.js";
import { normalizeRange } from "./note-table-range.js";
import { hidePasteChip, showPasteChip } from "./paste-chip.js";
import { planPaste } from "./paste-doc.js";
import { toast } from "./toast.js";

const directions = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
};

function cellBounds(cell) {
  const r0 = cell.parentElement.rowIndex;
  const c0 = Number(cell.dataset.excelX);
  return { r0, c0, r1: r0 + cell.rowSpan - 1, c1: c0 + cell.colSpan - 1 };
}

const intersects = (a, b) => a.r0 <= b.r1 && a.r1 >= b.r0 && a.c0 <= b.c1 && a.c1 >= b.c0;

function expandAcrossMerges(range, cells) {
  const merges = cells.filter(({ cell }) => cell.rowSpan > 1 || cell.colSpan > 1);
  let expanded;
  do {
    expanded = false;
    for (const { bounds } of merges) {
      if (!intersects(range, bounds)) continue;
      if (bounds.r0 >= range.r0 && bounds.r1 <= range.r1 && bounds.c0 >= range.c0 && bounds.c1 <= range.c1) continue;
      range.r0 = Math.min(range.r0, bounds.r0);
      range.r1 = Math.max(range.r1, bounds.r1);
      range.c0 = Math.min(range.c0, bounds.c0);
      range.c1 = Math.max(range.c1, bounds.c1);
      expanded = true;
    }
  } while (expanded);
}

export function fitExcelText(root) {
  const fits = [...root.querySelectorAll(".note-excel-fit")];
  for (const fit of fits) fit.firstElementChild.style.zoom = "";
  // Measure the full line after clearing previous zoom, then write all scales together.
  const scales = fits.map(fit => {
    const available = fit.getBoundingClientRect().width;
    const indent = getComputedStyle(fit).textIndent;
    const inset = Math.max(0, Number.parseFloat(indent) || 0) * (indent.endsWith("%") ? available / 100 : 1);
    const width = fit.firstElementChild.getBoundingClientRect().width;
    const usable = available - inset;
    return usable > 0.5 && width > usable ? (usable - 0.5) / width : 1;
  });
  fits.forEach((fit, index) => {
    if (scales[index] < 1) fit.firstElementChild.style.zoom = scales[index];
  });
}

function measureColumnWidths(grid, { c0, c1 }) {
  const samples = [];
  for (const cell of grid.querySelectorAll("td")) {
    const column = Number(cell.dataset.excelX);
    if (column < c0 || column > c1 || cell.colSpan > 1 || !cell.textContent.trim()) continue;
    const wrapper = cell.firstElementChild;
    const content = wrapper?.matches(".note-excel-fit, .note-excel-overflow[data-align]")
      ? wrapper.firstElementChild : wrapper?.matches(".note-excel-overflow") ? wrapper : cell;
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.className = "note-excel-width-probe";
    if (content === cell) probe.style.whiteSpace = cell.style.whiteSpace;
    probe.append(...Array.from(content.childNodes, node => node.cloneNode(true)));
    cell.append(probe);
    const box = probe.firstElementChild?.matches(".note-excel-oriented") ? probe.firstElementChild : probe;
    samples.push({ cell, column, probe, box });
  }

  // Batch DOM writes and reads. Measure the unscaled runs and explicit line breaks.
  const widths = new Map();
  for (const { cell, column, box } of samples) {
    const style = getComputedStyle(cell);
    const indent = Math.max(0, Number.parseFloat(style.textIndent) || 0);
    const fraction = style.textIndent.endsWith("%") ? indent / 100 : 0;
    if (fraction >= 1) continue;
    const textWidth = box.getBoundingClientRect().width + (fraction ? 0 : indent);
    const insets = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      + parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    let width = Math.ceil(textWidth / (1 - fraction) + insets);
    if (/^(?:normal|pre-wrap|pre-line)$/i.test(cell.style.whiteSpace)) {
      // A wrapped cell can shrink to fit, but does not make its column wider by itself.
      width = Math.min(width, Math.ceil(cell.getBoundingClientRect().width));
    }
    widths.set(column, Math.max(1, width, widths.get(column) ?? 0));
  }
  for (const { probe } of samples) probe.remove();
  return widths;
}

export function mountNoteExcel(block, { documentMarkdown, changed }) {
  const id = block.dataset.excelId;
  const undo = [];
  const redo = [];
  let active;
  let anchor;
  let field;
  let dragging = false;
  let selection;
  let painted = new Set();

  const grid = () => block.querySelector(":scope > .note-excel-grid");
  const location = cell => [cell.dataset.excelRow, cell.dataset.excelColumn];
  const selectorFor = ([row, column]) => `[data-excel-row="${row}"][data-excel-column="${column}"]`;
  const cellAt = (table, [row, column]) => table.rows.find(item => item.id === row).cells[table.columns.indexOf(column)];
  function select(cell, focus = true, start = cell) {
    if (active && active !== cell) active.tabIndex = -1;
    active = cell;
    anchor = start;
    active.tabIndex = 0;
    paintSelection();
    if (focus) active.focus();
  }

  function paintSelection() {
    const first = cellBounds(anchor);
    const last = cellBounds(active);
    selection = normalizeRange([first.r0, first.c0], [last.r0, last.c0]);
    const selected = new Set();
    if (anchor !== active) {
      const cells = [...grid().querySelectorAll("td")].map(cell => ({ cell, bounds: cellBounds(cell) }));
      expandAcrossMerges(selection, cells);
      for (const { cell, bounds } of cells) {
        if (!intersects(selection, bounds)) continue;
        const edge = (bounds.r0 === selection.r0 ? "t" : "") + (bounds.r1 === selection.r1 ? "b" : "")
          + (bounds.c0 === selection.c0 ? "l" : "") + (bounds.c1 === selection.c1 ? "r" : "");
        if (cell.dataset.edge !== edge) cell.dataset.edge = edge;
        if (!painted.has(cell)) cell.setAttribute("aria-selected", "true");
        selected.add(cell);
      }
    } else {
      selection = last;
    }
    for (const cell of painted) {
      if (selected.has(cell)) continue;
      delete cell.dataset.edge;
      cell.removeAttribute("aria-selected");
    }
    painted = selected;
  }

  function show(source, { position, range = false, start = position, layout = false }, focus = true) {
    const template = document.createElement("template");
    template.innerHTML = mdToHtml(source);
    const selector = selectorFor(position);
    const table = grid();
    const replacementGrid = template.content.querySelector(".note-excel-grid");
    if (layout) {
      table.style.cssText = replacementGrid.style.cssText;
      table.toggleAttribute("data-excel-fixed", replacementGrid.hasAttribute("data-excel-fixed"));
      table.querySelector("colgroup").replaceWith(replacementGrid.querySelector("colgroup"));
    }
    if (range || layout) {
      // A range can change which coordinates have a visible cell.
      table.tBodies[0].replaceWith(replacementGrid.tBodies[0]);
    } else {
      // Keep the cells mounted. A blur may be moving focus to the next cell.
      const replacement = template.content.querySelector(selector);
      const cell = table.querySelector(selector);
      cell.style.cssText = replacement.style.cssText;
      cell.replaceChildren(...replacement.childNodes);
      // A value entered into an empty cell can clip text from either side.
      for (const sibling of cell.parentElement.cells) {
        if (sibling === cell) continue;
        const next = replacement.parentElement.cells[sibling.cellIndex];
        if (sibling.firstElementChild?.classList.contains("note-excel-overflow")
          || next.firstElementChild?.classList.contains("note-excel-overflow")) {
          sibling.replaceChildren(...next.childNodes);
        }
      }
    }
    fitExcelText(range || layout ? table : table.querySelector(selector));
    block.querySelector(":scope > pre > code").textContent = template.content.querySelector("pre > code").textContent;
    block.dataset.src = source;
    if (range || layout || focus) select(table.querySelector(selector), focus, table.querySelector(selectorFor(start)));
    changed();
  }

  function remember(entry, focus = true) {
    undo.push(entry);
    if (undo.length > 20) undo.shift();
    redo.length = 0;
    show(entry.after, entry, focus);
  }

  function restore(from, to, reverse) {
    const entry = from.at(-1);
    const expected = reverse ? entry?.after : entry?.before;
    if (!entry || block.dataset.src !== expected || !readExcelTable(documentMarkdown(), id)) return;
    from.pop();
    to.push(entry);
    show(reverse ? entry.before : entry.after, entry);
  }

  function autoFitColumns() {
    const table = readExcelTable(documentMarkdown(), id);
    if (!table || field || !block.hasAttribute("data-excel-visible")) return;
    const element = grid();
    const measured = measureColumnWidths(element, selection);
    if (!measured.size) {
      toast("선택한 열에 너비를 맞출 셀 값이 없어요.");
      return;
    }
    saveColumnWidths(table, measured);
  }

  function saveColumnWidths(table, measured) {
    const element = grid();
    const columnWidths = { ...table.columnWidths };
    if (!element.hasAttribute("data-excel-fixed")) {
      // Establish a fixed layout while keeping other columns at their displayed widths.
      element.querySelectorAll("col").forEach((col, index) => {
        columnWidths[table.columns[index]] = `${Math.max(1, col.getBoundingClientRect().width)}px`;
      });
    }
    for (const [index, width] of measured) columnWidths[table.columns[index]] = `${width}px`;
    const before = block.dataset.src;
    const after = replaceExcelTable(before, id, { ...table, columnWidths });
    if (!after) {
      toast("열 너비를 저장할 수 없어요. 표의 크기 한도를 확인해 주세요.", { error: true });
      return;
    }
    if (before !== after) remember({ before, after, position: location(active), start: location(anchor), layout: true });
  }

  function resizeColumn(event) {
    const handle = event.target.closest(".note-excel-resize");
    if (!handle || !event.isPrimary || event.button !== 0 || field
      || !block.hasAttribute("data-excel-visible")) return;
    const table = readExcelTable(documentMarkdown(), id);
    if (!table) return;
    event.preventDefault();

    const element = grid();
    const columns = element.querySelectorAll("col");
    const cell = handle.parentElement;
    const column = cellBounds(cell).c1;
    const before = block.dataset.src;
    const startWidth = columns[column].getBoundingClientRect().width;
    const minWidth = Math.min(16, Math.round(startWidth) || 1);
    const blockRect = block.getBoundingClientRect();
    const startScroll = block.scrollLeft;
    const edge = cell.getBoundingClientRect().right - blockRect.left - block.clientLeft + startScroll;
    const guide = document.createElement("span");
    guide.className = "note-excel-resize-guide";
    guide.setAttribute("aria-hidden", "true");
    guide.hidden = true;
    block.append(guide);
    element.setPointerCapture(event.pointerId);
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let moved = false;

    const delta = e => e.clientX - event.clientX + block.scrollLeft - startScroll;
    const width = e => Math.max(minWidth, Math.round(startWidth + delta(e)));
    const finish = () => {
      listeners.abort();
      guide.remove();
    };
    element.addEventListener("pointermove", e => {
      if (e.pointerId !== event.pointerId) return;
      moved ||= Math.abs(delta(e)) >= 3;
      if (!moved) return;
      guide.hidden = false;
      guide.style.left = `${edge + width(e) - startWidth - 1}px`;
    }, options);
    element.addEventListener("pointerup", e => {
      if (e.pointerId !== event.pointerId) return;
      const next = width(e);
      finish();
      if (!moved || next === Math.round(startWidth) || field || before !== block.dataset.src
        || !readExcelTable(documentMarkdown(), id)) return;
      saveColumnWidths(table, [[column, next]]);
    }, options);
    for (const type of ["pointercancel", "lostpointercapture"]) {
      element.addEventListener(type, e => {
        if (e.pointerId === event.pointerId) finish();
      }, options);
    }
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
    select(cell);
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

  grid().setAttribute("role", "grid");
  grid().setAttribute("aria-multiselectable", "true");
  select(grid().querySelector("td"), false);
  block._tableHistory = {
    editing: () => !!field,
    canUndo: () => undo.length > 0,
    canRedo: () => redo.length > 0,
    undo: () => restore(undo, redo, true),
    redo: () => restore(redo, undo, false),
  };
  registerContext(block, ({ target }) => {
    const cell = target.closest("td[data-excel-row]");
    if (!cell || field || !block.hasAttribute("data-excel-visible")) return null;
    if (!intersects(selection, cellBounds(cell))) select(cell);
    return [[{ label: "열 너비 자동 맞춤", run: autoFitColumns }]];
  });
  block.addEventListener("focusin", event => {
    if (event.target !== active && event.target.matches("td[data-excel-row]")) select(event.target, false);
  });
  block.addEventListener("pointerdown", resizeColumn);
  block.addEventListener("mousedown", event => {
    dragging = false;
    const cell = event.target.closest("td[data-excel-row]");
    if (event.button === 2 && !event.ctrlKey && cell && !field && intersects(selection, cellBounds(cell))) {
      event.preventDefault(); // Keep the selected columns when opening their context menu.
      return;
    }
    if (event.button !== 0 || !cell || field?.parentElement === cell || event.target.closest(".note-excel-resize")) return;
    event.preventDefault();
    select(cell, true, event.shiftKey ? anchor : cell);
    dragging = true;
  });
  block.addEventListener("mousemove", event => {
    if (!(event.buttons & 1)) dragging = false;
    if (!dragging) return;
    const cell = event.target.closest("td[data-excel-row]");
    if (cell && cell !== active) select(cell, true, anchor);
  });
  block.addEventListener("mouseup", () => { dragging = false; });
  block.addEventListener("focusout", event => {
    if (!block.contains(event.relatedTarget)) dragging = false;
  });
  block.addEventListener("dblclick", event => {
    const cell = event.target.closest("td[data-excel-row]");
    if (!cell || event.target.closest(".note-excel-resize")) return;
    event.stopPropagation();
    edit(cell);
  });
  function transferRange(event) {
    if (field || !block.hasAttribute("data-excel-visible") || !event.target.closest("td[data-excel-row]")) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.clipboardData) return;
    const cut = event.type === "cut";
    const table = readExcelTable(documentMarkdown(), id);
    const contents = table && copyExcelRange(table, selection);
    if (!contents) {
      toast(cut ? "선택한 범위를 잘라낼 수 없어요. 표 상태와 크기를 확인해 주세요."
        : "선택한 범위를 복사할 수 없어요. 표 상태와 크기를 확인해 주세요.", { error: true });
      return;
    }
    const before = block.dataset.src;
    const cleared = cut ? clearExcelRange(table, selection) : table;
    const after = cleared === table ? before : cleared && replaceExcelTable(before, id, cleared);
    if (!after) {
      toast("선택한 범위를 잘라낼 수 없어요. 표 상태와 크기를 확인해 주세요.", { error: true });
      return;
    }
    try {
      event.clipboardData.setData("text/plain", contents.text);
      event.clipboardData.setData(EXCEL_RANGE_TYPE, contents.data);
    } catch {
      toast("클립보드에 쓸 수 없어요.", { error: true });
      return;
    }
    if (before !== after) {
      remember({ before, after, position: location(active), range: anchor !== active, start: location(anchor) });
    }
  }
  block.addEventListener("copy", transferRange);
  block.addEventListener("cut", transferRange);
  block.addEventListener("paste", event => {
    const cell = event.target.closest("td[data-excel-row]");
    if (!cell) return;
    event.stopPropagation();
    event.preventDefault();
    if (field || !block.hasAttribute("data-excel-visible")) return;
    const payload = event.clipboardData?.getData(EXCEL_RANGE_TYPE);
    const html = !payload && event.clipboardData?.getData("text/html");
    const plan = html && planPaste({ html, keepSingleExcelCell: true });
    const excel = plan?.kind === "table" && plan.block.excel;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const table = readExcelTable(documentMarkdown(), id);
    if (!table) {
      toast("표가 바뀌었거나 같은 ID의 표가 있어 붙여넣지 못했어요.", { error: true });
      return;
    }
    const position = location(cell);
    const paste = payload
      ? options => pasteCopiedExcelRange(table, ...position, payload, options)
      : excel && (options => pasteExcelRange(table, ...position, plan.block, options));
    const result = paste ? paste() : pasteExcelTextRange(table, ...position, text);
    const before = block.dataset.src;
    const after = result.table && replaceExcelTable(before, id, result.table);
    if (!after) {
      const message = {
        bounds: "붙여넣을 범위가 표를 벗어나요.",
        merge: paste ? "붙여넣을 범위가 기존 병합 셀의 일부만 덮어요."
          : "붙여넣을 텍스트 범위가 기존 병합 셀과 겹쳐요.",
        source: "붙여넣을 범위의 크기와 각 행의 열 수를 확인해 주세요.",
        "single-cell": "일반 텍스트를 붙여넣으려면 F2로 셀을 여세요.",
      }[result.error] ?? "범위 전체를 붙여넣을 수 없어요. 복사한 범위와 표 크기를 확인해 주세요.";
      toast(message, { error: result.error !== "single-cell" });
      return;
    }
    if (before === after) return;
    const values = paste ? paste({ valuesOnly: true }) : null;
    const valuesSource = values?.table && replaceExcelTable(before, id, values.table);
    const notes = [];
    if (values?.error === "merge") notes.push("기존 병합에 값이 겹쳐 이 범위는 값만 붙일 수 없어요.");
    else if (paste && !valuesSource) notes.push("표 크기 한도로 이 범위는 값만 붙일 수 없어요.");
    const entry = { before, after, position, range: true };
    remember(entry);
    function isCurrent() {
      return block.isConnected && !field && undo.at(-1) === entry && block.dataset.src === entry.after
        && readExcelTable(documentMarkdown(), id);
    }
    showPasteChip({
      message: excel ? `Excel ${plan.block.rows.length}행 × ${plan.block.cols}열 붙여넣기`
        : payload ? "복사한 Excel 범위를 붙여넣었어요." : "텍스트 범위를 표에 붙여넣었어요.",
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
        show(entry.after, entry, false);
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
    if (event.isComposing || event.keyCode === 229 || event.altKey) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const fill = mod && !event.shiftKey && (key === "d" || key === "r");
    if (mod && !fill) return;
    if (event.key === "F2" || event.key === "Enter") {
      event.preventDefault();
      edit(cell);
    } else if (fill || (event.key === "Delete" && !event.shiftKey)) {
      event.preventDefault();
      const table = readExcelTable(documentMarkdown(), id);
      const result = table && (fill ? fillExcelRange(table, selection, key === "d" ? "down" : "right")
        : { table: clearExcelRange(table, selection) });
      if (!result?.table) {
        const message = result?.error === "merge" ? "병합 모양이 같은 행이나 열에만 채울 수 있어요."
          : "표가 바뀌었거나 같은 ID의 표가 있어 선택 범위를 수정하지 못했어요.";
        toast(message, { error: true });
        return;
      }
      if (result.table === table) return;
      const before = block.dataset.src;
      const after = replaceExcelTable(before, id, result.table);
      if (!after) {
        toast("범위 변경을 저장할 수 없어요. 표의 크기 한도를 확인해 주세요.", { error: true });
        return;
      }
      if (before === after) return;
      remember({ before, after, position: location(cell), range: anchor !== cell, start: location(anchor) });
    } else if (event.key === "Escape" && anchor !== cell) {
      event.preventDefault();
      select(cell);
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
        if (target) { select(target, true, event.shiftKey ? anchor : target); break; }
      }
    }
  });
}
