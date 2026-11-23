// Monthly journal grid (view-only, P2-02). Columns = weeks, rows = weekdays.
import { api } from "./api.js";
import { chipGroup } from "./chips.js";

const DAY_NAMES = ["월", "화", "수", "목", "금", "토", "일"];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

// Weeks (Mon-start) covering the month; each week is 7 Date objects.
function weeksOf(month) {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const start = new Date(y, m - 1, 1 - ((first.getDay() + 6) % 7));
  const weeks = [];
  const last = new Date(y, m, 0);
  for (let d = new Date(start); d <= last; d.setDate(d.getDate() + 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i)));
  }
  return weeks;
}

function bodyLines(text) {
  const box = el("div", "jcell-body");
  for (const line of text.split("\n")) {
    const row = el("div", "jline");
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s?(.*)$/);
    if (m) {
      const done = m[1] !== " ";
      row.append(el("span", "jbox", done ? "☑" : "☐"), el("span", done ? "jdone" : "", m[2]));
    } else {
      row.textContent = line;
    }
    box.append(row);
  }
  return box;
}

export async function renderJournal(container, month) {
  const data = await api.journal(month);
  const days = data.days || {};
  const today = iso(new Date());
  const [y, m] = month.split("-").map(Number);
  let showWeekend = false;

  const head = el("div", "jhead");
  const prev = el("button", "btn ghost", "◀ 이전달");
  const next = el("button", "btn ghost", "다음달 ▶");
  const now = el("button", "btn ghost", "오늘");
  const toggle = chipGroup(
    [{ value: "hide", label: "주말 접기" }, { value: "show", label: "주말 펼치기" }],
    "hide",
    (v) => { showWeekend = v === "show"; paintGrid(); },
  );
  head.append(prev, el("strong", "jtitle", `${y}년 ${m}월`), next, now, toggle);
  prev.addEventListener("click", () => renderJournal(container, shiftMonth(month, -1)).catch(showErr));
  next.addEventListener("click", () => renderJournal(container, shiftMonth(month, 1)).catch(showErr));
  now.addEventListener("click", () => {
    const d = new Date();
    renderJournal(container, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`).catch(showErr);
  });

  const grid = el("div", "jgrid");
  const note = el("div", "meta", "보기 전용 — 편집은 다음 단계(P2-02b)에서 추가됩니다.");

  function paintGrid() {
    const weeks = weeksOf(month);
    const rows = showWeekend ? 7 : 5;
    grid.style.gridTemplateColumns = `48px repeat(${weeks.length}, minmax(160px, 1fr))`;
    grid.replaceChildren(el("div", "jcorner"));
    weeks.forEach((w, i) => grid.append(el("div", "jweek", `${i + 1}주`)));
    for (let r = 0; r < rows; r++) {
      grid.append(el("div", "jdow" + (r >= 5 ? " weekend" : ""), DAY_NAMES[r]));
      for (const week of weeks) {
        const d = week[r];
        const key = iso(d);
        const inMonth = d.getMonth() === m - 1;
        const cell = el("div", "jcell" + (inMonth ? "" : " out") + (key === today ? " today" : "") + (r >= 5 ? " weekend" : ""));
        cell.append(el("div", "jdate", String(d.getDate())));
        if (inMonth && days[key]) cell.append(bodyLines(days[key]));
        grid.append(cell);
      }
    }
  }

  function showErr(e) {
    container.replaceChildren(el("p", "error", e.message));
  }

  paintGrid();
  container.replaceChildren(head, note, grid);
}
