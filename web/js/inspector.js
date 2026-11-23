// Issue inspector (right drawer): title, property chips, memo. Opened by double-click on a row or a linked
// journal line. Every edit goes through the hub, so lists and journal lines update at once.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { openPageSheet } from "./pagedialog.js";
import { toast } from "./toast.js";
import { chipRow, dateChoices, debounce, el, fmtMD, svg } from "./ui.js";

const STATUS = [["todo", "할일"], ["doing", "진행"], ["hold", "보류"], ["done", "완료"]];
const PRIO = [[1, "높음"], [2, "보통"], [3, "낮음"]];
const MARKS = [[null, "없음"], ["star", "★ 중요"], ["urgent", "! 긴급"]];

let panel = null;
let openId = null;
let unsub = null;
let fields = null;
let returnFocus = null;

function ensurePanel() {
  if (panel) return panel;
  panel = el("aside", "insp");
  panel.id = "insp";
  panel.tabIndex = -1;
  panel.setAttribute("aria-label", "이슈 상세");
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); closeInspector(); }
  });
  document.querySelector(".main").append(panel);
  return panel;
}

export function closeInspector() {
  if (!panel || openId == null) return;
  commitMemo?.flush?.();
  openId = null;
  unsub?.();
  unsub = null;
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  const back = returnFocus;
  returnFocus = null;
  if (back?.isConnected) back.focus();
}

export function inspectorOpenId() { return openId; }

let commitMemo = null;

export async function openInspector(id) {
  const p = ensurePanel();
  if (openId === null) returnFocus = document.activeElement;
  openId = Number(id);
  unsub?.();
  try {
    if (!hub.task(id)) hub.putTask(await api.getTodo(id));
    if (!fields) fields = await api.todoFields().catch(() => []);
  } catch (e) {
    toast(`상세를 열지 못했어요 · ${e.message}`, { error: true });
    openId = null;
    return;
  }
  paint(true);
  unsub = hub.on((info) => { if (info.kind === "task" || info.kind === "day") refresh(); });
  p.classList.add("open");
  p.removeAttribute("aria-hidden");
}

