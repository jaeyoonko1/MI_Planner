// Recipe comparison (P6-04): a basket of 2-6 recipes, then a side-by-side parameter table. Read-only.
// Differences are shown with a marker and text (≠ / ∅), never by color alone.
import { api } from "./api.js";
import {
  cellMarker, cellText, cellTitle, compareTSV, filterCompareRows, MAX_COLUMNS, MIN_COLUMNS, toggleBasket,
  withGroupHeaders,
} from "./rcp-compare-model.js";
import { formatStamp } from "./rcp-model.js";
import { createVTable } from "./rcp-vtable.js";
import { button, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, errorState, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");

// ---- basket (kept while the user moves between sources) ----------------------------------------------------------

let basket = [];
const listeners = new Set();
const emit = () => listeners.forEach((f) => f());

export function inBasket(id) { return basket.some((b) => b.id === id); }

export function toggleInBasket(item) {
  const r = toggleBasket(basket, item);
  basket = r.basket;
  if (r.full) toast(`비교는 최대 ${MAX_COLUMNS}개까지 담을 수 있어요`);
  emit();
  return !r.full;
}

/** Toggle chip put in each recipe row. aria-pressed mirrors the basket. */
export function basketChip(recipe) {
  const item = { id: recipe.id, name: recipe.name };
  const b = el("button", "chip rcp-pick");
  b.type = "button";
  const paint = () => {
    const on = inBasket(item.id);
    b.setAttribute("aria-pressed", String(on));
    b.textContent = on ? "담김" : "담기";
    b.prepend(svg(on ? "check" : "plus"));
    b.setAttribute("aria-label", `${recipe.name} 비교에 ${on ? "담김 (누르면 빼기)" : "담기"}`);
  };
  b.addEventListener("click", () => { toggleInBasket(item); });
  paint();
  const f = () => { if (b.isConnected) paint(); else listeners.delete(f); };
  listeners.add(f);
  return b;
}

/** The bar under the recipe table: chosen recipes (removable), compare / clear buttons. */
export function basketBar() {
  const bar = el("div", "rcp-basket");
  bar.setAttribute("role", "region");
  bar.setAttribute("aria-label", "비교할 레시피");
  const paint = () => {
    bar.hidden = basket.length === 0;
    const names = el("div", "rcp-basket-names");
    for (const b of basket) {
      const x = el("button", "chip rcp-bname", b.name);
      x.type = "button";
      x.title = "비교에서 빼기";
      x.setAttribute("aria-label", `${b.name} 비교에서 빼기`);
      x.append(svg("x"));
      x.addEventListener("click", () => toggleInBasket(b));
      names.append(x);
    }
    const hint = el("span", "rcp-basket-hint", basket.length < MIN_COLUMNS
      ? `${MIN_COLUMNS}개 이상 담으면 비교할 수 있어요` : `${basket.length}/${MAX_COLUMNS}개 담음`);
    hint.setAttribute("role", "status");
    const go = button("비교하기", "pri", () => openCompare([...basket]));
    go.prepend(svg("grid"));
    go.disabled = basket.length < MIN_COLUMNS;
    const clear = button("비우기", "", () => { basket = []; emit(); });
    bar.replaceChildren(el("b", "", "비교 담기"), names, hint, clear, go);
  };
  paint();
  const f = () => { if (bar.isConnected) paint(); else listeners.delete(f); };
  listeners.add(f);
  return bar;
}

// ---- helpers shared with the history view ------------------------------------------------------------------------

export async function copyText(text, doneMessage) {
  try {
    await navigator.clipboard.writeText(text);
    toast(doneMessage);
  } catch {
    const ta = el("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.append(ta);
    ta.select();
    try { document.execCommand("copy"); toast(doneMessage); } catch { toast("복사하지 못했어요", { error: true }); }
    ta.remove();
  }
}

export function searchBox(label, value, onInput) {
  const s = el("input", "rcp-search");
  s.type = "search";
  s.placeholder = label;
  s.autocomplete = "off";
  s.value = value;
  s.setAttribute("aria-label", label);
  s.addEventListener("input", () => onInput(s.value));
  s.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && s.value) { s.value = ""; onInput(""); e.stopPropagation(); }
  });
  return s;
}

// ---- comparison sheet --------------------------------------------------------------------------------------------

