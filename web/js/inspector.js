// Issue inspector (right drawer): title, property chips, memo. Opened by double-click on a row or a linked
// journal line. Every edit goes through the hub, so lists and journal lines update at once.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { mountEditor } from "./note.js";
import { mountNoteColumns } from "./note-columns.js";
import { classRows, toggleMulti } from "./inspector-fields.js";
import { openPageSheet } from "./pagedialog.js";
import { toast } from "./toast.js";
import { editableOf, registerContext } from "./contextmenu.js";
import { deleteTaskUndoable, taskGroups } from "./taskactions.js";
import { chipRow, dateChoices, el, fmtMD, svg } from "./ui.js";

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
  // V-010: the same task actions as the list rows; text fields and the memo editor keep their own text menus
  registerContext(panel, (ctx) => {
    if (editableOf(ctx.target) || openId == null || !hub.task(openId)) return null;
    return taskGroups(hub.task(openId), { close: closeInspector });
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !e.defaultPrevented) { e.stopPropagation(); closeInspector(); }
  });
  document.querySelector(".main").append(panel);
  return panel;
}

// The memo is the same rich editor as a note page (P2B-10). For an issue with a page it edits the page body itself.
let memo = null; // { id, ctl }

function dropMemo() {
  memo?.ctl.destroy();
  memo = null;
}

export function closeInspector() {
  if (!panel || openId == null) return;
  memo?.ctl.flush();
  dropMemo();
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

export async function openInspector(id) {
  const p = ensurePanel();
  if (openId === null) returnFocus = document.activeElement;
  if (memo && memo.id !== Number(id)) { await memo.ctl.flush(); dropMemo(); }
  openId = Number(id);
  unsub?.();
  try {
    // always fresh: the memo of an issue with a page is read from the page body (unifies old diverged pairs once)
    const fresh = await api.getTodo(id);
    hub.putTask(fresh);
    if (fresh.memo_merged) {
      toast("메모와 페이지 본문이 달라 하나로 합쳤어요 · 이전 메모는 '통합 전 이슈 메모' 아래에 그대로 있어요", { ms: 9000 });
    }
    fields = await loadFields();
  } catch (e) {
    toast(`상세를 열지 못했어요 · ${e.message}`, { error: true });
    openId = null;
    return;
  }
  paint(true);
  unsub = hub.on((info) => { if (info.kind === "task" || info.kind === "day" || info.kind === "fields") refresh(info.kind === "fields"); });
  p.classList.add("open");
  p.removeAttribute("aria-hidden");
}

// Re-read the task after someone else changed it; never clobber a field that is being typed in.
async function refresh(reloadFields = false) {
  if (openId == null) return;
  if (reloadFields) fields = await loadFields();
  try { hub.putTask(await api.getTodo(openId)); } catch { /* deleted: close below */ return closeInspector(); }
  if (panel.contains(document.activeElement) && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) return;
  if (memo?.ctl.contains(document.activeElement)) { memo.ctl.syncFrom(hub.task(openId)?.note || ""); return; }
  paint(false);
}

async function write(data) {
  try {
    await hub.patchTask(openId, data);
  } catch (e) {
    toast(`저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => write(data) } });
  }
}

// Always read from the server: classifications are edited in 분류 관리 / 계층 편집 while an issue can stay open.
// A failed read keeps the last good list instead of caching an empty one.
async function loadFields() {
  try { return await api.todoFields(); } catch (e) {
    if (!fields) toast(`분류를 불러오지 못했어요 · ${e.message}`, { error: true });
    return fields || [];
  }
}

function classRow(r) {
  const write1 = (v) => write({ props: { [r.key]: v } });
  if (r.empty) {
    const go = el("a", "chip-link", "선택지 추가");
    go.href = "#/structure/classes";
    go.addEventListener("click", () => closeInspector());
    return row(r.label, "tag", el("span", "chip-note warn", "선택지가 없어요"), go);
  }
  const wrap = el("div", "chips");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", r.label);
  const chip = (label, pressed, onClick, c) => {
    const b = el("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(pressed));
    if (c?.depth) { b.classList.add("sub"); b.style.setProperty("--depth", c.depth); }
    if (c?.orphan) { b.classList.add("orphan"); b.title = "선택지 목록에서 사라진 값이에요 · 눌러 해제"; }
    b.addEventListener("click", onClick);
    return b;
  };
  if (r.type === "choice") {
    wrap.append(chip("없음", r.current == null, () => write1(null)));
    for (const c of r.chips) wrap.append(chip(c.label, c.value === r.current, () => write1(c.orphan ? null : c.value), c));
  } else {
    for (const c of r.chips) wrap.append(chip(c.label, r.current.includes(c.value), () => write1(toggleMulti(r.current, c.value).filter((v) => v !== undefined)), c));
  }
  return row(r.label, "tag", wrap);
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
  for (const r of classRows(fields, t.props)) props.append(classRow(r));

  const memoWrap = el("div", "memo-wrap");
  const memoHead = el("div", "memo-h");
  memoHead.append(el("div", "sec-h", "메모"));
  if (t.page_path) {
    const same = el("span", "memo-same", "페이지 본문과 같은 글");
    same.title = "이 메모를 고치면 페이지 본문이 같이 바뀌어요";
    memoHead.append(same);
  }
  memoWrap.append(memoHead);
  if (!memo || memo.id !== openId) {
    const id = openId;
    const ctl = mountNoteColumns(mountEditor, {
      content: t.note || "",
      pagePath: t.page_path || undefined,
      compact: true,
      label: "메모",
      placeholder: "이 이슈에 대한 메모 — 입력하면 자동으로 저장돼요 · 이미지는 붙여넣기",
      foldScope: `t:${id}`,
      // after the issue gets a page this URL keeps working (the server looks in the page folder first)
      fileUrl: (rel) => `/api/todos/${id}/file?name=${encodeURIComponent(rel.replace(/^files\//, ""))}`,
      upload: (file, name) => api.uploadTodoFile(id, file, name),
      save: async (md) => { await hub.patchTask(id, { note: md.trim() ? md : null }); },
      onError: (e, retry) => toast(`메모를 저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: retry } }),
    });
    memo = { id, ctl };
  } else {
    memo.ctl.syncFrom(t.note || "");
  }
  memoWrap.append(memo.ctl.el);

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
    await deleteTaskUndoable(openId, closeInspector);
  });
  foot.append(el("span", "hint", "일지 줄 · 목록 · 월간이 이 이슈를 함께 봅니다"), del);
  body.append(props, memoWrap);
  panel.replaceChildren(el("div", "insp-in"));
  panel.firstChild.append(head, body, foot);
  if (focusTitle) panel.focus({ preventScroll: true });
  else if (keep) panel.querySelector(`[data-fk="${keep}"]`)?.focus({ preventScroll: true });
}
