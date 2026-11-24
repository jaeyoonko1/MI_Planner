// Evaluation board screen (P4-04): fixed-width native table, delegated events (D-30), toggle chips (D-12).
import { api } from "./api.js";
import {
  UNASSIGNED, buildBoard, cellAt, cellsByStage, equipmentProgress, formatValue, lotProgress,
  stageCounts, visibleRows,
} from "./eval-board-model.js";
import { createPanel } from "./eval-panel.js";
import {
  allIds, applyChanged, columnIds, locate, lotIds, mergeSelection, pruneSelection, rectIds, rowIds,
} from "./eval-select-model.js";
import { toast } from "./toast.js";
import { chipRow, el, emptyState, errorState, skeleton, store, svg } from "./ui.js";

const STATE = { active: "진행 중", done: "완료", hold: "보류" };
const VIEWS = [["equipment", "설비별"], ["lot", "Lot별"], ["stage", "단계별"]];
const VIEW_UNIT = { equipment: "행", lot: "개 Lot", stage: "개 단계" };
const STAGE_CAP = 120;
const PREFS_KEY = "mi.board.prefs";

const esc = (text) => String(text).replace(/[&<>"']/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
const num = (n) => n.toLocaleString("ko-KR");

// Stage colors come from the template; they paint bars and tints only. Text always names the stage.
const HEX = /^#[0-9a-fA-F]{6}$/;
function stageStyle(board) {
  const style = el("style");
  style.textContent = board.stages.map((stage, i) => `.eb .st-${i}{--stage:${HEX.test(stage.color) ? stage.color : "#8f9bb5"}}`).join(" ");
  return style;
}

function segments(board, counts) {
  const parts = board.stages.map((stage, i) => ({ cls: "st-" + i, label: stage.label, n: counts.get(stage.key) }));
  parts.push({ cls: "st-n", label: "미배정", n: counts.get(UNASSIGNED) });
  return parts.filter((part) => part.n > 0).map((part) =>
    `<i class="${part.cls}" style="flex-grow:${part.n}" title="${esc(part.label)} ${num(part.n)}칸"></i>`).join("");
}

function summary(board, onRefresh) {
  const { evaluation } = board;
  const total = stageCounts(board);
  const box = el("section", "eb-summary");
  box.setAttribute("aria-label", "평가 진행 요약");
  const head = el("div", "eb-sum-head");
  const big = el("div", "eb-big");
  big.setAttribute("aria-label", `진행률 ${total.percent}퍼센트`);
  big.innerHTML = `<b>${total.percent}</b><span>%</span>`;
  const text = el("div", "eb-sum-text");
  const last = board.stages[board.stages.length - 1].label;
  text.append(
    el("span", "eb-state " + evaluation.status, STATE[evaluation.status] || evaluation.status),
    el("p", "eb-line", `${num(total.done)} / ${num(total.active)}칸 ${last}`),
    el("p", "eb-sub", `설비 ${evaluation.equipment_count} · Lot ${evaluation.lot_count} · 웨이퍼 ${evaluation.wafer_count} · 제외 ${num(evaluation.excluded_count)}칸`),
  );
  const refresh = el("button", "btn sm quiet eb-refresh", "새로고침");
  refresh.type = "button";
  refresh.prepend(svg("refresh"));
  refresh.addEventListener("click", onRefresh);
  head.append(big, text, refresh);
  const bar = el("div", "eb-bar");
  bar.setAttribute("role", "img");
  bar.setAttribute("aria-label", "단계별 분포: " + [...board.stages, { key: UNASSIGNED, label: "미배정" }]
    .map((stage) => `${stage.label} ${total.counts.get(stage.key)}칸`).join(", "));
  bar.innerHTML = segments(board, total.counts);
  const legend = el("ul", "eb-legend");
  legend.innerHTML = board.stages.map((stage, i) =>
    `<li class="st-${i}"><i></i>${esc(stage.label)}<b>${num(total.counts.get(stage.key))}</b></li>`).join("") +
    `<li class="st-n"><i></i>미배정<b>${num(total.counts.get(UNASSIGNED))}</b></li>`;
  box.append(head, bar, legend);
  return box;
}

function toolbar(board, prefs, onChange) {
  const bar = el("div", "eb-tools");
  const group = (label, node) => {
    const wrap = el("div", "fgroup");
    wrap.append(el("span", "k", label), node);
    return wrap;
  };
  const views = chipRow(VIEWS, prefs.view, (value) => onChange({ view: value }));
  views.setAttribute("aria-label", "보기 방식");
  bar.append(group("보기", views));
  if (prefs.view === "equipment") {
    const shows = chipRow([["stage", "단계"], ...board.fields.map((f) => [f.key, f.label])],
      prefs.show, (value) => onChange({ show: value }));
    shows.setAttribute("aria-label", "칸에 표시할 내용");
    bar.append(group("칸 표시", shows));
  }
  const remain = el("button", "chip", "남은 것만");
  remain.type = "button";
  remain.setAttribute("aria-pressed", String(prefs.remaining));
  remain.title = "마지막 단계에 도달한 칸과 제외한 칸을 숨겨요";
  remain.addEventListener("click", () => onChange({ remaining: !prefs.remaining }));
  const wrap = el("div", "fgroup");
  wrap.append(remain);
  bar.append(wrap);
  return bar;
}

function cellLabel(board, row, column, cell, field, value) {
  const head = `${row.lot.lot_no} 웨이퍼 ${row.wafer.wafer_no} · ${board.equipment[column].name}`;
  if (cell.excluded) return head + " · 제외";
  const stage = board.stageIndex.has(cell.stage_key) ? board.stages[board.stageIndex.get(cell.stage_key)].label : "미배정";
  return head + " · " + stage + (field ? ` · ${field.label} ${value || "없음"}` : "");
}

function matrixView(board, prefs) {
  const rows = visibleRows(board, prefs.remaining);
  const field = prefs.show === "stage" ? null : board.fields.find((f) => f.key === prefs.show) || null;
  const progress = equipmentProgress(board);
  const head = board.equipment.map((item, c) => {
    const p = progress[c];
    return `<th scope="col" class="eb-col"><button type="button" class="eb-hbtn" tabindex="-1" data-sel="col" data-c="${c}"` +
      ` title="${esc(item.name)}의 모든 칸 선택 (Ctrl·Shift: 추가)" aria-label="${esc(item.name)} 열 전체 선택"><span class="eb-eq">${esc(item.name)}</span></button>` +
      (item.vendor ? `<small>${esc(item.vendor)}</small>` : "") +
      `<span class="eb-mini" aria-hidden="true"><i style="width:${p.percent}%"></i></span>` +
      `<small class="eb-pct">${num(p.done)}/${num(p.active)} · ${p.percent}%</small></th>`;
  }).join("");
  let html = `<table class="eb-table" role="grid" aria-multiselectable="true" aria-label="평가 현황판 (설비별)"` +
    ` aria-rowcount="${rows.length + 1}" aria-colcount="${board.columns + 1}">` +
    `<thead><tr><th scope="col" class="eb-corner"><button type="button" class="eb-hbtn" tabindex="-1" data-sel="all"` +
    ` title="표시 중인 모든 칸 선택 (Ctrl+A)" aria-label="모든 칸 선택">Lot · 웨이퍼</button></th>${head}</tr></thead>`;
  let lastLot = null;
  rows.forEach((row, r) => {
    if (row.lot !== lastLot) {
      if (lastLot) html += "</tbody>";
      const p = lotProgress(board, row.lot);
      html += `<tbody data-lot="${row.lot.id}"><tr class="eb-band"><th scope="rowgroup" colspan="${board.columns + 1}">` +
        `<span><button type="button" class="eb-hbtn" tabindex="-1" data-sel="lot" data-lot="${row.lot.id}"` +
        ` title="${esc(row.lot.lot_no)}의 모든 칸 선택" aria-label="${esc(row.lot.lot_no)} 전체 선택"><b>${esc(row.lot.lot_no)}</b></button>` +
        `<small>${num(p.done)}/${num(p.active)} 완료</small></span></th></tr>`;
      lastLot = row.lot;
    }
    html += `<tr><th scope="row" class="eb-row"><button type="button" class="eb-hbtn" tabindex="-1" data-sel="row" data-r="${r}"` +
      ` title="이 웨이퍼의 모든 설비 칸 선택" aria-label="웨이퍼 ${esc(row.wafer.wafer_no)} 행 전체 선택">${esc(row.wafer.wafer_no)}</button></th>`;
    for (let c = 0; c < board.columns; c++) {
      const cell = cellAt(board, row.index, c);
      if (!cell) { html += `<td class="eb-cell ex" aria-hidden="true"></td>`; continue; }
      const stageI = board.stageIndex.get(cell.stage_key);
      const cls = cell.excluded ? "ex" : stageI === undefined ? "st-n" : "st-" + stageI;
      const stageLabel = stageI === undefined ? "미배정" : board.stages[stageI].label;
      const value = field && !cell.excluded ? formatValue(field, cell.values[field.key]) : "";
      const text = cell.excluded ? "제외" : field ? value || "—" : stageLabel;
      const label = cellLabel(board, row, c, cell, field && !cell.excluded ? field : null, value);
      html += `<td role="gridcell" tabindex="-1" aria-selected="false" class="eb-cell ${cls}${field && !value && !cell.excluded ? " blank" : ""}"` +
        ` data-r="${r}" data-c="${c}" data-id="${cell.id}" aria-label="${esc(label)}" title="${esc(label)}">` +
        `<span class="eb-t">${esc(text)}</span></td>`;
    }
    html += "</tr>";
  });
  html += lastLot ? "</tbody></table>" : "</table>";
  return { html, rows };
}

function lotView(board, prefs) {
  const head = board.equipment.map((item) => `<th scope="col" class="eb-col"><span class="eb-eq">${esc(item.name)}</span>` +
    (item.vendor ? `<small>${esc(item.vendor)}</small>` : "") + "</th>").join("");
  let html = `<table class="eb-table eb-lots" aria-label="평가 현황판 (Lot별)"><thead><tr>` +
    `<th scope="col" class="eb-corner">Lot</th>${head}</tr></thead><tbody>`;
  let shown = 0;
  for (const lot of board.lots) {
    const total = lotProgress(board, lot);
    if (!total.active || (prefs.remaining && total.done === total.active)) continue;
    shown++;
    html += `<tr><th scope="row" class="eb-row lot"><button type="button" class="eb-lotbtn" data-lot="${lot.id}"` +
      ` title="${esc(lot.lot_no)}의 웨이퍼별 상태 보기"><b>${esc(lot.lot_no)}</b>` +
      `<small>${num(total.done)}/${num(total.active)} · ${total.percent}%</small></button></th>`;
    for (const item of board.equipment) {
      const p = lotProgress(board, lot, item.id);
      if (!p.active) { html += `<td class="eb-cell ex"><span class="eb-t">제외</span></td>`; continue; }
      const label = `${lot.lot_no} · ${item.name}: ${p.done}/${p.active}칸 완료`;
      html += `<td class="eb-cell lotcell" title="${esc(label)}">` +
        `<span class="eb-seg" aria-hidden="true">${segments(board, p.counts)}</span>` +
        `<span class="eb-t"><span class="sr-only">${esc(label)}</span><span aria-hidden="true">${num(p.done)}/${num(p.active)}</span></span></td>`;
    }
    html += "</tr>";
  }
  return { html: html + "</tbody></table>", shown };
}

function stageView(board, prefs, state) {
  const groups = cellsByStage(board, prefs.remaining);
  const keys = [...board.stages.map((s, i) => [s.key, s.label, "st-" + i]), [UNASSIGNED, "미배정", "st-n"]]
    .filter(([key]) => key !== UNASSIGNED || groups.get(key).length);
  const host = el("div", "eb-stages");
  for (const [key, label, cls] of keys) {
    const items = groups.get(key);
    const shown = state.open.has(key) ? items : items.slice(0, STAGE_CAP);
    const column = el("section", "eb-stage " + cls);
    column.setAttribute("aria-label", `${label} ${items.length}칸`);
    const list = shown.map(({ cell, row, column: c }, i) =>
      `<li role="option" aria-selected="false" tabindex="${i ? -1 : 0}" data-id="${cell.id}"><b>${esc(board.equipment[c].name)}</b><span>${esc(row.lot.lot_no)} · ${esc(row.wafer.wafer_no)}</span></li>`).join("");
    column.innerHTML = `<header><i></i><h3>${esc(label)}</h3><b>${num(items.length)}</b></header>` +
      `<ul role="listbox" aria-multiselectable="true" aria-label="${esc(label)} 칸 목록">${list || '<li class="none" role="presentation">해당하는 칸이 없어요</li>'}</ul>`;
    if (items.length > shown.length) {
      const more = el("button", "btn sm quiet", `${num(items.length - shown.length)}개 더 보기`);
      more.type = "button";
      more.addEventListener("click", () => { state.open.add(key); state.repaint(); });
      column.append(more);
    }
    host.append(column);
  }
  return { host, empty: keys.every(([key]) => !groups.get(key).length) };
}

const activate = (node, mode, panel = false) => node.dispatchEvent(new CustomEvent("board-cell", {
  bubbles: true,
  detail: { id: Number(node.dataset.id), r: node.dataset.r === undefined ? undefined : Number(node.dataset.r),
    c: node.dataset.c === undefined ? undefined : Number(node.dataset.c), mode, panel },
}));
const additive = (event) => event.ctrlKey || event.metaKey || event.shiftKey;

// Roving tabindex grid; one set of delegated listeners for the whole table (D-30).
// Selection rules: click = this cell, Ctrl/Cmd+click = toggle, Shift+click/arrows = rectangle from the anchor,
// drag = rectangle, Space = toggle, Enter = select + open panel, Ctrl+A = all, Esc = clear, headers = lines.
// `h` is the board's selection controller (see renderBoard).
function bindGrid(scroll, rows, h) {
  const cells = new Map();
  let rowCount = 0, columns = 0;
  for (const td of scroll.querySelectorAll("td[data-r]")) {
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    cells.set(r + ":" + c, td);
    rowCount = Math.max(rowCount, r + 1);
    columns = Math.max(columns, c + 1);
  }
  const pos = (td) => ({ r: Number(td.dataset.r), c: Number(td.dataset.c) });
  let current = (h.focusId() && scroll.querySelector(`td[data-id="${h.focusId()}"]`)) || cells.get("0:0") || null;
  if (current) current.tabIndex = 0;
  const select = (td) => {
    if (current && current !== td) current.tabIndex = -1;
    td.tabIndex = 0;
    current = td;
    h.setFocusId(Number(td.dataset.id));
  };
  const focus = (td) => { if (td) { select(td); td.focus(); td.scrollIntoView({ block: "nearest", inline: "nearest" }); } };
  scroll.addEventListener("focusin", (event) => {
    const td = event.target.closest?.("td[data-r]");
    if (td) select(td);
  });

  scroll.addEventListener("keydown", (event) => {
    const td = event.target.closest?.("td[data-r]");
    if (!td || event.altKey || event.isComposing || event.keyCode === 229) return;
    const { r, c } = pos(td);
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && event.key.toLowerCase() === "a") { event.preventDefault(); h.line("all", 0, "replace"); return; }
    if (event.key === "Escape") { if (h.hasSelection()) { event.preventDefault(); h.clear(); } return; }
    if (event.key === "Enter") { event.preventDefault(); activate(td, "replace", true); return; }
    if (event.key === " ") { event.preventDefault(); activate(td, "toggle"); return; }
    let move;
    if (mod && event.shiftKey && event.key.startsWith("Arrow")) {
      move = { ArrowLeft: [r, 0], ArrowRight: [r, columns - 1], ArrowUp: [0, c], ArrowDown: [rowCount - 1, c] }[event.key];
    } else {
      move = {
        ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], ArrowUp: [r - 1, c], ArrowDown: [r + 1, c],
        PageUp: [Math.max(0, r - 10), c], PageDown: [Math.min(rowCount - 1, r + 10), c],
        Home: mod ? [0, 0] : [r, 0], End: mod ? [rowCount - 1, columns - 1] : [r, columns - 1],
      }[event.key];
    }
    if (!move) return;
    event.preventDefault();
    const target = cells.get(move[0] + ":" + move[1]);
    if (!target) return;
    focus(target);
    if (event.shiftKey) h.rect(h.anchor() || { r, c }, pos(target), { anchorAt: { r, c } });
    else if (!mod && h.isOpen()) activate(target, "replace");
  });

  // Mouse: drag a rectangle (preview while moving, commit on release), then swallow the click it ends with.
  let drag = null;
  let swallow = false;
  scroll.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0 || additive(event)) return;
    const td = event.target.closest?.("td[data-id]");
    if (!td || td.dataset.r === undefined) return;
    drag = { start: pos(td), last: pos(td), moved: false };
    window.addEventListener("pointerup", () => {
      if (drag?.moved) {
        swallow = true;
        setTimeout(() => { swallow = false; }, 0);
        h.rect(drag.start, drag.last, { anchorAt: drag.start, drag: true });
      }
      drag = null;
    }, { once: true });
  });
  scroll.addEventListener("pointerover", (event) => {
    if (!drag) return;
    const td = event.target.closest?.("td[data-r]");
    if (!td) return;
    const p = pos(td);
    if (!drag.moved && p.r === drag.start.r && p.c === drag.start.c) return;
    drag.moved = true;
    drag.last = p;
    h.rect(drag.start, p, { preview: true });
  });

  scroll.addEventListener("click", (event) => {
    const head = event.target.closest?.("[data-sel]");
    if (head) {
      const mode = additive(event) ? "toggle" : "replace";
      const kind = head.dataset.sel;
      h.line(kind, kind === "col" ? Number(head.dataset.c) : kind === "row" ? Number(head.dataset.r) : Number(head.dataset.lot), mode);
      return;
    }
    const td = event.target.closest?.("td[data-id]");
    if (!td || swallow) return;
    select(td);
    if (event.shiftKey && td.dataset.r !== undefined && h.anchor()) h.rect(h.anchor(), pos(td), {});
    else activate(td, event.ctrlKey || event.metaKey || event.shiftKey ? "toggle" : "replace");
  });
}

