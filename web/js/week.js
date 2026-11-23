// Weekly journal (P2B-05): Monday..Sunday day blocks in the shared line editor + 계획 / 납기 / 날짜 없음 lists.
// Drop a task on a day to plan it there; the undo toast restores the previous day.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { enableDayDrops, mountDay } from "./dayeditor.js";
import { taskRow } from "./taskrow.js";
import { addDays, debounce, el, emptyState, errorState, fmtMD, mondayOf, parseISO, skeleton, store, svg, todayISO, WD } from "./ui.js";

const TABS = [["plan", "계획"], ["due", "납기"], ["inbox", "날짜 없음"]];

// start: any date inside the wanted week (YYYY-MM-DD), default today. onNavigate(startISO) changes the route.
export async function renderWeek(container, start, onNavigate) {
  const today = todayISO();
  const monday = mondayOf(start || today);
  const sunday = addDays(monday, 6);
  let weekends = store.get("mi.week.weekends", true);
  let tab = store.get("mi.week.tab", "plan");
  let lists = { plan: [], due: [], inbox: [] };
  const days = [...Array(7)].map((_, i) => addDays(monday, i));

  container.replaceChildren(skeleton(6));
  let contents = {};
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];

  async function fetchAll() {
    const [journals, plan, due, inbox, all] = await Promise.all([
      Promise.all(months.map((m) => api.journal(m))),
      api.todos({ planned_from: monday, planned_to: sunday }),
      api.todos({ due_from: monday, due_to: sunday, open_only: true }),
      api.todos({ unplanned: true, open_only: true }),
      api.todos({ status: "todo,doing,hold" }),
    ]);
    contents = {};
    for (const j of journals) { Object.assign(contents, j.days); hub.putTasks(j.tasks); }
    lists = { plan: plan.items, due: due.items, inbox: inbox.items };
    for (const k of Object.keys(lists)) hub.putTasks(lists[k]);
    hub.setRequesters(all.requesters);
  }

  try {
    await fetchAll();
  } catch (e) {
    container.replaceChildren(errorState(e.message, () => renderWeek(container, start, onNavigate)));
    return;
  }

  const hero = el("div", "hero");
  const grow = el("div", "grow");
  const title = el("h1", "h1", `${fmtMD(monday)} – ${fmtMD(sunday)}`);
  const lead = el("p", "lead");
  lead.append(`${monday.slice(0, 4)}년 · 일지를 바로 쓰거나 오른쪽 할일을 원하는 날짜에 끌어 놓으세요.`);
  grow.append(el("div", "eyebrow", "주간 일지"), title, lead);
  const go = (label, target, aria) => {
    const b = el("button", "btn", label);
    b.type = "button";
    if (aria) b.setAttribute("aria-label", aria);
    b.addEventListener("click", () => onNavigate(target));
    return b;
  };
  const wk = el("button", "chip");
  wk.type = "button";
  wk.append("주말 표시");
  wk.addEventListener("click", () => { weekends = !weekends; store.set("mi.week.weekends", weekends); paintDays(); });
  const nav = el("div", "hero-actions");
  nav.append(go("이전 주", addDays(monday, -7)), go("이번 주", today), go("다음 주", addDays(monday, 7)));
  hero.append(grow, nav);

  const dayHost = el("div", "wdays");
  const left = el("section", "panel");
  const lhead = el("div", "panel-head");
  const lh = el("h2");
  lh.append(svg("cal"), "요일별 기록");
  lhead.append(lh, wk);
  left.append(lhead, dayHost);

  const tabs = el("div", "tabs");
  tabs.setAttribute("role", "tablist");
  const listBox = el("div", "tlist");
  const right = el("section", "panel week-work");
  const rhead = el("div", "panel-head");
  const rh = el("h2");
  rh.append(svg("todo"), "이번 주 할일");
  rhead.append(rh);
  const rfoot = el("div", "panel-foot");
  rfoot.append(el("span", "", "끌어서 날짜 칸에 놓기 = 하기로 한 날"), el("span", "", "납기는 그대로"));
  right.append(rhead, tabs, listBox, rfoot);

  const grid = el("div", "tgrid week");
  const lc = el("div"); lc.append(left);
  const rc = el("div"); rc.append(right);
  grid.append(lc, rc);
  container.replaceChildren(hero, grid);
  enableDayDrops(container);

  function paintDays() {
    wk.setAttribute("aria-pressed", String(weekends));
    // the editors of the previous paint are gone: forget them so the hub never writes into detached editors
    hub.clearDays();
    dayHost.replaceChildren(...days.slice(0, weekends ? 7 : 5).map((d) => {
      const blk = el("section", "wday" + (d === today ? " today" : ""));
      blk.dataset.day = d;
      const head = el("header");
      const dt = parseISO(d);
      const b = el("b");
      b.append(el("span", "wd-date", `${dt.getMonth() + 1}.${String(dt.getDate()).padStart(2, "0")}`), ` ${WD[dt.getDay()]}요일`);
      if (d === today) b.append(el("span", "pill cyan", "오늘"));
      const ex = el("button", "btn quiet sm", "확대");
      ex.type = "button";
      ex.title = "이 날짜를 오른쪽에 크게 열기";
      const host = el("div", "wday-body");
      head.append(b, ex);
      blk.append(head, host);
      const ctl = mountDay(host, d, contents[d] || "", { placeholder: "눌러서 쓰기" });
      ex.addEventListener("click", () => ctl.expand());
      return blk;
    }));
  }

  function paintTabs() {
    tabs.replaceChildren(...TABS.map(([k, label]) => {
      const b = el("button", "", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(tab === k));
      b.append(el("small", "", String(lists[k].length)));
      b.addEventListener("click", () => { tab = k; store.set("mi.week.tab", k); paintTabs(); });
      return b;
    }));
    const rows = lists[tab];
    const empty = {
      plan: { title: "이 주에 계획한 할일이 없어요", desc: "날짜 없음 탭에서 끌어 놓거나 일지에 ☐ 줄을 쓰세요.", icon: "cal" },
      due: { title: "이 주에 납기인 할일이 없어요", icon: "clock" },
      inbox: { title: "날짜 없는 할일이 없어요", desc: "모든 할일이 날짜에 배치되었어요.", icon: "check" },
    }[tab];
    listBox.replaceChildren(...(rows.length
      ? rows.map((t) => taskRow(t, { drag: true, showPlanned: tab !== "plan" }))
      : [emptyState(empty)]));
  }

  const refresh = debounce(async () => {
    try { await fetchAll(); } catch { return; }
    paintTabs();
  }, 60);
  function onHub(info) { if (info.kind === "task" || info.kind === "day") refresh(); }

  hub.on(onHub);
  paintDays();
  paintTabs();
}
