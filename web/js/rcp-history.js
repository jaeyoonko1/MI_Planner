// Snapshot history + diff of one recipe (P6-04). Used inside the recipe detail window. Read-only.
import { api } from "./api.js";
import { DIFF_STATUS, diffTSV, filterDiffRows, fmt, summaryText } from "./rcp-compare-model.js";
import { copyText, searchBox } from "./rcp-compare.js";
import { formatStamp, parseStatus } from "./rcp-model.js";
import { createVTable } from "./rcp-vtable.js";
import { button } from "./sheet.js";
import { chipRow, el, errorState, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");

function statusBadge(status) {
  const [label, tone, icon] = parseStatus(status);
  const b = el("span", `mos-badge ${tone}`);
  b.append(svg(icon, "i"), label);
  return b;
}

/** Fills `host` with the timeline; `onOpenDiff(a, b)` swaps to the diff panel (handled here too). */
export function renderHistory(host, recipeId) {
  const st = { data: null, a: null, b: null };
  host.replaceChildren(skeleton(4));

  function pairBar() {
    const bar = el("div", "rcp-pairbar");
    bar.setAttribute("role", "status");
    const ready = st.a && st.b && st.a !== st.b;
    bar.append(el("span", "", ready ? "고른 두 버전을 비교할 수 있어요" : "버전 두 개를 ‘기준’과 ‘대상’으로 고르면 직접 비교할 수 있어요"));
    const go = button("두 버전 비교", "pri", () => {
      const [a, b] = st.a < st.b ? [st.a, st.b] : [st.b, st.a];
      showDiff(a, b);
    });
    go.disabled = !ready;
    bar.append(go);
    return bar;
  }

  function paint() {
    const { items, truncated } = st.data;
    if (!items.length) { host.replaceChildren(el("div", "rcp-empty", "수집한 버전이 아직 없어요.")); return; }
    const list = el("ol", "rcp-timeline");
    const pair = pairBar();
    for (const it of items) {
      const li = el("li", "rcp-tl" + (it.is_current ? " cur" : ""));
      li.append(el("span", "rcp-tl-dot"));
      const body = el("div", "rcp-tl-body");
      const top = el("div", "rcp-tl-top");
      top.append(el("b", "", formatStamp(it.collected_at)), el("span", "mono", it.content_hash.slice(0, 8)), statusBadge(it.parse_status));
      if (it.is_current) top.append(el("span", "rcp-cur", "현재 버전"));
      const sum = el("p", "rcp-tl-sum", summaryText(it.summary));
      const s = it.summary;
      const meta = [`파라미터 ${num(it.param_count)}개`, `파일 ${num(it.file_count)}개`];
      if (s?.type_changed) meta.push(`값 종류 바뀜 ${s.type_changed}`);
      if (s?.within_tolerance) meta.push(`허용오차 이내 ${s.within_tolerance}`);
      if (s?.files_added || s?.files_removed || s?.files_changed) {
        meta.push(`파일 변경 ${(s.files_added ?? 0) + (s.files_removed ?? 0) + (s.files_changed ?? 0)}`);
      }
      const acts = el("div", "rcp-tl-acts");
      if (it.previous_id) {
        const d = button("이전 버전과 비교", "", () => showDiff(it.previous_id, it.id));
        d.prepend(svg("rows"));
        acts.append(d);
      }
      const pick = (key, label) => {
        const c = el("button", "chip", label);
        c.type = "button";
        c.setAttribute("aria-pressed", String(st[key] === it.id));
        c.setAttribute("aria-label", `${formatStamp(it.collected_at)} 버전을 비교 ${label}로 고르기`);
        c.addEventListener("click", () => {
          st[key] = st[key] === it.id ? null : it.id;
          if (st.a && st.a === st.b) st[key === "a" ? "b" : "a"] = null;
          paint();
        });
        return c;
      };
      acts.append(pick("a", "기준"), pick("b", "대상"));
      body.append(top, sum, el("p", "rcp-tl-meta", meta.join(" · ")), acts);
      li.append(body);
      list.append(li);
    }
    const parts = [pair, list];
    if (truncated) parts.push(el("p", "mos-hint", "오래된 버전은 줄여서 보여요."));
    host.replaceChildren(...parts);
  }

  async function showDiff(a, b) {
    host.replaceChildren(skeleton(4));
    try {
      renderDiff(host, await api.recipeDiff(recipeId, a, b), () => paint());
    } catch (e) {
      host.replaceChildren(errorState(e.message, () => paint()));
    }
  }

  api.recipeHistory(recipeId).then((d) => { st.data = d; paint(); })
    .catch((e) => host.replaceChildren(errorState(e.message, () => renderHistory(host, recipeId))));
}

function renderDiff(host, data, back) {
  const st = { status: "", query: "" };
  const { a, b, summary, rows } = data;
  const head = el("div", "rcp-diffhead");
  const backBtn = button("이력으로", "", back);
  backBtn.prepend(svg("clock"));
  const title = el("div", "grow");
  title.append(el("b", "", `${formatStamp(a.collected_at)} → ${formatStamp(b.collected_at)}`),
    el("span", "rcp-meta", `버전 ${a.content_hash.slice(0, 8)} → ${b.content_hash.slice(0, 8)}`));
  head.append(backBtn, title);

  const stats = el("div", "rcp-diffstats");
  const stat = (n, label, mark) => {
    const s = el("span", "rcp-dstat" + (n ? " on" : ""));
    s.append(el("i", "", mark), el("b", "", num(n)), document.createTextNode(` ${label}`));
    return s;
  };
  stats.append(stat(summary.added, "추가", "＋"), stat(summary.removed, "삭제", "－"), stat(summary.changed, "변경", "≠"));
  const extra = [];
  if (summary.type_changed) extra.push(`값 종류 바뀜 ${summary.type_changed}`);
  if (summary.within_tolerance) extra.push(`허용오차 이내라 같게 본 항목 ${summary.within_tolerance}`);
  if (summary.files_added || summary.files_removed || summary.files_changed) {
    extra.push(`파일 추가 ${summary.files_added} · 삭제 ${summary.files_removed} · 내용 바뀜 ${summary.files_changed}`);
  }
  if (extra.length) stats.append(el("span", "rcp-meta", extra.join(" · ")));

  const tools = el("div", "rcp-tools rcp-ctools");
  const chips = chipRow([["", "모든 변경"], ["added", "추가"], ["removed", "삭제"], ["changed", "변경"]], st.status, (v) => {
    st.status = v;
    for (const c of chips.children) c.setAttribute("aria-pressed", String(c.dataset.value === v));
    refill();
  });
  chips.setAttribute("aria-label", "변경 종류");
  const count = el("span", "rcp-count");
  count.setAttribute("role", "status");
  let shown = rows;
  const copy = button("복사 (TSV)", "", () => copyText(diffTSV(shown), `${num(shown.length)}행을 복사했어요`));
  copy.prepend(svg("copy"));
  tools.append(chips, searchBox("경로·이름·값 찾기", "", (v) => { st.query = v; refill(); }), count, copy);

  const table = createVTable({
    columns: [{ label: "상태", width: "86px" }, { label: "이름 · 경로", width: "minmax(180px, 1.4fr)" },
      { label: "이전 값", width: "minmax(110px, 1fr)" }, { label: "새 값", width: "minmax(110px, 1fr)" },
      { label: "그룹", width: "minmax(80px, .6fr)" }],
    ariaLabel: "바뀐 파라미터", minWidth: 520,
    render(item, row) {
      const r = item;
      const [label, mark] = DIFF_STATUS[r.status];
      const cell = (cls, ...kids) => { const d = el("div", `vt-td ${cls}`); d.setAttribute("role", "gridcell"); d.append(...kids); return d; };
      const state = cell(`vt-st ${r.status}`, el("i", "vt-mark", mark), document.createTextNode(label));
      const name = cell("vt-name", el("b", "", r.label || r.path), ...(r.label ? [el("span", "vt-sub", r.path)] : []));
      name.title = `${r.file} · ${r.path}`;
      const unit = r.unit ? ` ${r.unit}` : "";
      const oldV = cell("vt-val old" + (r.status === "added" ? " miss" : ""), el("span", "", r.old === null ? "—" : `${r.old}${unit}`));
      const newV = cell("vt-val new" + (r.status === "removed" ? " miss" : ""), el("span", "", r.new === null ? "—" : `${r.new}${unit}`));
      if (r.status === "changed") {
        const bits = [];
        if (r.type_changed) bits.push("값 종류가 바뀜");
        if (r.delta !== null) bits.push(`${fmt(r.delta, true)} 변화`);
        if (bits.length) newV.title = bits.join(" · ");
        if (r.delta !== null) newV.append(el("span", "vt-delta", fmt(r.delta, true)));
      }
      row.append(state, name, oldV, newV, cell("", el("span", "", r.group)));
    },
  });

  function refill() {
    shown = filterDiffRows(rows, st);
    count.textContent = shown.length === rows.length ? `${num(rows.length)}건` : `${num(shown.length)} / ${num(rows.length)}건`;
    table.setItems(shown, rows.length ? "조건에 맞는 변경이 없어요." : "두 버전의 파라미터가 같아요 (허용오차 이내 포함).");
  }
  refill();
  host.replaceChildren(head, stats, tools, table.el,
    el("p", "mos-hint rcp-legend", "＋ 새로 생김 · － 없어짐 · ≠ 값이 달라짐 · 숫자 항목은 매핑 파일의 허용오차 이내면 같은 값으로 봐요"));
}
