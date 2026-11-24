// Plan / Step screen (P5-01): plan list -> steps table, plus the Excel import dialog.
// Import is always dry run first; the only write happens when the user presses the apply button.
import { api } from "./api.js";
import {
  applyState, cellText, filterPreview, filterSteps, formatSize, formatStamp, STATUS, visibleColumns,
} from "./plans-model.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, emptyState, errorState, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");
const FIELDS = [
  ["product", "제품"], ["plan", "Plan"], ["step_code", "Step ID"], ["step_name", "Step 이름"], ["area", "공정 영역"],
  ["tool_group", "설비 그룹"], ["recipe", "레시피"], ["layer", "레이어"], ["note", "비고"],
];
const FILTERS = [["all", "전체"], ["new", "새로"], ["update", "바뀜"], ["same", "같음"], ["error", "확인 필요"]];

// ---- screen ------------------------------------------------------------------------------------------------

export async function renderPlans(host, planId, { go }) {
  const page = el("div", "page pl");
  const hero = el("div", "hero pl-hero");
  const title = el("div", "grow");
  title.append(el("div", "eyebrow", "MI 정보"), el("h1", "h1", "Plan · Step"));
  const importBtn = button("엑셀 가져오기", "pri", () => start());
  importBtn.prepend(svg("upload"));
  hero.append(title, importBtn);
  const body = el("div", "pl-body");
  body.append(skeleton(4));
  page.append(hero, body);
  host.replaceChildren(page);

  const state = { product: "", query: "", showStale: false, items: [], current: null };

  async function load(selectKey) {
    const data = await api.plans();
    state.items = data.items;
    if (selectKey) {
      const hit = data.items.find((p) => p.product === selectKey.product && p.name === selectKey.plan);
      if (hit && hit.id !== planId) { go(hit.id); return; }
    }
    paint();
  }

  function start() {
    openPlanImport({ onDone: (key) => load(key).catch((e) => body.replaceChildren(errorState(e.message, () => load()))) });
  }

  function paint() {
    if (!state.items.length) {
      body.className = "pl-body";
      body.replaceChildren(emptyState({
        title: "가져온 Plan이 아직 없어요", icon: "stack",
        desc: "process plan 엑셀(.xlsx)을 가져오면 Plan별 Step 표가 만들어져요. 먼저 미리보기를 보여 드리고, 확인하기 전에는 아무것도 저장하지 않아요.",
        action: { label: "엑셀 가져오기", run: start },
      }));
      return;
    }
    body.className = "pl-body has";
    const products = [...new Set(state.items.map((p) => p.product))];
    if (state.product && !products.includes(state.product)) state.product = "";
    const shown = state.items.filter((p) => !state.product || p.product === state.product);
    const selected = state.items.find((p) => p.id === planId) ?? shown[0] ?? state.items[0];
    const side = el("aside", "pl-side");
    side.setAttribute("aria-label", "Plan 목록");
    if (products.length > 1) {
      const chips = chipRow([["", "전체"], ...products.map((p) => [p, p])], state.product, (v) => { state.product = v; paint(); }, "pl-products");
      chips.setAttribute("aria-label", "제품으로 거르기");
      side.append(chips);
    }
    const list = el("ul", "pl-list");
    for (const plan of shown) {
      const li = el("li");
      const a = el("a", "pl-item");
      a.href = `#/plans/${plan.id}`;
      if (plan.id === selected.id) a.setAttribute("aria-current", "page");
      const meta = `${num(plan.step_count)}개 Step` + (plan.stale_count ? ` · 파일에 없음 ${plan.stale_count}` : "");
      a.append(el("b", "", plan.name), el("span", "pl-prod", plan.product), el("span", "pl-meta", meta));
      li.append(a);
      list.append(li);
    }
    side.append(list);
    const main = el("section", "pl-main");
    main.setAttribute("aria-label", "Step 표");
    main.append(skeleton(5));
    body.replaceChildren(side, main);
    showPlan(main, selected);
  }

  async function showPlan(main, plan) {
    let data;
    try {
      data = await api.plan(plan.id);
    } catch (e) {
      main.replaceChildren(errorState(e.message, () => showPlan(main, plan)));
      return;
    }
    if (!main.isConnected) return;
    state.current = data;
    main.replaceChildren(planView(data, {
      state,
      reimport: start,
      remove: async () => {
        const ok = await confirmSheet({
          title: `‘${plan.name}’ 지울까요?`, confirmLabel: "지우기", danger: true,
          sub: `${plan.product}의 Step ${plan.step_count + plan.stale_count}개가 앱에서 사라져요. 원본 엑셀은 그대로예요. 같은 파일을 다시 가져오면 돌아와요.`,
        });
        if (!ok) return;
        try {
          await api.deletePlan(plan.id);
          toast("Plan을 지웠어요");
          if (location.hash === "#/plans") await load();
          else location.hash = "#/plans";
        } catch (e) { toast(e.message, { error: true }); }
      },
    }));
  }

  try {
    await load();
  } catch (e) {
    body.replaceChildren(errorState(e.message, () => renderPlans(host, planId, { go })));
  }
}