// Stage view: one roving tab stop per list; same click/Space/Enter/Esc rules as the grid.
function bindList(host, h) {
  host.addEventListener("keydown", (event) => {
    if (event.altKey || event.isComposing || event.keyCode === 229) return;
    const li = event.target.closest?.("li[data-id]");
    if (!li) return;
    if (event.key === "Escape") { if (h.hasSelection()) { event.preventDefault(); h.clear(); } return; }
    const items = [...li.parentElement.querySelectorAll("li[data-id]")];
    const i = items.indexOf(li);
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[event.key];
    if (to !== undefined) {
      event.preventDefault();
      const next = items[Math.max(0, Math.min(items.length - 1, to))];
      items.forEach((node) => { node.tabIndex = -1; });
      next.tabIndex = 0;
      next.focus();
      if (h.isOpen() && !event.ctrlKey) activate(next, "replace");
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      activate(li, event.key === " " ? "toggle" : "replace", event.key === "Enter");
    }
  });
  host.addEventListener("click", (event) => {
    const li = event.target.closest?.("li[data-id]");
    if (li) activate(li, additive(event) ? "toggle" : "replace");
  });
}

function loadPrefs(board) {
  const saved = store.get(PREFS_KEY, {}) || {};
  const view = VIEWS.some(([key]) => key === saved.view) ? saved.view : "equipment";
  const show = saved.show === "stage" || board.fields.some((f) => f.key === saved.show) ? saved.show : "stage";
  return { view, show, remaining: saved.remaining === true };
}

