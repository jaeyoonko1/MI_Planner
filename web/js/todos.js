// Todo screen: quick add with detail chips, toggle-chip filters (D-12), shared rows. P2B-05.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { newTaskPage } from "./pagedialog.js";
import { mountQuickAdd } from "./quickadd.js";
import { taskRow } from "./taskrow.js";
import { debounce, el, emptyState, errorState, skeleton, svg } from "./ui.js";

const STATUS = [["todo", "할일"], ["doing", "진행"], ["hold", "보류"], ["done", "완료"]];
const PRIO = [[1, "높음"], [2, "보통"], [3, "낮음"]];
const DUE = [["overdue", "지남"], ["soon", "3일 이내"], ["week", "7일 이내"]];

function chip(label, pressed, onClick, dot) {
  const b = el("button", "chip");
  if (dot) b.append(el("i", "sw"));
  b.append(label);
  b.type = "button";
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", onClick);
  return b;
}

export async function renderTodos(container) {
  // Default view hides finished work.
  const f = { status: new Set(["todo", "doing", "hold"]), priority: new Set(), due: "", requester: "", q: "", by: {} };
  let fields = [];
  let items = [];
  let loadError = null;
  let openCount = 0;

  const hero = el("div", "hero");
  const filters = el("div", "filters");
  const listBox = el("div", "tlist");
  const panel = el("section", "panel");
  const foot = el("div", "panel-foot");
  foot.append(el("span", "", "클릭 · 이름 바꾸기"), el("span", "", "더블클릭 · 상세"), el("span", "", "체크 → 일지 ☑"), el("span", "", "N · 새 할일"));
  panel.append(listBox, foot);
  const qa = await mountQuickAdd(container, { onAdded: () => load() });
  qa.el.remove();

  function paintHero() {
    const grow = el("div", "grow");
    grow.append(
      el("div", "eyebrow", "할일"),
      el("h1", "h1", openCount ? `해야 할 일 ${openCount}개` : "해야 할 일"),
    );
    const lead = el("p", "lead");
    lead.append("일지의 ☐ 줄, 여기서 추가한 할일, 상세 패널이 ", el("b", "", "모두 같은 목록"), "이에요.");
    grow.append(lead);
    const pageBtn = el("button", "btn");
    pageBtn.type = "button";
    pageBtn.title = "이슈와 페이지를 한 번에 만들어요 (Alt+N)";
    pageBtn.append(svg("doc", "i s"), "할일 페이지 추가", el("kbd", "", "Alt+N"));
    pageBtn.addEventListener("click", () => newTaskPage());
    hero.replaceChildren(grow, pageBtn);
  }

  function paintFilters() {
    const row = (label, ...chips) => {
      const g = el("div", "fgroup");
      g.append(el("span", "k", label), ...chips);
      return g;
    };
    const toggle = (set, v) => { set.has(v) ? set.delete(v) : set.add(v); paintFilters(); load(); };
    const groups = [
      row("상태", ...STATUS.map(([v, l]) => chip(l, f.status.has(v), () => toggle(f.status, v)))),
      row("우선순위", ...PRIO.map(([v, l]) => chip(l, f.priority.has(v), () => toggle(f.priority, v)))),
      row("납기", ...DUE.map(([v, l]) => chip(l, f.due === v, () => { f.due = f.due === v ? "" : v; paintFilters(); load(); }))),
    ];
    if (hub.requesters.length) {
      groups.push(row("요청자", ...hub.requesters.map((r) => chip(r, f.requester === r, () => { f.requester = f.requester === r ? "" : r; paintFilters(); load(); }))));
    }
    for (const fd of fields.filter((x) => x.show_filter && !x.builtin && !x.archived && ["choice", "multi"].includes(x.type))) {
      const set = (f.by[fd.key] ||= new Set());
      groups.push(row(fd.label, ...fd.options.map((o) => chip(o.label, set.has(o.value), () => toggle(set, o.value), true))));
    }
    const search = el("label", "fsearch");
    const input = el("input");
    input.type = "search";
    input.placeholder = "검색";
    input.value = f.q;
    input.setAttribute("aria-label", "할일 검색");
    const run = debounce(() => { f.q = input.value; load(); }, 200);
    input.addEventListener("input", run);
    search.append(svg("search", "i s"), input);
    const dirty = f.status.size !== 3 || f.priority.size || f.due || f.requester || f.q || Object.values(f.by).some((s) => s.size);
    filters.replaceChildren(...groups, ...(dirty ? [resetBtn()] : []), search);
  }

  function resetBtn() {
    const b = el("button", "linkbtn", "필터 초기화");
    b.type = "button";
    b.addEventListener("click", () => {
      Object.assign(f, { status: new Set(["todo", "doing", "hold"]), priority: new Set(), due: "", requester: "", q: "", by: {} });
      paintFilters();
      load();
    });
    return b;
  }

  const fieldDefs = () => Object.fromEntries(fields.filter((x) => x.show_row && !x.builtin && !x.archived).map((x) => [x.key, x]));

  function paintList() {
    if (loadError) {
      listBox.replaceChildren(errorState(loadError, load));
      return;
    }
    if (!items.length) {
      const filtered = f.q || f.priority.size || f.due || f.requester || f.status.size !== 3 || Object.values(f.by).some((s) => s.size);
      listBox.replaceChildren(filtered
        ? emptyState({ title: "조건에 맞는 할일이 없어요", desc: "필터를 줄이거나 검색어를 바꿔 보세요.", action: { label: "필터 초기화", run: () => { Object.assign(f, { status: new Set(["todo", "doing", "hold"]), priority: new Set(), due: "", requester: "", q: "", by: {} }); paintFilters(); load(); } }, icon: "search" })
        : emptyState({ title: "아직 할일이 없어요", desc: "위 입력창에 쓰고 Enter를 누르세요. 일지에서 ☐ 줄을 승격해도 여기에 모여요.", icon: "todo" }));
      return;
    }
    const defs = fieldDefs();
    listBox.replaceChildren(...items.map((t) => taskRow(t, { fieldLabels: defs, drag: false })));
  }

  async function load() {
    const p = { status: [...f.status].join(","), priority: [...f.priority].join(","), requester: f.requester, q: f.q };
    if (f.due === "overdue") p.overdue = true;
    if (f.due === "soon") p.due_within = 3;
    if (f.due === "week") p.due_within = 7;
    for (const [k, set] of Object.entries(f.by)) if (set.size) p[`field_${k}`] = [...set].join(",");
    try {
      const data = await api.todos(p);
      items = data.items;
      loadError = null;
      hub.setRequesters(data.requesters);
      hub.putTasks(items);
      const open = await api.todos({ status: "todo,doing,hold" });
      openCount = open.items.length;
    } catch (e) {
      loadError = e.message;
    }
    paintHero();
    paintList();
  }

  const reload = debounce(() => { load().then(paintFilters); }, 60);
  hub.on((info) => { if (info.kind === "task" || info.kind === "day") reload(); });

  container.replaceChildren(hero, qa.el, filters, panel);
  listBox.replaceChildren(skeleton(5));
  paintHero();
  try { fields = await api.todoFields(); } catch { fields = []; }
  await load();
  paintFilters();
  qa.repaint();
  return qa.input;
}
