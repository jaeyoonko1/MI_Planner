// Today (P2B-05): today's journal beside what needs attention. Same hub, same task rows.
import { api } from "./api.js";
import { formatWait, formatThreshold } from "./eval-wait-model.js";
import { hub } from "./hub.js";
import { mountDay } from "./dayeditor.js";
import { taskRow } from "./taskrow.js";
import { chipRow, debounce, el, emptyState, errorState, parseISO, skeleton, svg, WD } from "./ui.js";
import { pageHash } from "./wikilinks.js";

const TABS = [["due", "납기 임박"], ["mark", "★ ! 중요"], ["plan", "오늘 일지"]];

function panelHead(icon, title, ...extra) {
  const h = el("div", "panel-head");
  const t = el("h2");
  t.append(svg(icon), title);
  h.append(t, ...extra);
  return h;
}

function link(href, label, iconId) {
  const a = el("a", "btn");
  a.href = href;
  if (iconId) a.append(svg(iconId, "i s"));
  a.append(label);
  return a;
}

// "밀린 단계" (P4-08): the evaluation cells waiting longest past their stage's warn_hours (P4-06). Click -> board, cell selected.
function stalledPanel(data, filter, onFilter) {
  const info = data.evaluations_stalled || { total: 0, levels: {}, limit: 0 };
  const items = data.evaluations || [];
  const shown = filter === "severe" ? items.filter((item) => item.warn === 2) : items;
  const section = el("section", "panel stall");
  section.setAttribute("aria-label", "밀린 평가 단계");
  const counts = el("span", "stall-counts");
  if (info.levels["2"]) counts.append(el("b", "wn2", `심각 ${info.levels["2"]}칸`));
  if (info.levels["1"]) counts.append(el("b", "wn1", `경고 ${info.levels["1"]}칸`));
  const filters = chipRow([["all", "전체"], ["severe", "심각만"]], filter, onFilter);
  filters.setAttribute("aria-label", "밀린 단계 보기");
  const all = el("a", "btn quiet sm", "평가 현황판");
  all.href = "#/evaluations";
  all.append(svg("chev", "i s"));
  section.append(panelHead("clock", "밀린 단계", counts, ...(info.total ? [filters] : []), all));
  if (!shown.length) {
    const none = el("p", "stall-empty");
    none.append(svg("check", "i s"), el("b", "", info.total ? "심각하게 밀린 단계는 없어요" : "밀린 단계가 없어요"),
      el("span", "", info.total ? "‘전체’로 바꾸면 경고 단계도 볼 수 있어요." : "진행 중인 평가에서 기준 시간을 넘긴 칸이 생기면 여기에 모여요."));
    section.append(none);
    return section;
  }
  const list = el("ul", "stall-list");
  for (const item of shown) {
    const li = el("li");
    const a = el("a", "stall-row w" + item.warn);
    a.href = item.page_path ? `${pageHash(item.page_path)}?cell=${item.cell_id}` : "#/evaluations";
    const wafer = item.wafer_no ? ` · ${item.wafer_no}` : "";
    a.setAttribute("aria-label", `${item.warn === 2 ? "심각" : "경고"}, ${item.equipment} ${item.lot_no}${wafer}, ${item.stage_label} 단계 ${formatWait(item.wait_h)} 대기, 현황판에서 열기`);
    const badge = el("span", "stall-badge");
    badge.append(svg(item.warn === 2 ? "alert" : "clock", "i s"), item.warn === 2 ? "심각" : "경고");
    const what = el("span", "stall-what");
    what.append(el("b", "", `${item.equipment} · ${item.lot_no}${wafer}`), el("small", "", `${item.evaluation_name} · ${item.stage_label}`));
    const wait = el("span", "stall-wait");
    wait.append(el("b", "", formatWait(item.wait_h)), el("small", "", item.warn_hours ? `기준 ${formatThreshold(item.warn_hours)}` : ""));
    a.append(badge, what, wait, svg("chev", "i s go"));
    li.append(a);
    list.append(li);
  }
  section.append(list);
  if (shown.length > 5) {
    // Narrow windows show the top five first (CSS); this chip reveals the rest.
    const more = el("button", "chip stall-more", `나머지 ${shown.length - 5}칸 보기`);
    more.type = "button";
    more.setAttribute("aria-pressed", "false");
    more.addEventListener("click", () => {
      const open = section.classList.toggle("open");
      more.setAttribute("aria-pressed", String(open));
      more.textContent = open ? "접기" : `나머지 ${shown.length - 5}칸 보기`;
    });
    section.append(more);
  }
  if (info.total > items.length) section.append(el("div", "panel-foot", `오래 기다린 순 상위 ${items.length}칸 · 전체 ${info.total}칸은 평가 현황판에서 확인해요`));
  return section;
}

