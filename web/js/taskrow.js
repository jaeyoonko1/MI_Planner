// One task row, used by today / weekly / tray / todo list. Click the title to rename it in place,
// double-click opens the inspector. Everything writes through the hub.
import { hub } from "./hub.js";
import { toast } from "./toast.js";
import { openInspector } from "./inspector.js";
import { dueInfo, el, fmtMD, svg } from "./ui.js";

const STATUS_LABEL = { todo: "할일", doing: "진행", hold: "보류", done: "완료" };

async function write(id, data) {
  try {
    await hub.patchTask(id, data);
  } catch (e) {
    toast(`저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => write(id, data) } });
  }
}

// opts: { drag, showPlanned, fieldLabels: {key: fieldDef} }
export function taskRow(t, opts = {}) {
  const done = t.status === "done";
  const row = el("div", "trow" + (done ? " done" : ""));
  row.dataset.id = String(t.id);
  if (t.priority === 1) row.append(el("i", "pbar p1"));
  else if (t.priority === 3) row.append(el("i", "pbar p3"));

  const check = el("button", "check");
  check.type = "button";
  check.setAttribute("role", "checkbox");
  check.setAttribute("aria-checked", String(done));
  check.setAttribute("aria-label", done ? "완료 취소" : "완료로 표시");
  check.append(svg("check", "i"));
  check.addEventListener("click", () => {
    check.setAttribute("aria-checked", String(!done));
    row.classList.toggle("done", !done);
    write(t.id, { status: done ? "todo" : "done" });
  });

  const main = el("div", "tmain");
  const title = el("span", "ttitle");
  const titleText = el("span", "ttext", t.title);
  if (t.mark === "star") title.append(el("span", "tmark star", "★"));
  if (t.mark === "urgent") title.append(el("span", "tmark urgent", "!"));
  title.append(titleText);
  title.tabIndex = 0;
  title.title = "클릭해서 이름 바꾸기 · 더블클릭하면 상세";
  const rename = () => {
    if (row.querySelector(".ttitle-edit")) return;
    const input = el("input", "ttitle-edit");
    input.type = "text";
    input.value = t.title;
    input.setAttribute("aria-label", "할일 제목");
    let closed = false;
    const finish = (save) => {
      if (closed) return;
      closed = true;
      const v = input.value.trim();
      input.replaceWith(title);
      if (save && v && v !== t.title) { titleText.textContent = v; write(t.id, { title: v }); }
      else if (save && !v) toast("제목은 비울 수 없어요", { error: true });
    };
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      if (e.key === "Enter") { e.preventDefault(); finish(true); title.focus(); }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); title.focus(); }
    });
    input.addEventListener("blur", () => finish(true));
    title.replaceWith(input);
    input.focus();
    input.select();
  };
  title.addEventListener("click", (e) => { if (e.detail === 1) rename(); });
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); rename(); } });
  row.addEventListener("dblclick", (e) => {
    if (e.target.closest(".check")) return;
    row.querySelector(".ttitle-edit")?.blur(); // the first click of the double click started a rename
    getSelection()?.removeAllRanges();
    openInspector(t.id);
  });

  const meta = el("div", "tmeta");
  meta.append(el("span", "tid", `#${t.id}`));
  const due = dueInfo(t.due_date, done);
  if (due) meta.append(el("span", `pill ${due.level}`, due.text));
  if (t.planned_date && opts.showPlanned !== false) meta.append(el("span", "pill plan", `${fmtMD(t.planned_date)} 일지`));
  if (t.requester) meta.append(el("span", "treq", `@${t.requester}`));
  if (t.status === "doing" || t.status === "hold") meta.append(el("span", `pill st-${t.status}`, STATUS_LABEL[t.status]));
  for (const [key, def] of Object.entries(opts.fieldLabels || {})) {
    const v = t.props?.[key];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const vals = (Array.isArray(v) ? v : [v]).map((x) => def.options?.find((o) => String(o.value) === String(x))?.label ?? String(x));
    meta.append(el("span", "pill gray", vals.join(", ")));
  }
  main.append(title, meta);
  row.append(check, main);

  if (opts.drag) {
    row.draggable = true;
    row.classList.add("draggable");
    row.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-mi-task", String(t.id));
      e.dataTransfer.setData("text/plain", t.title);
      e.dataTransfer.effectAllowed = "move";
      row.classList.add("dragging");
      requestAnimationFrame(() => document.body.classList.add("dragging-task"));
    });
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); document.body.classList.remove("dragging-task"); });
  }
  return row;
}
