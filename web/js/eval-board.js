// Evaluation board screen (P4-04): fixed-width native table, delegated events (D-30), toggle chips (D-12).
import { api } from "./api.js";
import {
  UNASSIGNED, buildBoard, cellAt, cellsByStage, equipmentProgress, formatValue, lotProgress,
  stageCounts, visibleRows,
} from "./eval-board-model.js";
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
    return `<th scope="col" class="eb-col"><span class="eb-eq">${esc(item.name)}</span>` +
      (item.vendor ? `<small>${esc(item.vendor)}</small>` : "") +
      `<span class="eb-mini" aria-hidden="true"><i style="width:${p.percent}%"></i></span>` +
      `<small class="eb-pct">${num(p.done)}/${num(p.active)} · ${p.percent}%</small></th>`;
  }).join("");
  let html = `<table class="eb-table" role="grid" aria-label="평가 현황판 (설비별)"` +
    ` aria-rowcount="${rows.length + 1}" aria-colcount="${board.columns + 1}">` +
    `<thead><tr><th scope="col" class="eb-corner">Lot · 웨이퍼</th>${head}</tr></thead>`;
  let lastLot = null;
  rows.forEach((row, r) => {
    if (row.lot !== lastLot) {
      if (lastLot) html += "</tbody>";
      const p = lotProgress(board, row.lot);
      html += `<tbody data-lot="${row.lot.id}"><tr class="eb-band"><th scope="rowgroup" colspan="${board.columns + 1}">` +
        `<span><b>${esc(row.lot.lot_no)}</b><small>${num(p.done)}/${num(p.active)} 완료</small></span></th></tr>`;
      lastLot = row.lot;
    }
    html += `<tr><th scope="row" class="eb-row">${esc(row.wafer.wafer_no)}</th>`;
    for (let c = 0; c < board.columns; c++) {
      const cell = cellAt(board, row.index, c);
      if (!cell) { html += `<td class="eb-cell ex" aria-hidden="true"></td>`; continue; }
      const stageI = board.stageIndex.get(cell.stage_key);
      const cls = cell.excluded ? "ex" : stageI === undefined ? "st-n" : "st-" + stageI;
      const stageLabel = stageI === undefined ? "미배정" : board.stages[stageI].label;
      const value = field && !cell.excluded ? formatValue(field, cell.values[field.key]) : "";
      const text = cell.excluded ? "제외" : field ? value || "—" : stageLabel;
      const label = cellLabel(board, row, c, cell, field && !cell.excluded ? field : null, value);
      html += `<td role="gridcell" tabindex="-1" class="eb-cell ${cls}${field && !value && !cell.excluded ? " blank" : ""}"` +
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
    const list = shown.map(({ cell, row, column: c }) =>
      `<li data-id="${cell.id}"><b>${esc(board.equipment[c].name)}</b><span>${esc(row.lot.lot_no)} · ${esc(row.wafer.wafer_no)}</span></li>`).join("");
    column.innerHTML = `<header><i></i><h3>${esc(label)}</h3><b>${num(items.length)}</b></header>` +
      `<ul tabindex="0" aria-label="${esc(label)} 칸 목록">${list || '<li class="none">해당하는 칸이 없어요</li>'}</ul>`;
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

// Roving tabindex grid; one set of delegated listeners for the whole table.
function bindGrid(scroll) {
  const cells = new Map();
  let rows = 0, columns = 0;
  for (const td of scroll.querySelectorAll("td[data-r]")) {
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    cells.set(r + ":" + c, td);
    rows = Math.max(rows, r + 1);
    columns = Math.max(columns, c + 1);
  }
  let current = cells.get("0:0") || null;
  if (current) current.tabIndex = 0;
  const select = (td) => {
    if (current && current !== td) current.tabIndex = -1;
    td.tabIndex = 0;
    current = td;
  };
  const focus = (td) => { if (td) { select(td); td.focus(); td.scrollIntoView({ block: "nearest", inline: "nearest" }); } };
  scroll.addEventListener("focusin", (event) => {
    const td = event.target.closest?.("td[data-r]");
    if (td) select(td);
  });
  scroll.addEventListener("keydown", (event) => {
    const td = event.target.closest?.("td[data-r]");
    if (!td || event.altKey || event.isComposing || event.keyCode === 229) return;
    const r = Number(td.dataset.r), c = Number(td.dataset.c);
    const move = {
      ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1], ArrowUp: [r - 1, c], ArrowDown: [r + 1, c],
      PageUp: [Math.max(0, r - 10), c], PageDown: [Math.min(rows - 1, r + 10), c],
      Home: event.ctrlKey ? [0, 0] : [r, 0], End: event.ctrlKey ? [rows - 1, columns - 1] : [r, columns - 1],
    }[event.key];
    if (move) {
      event.preventDefault();
      focus(cells.get(move[0] + ":" + move[1]));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      td.click();
    }
  });
  scroll.addEventListener("click", (event) => {
    const td = event.target.closest?.("td[data-id]");
    if (!td) return;
    select(td);
    // P4-05 listens for this to open the cell panel.
    scroll.dispatchEvent(new CustomEvent("board-cell", { bubbles: true, detail: { id: Number(td.dataset.id) } }));
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
  try {
    board = buildBoard(await api.evaluationBoard(page.meta.eval_id));
  } catch (error) {
    host.replaceChildren(errorState(error.message, onError));
    return;
  }
  const prefs = loadPrefs(board);
  const root = el("div", "eb");
  const status = el("p", "sr-only");
  status.setAttribute("role", "status");
  const stageState = { open: new Set(), repaint: () => paint() };
  let summaryEl = summary(board, () => reload());

  async function reload() {
    try {
      board = buildBoard(await api.evaluationBoard(page.meta.eval_id));
      const next = summary(board, () => reload());
      summaryEl.replaceWith(next);
      summaryEl = next;
      paint();
      status.textContent = "현황판을 새로 불러왔어요.";
    } catch (error) {
      status.textContent = "";
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
    const count = paint();
    status.textContent = `${VIEWS.find(([key]) => key === prefs.view)[1]} 보기 · ${num(count)}${VIEW_UNIT[prefs.view]}${prefs.remaining ? " · 남은 것만" : ""}`;
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
        bindGrid(scroll);
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
      count = stages.children.length;
    }
    root.querySelector(".eb-tools")?.replaceWith(toolbar(board, prefs, change));
    const old = root.querySelector(".eb-view");
    if (old) old.replaceWith(view); else root.append(view);
    root.dataset.paintMs = String(Math.round(performance.now() - t0));
    return count;
  }

  root.append(stageStyle(board), summaryEl, toolbar(board, prefs, change), status);
  paint();
  const content = page.content && page.content.trim();
  if (content) {
    const notes = el("section", "eb-notes");
    notes.append(el("h3", "", "평가 메모"), el("div", "content", content));
    root.append(notes);
  }
  host.replaceChildren(root);
}
