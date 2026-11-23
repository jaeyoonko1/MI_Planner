// Small DOM + date helpers shared by the P2B-05 screens.
import { icon } from "./icons.js";

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export const WD = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseISO = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const todayISO = () => iso(new Date());
export const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
export const mondayOf = (s) => addDays(s, -((parseISO(s).getDay() + 6) % 7));
export const fmtMD = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
export const dayDiff = (s, from = todayISO()) => Math.round((parseISO(s) - parseISO(from)) / 864e5);

// "납기" pill info: text + severity (text always carries the meaning, color only reinforces it).
export function dueInfo(due, done) {
  if (!due) return null;
  const n = dayDiff(due);
  if (done) return { text: `${fmtMD(due)} 납기`, level: "none" };
  if (n < 0) return { text: `납기 ${-n}일 지남`, level: "late" };
  if (n === 0) return { text: "오늘 납기", level: "soon" };
  if (n <= 3) return { text: `납기 D-${n}`, level: "soon" };
  return { text: `${fmtMD(due)} 납기`, level: "none" };
}

export function svg(id, cls = "i") { return icon(id, cls); }

export function emptyState({ title, desc, action, icon: ic = "todo" }) {
  const box = el("div", "estate");
  const mark = el("span", "empty-mark");
  mark.append(svg(ic));
  box.append(mark, el("b", "", title));
  if (desc) box.append(el("span", "empty-desc", desc));
  if (action) {
    const b = el("button", "btn sm", action.label);
    b.type = "button";
    b.addEventListener("click", action.run);
    box.append(b);
  }
  return box;
}

export function errorState(message, retry) {
  const box = el("div", "estate error-state");
  box.setAttribute("role", "alert");
  const mark = el("span", "empty-mark");
  mark.append(svg("alert"));
  box.append(mark, el("b", "", "불러오지 못했어요"), el("span", "empty-desc", message || "알 수 없는 오류"));
  if (retry) {
    const b = el("button", "btn sm", "다시 시도");
    b.type = "button";
    b.addEventListener("click", retry);
    box.append(b);
  }
  return box;
}

export function skeleton(rows = 4) {
  const box = el("div", "skel");
  box.setAttribute("aria-busy", "true");
  box.setAttribute("aria-label", "불러오는 중");
  for (let i = 0; i < rows; i++) box.append(el("i", ""));
  return box;
}

// Single-choice chip row (D-12). items: [value, label]; `pressed` is compared with ===.
export function chipRow(items, current, onPick, cls = "") {
  const wrap = el("div", "chips " + cls);
  wrap.setAttribute("role", "group");
  for (const [value, label, extra] of items) {
    const b = el("button", "chip", label);
    b.type = "button";
    b.dataset.value = String(value);
    b.setAttribute("aria-pressed", String(value === current));
    if (extra) b.title = extra;
    b.addEventListener("click", () => onPick(value));
    wrap.append(b);
  }
  return wrap;
}

// Relative date choices used by quick add and the inspector.
export function dateChoices(kind) {
  const t = todayISO();
  const nextMon = addDays(mondayOf(t), 7);
  const base = [[null, "없음"], [t, "오늘"], [addDays(t, 1), "내일"]];
  return kind === "due"
    ? [...base, [addDays(t, 3), "3일 후"], [nextMon, "다음 주 월"]]
    : [...base, [nextMon, "다음 주 월"]];
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  wrapped.flush = (...a) => { clearTimeout(t); fn(...a); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: session only */ } },
};
