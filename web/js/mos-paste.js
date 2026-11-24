// MOS paste dialog (P4-08): paste a MOS table -> column mapping -> dry-run preview -> confirm.
// All parsing lives in mos-paste-model.js; this file only draws it. The only write is the atomic
// bulk stage API, called by the board through `apply`, and only after the user presses the button.
import { api } from "./api.js";
import {
  CELL_KINDS, ROLES, ROW_ERRORS, buildMoves, parseStageMapText, parseTable, planPaste, previewRows, readMapping,
  serializeMapping, stageMapText,
} from "./mos-paste-model.js";
import { button, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");
const FILTERS = [["all", "전체"], ["apply", "적용"], ["risky", "확인 필요"], ["skipped", "건너뜀"]];

function field(label, control, hint) {
  const wrap = el("label", "mos-field");
  wrap.append(el("span", "k", label), control);
  if (hint) wrap.append(el("small", "", hint));
  return wrap;
}

function toggle(label, on, onChange) {
  const b = el("button", "chip", label);
  b.type = "button";
  b.setAttribute("aria-pressed", String(on));
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(next));
    onChange(next);
  });
  return b;
}

/**
 * @param board     buildBoard() output of the open evaluation
 * @param apply     async (moves) => result of the bulk API; the board shows the toast + undo and reloads
 */
