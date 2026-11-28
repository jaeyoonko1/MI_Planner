// Note layout (P3-03, V-008): rows of columns that share one markdown file and one save queue.
// Structure changes (insert / delete a column, add a row) keep every other editor alive, are undoable for the
// whole session (toast button + Ctrl+Z) and never write anything but the page's own file and `note_layout`.
import {
  MAX_COLUMNS, MAX_ROWS, addRowBelow, deleteColumn, insertColumn, joinColumns, layoutFor, layoutMeta, mergeTarget,
  resizePair, rowIndexOf, rowsOf, splitColumns, widthsAfterDelete, widthsAfterInsert,
} from "./note-column-layout.js";
import { TABLE_KEY_HELP } from "./note-table.js";
import { refreshExcelTableViews } from "./mdconv.js";
import { toast } from "./toast.js";
import { registerContext } from "./contextmenu.js";

const conflictedDrafts = new Map();
window.addEventListener("beforeunload", (event) => {
  if (!conflictedDrafts.size) return;
  event.preventDefault();
  event.returnValue = "";
});

const SVG_NS = "http://www.w3.org/2000/svg";
const ICONS = {
  left: "M7.5 3h6v10h-6z M3.5 6v4 M1.5 8h4",
  right: "M2.5 3h6v10h-6z M12.5 6v4 M10.5 8h4",
  row: "M2.5 2.5h11v6h-11z M8 10.5v4 M6 12.5h4",
  remove: "M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.6 8.5h5.8l.6-8.5 M7 7v4 M9 7v4",
};
const KEY_HELP = [
  ["Alt+Shift+←", "현재 단의 왼쪽에 단 추가"],
  ["Alt+Shift+→", "현재 단의 오른쪽에 단 추가"],
  ["Alt+Shift+↓", "현재 행 아래에 새 행 추가"],
  ["Alt+Shift+Delete", "현재 단 삭제"],
  ["Ctrl+Z", "방금 한 단·행 변경 되돌리기 (그 뒤에 입력하면 일반 실행 취소)"],
];

function element(tag, cls, text = "") {
  const node = document.createElement(tag);
  node.className = cls;
  if (text) node.textContent = text;
  return node;
}

function chip(text, action) {
  const button = element("button", "chip", text);
  button.type = "button";
  button.addEventListener("click", action);
  return button;
}

function iconButton(id, label, action) {
  const button = element("button", "note-col-btn");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICONS[id]);
  svg.append(path);
  button.append(svg);
  button.addEventListener("mousedown", (event) => event.preventDefault()); // keep the caret in the column
  button.addEventListener("click", action);
  return button;
}

const cloneLayout = (layout) => ({ mode: layout.mode, rows: layout.rows.map((row) => [...row]) });