function planView(data, { state, reimport, remove }) {
  const { plan, steps, extra_columns: extra } = data;
  const wrap = el("div", "pl-view");
  const head = el("header", "pl-head");
  const t = el("div", "pl-title");
  t.append(el("h2", "", plan.name), el("span", "pl-chip", plan.product));
  const meta = el("p", "pl-sub");
  const bits = [plan.source_file && `${plan.source_file}${plan.sheet ? ` · ${plan.sheet}` : ""}`, `가져온 시각 ${formatStamp(plan.imported_at)}`];
  meta.textContent = bits.filter(Boolean).join(" · ");
  if (plan.source_path) meta.title = plan.source_path;
  const actions = el("div", "pl-actions");
  const again = button("다시 가져오기", "sm", reimport);
  again.prepend(svg("refresh", "i s"));
  const del = button("지우기", "sm quiet danger", remove);
  actions.append(again, del);
  const left = el("div", "grow");
  left.append(t, meta);
  head.append(left, actions);

  const columns = visibleColumns(steps.filter((s) => state.showStale || !s.stale), extra);
  const staleCount = steps.filter((s) => s.stale).length;
  const tools = el("div", "pl-tools");
  const search = el("input", "pl-search");
  search.type = "search";
  search.placeholder = "Step 찾기";
  search.value = state.query;
  search.setAttribute("aria-label", "Step 찾기");
  search.autocomplete = "off";
  tools.append(search);
  const count = el("span", "pl-count");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  if (staleCount) {
    const chip = el("button", "chip", `파일에 없는 Step ${staleCount}개 보기`);
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(state.showStale));
    chip.addEventListener("click", () => { state.showStale = !state.showStale; wrap.replaceWith(planView(data, { state, reimport, remove })); });
    tools.append(chip);
  }
  tools.append(count);

  const scroll = el("div", "pl-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("role", "region");
  scroll.setAttribute("aria-label", `${plan.name} Step 표`);
  const table = el("table", "pl-table");
  const thead = el("thead");
  const hr = el("tr");
  const nth = el("th", "n", "#");
  nth.scope = "col";
  hr.append(nth);
  for (const c of columns) {
    const th = el("th", c.extra ? "x" : "", c.label);
    th.scope = "col";
    hr.append(th);
  }
  thead.append(hr);
  const tbody = el("tbody");
  table.append(thead, tbody);
  scroll.append(table);
  const empty = el("div", "pl-empty");
  empty.hidden = true;

  function fill() {
    const rows = filterSteps(steps, columns, state);
    const frag = document.createDocumentFragment();
    rows.forEach((s, i) => {
      const tr = el("tr", s.stale ? "stale" : "");
      tr.append(el("td", "n", String(s.stale ? "–" : i + 1)));
      columns.forEach((c) => {
        const td = el("td", c.key === "step_code" ? "mono" : c.key === "name" ? "nm" : "", cellText(s, c));
        if (c.key === "name" && s.stale) td.append(el("em", "pl-stale", "파일에 없음"));
        tr.append(td);
      });
      frag.append(tr);
    });
    tbody.replaceChildren(frag);
    const live = steps.filter((s) => state.showStale || !s.stale).length;
    count.textContent = state.query.trim() ? `${num(rows.length)} / ${num(live)}개` : `${num(live)}개 Step`;
    empty.hidden = rows.length > 0;
    scroll.hidden = rows.length === 0;
    if (!rows.length) {
      empty.replaceChildren(el("b", "", state.query.trim() ? "찾는 Step이 없어요" : "이 Plan에는 Step이 없어요"),
        el("span", "", state.query.trim() ? "다른 단어로 찾아 보세요." : "다시 가져오면 채워져요."));
    }
  }
  search.addEventListener("input", () => { state.query = search.value; fill(); });
  search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { search.value = ""; state.query = ""; fill(); e.stopPropagation(); } });
  fill();
  wrap.append(head, tools, scroll, empty);
  return wrap;
}

