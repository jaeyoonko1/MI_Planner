// Quick add (todo screen): one line + optional detail chips. The last confirmed choices become the next
// defaults (toggle can switch that off, "기본값 비우기" clears them). Stored per browser, never sent anywhere.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { toast } from "./toast.js";
import { addDays, chipRow, el, fmtMD, mondayOf, store, svg, todayISO } from "./ui.js";

const KEY = "mi.qa";
const EMPTY = () => ({ planned: null, due: null, priority: 2, requester: null, mark: null, props: {} });
const PRIO = [[1, "높음"], [2, "보통"], [3, "낮음"]];
const MARKS = [[null, "없음"], ["star", "★ 중요"], ["urgent", "! 긴급"]];

// Date choices are stored as tokens so "내일" stays relative to the day it is used, not the day it was picked.
function resolveDate(tok) {
  if (!tok) return null;
  if (tok === "today") return todayISO();
  if (tok === "tomorrow") return addDays(todayISO(), 1);
  if (tok === "d3") return addDays(todayISO(), 3);
  if (tok === "nextmon") return addDays(mondayOf(todayISO()), 7);
  return tok; // an explicit YYYY-MM-DD
}
const planChoices = [[null, "없음"], ["today", "오늘"], ["tomorrow", "내일"], ["nextmon", "다음 주 월"]];
const dueChoices = [[null, "없음"], ["today", "오늘"], ["tomorrow", "내일"], ["d3", "3일 후"], ["nextmon", "다음 주 월"]];

function load() {
  const saved = store.get(KEY, null) || {};
  return {
    detail: !!saved.detail,
    remember: saved.remember !== false,
    draft: { ...EMPTY(), ...(saved.remember === false ? {} : saved.draft || {}), props: { ...((saved.remember === false ? {} : saved.draft)?.props || {}) } },
  };
}

