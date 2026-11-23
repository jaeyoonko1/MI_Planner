// Todo screen (P2-04): toggle-chip filters (D-12), quick add (N), inline editing.
import { api } from "./api.js";

const STATUS = [["todo", "할일"], ["doing", "진행"], ["hold", "보류"], ["done", "완료"]];
const PRIO = [[1, "높음"], [2, "보통"], [3, "낮음"]];
const STATUS_LABEL = Object.fromEntries(STATUS);
const PRIO_LABEL = Object.fromEntries(PRIO);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Multi-select toggle chip.
function toggleChip(label, pressed, onToggle) {
  const b = el("button", "chip", label);
  b.type = "button";
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(next));
    onToggle(next);
  });
  return b;
}

export async function renderTodos(container) {
  // Default view hides finished work.
  const f = { status: new Set(["todo", "doing", "hold"]), priority: new Set(), due: "", requester: "", q: "" };
  let requesters = [];

  const filters = el("div", "tfilters");
  const quick = el("input", "tquick");
  quick.type = "text";
  quick.placeholder = "새 할일 입력 후 Enter  (단축키 N)";
  const list = el("div", "tlist");
  const msg = el("div", "error");

  const flip = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

  function paintFilters() {
    const row = (label, ...chips) => {
      const r = el("div", "tfrow");
      r.append(el("span", "tflabel", label), ...chips);
      return r;
    };
    const mk = (set, entries) => entries.map(([v, l]) =>
      toggleChip(l, set.has(v), () => { flip(set, v); load(); }));
    const dueChip = (value, label) => toggleChip(label, f.due === value, () => {
      f.due = f.due === value ? "" : value;
      paintFilters();
      load();
    });
    const reqChips = requesters.map((r) => toggleChip(r, f.requester === r, () => {
      f.requester = f.requester === r ? "" : r;
      paintFilters();
      load();
    }));
    const search = el("input", "tsearch");
    search.type = "text";
    search.placeholder = "검색";
    search.value = f.q;
    search.addEventListener("input", () => { f.q = search.value; load(); });
    filters.replaceChildren(
      row("상태", ...mk(f.status, STATUS)),
      row("우선순위", ...mk(f.priority, PRIO)),
      row("납기", dueChip("overdue", "지남"), dueChip("soon", "3일 이내"), dueChip("week", "7일 이내")),
      ...(reqChips.length ? [row("요청자", ...reqChips)] : []),
      row("", search),
    );
  }

  async function load() {
    const p = { status: [...f.status].join(","), priority: [...f.priority].join(","), requester: f.requester, q: f.q };
    if (f.due === "overdue") p.overdue = true;
    if (f.due === "soon") p.due_within = 3;
    if (f.due === "week") p.due_within = 7;
    try {
      const data = await api.todos(p);
      requesters = data.requesters;
      msg.textContent = "";
      paintList(data.items);
    } catch (e) {
      msg.textContent = e.message;
    }
  }

  async function patch(id, data) {
    try {
      await api.patchTodo(id, data);
    } catch (e) {
      msg.textContent = e.message;
    }
    load();
  }

  function paintList(items) {
    const today = new Date().toISOString().slice(0, 10);
    if (!items.length) {
      list.replaceChildren(el("p", "meta", "조건에 맞는 할일이 없습니다."));
      return;
    }
    list.replaceChildren(...items.map((t) => {
      const row = el("div", "trow" + (t.status === "done" ? " tdone" : ""));
      const status = el("button", "chip tstatus", STATUS_LABEL[t.status]);
      status.title = "클릭하면 다음 상태로";
      status.addEventListener("click", () => {
        const order = STATUS.map(([v]) => v);
        patch(t.id, { status: order[(order.indexOf(t.status) + 1) % order.length] });
      });
      const prio = el("button", "chip tprio p" + t.priority, PRIO_LABEL[t.priority]);
      prio.title = "클릭하면 우선순위 변경";
      prio.addEventListener("click", () => patch(t.id, { priority: (t.priority % 3) + 1 }));

      const title = el("span", "ttitle", t.title);
      title.title = "클릭하면 제목 수정";
      title.addEventListener("click", () => {
        const input = el("input", "ttitle-edit");
        input.type = "text";
        input.value = t.title;
        let done = false;
        const commit = (save) => {
          if (done) return;
          done = true;
          if (save && input.value.trim() && input.value.trim() !== t.title) patch(t.id, { title: input.value });
          else load();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") commit(true);
          if (e.key === "Escape") commit(false);
        });
        input.addEventListener("blur", () => commit(true));
        title.replaceWith(input);
        input.focus();
        input.select();
      });

      const due = el("input", "tdate" + (t.due_date && t.due_date < today && t.status !== "done" ? " late" : ""));
      due.type = "date";
      due.title = "납기";
      due.value = t.due_date || "";
      due.addEventListener("change", () => patch(t.id, { due_date: due.value || null }));

      const req = el("input", "treq");
      req.type = "text";
      req.placeholder = "요청자";
      req.value = t.requester || "";
      req.addEventListener("change", () => patch(t.id, { requester: req.value.trim() || null }));

      const del = el("button", "icon-btn", "✕");
      del.title = "삭제";
      del.addEventListener("click", async () => {
        if (!confirm(`'${t.title}' 할일을 삭제할까요?`)) return;
        try { await api.deleteTodo(t.id); } catch (e) { msg.textContent = e.message; }
        load();
      });
      row.append(status, prio, title, due, req, del);
      return row;
    }));
  }

  quick.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !quick.value.trim()) return;
    try {
      await api.addTodo({ title: quick.value });
      quick.value = "";
      f.status.add("todo");
      paintFilters();
    } catch (err) {
      msg.textContent = err.message;
      return;
    }
    load();
  });

  container.replaceChildren(el("h2", "page-title", "할일"), quick, filters, msg, list);
  paintFilters();
  await load();
  paintFilters(); // requester chips arrive with the first response
  return quick;
}
