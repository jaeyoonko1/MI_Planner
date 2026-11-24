// Cell side panel for the evaluation board (P4-05): one cell (stage, values, memo, history) or a bulk move.
// Pure view: all data changes go through the callbacks in `ctx`, so the board stays the single owner of state.
import { UNASSIGNED, formatAt } from "./eval-board-model.js";
import { describeSelection, locate, nextStageMoves, stageDistribution, targetMoves } from "./eval-select-model.js";
import { LEVEL_TEXT, boardNow, cellWait, formatThreshold, formatWait, historyDurations, waitSentence, waitSummary } from "./eval-wait-model.js";
import { statusBadge } from "./eval-entity.js";
import {
  ENTITY_STATUS, KIND_LABEL, entityName, findEntity, statusMeta, statusOf, statusSummary, touchedEntities,
} from "./eval-entity-model.js";
import { el, svg } from "./ui.js";

const NOTE_MAX = 2000;
const TEXT_MAX = 500;
const num = (n) => n.toLocaleString("ko-KR");

function button(cls, text, onClick) {
  const b = el("button", cls, text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

export function createPanel(ctx) {
  const root = el("aside", "eb-panel");
  root.hidden = true;
  let ids = [];
  let info = { skipped: 0 };
  let session = 0; // bumps on every show(); late async results from an older cell are dropped
  let chain = Promise.resolve(); // saves for the shown cell run one after another
  let commits = []; // functions that save any edited-but-unsaved field (blur normally does it first)
  let pending = null; // bulk: chosen target stage (undefined = none yet)
  let busy = false;
  let statusEl = null;
  let entityViews = []; // rebuilders of the equipment / Lot rows, run after a status or name change

  const board = () => ctx.board();

  // A node that rebuilds itself on refreshEntities(), so badges and names never go stale (V-005).
  function live(build) {
    let node = build();
    entityViews.push(() => {
      const next = build();
      node.replaceWith(next);
      node = next;
    });
    return node;
  }

  function refreshEntities() {
    const keep = root.contains(document.activeElement) ? document.activeElement.dataset?.keep : undefined;
    entityViews.forEach((rebuild) => rebuild());
    if (keep) root.querySelector(`[data-keep="${CSS.escape(keep)}"]`)?.focus();
  }

  // Equipment / Lot this cell belongs to: name + status badge + edit button (opens the same popover as the header).
  function entityRow(kind, id) {
    return live(() => {
      const item = findEntity(board(), kind, id);
      const row = el("div", "eb-prow");
      if (!item) return row;
      const name = entityName(kind, item);
      const edit = button("icon-btn eb-pedit", "", () => ctx.editEntity(edit, kind, id));
      edit.dataset.keep = `edit-${kind}`;
      edit.setAttribute("aria-haspopup", "dialog");
      edit.setAttribute("aria-label", `${KIND_LABEL[kind]} ${name} 상태·이름 편집`);
      edit.title = `${KIND_LABEL[kind]} 상태·이름 편집 (${kind === "lot" ? "L" : "E"})`;
      edit.append(svg("edit"));
      const label = el("span", "eb-pname");
      label.append(el("span", "eb-pk", KIND_LABEL[kind]), el("b", "", name));
      row.append(label, statusBadge(kind, statusOf(item)), edit);
      if (item.note) row.append(el("p", "eb-pnote", item.note));
      return row;
    });
  }

  // Status chips for many equipment / Lots at once; "pressed" only when they all share one status.
  function bulkStatus(kind, ids) {
    return live(() => {
      const sum = statusSummary(board(), kind, ids);
      const box = el("div", "eb-bstat");
      const head = el("p", "eb-bhead");
      head.append(el("b", "", `${KIND_LABEL[kind]} ${num(ids.length)}개`));
      if (sum.uniform === null) {
        head.append(el("span", "", "상태가 섞여 있어요: " + ENTITY_STATUS.filter((item) => sum.counts.get(item.key) > 0)
          .map((item) => `${item.label} ${sum.counts.get(item.key)}`).join(" · ")));
      }
      const group = el("div", "chips eb-schips");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", `${KIND_LABEL[kind]} ${num(ids.length)}개 상태`);
      for (const item of ENTITY_STATUS) {
        const chip = button("chip eb-schip s-" + item.key, "", () => ctx.setStatuses(kind, ids, item.key));
        chip.dataset.keep = `${kind}-${item.key}`;
        chip.title = `${KIND_LABEL[kind]} ${num(ids.length)}개를 ${item.label} 상태로 — ${item.hint}`;
        chip.setAttribute("aria-pressed", String(sum.uniform === item.key));
        chip.append(svg(item.icon), el("span", "", item.label));
        group.append(chip);
      }
      box.append(head, group);
      return box;
    });
  }

  // Wait line: icon + words, so the level never relies on color alone.
  function waitBadge(info) {
    const level = ctx.warnOn() ? info.level : 0;
    const badge = el("span", "eb-wait w" + level);
    badge.append(svg(level === 2 ? "alert" : "clock"), el("b", "", `대기 ${info.text}`));
    if (level) badge.append(el("span", "", `${LEVEL_TEXT[level]} · 기준 ${formatThreshold(info.warnHours)}${level === 2 ? "의 2배" : ""} 초과`));
    else if (info.warnHours) badge.append(el("span", "", `기준 ${formatThreshold(info.warnHours)}`));
    badge.title = waitSentence(info, ctx.warnOn());
    return badge;
  }
  const stageLabel = (key) => {
    const b = board();
    return b.stageIndex.has(key) ? b.stages[b.stageIndex.get(key)].label : key ? String(key) : "미배정";
  };
  const stageClass = (key) => (board().stageIndex.has(key) ? "st-" + board().stageIndex.get(key) : "st-n");

  function status(text, error = false) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.classList.toggle("err", error);
  }

  function stageChip(key, label, pressed, onPick) {
    const b = el("button", "chip eb-pchip " + stageClass(key));
    b.type = "button";
    b.append(el("i"), el("span", "", label));
    b.dataset.stage = key ?? "";
    b.setAttribute("aria-pressed", String(pressed));
    b.addEventListener("click", () => onPick(key));
    return b;
  }

  function stageChips(selected, onPick) {
    const group = el("div", "chips eb-pchips");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "단계");
    for (const stage of board().stages) group.append(stageChip(stage.key, stage.label, selected === stage.key, onPick));
    group.append(stageChip(null, "미배정", selected === null, onPick));
    return group;
  }

  function header(title, sub, closeLabel = "패널 닫기") {
    const head = el("header", "eb-phead");
    const text = el("div", "eb-ptitle");
    const h = el("h3", "", title);
    h.id = "eb-ptitle";
    text.append(h, el("p", "", sub));
    const close = button("icon-btn eb-pclose", "", () => ctx.clear());
    close.setAttribute("aria-label", closeLabel);
    close.title = closeLabel + " (Esc)";
    close.append(svg("x"));
    head.append(text, close);
    return head;
  }

  function section(title, ...nodes) {
    const box = el("section", "eb-psec");
    box.append(el("h4", "", title), ...nodes);
    return box;
  }

  function scopeButtons() {
    const row = el("div", "eb-scope");
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "선택 범위 넓히기");
    for (const [kind, label, hint] of [
      ["row", "이 웨이퍼 행", "같은 웨이퍼의 모든 설비 칸을 선택해요"],
      ["column", "이 설비 전체", "이 설비의 모든 칸을 선택해요"],
      ["lot", "이 Lot 전체", "같은 Lot의 모든 칸을 선택해요"],
      ["all", "모두", "표시 중인 모든 칸을 선택해요 (Ctrl+A)"],
    ]) {
      const b = button("chip", label, () => ctx.selectScope(kind));
      b.title = hint;
      row.append(b);
    }
    return row;
  }

  // ---- one cell ------------------------------------------------------------------------------

  function queueSave(cellId, patch) {
    const mine = session;
    const run = async () => {
      status("저장 중…");
      try {
        await ctx.saveCell(cellId, patch);
        if (mine === session) status("저장됨");
      } catch (error) {
        if (mine === session) status(error.message, true);
        throw error;
      }
    };
    chain = chain.then(run, run);
    return chain;
  }

  function fieldRow(field, cell) {
    const id = `eb-f-${field.key}`;
    const row = el("div", "eb-pfield");
    const label = el("label", "", field.label);
    const err = el("p", "eb-ferr");
    err.id = id + "-err";
    err.setAttribute("role", "alert");
    const current = () => cell.values[field.key];
    const save = async (value) => {
      err.textContent = "";
      try {
        await queueSave(cell.id, { values: { [field.key]: value } });
        return true;
      } catch (error) {
        err.textContent = error.message;
        return false;
      }
    };
    if (field.type === "okng" || field.type === "check") {
      label.removeAttribute("for");
      const group = el("div", "chips");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", field.label);
      const options = field.type === "okng" ? [["ok", "OK"], ["ng", "NG"]] : [[true, "체크"]];
      const sync = () => group.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(options[i][0] === current())));
      options.forEach(([value, text]) => {
        const b = button("chip", text, async () => {
          const next = current() === value ? null : value;
          const before = current();
          b.disabled = true;
          if (!(await save(next))) { cell.values[field.key] = before; }
          b.disabled = false;
          sync();
        });
        group.append(b);
      });
      sync();
      row.append(label, group, err);
      return row;
    }
    const input = el("input", "eb-input");
    input.id = id;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (field.type === "number") { input.inputMode = "decimal"; input.placeholder = "숫자"; }
    else { input.maxLength = TEXT_MAX; input.placeholder = "입력"; }
    label.htmlFor = id;
    input.setAttribute("aria-describedby", err.id);
    const shown = () => (current() === undefined || current() === null ? "" : String(current()));
    input.value = shown();
    let saving = false;
    const commit = async () => {
      const text = input.value.trim();
      if (text === shown() || saving) return;
      let value = text === "" ? null : text;
      if (field.type === "number" && value !== null) {
        value = Number(value.replace(/,/g, ""));
        if (!Number.isFinite(value)) {
          input.setAttribute("aria-invalid", "true");
          err.textContent = `'${field.label}'에는 숫자를 입력해 주세요.`;
          return;
        }
      }
      input.removeAttribute("aria-invalid");
      saving = true;
      const ok = await save(value);
      saving = false;
      if (ok) input.value = shown();
      else input.setAttribute("aria-invalid", "true");
    };
    input.addEventListener("input", () => { input.removeAttribute("aria-invalid"); err.textContent = ""; });
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter") { event.preventDefault(); commit(); }
      else if (event.key === "Escape") { event.stopPropagation(); input.value = shown(); err.textContent = ""; input.removeAttribute("aria-invalid"); ctx.release(); }
    });
    commits.push(commit);
    row.append(label, input, err);
    return row;
  }

  function noteRow(cell) {
    const area = el("textarea", "eb-input eb-note");
    area.id = "eb-note";
    area.rows = 3;
    area.maxLength = NOTE_MAX;
    area.placeholder = "이 칸에 남길 메모";
    area.value = cell.note || "";
    area.setAttribute("aria-label", "메모");
    const count = el("span", "eb-count");
    const showCount = () => { count.textContent = area.value.length >= NOTE_MAX - 300 ? `${num(area.value.length)}/${num(NOTE_MAX)}` : ""; };
    showCount();
    let saving = false;
    const commit = async () => {
      const text = area.value.trim();
      if (text === (cell.note || "") || saving) return;
      saving = true;
      try {
        await queueSave(cell.id, { note: text });
        area.value = cell.note || "";
        area.removeAttribute("aria-invalid");
      } catch {
        area.setAttribute("aria-invalid", "true");
      }
      saving = false;
      showCount();
    };
    area.addEventListener("input", showCount);
    area.addEventListener("blur", commit);
    area.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); commit(); }
      else if (event.key === "Escape") { event.stopPropagation(); commit(); ctx.release(); }
    });
    commits.push(commit);
    const wrap = el("div", "eb-notewrap");
    wrap.append(area, count);
    return wrap;
  }

  function historyList(items) {
    if (!items.length) return el("p", "eb-empty", "아직 단계 이력이 없어요. 단계를 고르면 여기에 쌓여요.");
    const list = el("ol", "eb-hist");
    const stays = historyDurations(items, boardNow(board()));
    for (const [i, item] of items.entries()) {
      const when = formatAt(item.at);
      const li = el("li");
      const move = el("span", "eb-hmove");
      move.append(el("span", "from", stageLabel(item.from_stage)), el("em", "", "→"), el("b", "", stageLabel(item.to_stage)));
      const time = el("time", "", when.text);
      time.dateTime = item.at;
      time.title = when.ago;
      const stay = el("span", "eb-stay", stays[i] === null || (i === 0 && item.to_stage === board().lastKey) ? "" : (i === 0 ? "지금까지 " : "머문 시간 ") + formatWait(stays[i]));
      const when2 = el("span", "eb-hwhen");
      when2.append(time, stay);
      li.append(move, when2);
      list.append(li);
    }
    return list;
  }

  function singleBody(cellId) {
    const b = board();
    const spot = locate(b, cellId);
    const { cell, row, column } = spot;
    const equipment = b.equipment[column];
    const frag = document.createDocumentFragment();
    frag.append(header(`${row.lot.lot_no} · 웨이퍼 ${row.wafer.wafer_no}`, equipment.name + (equipment.vendor ? ` · ${equipment.vendor}` : "")));
    const body = el("div", "eb-pbody");
    if (cell.excluded) {
      const none = el("div", "eb-excluded");
      none.append(el("b", "", "제외한 조합이에요"), el("p", "", "평가에서 빼 둔 칸이라 단계나 값을 바꿀 수 없어요. 포함하면 이전 단계 그대로 돌아오고 대기 시간은 새로 시작해요."));
      const include = button("btn eb-include", "평가에 포함하기", () => ctx.setExcluded([cell.id], false));
      none.append(include);
      body.append(none, section("설비 · Lot", entityRow("equipment", equipment.id), entityRow("lot", row.lot.id)),
        section("선택 범위", scopeButtons()));
      frag.append(body);
      return frag;
    }
    body.append(section("설비 · Lot", entityRow("equipment", equipment.id), entityRow("lot", row.lot.id)));
    const stageBox = section("단계");
    const refreshStage = () => {
      const at = formatAt(cell.at);
      const group = stageChips(b.stageIndex.has(cell.stage_key) ? cell.stage_key : null, async (key) => {
        if (busy || key === (b.stageIndex.has(cell.stage_key) ? cell.stage_key : null)) return;
        await ctx.moveCells(targetMoves([cell.id], key), { label: stageLabel(key) });
      });
      const nextMoves = nextStageMoves(b, [cell.id]);
      const next = button("btn sm eb-next", nextMoves.length ? `다음 단계로 · ${stageLabel(nextMoves[0].stage_key)}` : "마지막 단계예요", async () => {
        if (!busy && nextMoves.length) await ctx.moveCells(nextMoves, { label: stageLabel(nextMoves[0].stage_key) });
      });
      next.disabled = !nextMoves.length;
      const since = el("p", "eb-since", cell.at ? `${at.text}부터 · ${at.ago}` : "아직 단계가 정해지지 않았어요");
      const waiting = cellWait(b, cell, boardNow(b));
      stageBox.replaceChildren(el("h4", "", "단계"), group, ...(waiting ? [waitBadge(waiting)] : []), since, next);
    };
    refreshStage();
    body.append(stageBox);
    if (b.fields.length) {
      commits = [];
      body.append(section("값", ...b.fields.map((field) => fieldRow(field, cell))));
    }
    const noteBox = section("메모", noteRow(cell));
    body.append(noteBox);
    const histBox = section("단계 이력", el("p", "eb-empty", "불러오는 중…"));
    const exclude = button("btn quiet sm eb-exclude", "이 칸 평가에서 제외", () => ctx.setExcluded([cell.id], true));
    exclude.title = "제외하면 진행률에서 빠지고 단계·값을 바꿀 수 없어요. 언제든 되돌릴 수 있어요.";
    body.append(histBox, section("선택 범위", scopeButtons()), section("칸 관리", exclude));
    const mine = session;
    const loadHistory = async () => {
      try {
        const items = await ctx.loadHistory(cell.id);
        if (mine === session) histBox.replaceChildren(el("h4", "", "단계 이력"), historyList(items));
      } catch (error) {
        if (mine === session) histBox.replaceChildren(el("h4", "", "단계 이력"), el("p", "eb-empty", error.message));
      }
    };
    loadHistory();
    root._refresh = () => { refreshStage(); loadHistory(); };
    statusEl = el("p", "eb-pstatus");
    statusEl.setAttribute("role", "status");
    frag.append(body, statusEl);
    return frag;
  }

  // ---- many cells ----------------------------------------------------------------------------

  function bulkBody() {
    const b = board();
    const desc = describeSelection(b, ids);
    const frag = document.createDocumentFragment();
    frag.append(header(`${num(ids.length)}칸 선택`, `설비 ${desc.equipment} · Lot ${desc.lots}`, "선택 해제"));
    const body = el("div", "eb-pbody");
    const dist = el("ul", "eb-dist");
    const render = () => {
      const { counts } = stageDistribution(b, ids);
      dist.replaceChildren(...[...b.stages.map((s) => [s.key, s.label]), [UNASSIGNED, "미배정"]]
        .filter(([key]) => counts.get(key) > 0)
        .map(([key, label]) => {
          const li = el("li", stageClass(key === UNASSIGNED ? null : key));
          li.append(el("i"), el("span", "", label), el("b", "", num(counts.get(key))));
          return li;
        }));
    };
    render();
    body.append(section("지금 단계", dist));
    const waits = waitSummary(b, ids.map((id) => b.byId.get(id)), boardNow(b));
    if (waits.longest) {
      const box = el("div", "eb-waits");
      box.append(waitBadge(waits.longest));
      const which = locate(b, waits.longest.cell.id);
      box.append(el("p", "eb-since", `가장 오래 기다린 칸: ${b.equipment[which.column].name} · ${which.row.lot.lot_no} ${which.row.wafer.wafer_no} · ${waits.longest.stage.label}`));
      if (ctx.warnOn() && (waits.warn || waits.alert)) box.append(el("p", "eb-since", `경고 ${num(waits.warn)}칸 · 심각 ${num(waits.alert)}칸`));
      body.append(section("대기 시간", box));
    }
    if (info.skipped) {
      const note = el("p", "eb-note-skip", `제외한 칸 ${num(info.skipped)}개는 선택에서 뺐어요.`);
      body.append(note);
    }
    const group = stageChips(pending === undefined ? undefined : pending, (key) => {
      if (busy) return;
      pending = key;
      sync();
    });
    const apply = button("btn eb-apply", "", async () => {
      if (busy || pending === undefined) return;
      await ctx.moveCells(targetMoves(ids, pending), { label: stageLabel(pending) });
    });
    const next = button("btn ghost eb-next", "각 칸을 다음 단계로", async () => {
      if (busy) return;
      const moves = nextStageMoves(b, ids);
      if (!moves.length) { status("모두 마지막 단계예요."); return; }
      await ctx.moveCells(moves, { label: "다음" });
    });
    const hint = el("p", "eb-since");
    function sync() {
      group.querySelectorAll("button").forEach((chip) => {
        const key = chip.dataset.stage === "" ? null : chip.dataset.stage;
        chip.setAttribute("aria-pressed", String(pending !== undefined && key === pending));
      });
      apply.disabled = pending === undefined;
      apply.textContent = pending === undefined ? "옮길 단계를 고르세요" : `${stageLabel(pending)} 단계로 옮기기 · ${num(ids.length)}칸`;
      if (pending === undefined) { hint.textContent = "단계를 고른 뒤 옮기기를 눌러요. 실행 취소할 수 있어요."; return; }
      const same = ids.filter((id) => (b.byId.get(id).stage_key ?? null) === pending).length;
      hint.textContent = same ? `이미 같은 단계인 ${num(same)}칸은 그대로 두어요.` : "모든 칸의 단계가 바뀌어요.";
    }
    sync();
    const touched = touchedEntities(b, ids);
    const exclude = button("btn quiet sm eb-exclude", `선택한 ${num(ids.length)}칸 평가에서 제외`, () => ctx.setExcluded(ids, true));
    exclude.title = "제외하면 진행률에서 빠지고 단계·값을 바꿀 수 없어요. 언제든 되돌릴 수 있어요.";
    body.append(section("옮길 단계", group, hint, apply, next),
      section("설비 · Lot 상태", bulkStatus("equipment", touched.equipment), bulkStatus("lot", touched.lots)),
      section("선택 범위", scopeButtons()), section("칸 관리", exclude));
    root._refresh = () => { render(); sync(); };
    statusEl = el("p", "eb-pstatus");
    statusEl.setAttribute("role", "status");
    const clear = button("btn quiet sm eb-clear", "선택 해제", () => ctx.clear());
    frag.append(body, statusEl, clear);
    return frag;
  }

  // ---- public --------------------------------------------------------------------------------

  async function flush() {
    const todo = commits.map((commit) => commit());
    await Promise.allSettled(todo);
    await chain.catch(() => {});
  }

  function show(nextIds, nextInfo = {}) {
    session++;
    ids = nextIds;
    info = { skipped: 0, ...nextInfo };
    pending = undefined;
    commits = [];
    entityViews = [];
    root._refresh = null;
    statusEl = null;
    if (!ids.length) { root.hidden = true; root.replaceChildren(); return; }
    root.hidden = false;
    root.setAttribute("role", "complementary");
    root.setAttribute("aria-labelledby", "eb-ptitle");
    root.dataset.mode = ids.length === 1 ? "single" : "bulk";
    root.replaceChildren(ids.length === 1 ? singleBody(ids[0]) : bulkBody());
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); ctx.release(); }
  });

  return {
    el: root,
    show,
    flush,
    isOpen: () => !root.hidden,
    setBusy(value) {
      busy = value;
      root.toggleAttribute("aria-busy", value);
      root.querySelectorAll(".eb-pchip, .eb-apply, .eb-next").forEach((node) => {
        if (value) { node.dataset.wasDisabled = node.disabled ? "1" : ""; node.disabled = true; }
        else if ("wasDisabled" in node.dataset) { node.disabled = node.dataset.wasDisabled === "1"; delete node.dataset.wasDisabled; }
      });
    },
    // Rebuild the stage-dependent parts, keeping keyboard focus on the same stage chip.
    refresh() {
      const stage = root.contains(document.activeElement) ? document.activeElement.dataset?.stage : undefined;
      root._refresh?.();
      refreshEntities();
      if (stage !== undefined) root.querySelector(`.eb-pchip[data-stage="${CSS.escape(stage)}"]`)?.focus();
    },
    status,
    focusStage() {
      const target = root.querySelector('.eb-pchip[aria-pressed="true"]') || root.querySelector("button, input");
      target?.focus();
    },
  };
}