// Re-read the task after someone else changed it; never clobber a field that is being typed in.
async function refresh() {
  if (openId == null) return;
  try { hub.putTask(await api.getTodo(openId)); } catch { /* deleted: close below */ return closeInspector(); }
  if (panel.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  paint(false);
}

async function write(data) {
  try {
    await hub.patchTask(openId, data);
  } catch (e) {
    toast(`저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => write(data) } });
  }
}

function row(label, iconId, ...content) {
  const r = el("div", "prop");
  const k = el("span", "k");
  k.append(svg(iconId, "i s"), label);
  const v = el("div", "pv");
  v.append(...content);
  r.append(k, v);
  return r;
}

function dateRow(label, iconId, key, current, kind) {
  const choices = dateChoices(kind);
  const known = choices.some(([v]) => v === current);
  const input = el("input", "date-in");
  input.type = "date";
  input.value = current || "";
  input.setAttribute("aria-label", `${label} 날짜 직접 선택`);
  input.addEventListener("change", () => write({ [key]: input.value || null }));
  const chips = chipRow(choices, current, (v) => write({ [key]: v }));
  if (current && !known) chips.append(el("span", "chip-note", fmtMD(current)));
  return row(label, iconId, chips, input);
}

// 페이지: an issue is complete without one. "페이지로 확장" links exactly one page to this same issue id.
function pageRow(t) {
  const done = (res) => { hub.putTask(res.task); hub.emit({ kind: "task", id: t.id }); };
  if (t.page_path) {
    const a = el("a", "pg-link");
    a.href = "#/page/" + t.page_path.split("/").map(encodeURIComponent).join("/");
    a.append(svg("doc", "i s"), el("span", "", t.page_path));
    a.title = t.page_path;
    const move = el("button", "btn quiet sm", "위치 변경");
    move.type = "button";
    move.addEventListener("click", () => openPageSheet({ task: t, relocate: true, onDone: done }));
    return row("페이지", "doc", a, move);
  }
  const b = el("button", "btn sm", "페이지로 확장");
  b.type = "button";
  b.prepend(svg("plus", "i s"));
  b.addEventListener("click", () => openPageSheet({ task: t, onDone: done }));
  return row("페이지", "doc", b, el("span", "chip-note", "이슈만으로 충분하면 그대로 두세요"));
}

function paint(focusTitle) {
  const t = hub.task(openId);
  if (!t) return;
  const keep = document.activeElement?.dataset?.fk;
  const head = el("div", "insp-h");
  const grow = el("div", "grow");
  grow.append(el("div", "k", `이슈 #${t.id}`));
  const title = el("h3", "", t.title);
  title.contentEditable = "plaintext-only";
  title.spellcheck = false;
  title.setAttribute("role", "textbox");
  title.setAttribute("aria-label", "제목");
  title.dataset.fk = "title";
  title.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); title.blur(); }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); title.textContent = t.title; title.blur(); }
  });
  title.addEventListener("blur", () => {
    const v = title.textContent.trim();
    if (v && v !== t.title) write({ title: v });
    else title.textContent = hub.task(openId)?.title ?? t.title;
  });
  grow.append(title);
  const close = el("button", "ib");
  close.type = "button";
  close.setAttribute("aria-label", "닫기");
  close.title = "닫기 (Esc)";
  close.append(svg("x"));
  close.addEventListener("click", closeInspector);
  head.append(grow, close);

  const body = el("div", "insp-b");
  const who = [...new Set([...(hub.requesters || []), ...(t.requester ? [t.requester] : [])])];
  const reqInput = el("input", "txt-in");
  reqInput.type = "text";
  reqInput.placeholder = "직접 입력";
  reqInput.value = "";
  reqInput.setAttribute("aria-label", "요청자 직접 입력");
  reqInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) reqInput.blur(); });
  reqInput.addEventListener("change", () => write({ requester: reqInput.value.trim() || null }));
  const props = el("div", "props");
  props.append(
    row("상태", "flag", chipRow(STATUS, t.status, (v) => write({ status: v }))),
    row("우선순위", "flag", chipRow(PRIO, t.priority, (v) => write({ priority: v }))),
    row("표시", "star", chipRow(MARKS, t.mark ?? null, (v) => write({ mark: v }))),
    dateRow("하기로 한 날", "cal", "planned_date", t.planned_date, "plan"),
    dateRow("납기", "clock", "due_date", t.due_date, "due"),
    row("요청자", "user",
      chipRow([[null, "없음"], ...who.map((w) => [w, w])], t.requester ?? null, (v) => write({ requester: v })), reqInput),
  );
  props.append(pageRow(t));
  for (const f of fields || []) {
    if (f.builtin || f.archived || !["choice", "multi"].includes(f.type)) continue;
    const cur = t.props?.[f.key];
    const items = f.options.map((o) => [o.value, o.label]);
    if (f.type === "choice") {
      props.append(row(f.label, "tag", chipRow([[null, "없음"], ...items], cur ?? null, (v) => write({ props: { [f.key]: v } }))));
    } else {
      const set = new Set(cur || []);
      const wrap = el("div", "chips");
      for (const [v, l] of items) {
        const b = el("button", "chip", l);
        b.type = "button";
        b.setAttribute("aria-pressed", String(set.has(v)));
        b.addEventListener("click", () => {
          set.has(v) ? set.delete(v) : set.add(v);
          write({ props: { [f.key]: [...set] } });
        });
        wrap.append(b);
      }
      props.append(row(f.label, "tag", wrap));
    }
  }

  const memoWrap = el("div", "memo-wrap");
  memoWrap.append(el("div", "sec-h", "메모"));
  const memo = el("textarea", "memo-in");
  memo.value = t.note || "";
  memo.rows = 6;
  memo.placeholder = "이 이슈에 대한 메모 — 입력하면 자동으로 저장돼요";
  memo.setAttribute("aria-label", "메모");
  memo.dataset.fk = "memo";
  const stat = el("span", "memo-stat");
  const save = async () => {
    if (memo.value === (hub.task(openId)?.note || "")) return;
    stat.textContent = "저장 중…";
    try { await hub.patchTask(openId, { note: memo.value || null }); stat.textContent = "저장됨"; }
    catch (e) { stat.textContent = ""; toast(`메모를 저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: save } }); }
  };
  const later = debounce(save, 700);
  commitMemo = later;
  memo.addEventListener("input", () => { stat.textContent = ""; later(); });
  memo.addEventListener("blur", () => later.flush());
  memoWrap.append(memo, stat);

  const foot = el("div", "insp-f");
  const del = el("button", "btn quiet sm danger", "삭제");
  del.type = "button";
  let armed = false;
  del.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      del.textContent = "한 번 더 누르면 삭제";
      setTimeout(() => { armed = false; del.textContent = "삭제"; }, 3000);
      return;
    }
    const snapshot = { ...hub.task(openId) };
    try {
      await hub.deleteTask(openId);
      closeInspector();
      toast(`#${snapshot.id} 삭제했어요`, {
        action: {
          label: "되돌리기",
          run: async () => {
            const { id, created_at, updated_at, props: p2, ...rest } = snapshot;
            await hub.createTask(Object.fromEntries(Object.entries(rest).filter(([, v]) => v != null && v !== "")));
          },
        },
      });
    } catch (e) { toast(`삭제하지 못했어요 · ${e.message}`, { error: true }); }
  });
  foot.append(el("span", "hint", "일지 줄 · 목록 · 월간이 이 이슈를 함께 봅니다"), del);
  body.append(props, memoWrap);
  panel.replaceChildren(el("div", "insp-in"));
  panel.firstChild.append(head, body, foot);
  if (focusTitle) panel.focus({ preventScroll: true });
  else if (keep) panel.querySelector(`[data-fk="${keep}"]`)?.focus({ preventScroll: true });
}
