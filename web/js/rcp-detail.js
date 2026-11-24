// Recipe detail (P6-03): the current snapshot's files with parse status, and the parsed parameters.
// Read-only: the only action is "다시 파싱", which re-reads the locally cached files with the current mapping.
import { api } from "./api.js";
import { filterParams, formatStamp, groupParams, mappingLine, parseStatus } from "./rcp-model.js";
import { renderHistory } from "./rcp-history.js";
import { button, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, errorState, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");
const MAX_ROWS = 500;

function statusBadge(status) {
  const [label, tone, icon] = parseStatus(status);
  const b = el("span", `mos-badge ${tone}`);
  b.append(svg(icon, "i"), label);
  return b;
}

function notice(text) {
  const n = el("div", "rcp-note");
  n.append(svg("alert"), el("span", "", text));
  return n;
}

export function openRecipeDetail({ recipe, onChanged }) {
  const sheet = openSheet({
    title: recipe.name, wide: true,
    sub: `${recipe.source_name ?? ""}${recipe.equipment ? ` · ${recipe.equipment}` : ""} · 설비의 레시피는 바꾸지 않아요 (읽기 전용)`,
  });
  sheet.dlg.classList.add("rcp-sheet", "rcp-detail");
  const st = { data: null, file: "", query: "", namedOnly: false, view: "params" };
  const close = button("닫기", "", () => sheet.close());
  const reparse = button("다시 파싱", "pri", () => doReparse());
  reparse.prepend(svg("refresh"));
  reparse.title = "이 PC에 받아 둔 원본 파일을 현재 매핑으로 다시 읽어요. 새 버전은 만들어지지 않아요.";
  sheet.foot.append(close, reparse);
  sheet.body.append(skeleton(4));

  async function doReparse() {
    reparse.disabled = true;
    try {
      st.data = await api.reparseRecipeSnapshot(st.data.snapshot.id);
      paint();
      toast("다시 파싱했어요");
      onChanged?.();
    } catch (e) { toast(e.message, { error: true }); }
    reparse.disabled = false;
  }

  function paint() {
    const { snapshot, files, params, parse } = st.data;
    const info = snapshot.parser_info ?? {};
    const top = el("div", "rcp-dmeta");
    top.append(statusBadge(snapshot.parse_status),
      el("span", "", `수집 ${formatStamp(snapshot.collected_at)}`), el("span", "", `파일 ${num(snapshot.file_count)}개`),
      el("span", "", `파라미터 ${num(snapshot.param_count)}개`), el("span", "mono", `버전 ${snapshot.content_hash.slice(0, 8)}`));
    const parts = [top, el("p", "rcp-dmap", mappingLine(parse, info))];
    if (parse?.mapping_error) parts.push(notice(`매핑을 쓰지 못했어요 · ${parse.mapping_error}`));
    else if (parse?.stale) parts.push(notice("매핑이나 파서가 바뀌었어요. ‘다시 파싱’을 누르면 새 설정으로 읽어요."));
    if (info.warning_count) {
      const det = el("details", "rcp-hist");
      det.append(el("summary", "", `확인할 점 ${num(info.warning_count)}건`));
      const ul = el("ul");
      for (const w of info.warnings ?? []) ul.append(el("li", "", w));
      det.append(ul);
      parts.push(det);
    }
    const views = chipRow([["params", "파라미터"], ["history", "변경 이력"]], st.view, (v) => { st.view = v; paint(); });
    views.setAttribute("aria-label", "보기");
    parts.push(views);
    if (st.view === "history") {
      const host = el("div", "rcp-histhost");
      parts.push(host);
      sheet.body.replaceChildren(...parts);
      renderHistory(host, recipe.id);
      return;
    }
    parts.push(fileList(files), paramTable(params, files));
    sheet.body.replaceChildren(...parts);
  }

  function fileList(files) {
    const box = el("section", "rcp-files");
    box.setAttribute("aria-label", "파일별 파싱 결과");
    for (const f of files) {
      const row = el("div", "rcp-file" + (f.error ? " bad" : ""));
      row.append(el("b", "", f.rel_path), el("span", "rcp-meta", f.error ? "" : f.parser ? `${f.parser} 파서` : "파싱 대상 아님 (원본만 보관)"));
      if (f.error) row.append(el("span", "rcp-ferr", f.error));
      box.append(row);
    }
    return box;
  }

  function paramTable(params, files) {
    const wrap = el("section", "rcp-params");
    if (!params.length) {
      wrap.append(el("div", "rcp-empty", "읽어 낸 파라미터가 없어요."));
      return wrap;
    }
    const tools = el("div", "rcp-tools");
    const search = el("input", "rcp-search");
    search.type = "search";
    search.placeholder = "경로·이름·값 찾기";
    search.autocomplete = "off";
    search.setAttribute("aria-label", "파라미터 찾기");
    search.value = st.query;
    const count = el("span", "rcp-count");
    count.setAttribute("role", "status");
    const tail = el("div", "rcp-ptable");
    const parsedFiles = files.filter((f) => params.some((p) => p.file === f.rel_path));
    const multi = parsedFiles.length > 1;
    const fileChips = multi
      ? chipRow([["", "모든 파일"], ...parsedFiles.map((f) => [f.rel_path, f.rel_path])], st.file, (v) => { st.file = v; paint(); })
      : null;
    fileChips?.setAttribute("aria-label", "파일");
    const named = el("button", "chip", "이름 붙은 항목만");
    named.type = "button";
    named.setAttribute("aria-pressed", String(st.namedOnly));
    named.title = "매핑 파일에서 이름을 붙인 파라미터만 보여요";
    named.addEventListener("click", () => { st.namedOnly = !st.namedOnly; named.setAttribute("aria-pressed", String(st.namedOnly)); fill(); });
    tools.append(search, named, count);

    function fill() {
      const rows = filterParams(params, st);
      count.textContent = rows.length === params.length ? `${num(rows.length)}개` : `${num(rows.length)} / ${num(params.length)}개`;
      const table = el("table", "rcp-table");
      const head = el("tr");
      for (const h of ["이름", "값", "단위", "경로"]) { const th = el("th", "", h); th.scope = "col"; head.append(th); }
      const thead = el("thead");
      thead.append(head);
      const tbody = el("tbody");
      for (const [group, list] of groupParams(rows.slice(0, MAX_ROWS))) {
        const gr = el("tr", "grp");
        const gh = el("th", "", group);
        gh.colSpan = 4;
        gh.scope = "colgroup";
        gr.append(gh);
        tbody.append(gr);
        for (const p of list) {
          const tr = el("tr");
          tr.append(el("td", "nm", p.label || p.path), el("td", "val", p.value), el("td", "", p.unit), el("td", "mono", (multi ? `${p.file} · ` : "") + (p.label ? p.path : "")));
          tbody.append(tr);
        }
      }
      table.append(thead, tbody);
      const scroll = el("div", "rcp-scroll");
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", "파싱한 파라미터");
      scroll.append(table);
      tail.replaceChildren(rows.length ? scroll : el("div", "rcp-empty", "찾는 항목이 없어요."));
      if (rows.length > MAX_ROWS) tail.append(el("p", "mos-hint", `앞의 ${MAX_ROWS}개만 보여요. 찾기로 좁혀 보세요.`));
    }
    search.addEventListener("input", () => { st.query = search.value; fill(); });
    fill();
    wrap.append(...(fileChips ? [fileChips] : []), tools, tail);
    return wrap;
  }

  api.recipeSnapshot(recipe.current_snapshot_id).then((data) => { st.data = data; paint(); }).catch((e) => {
    sheet.body.replaceChildren(errorState(e.message, () => {}));
  });
}