// The surfaces share a single save queue, so typing in different columns always saves the complete note.
export function mountNoteColumns(mountEditor, cfg) {
  const { compact, content = "", draftKey, save, saveLayout } = cfg;
  const recoveredDraft = conflictedDrafts.get(draftKey);
  const root = element("div", compact ? "rich compact note-layout" : "note-layout");
  const tools = element("div", "note-layout-tools");
  const format = element("div", "note-format-host");
  const viewport = element("div", "note-column-viewport");
  const stack = element("div", "note-column-stack");
  const status = element("span", "jstatus note-layout-status");
  status.setAttribute("role", "status");
  const retry = chip("다시 저장", async () => {
    if (conflict) {
      try {
        const draft = getMd();
        await navigator.clipboard.writeText(draft);
        const latest = await cfg.loadLatest();
        if (disposed || !conflict || draft !== getMd()) return;
        conflictedDrafts.delete(draftKey);
        setMd(latest.content, latest.revision, latest.layout);
        updateStatus("초안을 복사하고 최신 본문을 불러왔어요");
      } catch (error) {
        toast(`초안을 복사하거나 본문을 불러오지 못했어요 · ${error.message}`, { error: true });
      }
      return;
    }
    if (documentError) saveDocument().catch(() => {});
    if (layoutError) persistLayout();
  });
  retry.hidden = true;
  viewport.append(stack);
  root.append(tools, format, viewport);
  let source = splitColumns(recoveredDraft ?? content);
  let layout = layoutFor(cfg.layout, rowsOf(source.separators).map((row) => row.length));
  let currentColumn = 0;
  let last = content;
  let revision = cfg.revision;
  let documentChain = Promise.resolve();
  let layoutChain = Promise.resolve();
  let pending = 0;
  let lastLayout = null;
  let conflict = recoveredDraft !== undefined;
  let documentError = conflict;
  let layoutError = false;
  let columns = []; // [{editor, initial, cell, tools, scope}] in file order, aligned with source.parts
  let scopeCount = 0; // fold scopes: the first columns keep their old per-position scopes, new ones get new numbers
  let disposed = false;
  const undoStack = [];

  function updateStatus(message, bad = false) {
    status.textContent = conflict ? "다른 곳에서 본문이 변경됐어요 · 초안은 아직 저장되지 않았어요"
      : documentError ? "본문 저장 실패" : layoutError ? "배치 저장 실패" : message;
    status.classList.toggle("error", documentError || layoutError || bad);
    retry.hidden = !(documentError || layoutError);
    retry.textContent = conflict ? "초안 복사 후 최신 본문 열기" : "다시 저장";
  }

  function presentSource() {
    return {
      ...source,
      parts: columns.map(({ editor, initial }, index) => {
        const value = editor.getMd();
        return value === initial ? source.parts[index] : value;
      }),
    };
  }

  function getMd() {
    return joinColumns(presentSource());
  }

  function saveDocument() {
    const md = getMd();
    refreshExcelTableViews(stack);
    if (conflict) {
      conflictedDrafts.set(draftKey, md);
      return documentChain;
    }
    if (!pending && md === last) return documentChain;
    pending++;
    updateStatus("저장 중…");
    const result = documentChain.then(async () => {
      if (conflict) return;
      if (md !== last) revision = await save(md, revision);
      last = md;
      documentError = false;
      updateStatus(md === getMd() ? "저장됨" : "편집 중…");
    }).catch(error => {
      documentError = true;
      if (error.status === 409 && draftKey && cfg.loadLatest) {
        conflict = true;
        conflictedDrafts.set(draftKey, getMd());
      }
      updateStatus("");
      throw error;
    }).finally(() => { pending--; });
    documentChain = result.catch(() => {});
    return result;
  }

  function persistLayout() {
    if (!saveLayout) return;
    const next = layoutMeta(layout);
    const key = JSON.stringify(next);
    layoutChain = layoutChain.then(async () => {
      if (lastLayout !== key) await saveLayout(next);
      lastLayout = key;
      layoutError = false;
      updateStatus("배치 저장됨");
    }).catch(() => {
      layoutError = true;
      updateStatus("");
    });
  }

  // ---- structure changes -------------------------------------------------------------------------
  const where = (index = currentColumn) => {
    const rows = rowsOf(source.separators);
    const row = rowIndexOf(rows, index);
    return { rows, row, pos: rows[row].indexOf(index) };
  };
  const hasContent = (col) => col.editor.getMd().trim() !== "";
  const snapshot = () => ({ md: getMd(), layout: cloneLayout(layout), focus: currentColumn });

  function remember(snap) {
    undoStack.push({ snap, stale: false });
    if (undoStack.length > 20) undoStack.shift();
  }

  function finishStructure(focusIndex) {
    arrange();
    activate(Math.max(0, Math.min(focusIndex, columns.length - 1)));
    columns[currentColumn].editor.focus();
    saveDocument().catch(() => {});
    persistLayout();
  }

  function restore(snap) {
    rebuild(snap.md, snap.layout);
    currentColumn = Math.min(snap.focus, columns.length - 1);
    finishStructure(currentColumn);
  }

  function undo() {
    const entry = undoStack.at(-1);
    if (!entry) return false;
    if (entry.stale) {
      undoStack.length = 0;
      updateStatus("그 뒤에 편집해서 단·행 변경은 되돌릴 수 없어요.", true);
      return false;
    }
    undoStack.pop();
    restore(entry.snap);
    updateStatus("단·행 변경을 되돌렸어요");
    return true;
  }
  // Any typing after a structure change turns the editors' own undo history back on.
  root.addEventListener("input", () => undoStack.forEach((entry) => { entry.stale = true; }), true);

  function addColumn(col, side) {
    closePanel();
    const index = columns.indexOf(col);
    const next = insertColumn(presentSource(), index, side);
    if (!next) {
      const { rows, row } = where(index);
      updateStatus(rows[row].length >= MAX_COLUMNS ? `한 행에는 단을 ${MAX_COLUMNS}개까지 둘 수 있어요.` : "열린 코드 블록이나 주석을 먼저 닫아 주세요.", true);
      return;
    }
    remember(snapshot());
    const { row, pos } = where(index);
    const at = side === "left" ? index : index + 1;
    source.separators = next.separators;
    source.parts.splice(at, 0, "");
    columns.splice(at, 0, makeColumn(""));
    layout.rows[row] = widthsAfterInsert(layout.rows[row], pos, side);
    finishStructure(at);
    updateStatus("단을 추가했어요 · Ctrl+Z로 되돌리기");
  }

  function addRow(col) {
    closePanel();
    const index = columns.indexOf(col);
    const { rows, row } = where(index);
    const next = addRowBelow(presentSource(), row);
    if (!next) {
      updateStatus(rows.length >= MAX_ROWS ? `행은 ${MAX_ROWS}개까지 둘 수 있어요.` : "열린 코드 블록이나 주석을 먼저 닫아 주세요.", true);
      return;
    }
    remember(snapshot());
    const at = rows[row].at(-1) + 1;
    source.separators = next.separators;
    source.parts.splice(at, 0, "");
    columns.splice(at, 0, makeColumn(""));
    layout.rows.splice(row + 1, 0, [100]);
    finishStructure(at);
    updateStatus("아래에 새 행을 추가했어요 · Ctrl+Z로 되돌리기");
  }

  function removeColumn(col, mode) {
    closePanel();
    const index = columns.indexOf(col);
    const { rows, row, pos } = where(index);
    const next = deleteColumn(presentSource(), index, mode);
    if (!next) {
      updateStatus(columns.length < 2 ? "마지막 단은 삭제할 수 없어요." : "열린 코드 블록이나 주석을 먼저 닫아 주세요.", true);
      return;
    }
    const wholeRow = rows[row].length === 1;
    const snap = snapshot();
    remember(snap);
    col.editor.destroy();
    col.cell.remove();
    columns.splice(index, 1);
    source.parts.splice(index, 1);
    source.separators = next.separators;
    let focusIndex = Math.min(index, columns.length - 1);
    if (next.merged !== null) {
      focusIndex = next.target > index ? next.target - 1 : next.target;
      const heir = columns[focusIndex];
      heir.editor.setMd(next.merged);
      heir.initial = heir.editor.getMd();
      source.parts[focusIndex] = next.merged;
    }
    if (wholeRow) layout.rows.splice(row, 1);
    else layout.rows[row] = widthsAfterDelete(layout.rows[row], pos);
    finishStructure(focusIndex);
    const noun = wholeRow ? "행" : `${index + 1}단`;
    toast(`${noun}을 삭제했어요${next.merged !== null ? " · 내용은 옆 단에 합쳤어요" : ""}`, {
      action: { label: "되돌리기", run: () => { if (!undo()) throw new Error("그 뒤에 편집해서 되돌릴 수 없어요."); } },
    });
  }

  // ---- delete confirmation: how to treat the content (toggle chips, no dropdown) ------------------
  let panel = null;
  function closePanel(refocus = false) {
    if (!panel) return;
    const owner = panel.owner;
    panel.node.remove();
    owner.cell.removeAttribute("data-open");
    panel = null;
    if (refocus) owner.editor.focus();
  }

  function askDelete(col) {
    closePanel();
    if (columns.length < 2) {
      updateStatus("마지막 단은 삭제할 수 없어요.", true);
      return;
    }
    if (!hasContent(col)) {
      removeColumn(col, "drop");
      return;
    }
    const index = columns.indexOf(col);
    const alone = where(index).rows[where(index).row].length === 1;
    const mergeLabel = `${mergeTarget(source.separators, index) < index ? "앞" : "뒤"} ${alone ? "행" : "단"}에 합치기`;
    let mode = "merge";
    const node = element("div", "note-col-confirm");
    node.setAttribute("role", "alertdialog");
    node.setAttribute("aria-label", alone ? "행 삭제 확인" : "단 삭제 확인");
    node.append(element("p", "note-col-confirm-t", `${alone ? "이 행" : "이 단"}에 내용이 있어요. 어떻게 할까요?`));
    const choices = element("div", "note-col-choices");
    choices.setAttribute("role", "group");
    const buttons = [["merge", mergeLabel], ["drop", "내용까지 삭제"]].map(([value, text]) => {
      const button = chip(text, () => { mode = value; paintChoices(); });
      button.dataset.mode = value;
      return button;
    });
    const paintChoices = () => buttons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    paintChoices();
    choices.append(...buttons);
    const actions = element("div", "note-col-confirm-a");
    const confirm = chip("삭제", () => removeColumn(col, mode));
    confirm.classList.add("danger");
    const cancel = chip("취소", () => closePanel(true));
    actions.append(confirm, cancel);
    node.append(choices, actions);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closePanel(true); }
    });
    col.cell.append(node);
    col.cell.dataset.open = "1";
    panel = { node, owner: col };
    buttons[0].focus();
  }

  // ---- toolbar, shortcuts ---------------------------------------------------------------------------
  function activate(index) {
    currentColumn = index;
    columns.forEach(({ editor }, i) => { editor.toolbar.hidden = i !== currentColumn; });
    paintTools();
  }

  const add = chip("단 추가", () => addColumn(columns[currentColumn], "right"));
  const addBelow = chip("행 추가", () => addRow(columns[currentColumn]));
  const helpButton = chip("단·표 단축키", () => {
    const open = help.hidden;
    help.hidden = !open;
    helpButton.setAttribute("aria-expanded", String(open));
  });
  helpButton.setAttribute("aria-expanded", "false");
  helpButton.setAttribute("aria-controls", "note-layout-help");
  const help = element("dl", "note-layout-help");
  help.id = "note-layout-help";
  help.hidden = true;
  const helpRows = [...KEY_HELP, ["표", "표 안의 칸에서는 아래 키가 표를 편집해요 (단·행 키보다 우선)"], ...TABLE_KEY_HELP];
  for (const [keys, text] of helpRows) {
    const dt = element("dt", "");
    const kbd = element("kbd", "", keys);
    dt.append(kbd);
    help.append(dt, element("dd", "", text));
  }
  const modeButtons = new Map([
    ["fit", chip("맞춤", () => setMode("fit"))],
    ["scroll", chip("스크롤", () => setMode("scroll"))],
  ]);
  function setMode(mode) {
    if (layout.mode === mode) return;
    layout = { ...layout, mode };
    paint();
    persistLayout();
  }

  if (saveLayout) {
    tools.append(add, addBelow, ...modeButtons.values(), helpButton);
  }
  tools.append(status, retry);
  if (saveLayout) root.insertBefore(help, format);

  root.addEventListener("keydown", (event) => {
    if (event.isComposing || event.keyCode === 229) return;
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "z") {
      const entry = undoStack.at(-1);
      if (entry && !entry.stale) { event.preventDefault(); undo(); }
      return;
    }
    if (!saveLayout || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
    const owner = columns.find((col) => col.cell.contains(event.target)) || columns[currentColumn];
    if (!owner) return;
    const handlers = {
      ArrowLeft: () => addColumn(owner, "left"),
      ArrowRight: () => addColumn(owner, "right"),
      ArrowDown: () => addRow(owner),
      Delete: () => askDelete(owner),
    };
    const run = handlers[event.key];
    if (!run) return;
    event.preventDefault();
    run();
  });

  // ---- context menu (V-010): the same functions as the column tool buttons; disabled states come from those buttons ----
  if (saveLayout) {
    registerContext(root, (ctx) => {
      const col = columns.find((c) => c.cell.contains(ctx.target));
      if (!col) return null;
      const off = (button, why) => button.disabled && why;
      const undoable = undoStack.at(-1);
      return [
        [
          { label: "왼쪽에 단 추가", icon: "col-left", keys: "Alt+Shift+←", disabled: off(col.buttons.left, `한 행에 단은 ${MAX_COLUMNS}개까지`), run: () => addColumn(col, "left") },
          { label: "오른쪽에 단 추가", icon: "col-right", keys: "Alt+Shift+→", disabled: off(col.buttons.right, `한 행에 단은 ${MAX_COLUMNS}개까지`), run: () => addColumn(col, "right") },
          { label: "아래에 행 추가", icon: "row-below", keys: "Alt+Shift+↓", disabled: off(col.buttons.row, `행은 ${MAX_ROWS}개까지`), run: () => addRow(col) },
        ],
        [
          { label: "단·행 변경 되돌리기", icon: "undo", keys: "Ctrl+Z", disabled: !(undoable && !undoable.stale) && "되돌릴 변경이 없어요", run: () => { if (!undo()) updateStatus("되돌릴 수 없어요.", true); } },
          { label: "이 단 삭제", icon: "trash", danger: true, keys: "Alt+Shift+Delete", disabled: off(col.buttons.remove, "마지막 단은 삭제할 수 없어요"), run: () => askDelete(col) },
        ],
      ];
    });
  }

  function paintTools() {
    if (!columns.length) return;
    const { rows, row } = where(Math.min(currentColumn, columns.length - 1));
    if (!saveLayout) return;
    add.disabled = rows[row].length >= MAX_COLUMNS;
    addBelow.disabled = rows.length >= MAX_ROWS;
    rowsOf(source.separators).forEach((indexes, r, all) => indexes.forEach((i, pos) => {
      const col = columns[i];
      const label = indexes.length > 1 ? `${pos + 1}단` : all.length > 1 ? `${r + 1}행` : "본문";
      col.tools.setAttribute("aria-label", `${label} 도구`);
      col.buttons.left.disabled = indexes.length >= MAX_COLUMNS;
      col.buttons.right.disabled = indexes.length >= MAX_COLUMNS;
      col.buttons.row.disabled = all.length >= MAX_ROWS;
      const only = columns.length < 2;
      const text = only ? "마지막 단은 삭제할 수 없어요" : indexes.length > 1 ? "이 단 삭제 · Alt+Shift+Delete" : "이 행 삭제 · Alt+Shift+Delete";
      col.buttons.remove.disabled = only;
      col.buttons.remove.title = text;
      col.buttons.remove.setAttribute("aria-label", text.split(" · ")[0]);
      col.editor.el.querySelector(".note-editor")?.setAttribute("aria-label", i ? `본문 ${label}` : cfg.label || "본문");
    }));
  }

  // ---- grid ---------------------------------------------------------------------------------------------
  let grids = []; // [{el, indexes}]

  function paint() {
    const span = Math.max(...layout.rows.map((row) => row.length));
    root.dataset.columns = String(columns.length);
    root.dataset.span = String(span);
    root.dataset.rows = String(layout.rows.length);
    root.dataset.mode = compact ? "stack" : layout.mode;
    stack.style.setProperty("--note-columns", String(span));
    grids.forEach(({ el, indexes }, r) => {
      const widths = layout.rows[r] || [];
      const tracks = widths.flatMap((width, index) => [
        ...(index && !compact ? ["12px"] : []), `minmax(0, ${width}fr)`,
      ]);
      el.style.gridTemplateColumns = compact ? "minmax(0, 1fr)" : tracks.join(" ");
      for (const handle of el.querySelectorAll("[data-boundary]")) {
        const index = Number(handle.dataset.boundary);
        const left = widths[index];
        const total = left + widths[index + 1];
        const min = Math.min(10, Math.floor(total / 2));
        handle.setAttribute("aria-valuenow", String(left));
        handle.setAttribute("aria-valuemin", String(min));
        handle.setAttribute("aria-valuemax", String(total - min));
        handle.setAttribute("aria-valuetext", `${left}% · ${total - left}%`);
      }
    });
    const many = span > 1;
    for (const [mode, button] of modeButtons) {
      button.hidden = !many;
      button.setAttribute("aria-pressed", String(layout.mode === mode));
    }
    paintTools();
  }

  function makeHandle(row, index) {
    const divider = element("div", "note-column-divider");
    divider.tabIndex = 0;
    divider.dataset.boundary = String(index);
    divider.setAttribute("role", "separator");
    divider.setAttribute("aria-orientation", "vertical");
    const prefix = layout.rows.length > 1 ? `${row + 1}행 ` : "";
    divider.setAttribute("aria-label", `${prefix}${index + 1}단과 ${index + 2}단 너비 조절`);
    divider.title = "드래그 또는 좌우 방향키로 너비 조절";
    divider.addEventListener("keydown", event => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (event.altKey) return;
      event.preventDefault();
      const delta = (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 5 : 1);
      layout.rows[row] = resizePair(layout.rows[row], index, layout.rows[row][index] + delta);
      paint();
      persistLayout();
    });
    divider.addEventListener("pointerdown", event => {
      if (event.button !== 0) return;
      event.preventDefault();
      divider.focus();
      divider.setPointerCapture(event.pointerId);
      const original = layout.rows[row];
      const start = event.clientX;
      const measure = grids[row].indexes.reduce((total, i) => total + columns[i].editor.el.getBoundingClientRect().width, 0);
      if (!measure) return;
      const move = pointer => {
        layout.rows[row] = resizePair(original, index, original[index] + (pointer.clientX - start) * 100 / measure);
        paint();
      };
      const finish = pointer => {
        divider.removeEventListener("pointermove", move);
        divider.removeEventListener("pointerup", finish);
        divider.removeEventListener("pointercancel", finish);
        divider.removeEventListener("lostpointercapture", finish);
        if (pointer.type !== "pointerup") {
          layout.rows[row] = original;
          paint();
        } else if (layout.rows[row][index] !== original[index]) persistLayout();
      };
      divider.addEventListener("pointermove", move);
      divider.addEventListener("pointerup", finish);
      divider.addEventListener("pointercancel", finish);
      divider.addEventListener("lostpointercapture", finish);
    });
    return divider;
  }

  function makeColumn(markdown) {
    const scope = scopeCount++;
    const editor = mountEditor({
      ...cfg,
      shared: true,
      report: updateStatus,
      content: markdown,
      documentMarkdown: getMd,
      label: scope ? `본문 ${scope + 1}단` : cfg.label || "본문",
      foldScope: scope && cfg.foldScope ? `${cfg.foldScope}:column:${scope + 1}` : cfg.foldScope,
      save: saveDocument,
    });
    const cell = element("div", "note-column");
    const colTools = element("div", "note-col-tools");
    colTools.setAttribute("role", "toolbar");
    const col = { editor, initial: editor.getMd(), cell, tools: colTools, buttons: {} };
    if (saveLayout) {
      col.buttons = {
        left: iconButton("left", "왼쪽에 단 추가 · Alt+Shift+←", () => addColumn(col, "left")),
        right: iconButton("right", "오른쪽에 단 추가 · Alt+Shift+→", () => addColumn(col, "right")),
        row: iconButton("row", "아래에 행 추가 · Alt+Shift+↓", () => addRow(col)),
        remove: iconButton("remove", "이 단 삭제 · Alt+Shift+Delete", () => askDelete(col)),
      };
      col.buttons.remove.classList.add("danger");
      colTools.append(...Object.values(col.buttons));
      cell.append(editor.el, colTools);
    } else {
      cell.append(editor.el);
    }
    editor.el.addEventListener("focusin", () => activate(columns.indexOf(col)));
    editor.toolbar.hidden = true;
    format.append(editor.toolbar);
    return col;
  }

  function arrange() {
    const shape = rowsOf(source.separators);
    grids = compact ? [{ el: element("div", "note-column-grid"), indexes: shape.flat() }]
      : shape.map((indexes) => ({ el: element("div", "note-column-grid"), indexes }));
    grids.forEach(({ el, indexes }, r) => {
      const children = [];
      indexes.forEach((i, pos) => {
        if (pos && !compact) children.push(makeHandle(r, pos - 1));
        children.push(columns[i].cell);
      });
      el.replaceChildren(...children);
    });
    stack.replaceChildren(...grids.map(({ el }) => el));
    refreshExcelTableViews(stack);
    paint();
  }

  function rebuild(md, meta) {
    closePanel();
    columns.forEach(({ editor }) => editor.destroy());
    columns = [];
    format.replaceChildren();
    source = splitColumns(md);
    layout = layoutFor(meta ?? layout, rowsOf(source.separators).map((row) => row.length));
    scopeCount = 0;
    currentColumn = 0;
    columns = source.parts.map((part) => makeColumn(part));
    arrange();
    activate(0);
  }

  function setMd(md, nextRevision, meta) {
    rebuild(md, meta);
    last = md;
    revision = nextRevision;
    conflict = false;
    documentError = false;
    undoStack.length = 0;
  }

  columns = source.parts.map((part) => makeColumn(part));
  arrange();
  activate(0);
  updateStatus("");

  const isBusy = () => pending > 0 || columns.some(({ editor }) => editor.isBusy());
  return {
    el: root,
    getMd,
    syncFrom(md, nextRevision, meta) {
      // Focus alone is not "busy": only a save in flight or unsaved text (getMd() !== last) blocks a sync,
      // so a focused but untouched cell still gets the newest revision and never fails with a false 409.
      if (pending > 0 || conflict || getMd() !== last || !nextRevision) return;
      if (md !== last) setMd(md, nextRevision, meta);
      else revision = nextRevision;
    },
    isBusy,
    contains: node => root.contains(node),
    focus: () => columns[currentColumn].editor.focus(),
    async flush() {
      await Promise.all(columns.map(({ editor }) => editor.flush()));
      if (!disposed && last !== getMd()) await saveDocument().catch(() => {});
      await layoutChain;
    },
    destroy() {
      disposed = true;
      columns.forEach(({ editor }) => editor.destroy());
    },
  };
}
