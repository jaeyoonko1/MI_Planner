// Today (P2B-05): today's journal beside what needs attention. Same hub, same task rows.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { mountDay } from "./dayeditor.js";
import { taskRow } from "./taskrow.js";
import { debounce, el, emptyState, errorState, parseISO, skeleton, svg, WD } from "./ui.js";

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

export async function renderToday(container) {
  let tab = "due";
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
    view.replaceChildren(hero, grid);
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
  }

  const reload = debounce(() => load(false), 60);
  hub.on((info) => { if (info.kind === "task" || info.kind === "day") reload(); });
  try { await load(true); } catch { return null; }
  return editor;
}
