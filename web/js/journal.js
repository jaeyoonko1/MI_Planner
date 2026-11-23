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

const LINK_MARK = "→ 할일 #";

// onPromote(lineIndex) is offered for unchecked checkbox lines not yet linked to a todo.
function bodyLines(text, onPromote) {
  const box = el("div", "jcell-body");
  text.split("\n").forEach((line, idx) => {
    const row = el("div", "jline");
    const m = line.match(/^\s*[-*]\s+\[([ xX])\]\s?(.*)$/);
    if (m) {
      const done = m[1] !== " ";
      row.append(el("span", "jbox", done ? "☑" : "☐"), el("span", done ? "jdone" : "", m[2]));
      if (!done && m[2].trim() && !m[2].includes(LINK_MARK) && onPromote) {
        const b = el("button", "jpromote", "→할일");
        b.title = "이 줄을 할일로 만들기";
        b.addEventListener("click", (e) => { e.stopPropagation(); onPromote(idx); });
        row.append(b);
      }
    } else {
      row.textContent = line;
    }
    box.append(row);
  });
  return box;
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
  head.append(prev, el("strong", "jtitle", `${y}년 ${m}월`), next, now, toggle, autoToggle);
  prev.addEventListener("click", () => renderJournal(container, shiftMonth(month, -1)).catch(showErr));
  next.addEventListener("click", () => renderJournal(container, shiftMonth(month, 1)).catch(showErr));
  now.addEventListener("click", () => {
    const d = new Date();
    renderJournal(container, `${d.getFullYear()}-${pad(d.getMonth() + 1)}`).catch(showErr);
  });

  const grid = el("div", "jgrid");
  const note = el("div", "meta", "칸을 클릭하면 편집합니다. 입력 후 잠시 멈추면 자동 저장됩니다.");
  const status = el("span", "jstatus");
  head.append(status);

  // Saves run one after another so an older PUT can never overwrite a newer one.
  let chain = Promise.resolve();
  function save(key, dd, text) {
    status.className = "jstatus";
    status.textContent = "저장 중…";
    chain = chain
      .then(() => api.saveDay(month, dd, text))
      .then(() => {
        if (text.trim()) days[key] = text; else delete days[key];
        status.textContent = "저장됨";
      })
      .catch((e) => {
        status.className = "jstatus error";
        status.textContent = `저장 실패: ${e.message}`;
      });
    return chain;
  }

  async function promote(key, idx) {
    try {
      await chain; // let pending saves land first so line indexes match the file
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
    const view = el("div", "jcell-view");
    const paint = () => {
      view.replaceChildren(days[key] ? bodyLines(days[key], (idx) => promote(key, idx)) : el("div", "jempty", ""));
    };
    paint();
    cell.append(view);
    cell.classList.add("editable");
    view.addEventListener("click", () => {
      const ta = document.createElement("textarea");
      ta.className = "jedit";
      ta.value = days[key] || "";
      const fit = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
      let timer = null;
      let dirty = false;
      const flush = () => {
        clearTimeout(timer);
        if (dirty) { dirty = false; return save(key, dd, ta.value); }
      };
      ta.addEventListener("input", () => {
        dirty = true;
        fit();
        clearTimeout(timer);
        timer = setTimeout(flush, 700);
      });
      ta.addEventListener("blur", async () => {
        await flush();
        paint();
        ta.replaceWith(view);
      });
      ta.addEventListener("keydown", (e) => { if (e.key === "Escape") ta.blur(); });
      view.replaceWith(ta);
      fit();
      ta.focus();
    });
  }

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
