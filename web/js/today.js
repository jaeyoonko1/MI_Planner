// "Today" screen (P2-06): today's journal cell + planned / due-soon / overdue todos.
import { api } from "./api.js";

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function todoList(items, empty) {
  if (!items.length) return el("p", "meta", empty);
  const ul = el("ul", "tdlist");
  for (const t of items) {
    const li = el("li", "");
    li.append(el("span", "tprio-dot p" + t.priority, "●"), el("span", "", ` ${t.title}`));
    if (t.due_date) li.append(el("span", "meta", `  납기 ${t.due_date}`));
    if (t.requester) li.append(el("span", "meta", `  · ${t.requester}`));
    ul.append(li);
  }
  return ul;
}

function section(title, ...body) {
  const box = el("section", "card tcard");
  box.append(el("h3", "", title), ...body);
  return box;
}

export async function renderToday(container) {
  const d = await api.today();
  const [y, m, dd] = d.date.split("-").map(Number);
  const jbody = el("div", "content", d.journal || "(오늘 일지가 비어 있습니다)");
  const open = el("a", "btn ghost", "월간 일지에서 편집");
  open.href = `#/page/${["일지", String(y), d.month].map(encodeURIComponent).join("/")}`;
  const grid = el("div", "tgrid");
  grid.append(
    section("오늘 하기로 한 일", todoList(d.planned, "없음")),
    section("납기 임박 (3일 이내)", todoList(d.due_soon, "없음")),
    section("납기 지남", todoList(d.overdue, "없음")),
    section("평가 진행 현황", el("p", "meta", "평가 기능(P4) 이후 표시됩니다.")),
  );
  container.replaceChildren(
    el("h2", "page-title", `오늘 · ${y}년 ${m}월 ${dd}일`),
    section("오늘 일지", jbody, open),
    grid,
  );
}