export function openCompare(items, { snapshots = {} } = {}) {
  const sheet = openSheet({
    title: "레시피 비교", wide: true,
    sub: "첫 번째 열이 기준이에요. 설비의 레시피는 바꾸지 않아요 (읽기 전용)",
  });
  sheet.dlg.classList.add("rcp-sheet", "rcp-compare");
  const close = button("닫기", "", () => sheet.close());
  sheet.foot.append(close);
  sheet.body.append(skeleton(5));
  const ids = items.map((i) => (snapshots[i.id] ? `${i.id}:${snapshots[i.id]}` : String(i.id))).join(",");
  const st = { onlyDiff: true, group: null, query: "" };
  let data = null;
  let shown = [];

  function paint() {
    const { columns, rows, groups, summary, mapping } = data;
    const parts = [];

    const cards = el("div", "rcp-cols");
    cards.style.setProperty("--n", String(columns.length));
    columns.forEach((c, i) => {
      const card = el("div", "rcp-col" + (i === 0 ? " ref" : ""));
      const top = el("div", "rcp-col-top");
      top.append(el("span", "rcp-col-n", i === 0 ? "기준" : `${i + 1}열`), el("b", "", c.name));
      card.append(top, el("span", "rcp-meta", [c.equipment, c.line].filter(Boolean).join(" · ") || c.source),
        el("span", "rcp-meta", `수집 ${formatStamp(c.collected_at)} · 버전 ${c.content_hash.slice(0, 8)}`));
      if (c.parse_status !== "ok") card.append(el("span", "rcp-meta warn", c.parse_status === "unparsed" ? "파싱 안 됨" : "파싱에 문제가 있어요"));
      cards.append(card);
    });
    parts.push(cards);

    const bad = mapping.filter((m) => m.error);
    if (bad.length) {
      const n = el("div", "rcp-note");
      n.append(svg("alert"), el("span", "", `매핑을 쓰지 못해 허용오차 없이 글자 그대로 비교했어요 · ${bad[0].error}`));
      parts.push(n);
    }

    const tools = el("div", "rcp-tools rcp-ctools");
    const mode = chipRow([[true, "다른 것만"], [false, "전체"]], st.onlyDiff, (v) => { st.onlyDiff = v; paint(); });
    mode.setAttribute("aria-label", "표시 범위");
    tools.append(mode, searchBox("경로·이름·값 찾기", st.query, (v) => { st.query = v; refill(); }));
    const count = el("span", "rcp-count");
    count.setAttribute("role", "status");
    const copy = button("복사 (TSV)", "", () => copyText(compareTSV(columns, shown), `${num(shown.length)}행을 복사했어요`));
    copy.prepend(svg("copy"));
    copy.title = "지금 보이는 행을 탭으로 구분해 복사해요. 엑셀에 바로 붙여넣을 수 있어요.";
    const xl = button("엑셀로 저장", "", () => exportXlsx(xl));
    xl.prepend(svg("download"));
    tools.append(count, copy, xl);
    parts.push(tools);

    if (groups.length > 1 || (groups.length === 1 && groups[0].name)) {
      const gchips = chipRow([[null, "모든 그룹"], ...groups.map((g) => [g.name, `${g.name || "기타"} ${num(g.count)}`])], st.group,
        (v) => { st.group = v; paint(); }, "rcp-gchips");
      gchips.setAttribute("aria-label", "그룹");
      parts.push(gchips);
    }

    const cols = [{ label: "이름 · 경로", width: "minmax(220px, 1.5fr)" },
      ...columns.map((c, i) => ({ label: `${i === 0 ? "기준 · " : ""}${c.name}`, width: "minmax(130px, 1fr)", title: c.name }))];
    const table = createVTable({
      columns: cols, ariaLabel: "레시피 파라미터 비교", minWidth: 220 + 130 * columns.length,
      render(item, row) {
        if (item.kind === "group") {
          const g = el("div", "vt-gcell", `${item.text} · ${num(item.count)}개${item.diffs ? ` · 다른 항목 ${num(item.diffs)}` : ""}`);
          g.setAttribute("role", "gridcell");
          row.append(g);
          return;
        }
        const r = item.row;
        const name = el("div", "vt-td vt-name");
        name.setAttribute("role", "gridcell");
        name.title = `${r.file} · ${r.path}`;
        name.append(el("b", "", r.label || r.path), ...(r.label ? [el("span", "vt-sub", r.path)] : []));
        row.append(name);
        r.values.forEach((_, i) => {
          const mark = r.marks[i];
          const td = el("div", "vt-td vt-val" + (mark === "d" ? " diff" : mark === "m" ? " miss" : ""));
          td.setAttribute("role", "gridcell");
          if (mark) {
            td.title = cellTitle(r, i, columns);
            td.setAttribute("aria-label", `${cellText(r, i)} (${td.title})`);
            td.append(el("i", "vt-mark", cellMarker(r, i)));
          }
          td.append(el("span", "", cellText(r, i) + (r.unit && r.values[i] != null ? ` ${r.unit}` : "")));
          row.append(td);
        });
      },
    });
    table.el.classList.add("rcp-vt-compare");

    function refill() {
      shown = filterCompareRows(rows, st);
      const flat = withGroupHeaders(shown);
      const diffCount = shown.filter((r) => r.diff).length;
      count.textContent = `${num(shown.length)}행 · 다른 항목 ${num(diffCount)}${rows.length !== shown.length ? ` (전체 ${num(rows.length)})` : ""}`;
      table.setItems(flat, st.onlyDiff && !st.query.trim() && st.group === null && summary.differing === 0
        ? "선택한 레시피의 파라미터가 모두 같아요 (허용오차 이내 포함)." : "조건에 맞는 항목이 없어요.");
    }
    refill();
    parts.push(table.el);
    parts.push(el("p", "mos-hint rcp-legend",
      "≠ 기준 열과 다른 값 · ∅ 이 레시피에 없는 항목 · 숫자 항목은 매핑 파일의 허용오차 이내면 같은 값으로 봐요 · ↑↓ PageUp/Down으로 이동"));
    sheet.body.replaceChildren(...parts);
  }

  async function exportXlsx(btn) {
    btn.disabled = true;
    try {
      const q = new URLSearchParams({ ids, only_diff: String(st.onlyDiff) });
      if (st.group !== null) q.set("group", st.group);
      if (st.query.trim()) q.set("q", st.query.trim());
      const res = await fetch(`/api/recipe-compare/export.xlsx?${q}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "내보내지 못했어요");
      const url = URL.createObjectURL(await res.blob());
      const a = el("a");
      a.href = url;
      a.download = `recipe-compare-${items.map((i) => i.name).join("_").slice(0, 60).replace(/[\\/:*?"<>|]/g, "_")}.xlsx`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("엑셀 파일을 저장했어요");
    } catch (e) { toast(e.message, { error: true }); }
    btn.disabled = false;
  }

  api.recipeCompare(ids).then((d) => { data = d; paint(); }).catch((e) => {
    sheet.body.replaceChildren(errorState(e.message, () => {}));
  });
}
