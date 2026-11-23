// Structure screen (P2B-07): the hierarchy bar + a grouped read view of issues, and the classification manager tab.
// The full compact work table (re-ordering, free layout, copy) is P2B-08.
import { api } from "./api.js";
import { renderClasses } from "./classes.js";
import { openLevelEditor } from "./leveldialog.js";
import { issueIcon, levelIcon } from "./levels.js";
import { dueInfo, el, emptyState, errorState, skeleton, svg } from "./ui.js";

const STATUS = { todo: "할일", doing: "진행", hold: "보류", done: "완료" };
const folded = new Set(); // group ids folded in this tab session

function valueLabel(field, value) {
  if (value === undefined || value === null || value === "") return null;
  const o = field?.options?.find((x) => x.value === value);
  return o ? o.label : String(value);
}

// Group issues level by level. Missing value -> "미분류" (last). Counts are unique issues.
function group(tasks, levels, fields, path = "") {
  if (!levels.length) return tasks.map((t) => ({ task: t }));
  const [lv, ...rest] = levels;
  const field = fields[lv.key];
  const buckets = new Map();
  for (const t of tasks) {
    const v = t.props?.[lv.key];
    const name = valueLabel(field, v);
    const k = name ?? "";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(t);
  }
  const order = (field?.options ?? []).map((o) => o.label);
  const names = [...buckets.keys()].filter(Boolean).sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.localeCompare(b, "ko");
  });
  if (buckets.has("")) names.push("");
  return names.map((n) => {
    const items = buckets.get(n);
    const id = `${path}/${lv.key}=${n}`;
    return { id, level: lv, name: n || "미분류", empty: !n, items, done: items.filter((t) => t.status === "done").length, children: group(items, rest, fields, id) };
  });
}

function issueRow(t, depth) {
  const r = el("div", "srow issue" + (t.status === "done" ? " done" : ""));
  r.style.setProperty("--d", depth);
  r.append(el("span", "fold"), issueIcon(), el("span", "tid", `#${t.id}`), el("span", "stitle", t.title));
  const meta = el("span", "smeta");
  meta.append(el("span", `pill st-${t.status}`, STATUS[t.status] ?? t.status));
  const due = dueInfo(t.due_date, t.status === "done");
  if (due) meta.append(el("span", `pill ${due.level}`, due.text));
  r.append(meta);
  return r;
}

function paintRows(host, nodes, depth, state) {
  for (const n of nodes) {
    if (n.task) { host.append(issueRow(n.task, depth)); continue; }
    const open = !folded.has(n.id);
    const r = el("div", "srow grp");
    r.style.setProperty("--d", depth);
    const fold = el("button", "fold");
    fold.type = "button";
    fold.setAttribute("aria-expanded", String(open));
    fold.setAttribute("aria-label", `${n.name} ${open ? "접기" : "펼치기"}`);
    fold.append(svg("chev", "i s"));
    const toggle = () => { open ? folded.add(n.id) : folded.delete(n.id); state.repaint(); };
    fold.addEventListener("click", toggle);
    r.addEventListener("dblclick", toggle);
    const name = el("b", "gname" + (n.empty ? " none" : ""), n.name);
    const pct = n.items.length ? Math.round((n.done / n.items.length) * 100) : 0;
    const roll = el("span", "roll");
    roll.setAttribute("role", "img");
    roll.setAttribute("aria-label", `완료 ${n.done} / ${n.items.length}`);
    const bar = el("i");
    bar.style.width = pct + "%";
    roll.append(bar);
    const lvname = el("small", "lvname", n.level.label);
    r.append(fold, levelIcon(n.level), name, lvname, el("span", "grow"), roll, el("span", "cnt", `${n.done}/${n.items.length}`));
    host.append(r);
    if (open) paintRows(host, n.children, depth + 1, state);
  }
}

async function renderTree(container, view, onView) {
  const [tasksRes, fieldList] = await Promise.all([api.todos({}), api.todoFields()]);
  const fields = Object.fromEntries(fieldList.map((f) => [f.key, f]));
  const tasks = tasksRes.items;
  const levels = view.mode === "fields" ? view.levels : [];

  const bar = el("div", "hbar");
  bar.append(el("span", "k", "계층"));
  if (view.mode === "free") {
    bar.append(el("span", "freebadge", "자유 배치"));
  } else {
    for (const l of view.levels) {
      const t = el("span", "lvchip");
      t.append(levelIcon(l), l.label);
      bar.append(t, el("span", "sep", "›"));
    }
    const t = el("span", "lvchip issue");
    t.append(issueIcon(), "이슈");
    bar.append(t);
  }
  const edit = el("button", "btn sm hedit", "계층 편집");
  edit.type = "button";
  edit.prepend(svg("hier", "i"));
  edit.addEventListener("click", () => openLevelEditor(view, { onApplied: onView, openClasses: () => { location.hash = "#/structure/classes"; } }));
  bar.append(edit);

  const parts = [bar];
  if (view.free_reason) {
    const w = el("div", "notice warn");
    w.setAttribute("role", "status");
    w.append(svg("alert", "i s"), el("span", "", view.free_reason));
    const fix = el("button", "btn sm", "계층 다시 설정");
    fix.type = "button";
    fix.addEventListener("click", () => openLevelEditor({ ...view, mode: "fields" }, { onApplied: onView, openClasses: () => { location.hash = "#/structure/classes"; } }));
    w.append(fix);
    parts.push(w);
  }

  const panel = el("section", "panel sview");
  const rows = el("div", "srows");
  rows.setAttribute("role", "tree");
  const foot = el("div", "panel-foot");
  foot.append(el("span", "", `${tasks.length}개 이슈`), el("span", "", view.mode === "free" ? "자유 배치 편집은 다음 단계에서 제공돼요" : "그룹 이름 더블클릭 · 접기/펼치기"));
  const state = {
    repaint() {
      rows.replaceChildren();
      if (!tasks.length) { rows.append(emptyState({ title: "아직 이슈가 없어요", desc: "오늘·할일에서 추가하면 여기에 분류별로 모여요.", icon: "hier" })); return; }
      paintRows(rows, group(tasks, levels, fields), 0, state);
    },
  };
  state.repaint();
  panel.append(rows, foot);
  parts.push(panel);
  container.replaceChildren(...parts);
}

export async function renderStructure(container, tab = "tree") {
  const page = el("div", "page structure");
  const hero = el("div", "hero");
  const grow = el("div", "grow");
  const lead = el("p", "lead");
  lead.append("이슈를 ", el("b", "", "원하는 분류"), "로 묶어 봐요. 보기에서 빼도 이슈의 분류 값은 그대로 남아요.");
  grow.append(el("div", "eyebrow", "구조"), el("h1", "h1", "업무 구조"), lead);
  hero.append(grow);
  const tabs = el("div", "chips tabsw");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "구조 화면");
  for (const [k, label, href] of [["tree", "이슈 구조", "#/structure"], ["classes", "분류 관리", "#/structure/classes"]]) {
    const b = el("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(tab === k));
    b.addEventListener("click", () => { if (tab !== k) location.hash = href; });
    tabs.append(b);
  }
  hero.append(tabs);
  const host = el("div", "shost");
  page.append(hero, host);
  container.replaceChildren(page);
  host.replaceChildren(skeleton(5));
  const load = async () => {
    try {
      if (tab === "classes") await renderClasses(host, { reload: load });
      else {
        const view = await api.structureView();
        await renderTree(host, view, load);
      }
    } catch (e) {
      host.replaceChildren(errorState(e.message, load));
    }
  };
  await load();
}
