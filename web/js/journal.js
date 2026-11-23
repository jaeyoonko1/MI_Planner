// Monthly journal grid (view-only, P2-02). Columns = weeks, rows = weekdays.
import { api } from "./api.js";
import { chipGroup } from "./chips.js";
import { editorKeys, mountLineEditor } from "./lineeditor.js";

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

const LINK_MARK = "→ 할일 #";

// Promote button shown on unchecked checkbox lines that are not yet linked to a todo.
function promoteButton(raw, idx, onPromote) {
  const m = raw.match(/^\s*[-*]\s+\[ \]\s?(.*)$/);
  if (!m || !m[1].trim() || m[1].includes(LINK_MARK)) return null;
  const b = el("button", "jpromote", "→할일");
  b.type = "button";
  b.title = "이 줄을 할일로 만들기";
  b.addEventListener("click", (e) => { e.stopPropagation(); onPromote(idx); });
  return b;
}

export async function renderJournal(container, month) {
  const [data, autoData] = await Promise.all([api.journal(month), api.journalAuto(month)]);
  const days = data.days || {};
  let auto = autoData;
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
  const autoToggle = chipGroup(
    [{ value: "on", label: "납기 할일 표시 켬" }, { value: "off", label: "끔" }],
    auto.enabled ? "on" : "off",
    async (v) => {
      try {
        await api.putSetting("journal_auto_show", v);
        auto = await api.journalAuto(month);
        paintGrid();
      } catch (e) {
        status.className = "jstatus error";
        status.textContent = e.message;
      }
    },
  );
  const keysToggle = chipGroup(
    [{ value: "on", label: "줄 단축키 켬" }, { value: "off", label: "끔" }],
    editorKeys.on ? "on" : "off",
    (v) => editorKeys.set(v === "on"),
  );
  head.append(prev, el("strong", "jtitle", `${y}년 ${m}월`), next, now, toggle, autoToggle, keysToggle);
  prev.addEventListener("click", () => renderJournal(container, shiftMonth(month, -1)).catch(showErr));
  next.addEventListener("click", () => renderJournal(container, shiftMonth(month, 1)).catch(showErr));
  now.addEventListener("click", () => {
    const d = new Date();
    renderJournal(container, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`).catch(showErr);
  });

  const grid = el("div", "jgrid");
  const note = el("div", "meta", "칸을 한 번 클릭하면 바로 편집, 더블클릭하면 오른쪽에 크게 열립니다. Tab 들여쓰기 · Ctrl+1 ☐☑★! · Ctrl+. 불렛 · Alt+↑↓ 이동. 입력 후 잠시 멈추면 자동 저장됩니다.");
  const status = el("span", "jstatus");
  head.append(status);

  // Each cell editor serializes its own saves; this callback only mirrors the result into `days`.
  const editors = [];
  function onState(kind, msg) {
    status.className = "jstatus" + (kind === "error" ? " error" : "");
    status.textContent = msg;
  }
  const saveCell = (key, dd) => async (text) => {
    await api.saveDay(month, dd, text);
    if (text.trim()) days[key] = text; else delete days[key];
  };

  async function promote(key, idx) {
    try {
      await Promise.all(editors.map((ed) => ed.flush())); // pending saves first so line indexes match the file
      const res = await api.promoteLine(key, idx);
      Object.keys(days).forEach((k) => delete days[k]);
      Object.assign(days, res.days);
      auto = await api.journalAuto(month);
      status.className = "jstatus";
      status.textContent = `할일 #${res.task.id} 생성됨`;
      paintGrid();
    } catch (e) {
      status.className = "jstatus error";
      status.textContent = e.message;
    }
  }

  function autoBox(key) {
    const items = auto.days?.[key] || [];
    if (!items.length) return null;
    const box = el("div", "jauto");
    for (const t of items) box.append(el("div", "jauto-item", `⏰ ${t.title}`));
    box.title = "납기 할일 (자동 표시, 파일에는 저장되지 않음)";
    return box;
  }

  function makeEditable(cell, key, dd) {
    const host = el("div", "jcell-view");
    cell.append(host);
    cell.classList.add("editable");
    editors.push(mountLineEditor(host, {
      value: days[key] || "",
      save: saveCell(key, dd),
      placeholder: "",
      toolbar: false,
      expand: { title: `${m}월 ${dd}일 일지` },
      foldKey: key,
      lineExtra: (raw, idx) => promoteButton(raw, idx, (i) => promote(key, i)),
      onState,
    }));
  }

  function paintGrid() {
    editors.length = 0;
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
        if (inMonth) {
          makeEditable(cell, key, d.getDate());
          const a = autoBox(key);
          if (a) cell.append(a);
        }
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