export async function renderBoard(host, page, onError) {
  host.replaceChildren(skeleton(5));
  let board;
  const evaluationId = page.meta.eval_id;
  try {
    board = buildBoard(await api.evaluationBoard(evaluationId));
  } catch (error) {
    host.replaceChildren(errorState(error.message, onError));
    return;
  }
  const prefs = loadPrefs(board);
  const root = el("div", "eb");
  const status = el("p", "sr-only");
  status.setAttribute("role", "status");
  const stageState = { open: new Set(), repaint: () => paint() };
  const sel = { ids: [], anchor: null, lastId: null, focusId: null, token: 0 };
  let busy = false;
  let summaryEl = summary(board, () => reload());
  const body = el("div", "eb-body");
  const rowsNow = () => visibleRows(board, prefs.remaining);
  const announce = (text) => { status.textContent = text; };

  // ---- selection -------------------------------------------------------------------------------

  const panel = createPanel({
    board: () => board,
    moveCells: (moves, opts) => moveCells(moves, opts),
    saveCell: async (id, patch) => {
      const res = await api.patchEvalCell(id, patch);
      const cell = board.byId.get(id);
      if (cell) { cell.values = res.values; cell.note = res.note; }
      if (patch.values && prefs.view === "equipment" && prefs.show in patch.values) repaint();
      return res;
    },
    loadHistory: (id) => api.evalCellHistory(id),
    selectScope: (kind) => selectScope(kind),
    clear: () => clearSelection(true),
    release: () => focusGrid(),
  });

  function syncSelection() {
    const set = new Set(sel.ids);
    for (const node of root.querySelectorAll("[data-id]")) {
      const on = set.has(Number(node.dataset.id));
      if (node.classList.contains("sel") !== on) {
        node.classList.toggle("sel", on);
        node.setAttribute("aria-selected", String(on));
      }
    }
  }

  async function setSelection(ids, opts = {}) {
    const token = ++sel.token;
    await panel.flush(); // finish saving the cell we are leaving
    if (token !== sel.token) return;
    sel.ids = ids;
    if (opts.anchor !== undefined) sel.anchor = opts.anchor;
    if (opts.lastId !== undefined) sel.lastId = opts.lastId;
    syncSelection();
    panel.show(ids, { skipped: opts.skipped || 0 });
    root.classList.toggle("has-panel", ids.length > 0);
    if (!opts.quiet) {
      const only = ids.length === 1 && board.byId.get(ids[0])?.excluded;
      announce(!ids.length ? "선택을 해제했어요." : only ? "제외한 칸이에요." : `${num(ids.length)}칸 선택됨`
        + (opts.skipped ? ` · 제외한 ${num(opts.skipped)}칸은 건너뜀` : ""));
    }
    if (opts.focusPanel) panel.focusStage();
  }

  function focusGrid() {
    const target = root.querySelector(`[data-id="${sel.focusId}"]`) || root.querySelector("td[data-r]");
    target?.focus({ preventScroll: true });
  }

  function clearSelection(focus) {
    sel.anchor = null;
    setSelection([]).then(() => { if (focus) focusGrid(); });
  }

  const activeIds = () => sel.ids.filter((id) => board.byId.get(id) && !board.byId.get(id).excluded);

  function selectLine(kind, arg, mode) {
    const rows = rowsNow();
    const found = kind === "col" ? columnIds(board, rows, arg) : kind === "row" ? rowIds(board, rows[arg])
      : kind === "lot" ? lotIds(board, rows, arg) : allIds(board, rows);
    const ids = [...mergeSelection(new Set(activeIds()), found.ids, mode === "toggle" ? "toggle" : "replace")];
    setSelection(ids, { skipped: found.skipped, lastId: found.ids[0] ?? sel.lastId });
  }

  function selectScope(kind) {
    const at = locate(board, sel.lastId ?? sel.ids[sel.ids.length - 1]);
    if (!at) return;
    if (kind === "all") selectLine("all", 0, "replace");
    else if (kind === "column") selectLine("col", at.column, "replace");
    else if (kind === "lot") selectLine("lot", at.row.lot.id, "replace");
    else {
      const found = rowIds(board, at.row);
      setSelection(found.ids, { skipped: found.skipped, lastId: sel.lastId });
    }
  }

  // Controller handed to the grid and list bindings.
  const handlers = {
    focusId: () => sel.focusId,
    setFocusId: (id) => { sel.focusId = id; },
    hasSelection: () => sel.ids.length > 0,
    isOpen: () => panel.isOpen(),
    anchor: () => sel.anchor,
    clear: () => clearSelection(false),
    line: selectLine,
    rect(a, b, opts = {}) {
      const found = rectIds(board, rowsNow(), a, b);
      if (opts.preview) { sel.ids = found.ids; syncSelection(); return; }
      if (opts.anchorAt && (!sel.anchor || opts.drag)) sel.anchor = opts.anchorAt;
      setSelection(found.ids, { skipped: found.skipped, lastId: found.ids[found.ids.length - 1] ?? sel.lastId });
    },
  };

  root.addEventListener("board-cell", (event) => {
    const { id, r, c, mode, panel: focusPanel } = event.detail;
    const cell = board.byId.get(id);
    if (!cell) return;
    if (cell.excluded) {
      if (mode === "replace") setSelection([id], { anchor: null, lastId: id });
      else announce("제외한 칸은 선택에 넣을 수 없어요.");
      return;
    }
    const ids = [...mergeSelection(new Set(activeIds()), [id], mode === "replace" ? "replace" : "toggle")];
    setSelection(ids, { anchor: r === undefined ? undefined : { r, c }, lastId: id, focusPanel });
  });

  // ---- stage moves + undo --------------------------------------------------------------------------

  async function runMoves(moves) {
    const same = moves.every((move) => move.stage_key === moves[0].stage_key);
    const result = await api.moveEvalCells(evaluationId, same
      ? { cell_ids: moves.map((move) => move.cell_id), stage_key: moves[0].stage_key } : { moves });
    applyChanged(board, result.changed, result.at);
    return result;
  }

  function failure(error) {
    const stale = error.status === 404 || error.status === 409;
    panel.status(error.message, true);
    announce(error.message);
    toast(error.message, { error: true, ...(stale ? { action: { label: "새로고침", run: reload } } : {}) });
  }

  async function moveCells(moves, { label }) {
    if (busy || !moves.length) return;
    busy = true;
    panel.setBusy(true);
    try {
      const result = await runMoves(moves);
      const changed = result.changed.length;
      refreshAfterChange();
      if (!changed) {
        const text = moves.length === 1 ? "이미 이 단계예요." : "모든 칸이 이미 이 단계예요.";
        panel.status(text);
        announce(text);
        toast(text);
        return;
      }
      const skipped = result.unchanged.length ? ` · ${num(result.unchanged.length)}칸은 이미 같은 단계` : "";
      const message = `${num(changed)}칸을 ${label} 단계로 옮겼어요${skipped}`;
      panel.status(message);
      announce(message);
      const back = result.changed.map((item) => ({ cell_id: item.id, stage_key: item.from }));
      toast(message, { ms: 10000, action: { label: "되돌리기", run: () => undo(back, changed) } });
    } catch (error) {
      failure(error);
    } finally {
      busy = false;
      panel.setBusy(false);
      panel.refresh();
    }
  }

  async function undo(moves, count) {
    if (busy) return;
    busy = true;
    panel.setBusy(true);
    try {
      await runMoves(moves);
      refreshAfterChange();
      announce(`${num(count)}칸을 되돌렸어요.`);
      toast(`${num(count)}칸을 되돌렸어요`);
    } catch (error) {
      failure(error);
    } finally {
      busy = false;
      panel.setBusy(false);
      panel.refresh();
    }
  }

  // ---- rendering ---------------------------------------------------------------------------------------

  function replaceSummary() {
    const next = summary(board, () => reload());
    summaryEl.replaceWith(next);
    summaryEl = next;
  }

  // Repaint after a data change without losing scroll position or keyboard focus.
  function repaint() {
    const scroll = root.querySelector(".eb-scroll");
    const at = scroll ? [scroll.scrollLeft, scroll.scrollTop] : null;
    const focused = document.activeElement?.closest?.("[data-id]")?.dataset.id;
    paint();
    const next = root.querySelector(".eb-scroll");
    if (at && next) { next.scrollLeft = at[0]; next.scrollTop = at[1]; }
    if (focused) root.querySelector(`[data-id="${focused}"]`)?.focus({ preventScroll: true });
  }

  function refreshAfterChange() {
    replaceSummary();
    repaint();
  }

  async function reload() {
    try {
      board = buildBoard(await api.evaluationBoard(evaluationId));
      replaceSummary();
      paint();
      const keep = pruneSelection(board, sel.ids);
      await setSelection(keep, { quiet: true });
      announce("현황판을 새로 불러왔어요.");
    } catch (error) {
      announce("");
      root.querySelector(".eb-view")?.replaceChildren(errorState(error.message, reload));
    }
  }

  function doneState() {
    return emptyState({
      title: prefs.remaining ? "남은 평가가 없어요" : "표시할 칸이 없어요",
      desc: prefs.remaining ? "모든 칸이 마지막 단계에 도달했어요." : "이 평가에는 평가할 조합이 없어요.",
      icon: "check",
      action: prefs.remaining ? { label: "전체 보기", run: () => change({ remaining: false }) } : undefined,
    });
  }

  function change(patch) {
    const focusLabel = root.querySelector(".eb-tools")?.contains(document.activeElement) ? document.activeElement.textContent : null;
    Object.assign(prefs, patch);
    store.set(PREFS_KEY, prefs);
    stageState.open.clear();
    sel.anchor = null;
    const count = paint();
    announce(`${VIEWS.find(([key]) => key === prefs.view)[1]} 보기 · ${num(count)}${VIEW_UNIT[prefs.view]}${prefs.remaining ? " · 남은 것만" : ""}`);
    if (focusLabel) {
      [...root.querySelectorAll(".eb-tools button")].find((b) => b.textContent === focusLabel)?.focus({ preventScroll: true });
    }
  }

  function paint() {
    const t0 = performance.now();
    const view = el("div", "eb-view");
    let count = 0;
    if (prefs.view === "equipment") {
      const { html, rows } = matrixView(board, prefs);
      count = rows.length;
      if (!rows.length) view.append(doneState());
      else {
        const scroll = el("div", "eb-scroll");
        scroll.innerHTML = html;
        view.append(scroll);
        bindGrid(scroll, rows, handlers);
      }
    } else if (prefs.view === "lot") {
      const { html, shown } = lotView(board, prefs);
      count = shown;
      if (!shown) view.append(doneState());
      else {
        const scroll = el("div", "eb-scroll");
        scroll.innerHTML = html;
        scroll.addEventListener("click", (event) => {
          const btn = event.target.closest(".eb-lotbtn");
          if (!btn) return;
          change({ view: "equipment" });
          const band = root.querySelector(`tbody[data-lot="${btn.dataset.lot}"]`);
          band?.querySelector("th")?.scrollIntoView({ block: "start" });
          band?.querySelector("td[data-r]")?.focus();
        });
        view.append(scroll);
      }
    } else {
      stageState.repaint = () => paint();
      const { host: stages, empty } = stageView(board, prefs, stageState);
      view.append(empty ? doneState() : stages);
      if (!empty) bindList(stages, handlers);
      count = stages.children.length;
    }
    root.querySelector(".eb-tools")?.replaceWith(toolbar(board, prefs, change));
    const old = root.querySelector(".eb-view");
    if (old) old.replaceWith(view); else body.prepend(view);
    syncSelection();
    root.dataset.paintMs = String(Math.round(performance.now() - t0));
    return count;
  }

  body.append(panel.el);
  root.append(stageStyle(board), summaryEl, toolbar(board, prefs, change), status, body);
  paint();
  const content = page.content && page.content.trim();
  if (content) {
    const notes = el("section", "eb-notes");
    notes.append(el("h3", "", "평가 메모"), el("div", "content", content));
    root.append(notes);
  }
  host.replaceChildren(root);
}
