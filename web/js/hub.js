// One in-memory picture of "what the server last said" so every mounted view shows the same task / day.
// Writes go through here: the server rewrites linked journal lines, the response says which days changed,
// and the hub pushes those texts into every mounted day editor and tells subscribers to repaint.
import { api } from "./api.js";
import { toast } from "./toast.js";

const tasks = new Map();     // id -> task
const editors = new Map();   // "YYYY-MM-DD" -> Set<editor ctl>
const subs = new Set();
let requesters = [];

const monthDay = (date) => [date.slice(0, 7), Number(date.slice(8, 10))];

export const hub = {
  // Views call this when they are replaced: their editors and listeners are gone.
  reset() { editors.clear(); subs.clear(); },
  clearDays() { editors.clear(); },
  task: (id) => tasks.get(Number(id)),
  putTask(t) { if (t && t.id != null) tasks.set(Number(t.id), t); },
  putTasks(list) { for (const t of Array.isArray(list) ? list : Object.values(list || {})) this.putTask(t); },
  get requesters() { return requesters; },
  setRequesters(list) { requesters = list || []; },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
  emit(info = {}) { [...subs].forEach((f) => { try { f(info); } catch (e) { console.error(e); } }); },

  registerDay(date, ctl) {
    if (!editors.has(date)) editors.set(date, new Set());
    editors.get(date).add(ctl);
    return () => editors.get(date)?.delete(ctl);
  },
  // {date: body}: refresh every editor that is idle; editors being typed in keep their text.
  applyDays(days, except) {
    for (const [date, body] of Object.entries(days || {})) {
      for (const ctl of editors.get(date) || []) {
        if (ctl !== except && !ctl.isBusy() && ctl.getValue() !== body) ctl.setValue(body);
      }
    }
  },

  // ---- writes -----------------------------------------------------------------------------
  async saveDay(date, text, ctl) {
    const [month, dd] = monthDay(date);
    const res = await api.saveDay(month, dd, text);
    this.putTasks(res.tasks);
    this.applyDays(res.other_days, ctl);
    if (res.changed?.length || Object.keys(res.other_days || {}).length) this.emit({ kind: "day", date });
    return res.content;
  },
  async patchTask(id, data) {
    const res = await api.patchTodo(id, data);
    const { journal_days: days, ...task } = res;
    this.putTask(task);
    this.applyDays(days);
    this.emit({ kind: "task", id: task.id });
    return task;
  },
  async createTask(data) {
    const { journal_days: days, ...task } = await api.addTodo(data);
    this.putTask(task);
    this.applyDays(days);
    this.emit({ kind: "task", id: task.id });
    return task;
  },
  async deleteTask(id) {
    const res = await api.deleteTodo(id);
    tasks.delete(Number(id));
    this.applyDays(res.journal_days);
    this.emit({ kind: "task", id });
  },
  // Put a task on a day (drop on a cell). Undo puts it back where it was.
  async moveTask(id, date) {
    const t = this.task(id) || (await api.getTodo(id));
    const prev = t.planned_date || null;
    if (prev === date) return;
    try {
      await this.patchTask(id, { planned_date: date });
    } catch (e) {
      toast(`옮기지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => this.moveTask(id, date) } });
      return;
    }
    const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
    toast(`#${id} → ${md(date)} 일지로 옮겼어요`, {
      action: { label: "되돌리기", run: async () => { await this.patchTask(id, { planned_date: prev }); toast(prev ? `${md(prev)} 일지로 되돌렸어요` : "날짜 없음으로 되돌렸어요"); } },
    });
  },
};