export async function openMosPaste({ board, apply }) {
  const sheet = openSheet({
    title: "MOS에서 붙여넣기", wide: true,
    sub: "MOS 화면의 표를 머리글째로 복사해 붙여넣으세요. 먼저 미리보기만 보여 주고, 확인하기 전에는 아무것도 바뀌지 않아요.",
  });
  sheet.dlg.classList.add("mos-sheet");
  let mapping = readMapping("");
  let savedText = serializeMapping(mapping);
  try {
    const settings = await api.settings();
    mapping = readMapping(settings.mos_mapping);
    savedText = serializeMapping(mapping);
  } catch { /* defaults are fine; saving will report the problem */ }
  if (!sheet.dlg.open) return;

  const state = { filter: "all", backward: false, stale: false, busy: false, plan: null, table: null };

  // ---- paste ---------------------------------------------------------------------------------------------
  const area = el("textarea", "mos-paste");
  area.rows = 6;
  area.spellcheck = false;
  area.setAttribute("aria-label", "MOS에서 복사한 표");
  area.placeholder = "Lot ID\tWafer\tEquipment\tStage\tTime\nLOT-TEST-001\t01\tEQ-A01\t측정\t2026-11-24 09:30";
  const clip = button("클립보드에서 붙여넣기", "sm quiet", async () => {
    try {
      area.value = await navigator.clipboard.readText();
      recompute();
    } catch {
      area.focus();
      toast("브라우저가 클립보드 읽기를 막았어요. 입력 칸을 눌러 Ctrl+V로 붙여넣어 주세요.", { error: true });
    }
  });
  clip.prepend(svg("paste", "i s"));
  const clear = button("지우기", "sm quiet", () => { area.value = ""; recompute(); area.focus(); });
  const pasteHead = el("div", "mos-row");
  pasteHead.append(el("h3", "", "1. 붙여넣기"), el("span", "grow"), clip, clear);

  // ---- mapping -------------------------------------------------------------------------------------------
  const inputs = {};
  const found = {};
  const mapBox = el("details", "mos-map");
  const mapSum = el("summary", "");
  const mapStatus = el("span", "mos-mapstat");
  mapSum.append(el("b", "", "2. 열 매핑"), mapStatus);
  const grid = el("div", "mos-mapgrid");
  for (const [role, label, required] of ROLES) {
    const input = el("input", "mos-in");
    input.type = "text";
    input.value = mapping[role];
    input.setAttribute("aria-label", `${label} 열 이름`);
    input.addEventListener("input", () => { markDirty(); recompute(); });
    inputs[role] = input;
    found[role] = el("span", "mos-found");
    const row = el("div", "mos-maprow");
    row.append(el("span", "k", required ? label : `${label} (선택)`), input, found[role]);
    grid.append(row);
  }
  const stageMapArea = el("textarea", "mos-in mos-stagemap");
  stageMapArea.rows = 3;
  stageMapArea.spellcheck = false;
  stageMapArea.value = stageMapText(mapping.stageMap);
  stageMapArea.placeholder = "MOS 값 = 이 평가의 단계 이름\nRCVD = 접수";
  stageMapArea.setAttribute("aria-label", "MOS 단계 값과 평가 단계 대응");
  stageMapArea.addEventListener("input", () => { markDirty(); recompute(); });
  const headerChips = el("div", "mos-headers");
  const saveMap = button("매핑 저장", "sm", saveMapping);
  const saveState = el("span", "mos-savestate");
  const mapFoot = el("div", "mos-row");
  mapFoot.append(saveMap, saveState);
  mapBox.append(mapSum, el("p", "mos-hint", "MOS 표의 머리글 이름을 적어 두면 다음부터 자동으로 찾아요. 여러 이름은 쉼표로 구분하고, 대소문자·띄어쓰기·밑줄은 구분하지 않아요."),
    grid, field("단계 값 대응 (한 줄에 하나)", stageMapArea, "MOS의 단계 값이 평가 단계 이름과 다를 때만 적어요. 같은 이름이면 비워 두세요."),
    headerChips, mapFoot);

  function currentMapping() {
    const out = { stageMap: parseStageMapText(stageMapArea.value) };
    for (const [role] of ROLES) out[role] = inputs[role].value.trim();
    return out;
  }
  function markDirty() {
    const dirty = serializeMapping(readMapping(serializeMapping(currentMapping()))) !== savedText;
    saveState.textContent = dirty ? "저장하지 않은 변경이 있어요" : "";
    saveState.dataset.k = dirty ? "dirty" : "";
  }
  async function saveMapping() {
    const next = readMapping(serializeMapping(currentMapping()));
    saveMap.disabled = true;
    try {
      await api.putSetting("mos_mapping", serializeMapping(next));
      savedText = serializeMapping(next);
      saveState.textContent = "저장했어요. 다음에도 이 매핑을 써요.";
      saveState.dataset.k = "ok";
    } catch (error) {
      saveState.textContent = `저장하지 못했어요. ${error.message}`;
      saveState.dataset.k = "err";
    } finally {
      saveMap.disabled = false;
    }
  }

  // ---- preview -------------------------------------------------------------------------------------------
  const preview = el("section", "mos-preview");
  preview.setAttribute("aria-live", "polite");
  const stats = el("div", "mos-stats");
  const opts = el("div", "mos-opts");
  const filterHost = el("div", "mos-filter");
  const list = el("div", "mos-list");
  const unknownBox = el("div", "mos-unknown");
  const previewHead = el("div", "mos-row");
  previewHead.append(el("h3", "", "3. 미리보기"));
  preview.append(previewHead, stats, opts, unknownBox, filterHost, list);

  const apply_ = button("적용", "pri", confirm);
  const cancel = button("취소", "", sheet.close);
  sheet.foot.append(cancel, apply_);

  const risky = () => (state.plan?.counts.backward || 0) + (state.plan?.counts.stale || 0);
  const options = () => ({ allowBackward: state.backward, allowStale: state.stale });

  function stat(label, n, tone) {
    const box = el("div", "mos-stat" + (tone ? " " + tone : ""));
    box.append(el("b", "", num(n)), el("span", "", label));
    return box;
  }

  function paintOptions() {
    opts.replaceChildren();
    if (!risky()) return;
    opts.append(el("span", "k", "자동으로 건너뛰는 칸"));
    const { counts } = state.plan;
    if (counts.backward) opts.append(toggle(`단계 되돌림 ${num(counts.backward)}칸도 적용`, state.backward, (on) => { state.backward = on; paintFoot(); paintRows(); }));
    if (counts.stale) opts.append(toggle(`MOS가 더 오래된 ${num(counts.stale)}칸도 적용`, state.stale, (on) => { state.stale = on; paintFoot(); paintRows(); }));
  }

  function paintFoot() {
    const n = state.plan && !state.plan.error ? buildMoves(state.plan, options()).length : 0;
    apply_.textContent = n ? `${num(n)}칸 적용` : "적용할 칸 없음";
    apply_.disabled = !n || state.busy;
  }

  function badge(text, tone, icon) {
    const b = el("span", "mos-badge " + tone);
    if (icon) b.append(svg(icon, "i s"));
    b.append(text);
    return b;
  }

  function resultOf(item) {
    if (item.error) return badge(ROW_ERRORS[item.error], "bad", "alert");
    const counts = {};
    for (const cell of item.cells) counts[cell.kind] = (counts[cell.kind] || 0) + 1;
    const wrap = el("span", "mos-results");
    const order = ["apply", "backward", "stale", "same", "superseded", "excluded"];
    for (const kind of order) {
      if (!counts[kind]) continue;
      const on = kind === "apply" || (kind === "backward" && state.backward) || (kind === "stale" && state.stale);
      const tone = kind === "apply" ? "ok" : kind === "backward" || kind === "stale" ? (on ? "ok" : "warn") : "mute";
      const icon = kind === "apply" ? "check" : kind === "backward" || kind === "stale" ? (on ? "check" : "alert") : null;
      wrap.append(badge(`${CELL_KINDS[kind]} ${num(counts[kind])}`, tone, icon));
    }
    return wrap;
  }

  function paintRows() {
    list.replaceChildren();
    const plan = state.plan;
    if (!plan || plan.error || !plan.rows.length) return;
    const { rows, total, capped } = previewRows(plan, state.filter);
    if (!rows.length) {
      list.append(el("p", "mos-none", "이 조건에 맞는 줄이 없어요."));
      return;
    }
    const table = el("table", "mos-table");
    table.innerHTML = "<thead><tr><th>줄</th><th>Lot</th><th>웨이퍼</th><th>설비</th><th>MOS 단계</th><th>결과</th></tr></thead>";
    const body = el("tbody");
    for (const item of rows) {
      const tr = el("tr", item.error ? "bad" : "");
      const stage = item.stageLabel && item.stageLabel !== item.stage ? `${item.stage} → ${item.stageLabel}` : item.stage;
      for (const text of [String(item.line), item.lot, item.wafer || "전체", item.equipment, stage]) tr.append(el("td", "", text));
      const last = el("td");
      last.append(resultOf(item));
      tr.append(last);
      body.append(tr);
    }
    table.append(body);
    const scroll = el("div", "mos-scroll");
    scroll.append(table);
    list.append(scroll);
    if (capped) list.append(el("p", "mos-none", `앞의 ${num(rows.length)}줄만 보여 줘요 (조건에 맞는 줄 ${num(total)}개). 적용은 모든 줄에 해당해요.`));
  }

  function paintPreview() {
    const plan = state.plan;
    stats.replaceChildren();
    unknownBox.replaceChildren();
    filterHost.replaceChildren();
    if (!plan) {
      stats.append(el("p", "mos-none", "표를 붙여넣으면 여기에 결과가 먼저 나와요."));
      paintOptions(); paintRows(); paintFoot();
      return;
    }
    if (plan.error) {
      const err = el("p", "mos-error", plan.error);
      err.setAttribute("role", "alert");
      stats.append(err);
      paintOptions(); paintRows(); paintFoot();
      return;
    }
    const { counts } = plan;
    stats.append(stat("적용", counts.apply, "ok"), stat("이미 같음", counts.same), stat("확인 필요", risky(), risky() ? "warn" : ""),
      stat("건너뛴 줄", counts.skipped, counts.skipped ? "bad" : ""));
    const unknowns = [["Lot", plan.unknown.lots], ["설비", plan.unknown.equipment], ["단계", plan.unknown.stages]].filter(([, v]) => v.length);
    if (unknowns.length) {
      unknownBox.append(svg("alert", "i s"));
      const text = el("div", "mos-unk-text");
      text.append(el("b", "", "이 평가에 없어서 건너뛰는 항목"));
      for (const [label, values] of unknowns) {
        const shown = values.slice(0, 8).join(", ") + (values.length > 8 ? ` 외 ${num(values.length - 8)}개` : "");
        text.append(el("span", "", `${label}: ${shown}`));
      }
      unknownBox.append(text);
    }
    filterHost.append(chipRow(FILTERS, state.filter, (value) => { state.filter = value; paintPreview(); }));
    filterHost.firstChild.setAttribute("aria-label", "미리보기 보기 방식");
    paintOptions(); paintRows(); paintFoot();
  }

  function paintMapping() {
    const cols = state.plan?.columns;
    for (const [role, , required] of ROLES) {
      const box = found[role];
      box.className = "mos-found";
      if (!state.table || state.table.error) { box.textContent = ""; continue; }
      const name = cols?.headerOf[role];
      box.textContent = name ? `✓ ${name}` : required ? "찾지 못함" : "없음";
      box.classList.add(name ? "ok" : required ? "bad" : "mute");
    }
    const missing = cols?.missing.length;
    mapStatus.textContent = !state.table || state.table.error ? "" : missing ? " · 열을 찾지 못했어요" : " · 모든 열을 찾았어요";
    mapStatus.dataset.k = missing ? "bad" : "ok";
    if (missing) mapBox.open = true;
    headerChips.replaceChildren();
    if (missing && state.table?.headers.length) {
      const target = ROLES.find(([role, , required]) => required && cols.missing.includes(role))?.[0];
      headerChips.append(el("span", "k", `붙여넣은 표의 머리글 — 누르면 ‘${ROLES.find(([r]) => r === target)[1]}’ 열 이름으로 넣어요`));
      const row = el("div", "chips");
      for (const header of state.table.headers) {
        const chip = el("button", "chip", header);
        chip.type = "button";
        chip.title = `${ROLES.find(([r]) => r === target)[1]} 열로 지정`;
        chip.addEventListener("click", () => {
          const input = inputs[target];
          input.value = input.value.trim() ? `${header}, ${input.value}` : header;
          markDirty();
          recompute();
          inputs[target].focus();
        });
        row.append(chip);
      }
      headerChips.append(row);
    }
  }

  let timer = 0;
  function recompute() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const text = area.value;
      state.table = text.trim() ? parseTable(text) : null;
      state.plan = state.table ? planPaste(board, state.table, readMapping(serializeMapping(currentMapping()))) : null;
      if (!risky()) { state.backward = false; state.stale = false; }
      paintMapping();
      paintPreview();
    }, 120);
  }

  async function confirm() {
    if (!state.plan || state.plan.error || state.busy) return;
    const moves = buildMoves(state.plan, options());
    if (!moves.length) return;
    state.busy = true;
    paintFoot();
    apply_.textContent = "적용 중…";
    try {
      await apply(moves);
      sheet.close();
    } catch (error) {
      state.busy = false;
      paintFoot();
      const err = el("p", "mos-error", `적용하지 못했어요. 아무것도 바뀌지 않았어요. ${error.message}`);
      err.setAttribute("role", "alert");
      stats.replaceChildren(err);
    }
  }

  area.addEventListener("input", recompute);
  area.addEventListener("paste", () => setTimeout(recompute, 0));
  sheet.body.append(pasteHead, area, mapBox, preview);
  sheet.dlg.classList.add("mos-sheet");
  paintMapping();
  paintPreview();
  area.focus();
}