// "@요청자  ~11-27 / ~오늘 / ~내일  !(높음)  필드명:값" in the title line.
function parseTokens(text, fields) {
  const out = { title: [], props: {}, msgs: [] };
  const draft = {};
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let m;
    if ((m = word.match(/^@(.+)$/))) { draft.requester = m[1]; continue; }
    if ((m = word.match(/^~(.+)$/))) {
      const v = m[1];
      let d = null;
      if (v === "오늘") d = todayISO();
      else if (v === "내일") d = addDays(todayISO(), 1);
      else if ((m = v.match(/^(\d{1,2})[-/](\d{1,2})$/))) {
        const y = new Date().getFullYear();
        d = `${y}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
      }
      if (d && !Number.isNaN(Date.parse(d))) { draft.due_date = d; continue; }
      out.msgs.push(`날짜 '${word}'를 읽지 못해 제목에 남겼어요`);
    } else if (word === "!") { draft.priority = 1; continue; }
    else if ((m = word.match(/^([^:\s]+):(.+)$/))) {
      const f = fields.find((x) => x.label === m[1] && ["choice", "multi"].includes(x.type));
      const o = f?.options.find((x) => x.label === m[2]);
      if (f && o) { out.props[f.key] = f.type === "multi" ? [o.value] : o.value; continue; }
      if (f) out.msgs.push(`${f.label}에 '${m[2]}' 값이 없어 제목에 남겼어요`);
    }
    out.title.push(word);
  }
  return { title: out.title.join(" "), props: out.props, draft, msgs: out.msgs };
}

// opts: { onAdded(task), requesters() }
export async function mountQuickAdd(host, opts = {}) {
  let fields = [];
  try { fields = (await api.todoFields()).filter((f) => !f.builtin && !f.archived && ["choice", "multi"].includes(f.type)); }
  catch { /* chips for custom fields are optional */ }
  const st = load();
  const persist = () => store.set(KEY, { detail: st.detail, remember: st.remember, draft: st.remember ? st.draft : EMPTY() });

  const box = el("section", "qa" + (st.detail ? " open" : ""));
  box.setAttribute("aria-label", "새 할일");
  const row = el("div", "qa-row");
  row.append(svg("plus"));
  const input = el("input");
  input.type = "text";
  input.placeholder = "할일 입력 후 Enter  ·  @요청자  ~11-27  !  제품:HBM";
  input.setAttribute("aria-label", "새 할일 제목");
  const sw = el("button", "toggle");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.title = "상세 입력 (Ctrl+Shift+D)";
  sw.append(el("span", "switch"), "상세");
  const add = el("button", "btn pri", "추가");
  add.type = "button";
  row.append(input, sw, add);

  const preview = el("div", "qa-preview");
  const detail = el("div", "qa-detail");
  const inner = el("div", "qa-inner");
  const clip = el("div", "qa-clip"); // grid 0fr -> 1fr needs a padding-free clipping child
  clip.append(inner);
  detail.append(clip);
  box.append(row, preview, detail);

  const setDraft = (k, v) => { st.draft[k] = v; persist(); paint(); };
  const setProp = (key, v) => { st.draft.props = { ...st.draft.props, [key]: v }; persist(); paint(); };

  function summary() {
    const d = st.draft;
    const pills = [];
    const p = resolveDate(d.planned);
    if (p) pills.push(`${fmtMD(p)} 일지`);
    const due = resolveDate(d.due);
    if (due) pills.push(`납기 ${fmtMD(due)}`);
    if (d.priority !== 2) pills.push(`우선순위 ${PRIO.find(([v]) => v === d.priority)[1]}`);
    if (d.requester) pills.push(`@${d.requester}`);
    if (d.mark) pills.push(d.mark === "star" ? "★ 중요" : "! 긴급");
    for (const f of fields) {
      const v = d.props[f.key];
      if (v == null || (Array.isArray(v) && !v.length)) continue;
      pills.push((Array.isArray(v) ? v : [v]).map((x) => f.options.find((o) => o.value === x)?.label ?? x).join(", "));
    }
    return pills;
  }

  function paint() {
    box.classList.toggle("open", st.detail);
    sw.setAttribute("aria-checked", String(st.detail));
    const pills = summary();
    preview.replaceChildren(...pills.map((t) => el("span", "pill gray", t)));
    if (pills.length && st.remember) preview.append(el("span", "qa-note", "기본값"));
    preview.hidden = st.detail || !pills.length;
    const d = st.draft;
    const prop = (label, ...content) => { inner.append(el("span", "k", label)); const c = el("div", "chips"); c.append(...content); inner.append(c); };
    inner.replaceChildren();
    const dateIn = (key, tok) => {
      const i = el("input", "date-in");
      i.type = "date";
      i.value = /^\d{4}-/.test(tok || "") ? tok : "";
      i.setAttribute("aria-label", "날짜 직접 선택");
      i.addEventListener("change", () => setDraft(key, i.value || null));
      return i;
    };
    prop("하기로 한 날", chipRow(planChoices, d.planned, (v) => setDraft("planned", v)), dateIn("planned", d.planned));
    prop("납기", chipRow(dueChoices, d.due, (v) => setDraft("due", v)), dateIn("due", d.due));
    prop("우선순위", chipRow(PRIO, d.priority, (v) => setDraft("priority", v)));
    const known = hub.requesters || [];
    const reqIn = el("input", "txt-in");
    reqIn.type = "text";
    reqIn.placeholder = "직접 입력";
    reqIn.value = d.requester && !known.includes(d.requester) ? d.requester : "";
    reqIn.setAttribute("aria-label", "요청자 직접 입력");
    reqIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) reqIn.blur(); });
    reqIn.addEventListener("change", () => setDraft("requester", reqIn.value.trim() || null));
    prop("요청자", chipRow([[null, "없음"], ...known.map((r) => [r, r])], d.requester, (v) => setDraft("requester", v)), reqIn);
    prop("표시", chipRow(MARKS, d.mark, (v) => setDraft("mark", v)));
    for (const f of fields) {
      const items = f.options.map((o) => [o.value, o.label]);
      if (f.type === "choice") prop(f.label, chipRow([[null, "없음"], ...items], d.props[f.key] ?? null, (v) => setProp(f.key, v)));
      else {
        const set = new Set(d.props[f.key] || []);
        const wrap = el("div", "chips");
        for (const [v, l] of items) {
          const b = el("button", "chip", l);
          b.type = "button";
          b.setAttribute("aria-pressed", String(set.has(v)));
          b.addEventListener("click", () => { set.has(v) ? set.delete(v) : set.add(v); setProp(f.key, [...set]); });
          wrap.append(b);
        }
        prop(f.label, wrap);
      }
    }
    const foot = el("div", "qa-foot");
    const mem = el("button", "toggle");
    mem.type = "button";
    mem.setAttribute("role", "switch");
    mem.setAttribute("aria-checked", String(st.remember));
    mem.append(el("span", "switch"), "마지막 선택을 다음 기본값으로");
    mem.addEventListener("click", () => { st.remember = !st.remember; persist(); paint(); });
    const reset = el("button", "linkbtn", "기본값 비우기");
    reset.type = "button";
    reset.addEventListener("click", () => { st.draft = EMPTY(); persist(); paint(); toast("기본값을 비웠어요"); });
    foot.append(mem, el("span", "grow"), reset);
    inner.append(foot);
  }

  function setDetail(on) {
    st.detail = on;
    persist();
    paint();
    input.focus();
  }
  sw.addEventListener("click", () => setDetail(!st.detail));
  box.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") { e.preventDefault(); setDetail(!st.detail); }
  });

  let busy = false;
  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    add.disabled = true;
    const parsed = parseTokens(text, fields);
    if (!parsed.title) { toast("제목을 입력하세요", { error: true }); busy = false; add.disabled = false; return; }
    const d = st.draft;
    const body = {
      title: parsed.title,
      priority: parsed.draft.priority ?? d.priority,
      planned_date: resolveDate(d.planned),
      due_date: parsed.draft.due_date ?? resolveDate(d.due),
      requester: parsed.draft.requester ?? d.requester,
      mark: d.mark,
      props: { ...d.props, ...parsed.props },
    };
    for (const k of ["planned_date", "due_date", "requester", "mark"]) if (body[k] == null) delete body[k];
    for (const [k, v] of Object.entries(body.props)) if (v == null || (Array.isArray(v) && !v.length)) delete body.props[k];
    if (!Object.keys(body.props).length) delete body.props;
    try {
      const task = await hub.createTask(body);
      input.value = "";
      opts.onAdded?.(task);
      const extra = [task.planned_date ? `${fmtMD(task.planned_date)} 일지에도` : "", parsed.msgs[0] || ""].filter(Boolean).join(" · ");
      toast(`할일 #${task.id} 추가${extra ? ` · ${extra}` : ""}`, {
        action: { label: "되돌리기", run: async () => { await hub.deleteTask(task.id); opts.onAdded?.(null); } },
      });
    } catch (e) {
      toast(`추가하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: submit } });
    } finally {
      busy = false;
      add.disabled = false;
      input.focus();
    }
  }
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
  add.addEventListener("click", submit);
  paint();
  return { el: box, input, repaint: paint };
}