export async function renderToday(container) {
  let tab = "due";
  let stallFilter = "all";
  const stallHost = el("div", "stall-host");
  let data = null;
  let editor = null;
  const view = el("div", "page");
  container.replaceChildren(view, skeleton(6));

  const listBox = el("div", "tlist");
  const tabs = el("div", "tabs");
  tabs.setAttribute("role", "tablist");

  function sets() {
    const open = (a) => a.filter((t) => t.status !== "done");
    const due = [...data.overdue, ...data.due_soon.filter((t) => !data.overdue.some((o) => o.id === t.id))]
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    return { due: open(due), mark: data.marked, plan: data.planned_all };
  }

  function paintRight() {
    const s = sets();
    tabs.replaceChildren(...TABS.map(([k, label]) => {
      const b = el("button", "", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(tab === k));
      b.append(el("small", "", String(s[k].length)));
      b.addEventListener("click", () => { tab = k; paintRight(); });
      return b;
    }));
    const rows = s[tab];
    const empty = {
      due: { title: "임박한 납기가 없어요", desc: "3일 안에 끝내야 하는 일이 생기면 여기에 모여요.", icon: "cal" },
      mark: { title: "★ ! 로 표시한 일이 없어요", desc: "일지 줄에서 Ctrl+1로 ★ 또는 !를 고르면 모아 보여 줘요.", icon: "star" },
      plan: { title: "오늘 일지에 할일이 없어요", desc: "왼쪽 일지에 ☐ 줄을 쓰면 바로 이슈가 돼요.", icon: "todo" },
    }[tab];
    listBox.replaceChildren(...(rows.length ? rows.map((t) => taskRow(t, { drag: false, showPlanned: tab !== "plan" })) : [emptyState(empty)]));
    paintHero();
  }

  const hero = el("div", "hero");
  function paintHero() {
    const [y, m, d] = data.date.split("-").map(Number);
    const wd = WD[parseISO(data.date).getDay()];
    const grow = el("div", "grow");
    const late = data.overdue.length;
    const plan = data.planned_all;
    const doneN = plan.filter((t) => t.status === "done").length;
    const lead = el("p", "lead");
    if (late) lead.append(el("b", "r", `납기 지난 일 ${late}개`), "부터. ");
    lead.append(`오늘 일지에 할일 `, el("b", "", String(plan.length - doneN)), "개 · 완료 ", el("b", "", String(doneN)));
    grow.append(el("div", "eyebrow", `${y}년 ${m}월 ${d}일 ${wd}요일`), el("h1", "h1", "오늘"), lead);
    hero.replaceChildren(grow, link("#/week", "주간 일지"), link(`#/month`, "월간 일지", "cal"), link("#/todos", "할일 목록", "todo"));
  }

  function build() {
    const left = el("section", "panel");
    const body = el("div", "panel-body");
    const status = el("span", "jstatus");
    editor = mountDay(body, data.date, data.journal, {
      toolbar: true,
      placeholder: "오늘 할 일을 불렛으로 쭉 쓰세요 — Tab으로 구조화, Ctrl+1로 ☐ ☑ ★ !",
      onState: (k, msg) => { status.dataset.k = k; status.textContent = msg; },
    });
    const foot = el("div", "panel-foot");
    foot.append(el("span", "", "☐ ☑ ★ ! 줄은 할일 목록·주간·월간과 같은 이슈예요"), el("span", "grow"), status);
    left.append(panelHead("cal", "오늘 일지"), body, foot);

    const right = el("section", "panel");
    const rfoot = el("div", "panel-foot");
    rfoot.append(el("span", "", "클릭 · 이름 바꾸기"), el("span", "", "더블클릭 · 상세"), el("span", "", "체크 → 일지에도 ☑"));
    right.append(panelHead("flag", "지금 챙길 일", (() => { const a = el("a", "btn quiet sm", "전체"); a.href = "#/todos"; a.append(svg("chev", "i s")); return a; })()), tabs, listBox, rfoot);

    const grid = el("div", "tgrid");
    const l = el("div"); l.append(left);
    const r = el("div"); r.append(right);
    grid.append(l, r);
    view.replaceChildren(hero, stallHost, grid);
    paintStall();
  }

  function paintStall() {
    stallHost.replaceChildren(stalledPanel(data, stallFilter, (value) => { stallFilter = value; paintStall(); }));
  }

  async function load(first) {
    try {
      const d = await api.today();
      hub.putTasks(d.tasks);
      hub.setRequesters(d.requesters);
      hub.putTasks([...d.planned_all, ...d.marked, ...d.overdue, ...d.due_soon]);
      data = d;
    } catch (e) {
      if (first) { container.replaceChildren(errorState(e.message, () => renderToday(container))); throw e; }
      return;
    }
    if (first) { container.replaceChildren(view); build(); }
    paintRight();
    paintStall();
  }

  const reload = debounce(() => load(false), 60);
  hub.on((info) => { if (info.kind === "task" || info.kind === "day") reload(); });
  try { await load(true); } catch { return null; }
  return editor;
}
