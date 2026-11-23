// Monthly journal (P2B-05): columns = weeks, rows = weekdays, cells are shared line editors.
// The tray on the right lists tasks without a date; drop one on a cell to plan it (undo in the toast).
import { api } from "./api.js";
import { hub } from "./hub.js";
import { enableDayDrops, mountDay } from "./dayeditor.js";
import { editorKeys } from "./lineeditor.js";
import { taskRow } from "./taskrow.js";
import { addDays, debounce, el, emptyState, errorState, fmtMD, iso, mondayOf, skeleton, store, svg, todayISO, WD } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Weeks (Mon-start) covering the month; each week is 7 ISO dates.
function weeksOf(month) {
  const [y, m] = month.split("-").map(Number);
  const first = iso(new Date(y, m - 1, 1));
  const last = iso(new Date(y, m, 0));
  const weeks = [];
  for (let d = mondayOf(first); d <= last; d = addDays(d, 7)) weeks.push([...Array(7)].map((_, i) => addDays(d, i)));
  return weeks;
}

function switchBtn(label, on, onClick) {
  const b = el("button", "chip");
  b.type = "button";
  b.setAttribute("aria-pressed", String(on));
  b.append(...[].concat(label));
  b.addEventListener("click", onClick);
  return b;
}

// onNavigate(month) opens another month page (the app creates it first).
export async function renderJournal(container, month, onNavigate) {
  const today = todayISO();
  const [y, m] = month.split("-").map(Number);
  let showWeekend = store.get("mi.month.weekends", false);
  let showTray = store.get("mi.month.tray", true);
  container.replaceChildren(skeleton(8));

  let data, autoData, unplanned;
  async function fetchAll() {
    const [d, a, u, all] = await Promise.all([
      api.journal(month), api.journalAuto(month),
      api.todos({ unplanned: true, open_only: true }),
      api.todos({ status: "todo,doing,hold" }),
    ]);
    data = d; autoData = a; unplanned = u.items;
    hub.putTasks(d.tasks);
    hub.putTasks(unplanned);
    hub.setRequesters(all.requesters);
  }
  try {
    await fetchAll();
  } catch (e) {
    container.replaceChildren(errorState(e.message, () => renderJournal(container, month, onNavigate)));
    return;
  }

  const hero = el("div", "hero");
  const grid = el("div", "jgrid");
  const scroll = el("div", "jscroll");
  scroll.append(grid);
  const layout = el("div", "jlayout");
  const trayBox = el("aside", "tray");
  const trayList = el("div", "tlist");

  function paintHero() {
    const grow = el("div", "grow");
    const lead = el("p", "lead");
    lead.append("칸에 바로 쓰세요. ", el("b", "", "☐ ☑ ★ ! 줄 = 할일"), " (Ctrl+1) · 오른쪽 할일을 칸에 끌어 놓으면 그날로 옮겨져요.");
    grow.append(el("div", "eyebrow", "월간 일지"), el("h1", "h1", `${y}년 ${m}월`), lead);
    const step = (label, delta, aria) => {
      const b = el("button", "btn", label);
      b.type = "button";
      b.setAttribute("aria-label", aria);
      b.addEventListener("click", () => onNavigate(delta === 0 ? todayISO().slice(0, 7) : shiftMonth(month, delta)));
      return b;
    };
    const tools = el("div", "hero-actions");
    tools.append(
      step("이전 달", -1, "이전 달"), step("이번 달", 0, "이번 달"), step("다음 달", 1, "다음 달"),
    );
    const opts = el("div", "chips hero-chips");
    opts.append(
      switchBtn("주말", showWeekend, () => { showWeekend = !showWeekend; store.set("mi.month.weekends", showWeekend); paintHero(); paintGrid(); }),
      switchBtn([svg("todo", "i s"), `날짜 없는 할일 ${unplanned.length}`], showTray, () => { showTray = !showTray; store.set("mi.month.tray", showTray); paintHero(); paintLayout(); }),
      switchBtn("납기 표시", autoData.enabled, async () => {
        try {
          await api.putSetting("journal_auto_show", autoData.enabled ? "off" : "on");
          autoData = await api.journalAuto(month);
          paintHero(); paintGrid();
        } catch (e) { import("./toast.js").then(({ toast }) => toast(e.message, { error: true })); }
      }),
      switchBtn("줄 단축키", editorKeys.on, () => { editorKeys.set(!editorKeys.on); paintHero(); }),
    );
    hero.replaceChildren(grow, tools, opts);
  }

  function autoBox(key) {
    const items = autoData.days?.[key] || [];
    if (!items.length) return null;
    const box = el("div", "jauto");
    box.title = "납기 할일 (자동 표시, 일지 파일에는 저장되지 않아요)";
    for (const t of items) box.append(el("div", key < today ? "jauto-item late" : "jauto-item", `⏰ ${t.title}`));
    return box;
  }

  function paintGrid() {
    hub.clearDays();
    const weeks = weeksOf(month);
    const rows = showWeekend ? 7 : 5;
    grid.style.gridTemplateColumns = `40px repeat(${weeks.length}, minmax(168px, 1fr))`;
    const cells = [el("div", "jh")];
    weeks.forEach((w, i) => {
      const h = el("div", "jh" + (w[0] <= today && today <= w[6] ? " cur" : ""));
      h.append(el("b", "", `${i + 1}주차`), `${fmtMD(w[0])} – ${fmtMD(w[rows - 1])}`);
      cells.push(h);
    });
    for (let r = 0; r < rows; r++) {
      cells.push(el("div", "jd" + (r >= 5 ? " weekend" : ""), WD[(r + 1) % 7]));
      for (const week of weeks) {
        const key = week[r];
        const inMonth = key.slice(0, 7) === month;
        const cell = el("div", "jc" + (inMonth ? "" : " out") + (key === today ? " today" : "") + (r >= 5 ? " weekend" : ""));
        const dn = el("span", "dn", String(Number(key.slice(8))));
        if (key === today) dn.setAttribute("aria-label", `오늘 ${dn.textContent}일`);
        cell.append(dn);
        if (inMonth) {
          cell.dataset.day = key;
          const host = el("div", "jcell-view");
          cell.append(host);
          mountDay(host, key, data.days[key] || "");
          const a = autoBox(key);
          if (a) cell.append(a);
        }
        cells.push(cell);
      }
    }
    grid.replaceChildren(...cells);
  }

  function paintTray() {
    trayList.replaceChildren(...(unplanned.length
      ? unplanned.map((t) => taskRow(t, { drag: true, showPlanned: false }))
      : [emptyState({ title: "모두 배치됨", desc: "날짜 없는 할일이 없어요.", icon: "check" })]));
    const count = trayBox.querySelector(".panel-head small");
    if (count) count.textContent = String(unplanned.length);
  }

  function buildTray() {
    const panel = el("section", "panel");
    const head = el("div", "panel-head");
    const h = el("h2");
    h.append(svg("todo"), "날짜 없는 할일 ", el("small", "", String(unplanned.length)));
    head.append(h);
    const foot = el("div", "panel-foot");
    foot.append(el("span", "", "칸에 끌어 놓기 = 하기로 한 날"));
    panel.append(head, trayList, foot);
    trayBox.replaceChildren(panel);
  }

  function paintLayout() {
    layout.classList.toggle("no-tray", !showTray);
    layout.replaceChildren(scroll, ...(showTray ? [trayBox] : []));
  }

  const refresh = debounce(async () => {
    try { await fetchAll(); } catch { return; }
    paintHero();
    paintTray();
    // cells only change through the hub (applyDays), but the 납기 boxes follow the tasks
    grid.querySelectorAll(".jauto").forEach((n) => n.remove());
    grid.querySelectorAll(".jc[data-day]").forEach((c) => { const a = autoBox(c.dataset.day); if (a) c.append(a); });
  }, 60);
  hub.on((info) => { if (info.kind === "task" || info.kind === "day") refresh(); });

  paintHero();
  paintGrid();
  buildTray();
  paintTray();
  paintLayout();
  container.replaceChildren(hero, layout);
  enableDayDrops(container);
}
