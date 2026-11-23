// A day's journal text in the shared line editor, wired to the hub (same text in today / weekly / monthly).
import { api } from "./api.js";
import { hub } from "./hub.js";
import { toast } from "./toast.js";
import { flash } from "./shell.js";
import { el, WD, parseISO } from "./ui.js";
import { mountLineEditor } from "./lineeditor.js";
import { openInspector } from "./inspector.js";

const PROMOTABLE = /^\s*[-*]\s+\[[ xX*!]\]\s?(.*)$/;

export function dayTitle(date) {
  const d = parseISO(date);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일 일지`;
}

export function mountDay(host, date, content, opts = {}) {
  let ctl = null;

  function promoteButton(raw, idx) {
    const m = raw.match(PROMOTABLE);
    if (!m || !m[1].trim() || m[1].includes("→ 할일 #")) return null;
    const b = el("button", "jpromote", "→ 할일");
    b.type = "button";
    b.title = "이 줄을 할일로 만들기 (같은 날 같은 제목은 중복되지 않아요)";
    b.addEventListener("click", (e) => { e.stopPropagation(); promote(idx); });
    return b;
  }

  async function promote(idx) {
    try {
      await ctl.flush(); // pending saves first so line indexes match the file
      const res = await api.promoteLine(date, idx);
      hub.putTasks(res.tasks);
      hub.putTask(res.task);
      hub.applyDays(res.days, ctl);
      ctl.setValue(res.days[date] || "");
      hub.emit({ kind: "task", id: res.task.id });
      toast(res.reused ? `기존 할일 #${res.task.id}에 연결했어요` : `할일 #${res.task.id} 만들었어요`);
    } catch (e) {
      toast(e.message, { error: true });
    }
  }

  ctl = mountLineEditor(host, {
    value: content || "",
    save: (text) => hub.saveDay(date, text, ctl),
    placeholder: opts.placeholder ?? "",
    toolbar: !!opts.toolbar,
    expand: { title: dayTitle(date) },
    foldKey: date,
    taskInfo: (id) => hub.task(id),
    onOpenTask: (id) => openInspector(id),
    linkGrip: true,
    lineExtra: promoteButton,
    onState: (k, msg) => {
      if (k === "error") flash(false, msg);
      else if (k === "saved") flash(true, "저장됨");
      opts.onState?.(k, msg);
    },
  });
  hub.registerDay(date, ctl);
  return ctl;
}

// Drop target for "task -> day": cells/blocks marked [data-day] accept dragged tasks (rows or line grips).
export function enableDayDrops(root) {
  const cell = (e) => e.target.closest?.("[data-day]");
  const has = (e) => [...(e.dataTransfer?.types || [])].includes("application/x-mi-task");
  const clear = () => root.querySelectorAll("[data-day].drop").forEach((c) => c.classList.remove("drop"));
  root.addEventListener("dragover", (e) => {
    const c = cell(e);
    if (!c || !has(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!c.classList.contains("drop")) { clear(); c.classList.add("drop"); }
  });
  root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) clear(); });
  root.addEventListener("drop", (e) => {
    const c = cell(e);
    clear();
    if (!c || !has(e)) return;
    e.preventDefault();
    const id = Number(e.dataTransfer.getData("application/x-mi-task"));
    if (id) hub.moveTask(id, c.dataset.day);
  });
  root.addEventListener("dragend", clear);
}