// ---- import dialog -----------------------------------------------------------------------------------------

function badge(status) {
  const s = STATUS[status];
  const b = el("span", `mos-badge ${s.tone}`);
  b.append(svg(s.icon, "i"), s.label);
  return b;
}

function stat(value, label, tone = "") {
  const box = el("div", `mos-stat ${tone}`);
  box.append(el("b", "", num(value)), el("span", "", label));
  return box;
}

export async function openPlanImport({ onDone }) {
  const sheet = openSheet({
    title: "엑셀에서 Plan · Step 가져오기", wide: true,
    sub: "먼저 미리보기만 보여 드려요. ‘반영’을 누르기 전에는 아무것도 저장되지 않아요. 같은 파일을 다시 가져오면 중복 없이 갱신돼요.",
  });
  sheet.dlg.classList.add("mos-sheet", "pl-sheet");
  const st = { file: null, opts: {}, preview: null, filter: "all", busy: false, seq: 0 };
  try {
    const saved = JSON.parse((await api.settings()).plan_mapping || "{}");
    if (saved && typeof saved === "object") st.opts.mapping = saved;
  } catch { /* guessing from the header names still works */ }
  if (!sheet.dlg.open) return;

  // file picker / drop zone
  const input = el("input");
  input.type = "file";
  input.accept = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  input.hidden = true;
  const drop = el("div", "pl-drop");
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  const pick = () => input.click();
  const paintDrop = () => {
    drop.replaceChildren(svg("upload"));
    const text = el("div", "pl-drop-t");
    if (st.file) text.append(el("b", "", st.file.name), el("span", "", `${formatSize(st.file.size)} · 눌러서 다른 파일 고르기`));
    else text.append(el("b", "", "엑셀 파일(.xlsx)을 여기에 끌어놓거나 눌러서 고르세요"), el("span", "", "회사 파일은 이 PC 밖으로 나가지 않아요"));
    drop.append(text);
    drop.setAttribute("aria-label", st.file ? `선택한 파일 ${st.file.name}. 다른 파일 고르기` : "엑셀 파일 고르기");
  };
  paintDrop();
  drop.addEventListener("click", pick);
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); choose(e.dataTransfer.files[0]); });
  input.addEventListener("change", () => { choose(input.files[0]); input.value = ""; });

  const pathIn = el("input", "mos-in");
  pathIn.placeholder = "예: \\\\사내서버\\공정\\process_plan.xlsx";
  pathIn.setAttribute("aria-label", "원본 파일 경로");
  const prodIn = el("input", "mos-in");
  prodIn.placeholder = "제품 열이 없을 때만 사용";
  prodIn.setAttribute("aria-label", "제품 이름 (제품 열이 없을 때)");
  const fields = el("div", "pl-fields");
  for (const [label, control, hint] of [["원본 경로 (선택)", pathIn, "기록용이에요. 앱이 이 경로를 열지는 않아요."], ["제품 이름 (선택)", prodIn, "제품 열이 없는 시트에 쓰는 기본값이에요."]]) {
    const f = el("label", "mos-field");
    f.append(el("span", "k", label), control, el("small", "", hint));
    fields.append(f);
  }
  prodIn.addEventListener("change", () => run());

  const area = el("div", "pl-preview");
  area.setAttribute("aria-live", "polite");
  sheet.body.append(input, drop, fields, area);
  const cancel = button("닫기", "", () => sheet.close());
  const apply = button("가져오기", "pri");
  apply.disabled = true;
  sheet.foot.append(cancel, apply);

  function choose(file) {
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      area.replaceChildren(el("p", "mos-error", ".xlsx 파일만 가져올 수 있어요. (.xls는 엑셀에서 .xlsx로 저장한 뒤 골라 주세요.)"));
      return;
    }
    st.file = file;
    st.opts = { mapping: st.opts.mapping };
    st.preview = null;
    paintDrop();
    run();
  }

  function options() {
    return { ...st.opts, product: prodIn.value.trim(), source_path: pathIn.value.trim() };
  }

  async function run() {
    if (!st.file) return;
    const mine = ++st.seq;
    st.busy = true;
    apply.disabled = true;
    area.replaceChildren(skeleton(3));
    try {
      const data = await api.importPlans(st.file, true, options());
      if (mine !== st.seq || !sheet.dlg.open) return;
      st.preview = data;
      st.opts.sheet = data.sheet;
      st.opts.header_row = st.opts.header_row ?? data.header_row;
      paintPreview();
    } catch (e) {
      if (mine !== st.seq) return;
      st.preview = null;
      const box = el("div", "mos-error", e.message);
      box.setAttribute("role", "alert");
      area.replaceChildren(box);
    } finally {
      if (mine === st.seq) st.busy = false;
    }
  }

  function chosenMapping() { return st.opts.mapping || {}; }

  function mappingBlock(p) {
    const found = FIELDS.filter(([k]) => p.mapping[k]).length;
    const det = el("details", "mos-map");
    det.open = !p.can_apply;
    const sum = el("summary");
    sum.append(el("b", "", "열 지정"), el("span", `mos-mapstat`, ` · ${found}/${FIELDS.length}개 찾음`));
    sum.lastChild.dataset.k = p.can_apply ? "ok" : "bad";
    det.append(sum);
    det.append(el("p", "mos-hint", "각 항목에 쓸 엑셀 열을 눌러 고르세요. 고른 지정은 저장돼서 다음 가져오기에도 쓰여요."));
    const grid = el("div", "mos-mapgrid");
    const headers = [...new Set(p.headers.filter(Boolean))];
    for (const [key, label] of FIELDS) {
      const row = el("div", "pl-maprow");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", `${label} 열`);
      row.append(el("span", "k", label));
      const chips = el("div", "chips");
      for (const h of ["", ...headers]) {
        const c = el("button", "chip", h || "없음");
        c.type = "button";
        c.setAttribute("aria-pressed", String((p.mapping[key] || "") === h));
        c.addEventListener("click", () => {
          st.opts.mapping = { ...chosenMapping(), [key]: h };
          run();
        });
        chips.append(c);
      }
      row.append(chips);
      grid.append(row);
    }
    det.append(grid);
    return det;
  }

  function paintPreview() {
    const p = st.preview;
    const parts = [];
    const note = el("p", "pl-note");
    note.append(svg("lock", "i s"), "미리보기예요. 아직 아무것도 저장되지 않았어요.");
    parts.push(note);

    const where = el("div", "pl-where");
    if (p.sheets.length > 1) {
      const chips = chipRow(p.sheets.map((s) => [s.name, `${s.name} (${num(s.rows)}줄)`]), p.sheet, (name) => {
        st.opts = { mapping: st.opts.mapping, sheet: name };
        run();
      });
      chips.setAttribute("aria-label", "가져올 시트");
      const wrap = el("div", "pl-line");
      wrap.append(el("span", "k", "시트"), chips);
      where.append(wrap);
    }
    const hrow = el("div", "pl-line");
    const hin = el("input", "mos-in pl-num");
    hin.type = "number";
    hin.min = "1";
    hin.value = String(p.header_row);
    hin.setAttribute("aria-label", "머리글 줄 번호");
    const reread = button("다시 읽기", "sm", () => {
      const n = Number(hin.value);
      if (Number.isInteger(n) && n >= 1) { st.opts.header_row = n; run(); }
    });
    hin.addEventListener("keydown", (e) => { if (e.key === "Enter") reread.click(); });
    hrow.append(el("span", "k", "머리글 줄"), hin, el("span", "mos-hint", "번째 줄 · 자동으로 찾았어요. 다르면 바꿔 주세요."), reread);
    where.append(hrow);
    parts.push(where, mappingBlock(p));
    if (p.problem) {
      const box = el("div", "mos-error", p.problem);
      box.setAttribute("role", "alert");
      parts.push(box);
    }
    if (p.extra_headers.length) {
      parts.push(el("p", "mos-hint", `지정하지 않은 열 ${p.extra_headers.length}개(${p.extra_headers.slice(0, 4).join(", ")}${p.extra_headers.length > 4 ? " …" : ""})는 ‘기타 열’로 함께 저장해서 표에 보여 줘요.`));
    }

    const c = p.counts;
    const stats = el("div", "mos-stats pl-stats");
    stats.append(stat(c.new, "새로 추가", c.new ? "ok" : ""), stat(c.update, "바뀜", c.update ? "warn" : ""), stat(c.same, "같음"),
      stat(c.missing, "파일에 없음", c.missing ? "warn" : ""), stat(c.error, "확인 필요", c.error ? "bad" : ""));
    parts.push(stats);
    if (p.plans.length) {
      const ul = el("ul", "pl-plans");
      for (const pl of p.plans) {
        const li = el("li");
        const bits = [pl.new_plan ? "새 Plan" : "기존 Plan", `새로 ${pl.new}`, `바뀜 ${pl.update}`, `같음 ${pl.same}`];
        if (pl.missing) bits.push(`파일에 없음 ${pl.missing}`);
        li.append(el("b", "", pl.plan), el("span", "pl-prod", pl.product), el("span", "pl-meta", bits.join(" · ")));
        ul.append(li);
      }
      parts.push(ul);
    }

    if (p.rows.length || p.errors.length) {
      const filters = chipRow(FILTERS, st.filter, (v) => { st.filter = v; paintPreview(); });
      filters.setAttribute("aria-label", "미리보기 거르기");
      parts.push(filters);
      const wrap = el("div", "mos-scroll");
      wrap.tabIndex = 0;
      wrap.setAttribute("role", "region");
      wrap.setAttribute("aria-label", "미리보기 목록");
      if (st.filter === "error") {
        wrap.append(errorTable(p.errors));
      } else {
        wrap.append(rowTable(filterPreview(p.rows, st.filter)));
      }
      parts.push(wrap);
      if (p.rows_truncated) parts.push(el("p", "mos-hint", `미리보기는 앞 ${p.rows.length}줄만 보여 줘요. 개수와 반영은 전체 ${num(c.new + c.update + c.same)}줄 기준이에요.`));
    }
    area.replaceChildren(...parts);
    const [ok, label] = applyState(p);
    apply.disabled = !ok;
    apply.textContent = label;
  }

  function rowTable(rows) {
    const table = el("table", "mos-table");
    const head = el("thead");
    const hr = el("tr");
    for (const h of ["줄", "결과", "Plan", "Step ID", "Step 이름", "바뀐 항목"]) {
      const th = el("th", "", h);
      th.scope = "col";
      hr.append(th);
    }
    head.append(hr);
    const tb = el("tbody");
    if (!rows.length) {
      const tr = el("tr");
      const td = el("td", "mos-none", "해당하는 줄이 없어요.");
      td.colSpan = 6;
      tr.append(td);
      tb.append(tr);
    }
    for (const r of rows) {
      const tr = el("tr");
      const res = el("td");
      res.append(badge(r.status));
      tr.append(el("td", "", String(r.row)), res, el("td", "", r.plan), el("td", "", r.step_code), el("td", "", r.name),
        el("td", "", r.changes.join(", ")));
      tb.append(tr);
    }
    table.append(head, tb);
    return table;
  }

  function errorTable(errors) {
    const table = el("table", "mos-table");
    const head = el("thead");
    const hr = el("tr");
    for (const h of ["줄", "Step", "문제"]) {
      const th = el("th", "", h);
      th.scope = "col";
      hr.append(th);
    }
    head.append(hr);
    const tb = el("tbody");
    if (!errors.length) {
      const tr = el("tr");
      const td = el("td", "mos-none", "확인이 필요한 줄이 없어요.");
      td.colSpan = 3;
      tr.append(td);
      tb.append(tr);
    }
    for (const e of errors) {
      const tr = el("tr", "bad");
      tr.append(el("td", "", String(e.row)), el("td", "", e.step || "—"), el("td", "", e.message));
      tb.append(tr);
    }
    table.append(head, tb);
    return table;
  }

  apply.addEventListener("click", async () => {
    if (st.busy || !st.preview) return;
    st.busy = true;
    apply.disabled = true;
    apply.textContent = "반영 중…";
    try {
      const done = await api.importPlans(st.file, false, options());
      try {
        await api.putSetting("plan_mapping", JSON.stringify(done.mapping));
      } catch { /* the import itself succeeded; the mapping is just not remembered */ }
      const c = done.counts;
      toast(`Plan ${done.plans.length}개 · 새로 ${num(c.new)}, 바뀜 ${num(c.update)}${c.error ? `, 확인 필요 ${num(c.error)}줄은 건너뜀` : ""}`);
      const first = done.plans[0];
      sheet.close();
      onDone(first ? { product: first.product, plan: first.plan } : null);
    } catch (e) {
      st.busy = false;
      const box = el("div", "mos-error", e.message);
      box.setAttribute("role", "alert");
      area.prepend(box);
      paintApplyState();
    }
  });
  function paintApplyState() {
    const [ok, label] = applyState(st.preview);
    apply.disabled = !ok;
    apply.textContent = label;
  }

  drop.focus();
}
