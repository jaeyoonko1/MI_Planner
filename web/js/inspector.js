// Issue inspector shared by Structure, task lists, and linked journal lines.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { mountEditor } from "./note.js";
import { mountNoteColumns } from "./note-columns.js";
import { classRows, toggleMulti } from "./inspector-fields.js";
import { openPageSheet } from "./pagedialog.js";
import { levelChips, levelGlyph, openParentSheet } from "./structissue.js";
import { rankOf } from "./structmodel.js";
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
let levels = []; // V-011 issue levels (에픽 …), top first
let returnFocus = null;
let structure = null;
let related = [];
let revision = 0;
let refreshRevision = 0;
let levelsExpanded = false;
let hierarchyWrite = null;
let stalePaint = false; // a refresh landed while typing: the badge and fields need a repaint after blur

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
    if (e.key !== "Escape" || e.defaultPrevented || e.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (structure) structure.focusRow();
    else closeInspector();
  });
  // A refresh that arrived while a field or the memo had focus is painted once focus leaves the panel's inputs.
  panel.addEventListener("focusout", () => setTimeout(() => {
    if (!stalePaint || openId == null) return;
    const a = document.activeElement;
    if (panel.contains(a) && (/^(INPUT|TEXTAREA)$/.test(a.tagName) || memo?.ctl.contains(a))) return;
    paint();
  }, 0));
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
  if (!panel || (openId == null && !structure)) return;
  if (panel.contains(document.activeElement)) document.activeElement.blur();
  memo?.ctl.flush();
  dropMemo();
  revision++;
  openId = null;
  structure?.onClose();
  structure = null;
  unsub?.();
  unsub = null;
  panel.classList.remove("open", "structure-insp");
  panel.setAttribute("aria-hidden", "true");
  const back = returnFocus;
  returnFocus = null;
  if (back?.isConnected && (document.activeElement === document.body || panel.contains(document.activeElement))) back.focus();
}

export function inspectorOpenId() { return openId; }

function begin(nextId, context) {
  const p = ensurePanel();
  if (openId === null && !structure) returnFocus = document.activeElement;
  if (p.contains(document.activeElement)) document.activeElement.blur();
  const oldMemo = memo;
  memo = null;
  const flushed = oldMemo?.ctl.flush();
  oldMemo?.ctl.destroy();
  unsub?.();
  unsub = null;
  if (structure && structure !== context) structure.onClose();
  openId = nextId;
  structure = context;
  levelsExpanded = false;
  p.classList.toggle("structure-insp", Boolean(context));
  const loading = el("div", "insp-loading", "상세를 불러오는 중…");
  loading.setAttribute("role", "status");
  p.replaceChildren(loading);
  return { ticket: ++revision, flushed };
}

function show() {
  panel.classList.add("open");
  panel.removeAttribute("aria-hidden");
}

function drawerButton(label, onclick, cls = "btn quiet sm") {
  const b = el("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onclick);
  return b;
}

function dismissButton() {
  const b = drawerButton("", () => {
    const back = structure?.focusRow;
    closeInspector();
    back?.();
  }, "ib");
  b.setAttribute("aria-label", "닫기");
  b.append(svg("x"));
  return b;
}

export function openStructureCard(context, { kind, title, description, actions = [] }, focus = false) {
  if (openId != null || structure !== context) begin(null, context);
  const head = el("div", "insp-h");
  const grow = el("div", "grow");
  grow.append(el("div", "k", kind), el("h3", "", title));
  head.append(grow, dismissButton());
  const body = el("div", "insp-b");
  body.append(el("p", "chip-note", description));
  const buttons = el("div", "chips");
  for (const [label, run] of actions) buttons.append(drawerButton(label, run));
  body.append(buttons);
  const inner = el("div", "insp-in");
  inner.append(head, body);
  panel.replaceChildren(inner);
  show();
  if (focus) (buttons.firstElementChild ?? panel).focus({ preventScroll: true });
}

export async function openInspector(id, { focus = true, context = null } = {}) {
  id = Number(id);
  const target = () => context ? panel.querySelector('[data-fk="title"]') : panel;
  if (openId === id && structure === context && panel.querySelector(`[data-issue="${id}"]`)) {
    if (focus) target()?.focus({ preventScroll: true });
    return;
  }
  const { ticket, flushed } = begin(id, context);
  try {
    await flushed;
    // Read the detail to reconcile old issue/page memo pairs.
    const [fresh, lists, all] = await Promise.all([
      api.getTodo(id), loadFields(), context ? null : api.todos({}).catch(() => ({ items: [] })),
    ]);
    if (revision !== ticket) return;
    hub.putTask(fresh);
    ({ fields, levels } = lists);
    related = all?.items ?? context.tasks();
    if (fresh.memo_merged) {
      toast("메모와 페이지 본문이 달라 하나로 합쳤어요 · 이전 메모는 '통합 전 이슈 메모' 아래에 그대로 있어요", { ms: 9000 });
    }
  } catch (e) {
    if (revision !== ticket) return;
    toast(`상세를 열지 못했어요 · ${e.message}`, { error: true });
    closeInspector();
    return;
  }
  paint();
  show();
  if (focus && (!context || context.canFocus())) target()?.focus({ preventScroll: true });
  unsub = hub.on((info) => {
    if (["task", "day", "fields"].includes(info.kind)) refresh(info.kind === "fields");
  });
}

// Re-read the task after someone else changed it; never clobber a field that is being typed in.
async function refresh(reloadFields = false) {
  if (openId == null) return;
  const id = openId, ticket = revision, update = ++refreshRevision;
  const current = () => revision === ticket && refreshRevision === update;
  const title = panel.querySelector('[data-fk="title"]');
  try {
    const [task, lists, all] = await Promise.all([
      api.getTodo(id), reloadFields ? loadFields() : null, api.todos({}),
    ]);
    if (!current()) return;
    hub.putTask(task);
    if (lists) ({ fields, levels } = lists);
    related = all.items;
  } catch (e) {
    if (current() && e.status === 404) closeInspector();
    return;
  }
  const active = document.activeElement;
  if (panel.contains(active) && /^(INPUT|TEXTAREA)$/.test(active.tagName)) { stalePaint = true; return; }
  if (active === title && title.textContent.trim() !== title.dataset.savedTitle) { stalePaint = true; return; }
  if (memo?.ctl.contains(document.activeElement)) {
    // keep the focused cell, but take the newest revision/text when nothing is unsaved, and show the new level now
    const task = hub.task(openId);
    memo.ctl.syncFrom(task?.note || "", task?.note_revision);
    const toggle = panel.querySelector('[data-fk="level"]');
    if (toggle && task) labelLevelToggle(toggle, levels.find((l) => l.id === task.level_id));
    stalePaint = true;
    return;
  }
  paint();
}

async function write(data, id = openId) {
  try {
    await hub.patchTask(id, data);
  } catch (e) {
    toast(`저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => write(data, id) } });
  }
}

// Always read from the server: classifications are edited in 분류 관리 / 계층 편집 while an issue can stay open.
// A failed read keeps the last good list instead of caching an empty one.
async function loadFields() {
  const nextLevels = await api.structureLevels().catch(() => levels);
  const nextFields = await api.todoFields().catch((e) => {
    if (!fields) toast(`분류를 불러오지 못했어요 · ${e.message}`, { error: true });
    return fields || [];
  });
  return { levels: nextLevels, fields: nextFields };
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

async function changeHierarchy(t, data) {
  if (hierarchyWrite || Object.entries(data).every(([key, value]) => t[key] === value)) return;
  const context = structure;
  const ticket = revision;
  const pending = context ? context.patch(t, data) : hub.patchTask(t.id, data);
  hierarchyWrite = pending;
  try {
    await pending;
  } catch (e) {
    toast(`저장하지 못했어요 · ${e.message}`, { error: true });
    if (ticket === revision) paint();
  } finally {
    hierarchyWrite = null;
  }
}

function levelPicker(t) {
  const ticket = revision;
  const context = structure;
  const picker = levelChips({
    levels, current: t.level_id,
    onPick: (id) => changeHierarchy(hub.task(t.id) ?? t, { level_id: id }),
    onChanged: async (next, _selected, setCurrent) => {
      await context?.levelsChanged(next);
      if (ticket !== revision) return;
      levels = next;
      const fresh = await api.getTodo(t.id);
      if (ticket !== revision) return;
      hub.putTask(fresh);
      setCurrent(fresh.level_id);
      for (const other of panel.querySelectorAll(".level-picker")) {
        if (other !== picker) other.replaceWith(levelPicker(fresh));
      }
      labelLevelToggle(panel.querySelector(".insp-level-toggle"), levels.find((l) => l.id === fresh.level_id));
      if (context) related = context.tasks();
      panel.querySelector(".insp-order-warnings")?.replaceChildren(...hierarchyWarnings(fresh));
    },
  });
  return picker;
}

function labelLevelToggle(toggle, level) {
  toggle.replaceChildren(levelGlyph(level, "i s"), el("span", "", level?.label ?? "수준"), svg("chev", "i s"));
  toggle.setAttribute("aria-label", `수준 변경 · ${level?.label ?? ""}`);
}

function issueLink(t) {
  return drawerButton(`#${t.id} ${t.title}`, () => {
    if (structure) structure.openRelated(t.id);
    else openInspector(t.id);
  }, "chip-link");
}

function parentRow(t) {
  const parts = [];
  if (t.parent_task_id != null) {
    const byId = new Map(related.map((issue) => [issue.id, issue]));
    const ancestors = [];
    const seen = new Set([t.id]);
    for (let p = byId.get(t.parent_task_id); p && !seen.has(p.id); p = byId.get(p.parent_task_id)) {
      ancestors.unshift(p);
      seen.add(p.id);
    }
    const trail = el("div", "insp-ancestors");
    for (const issue of ancestors) {
      if (trail.childElementCount) trail.append(el("span", "chip-note", "›"));
      trail.append(issueLink(issue));
    }
    if (!ancestors.length) trail.append(issueLink({ id: t.parent_task_id, title: "" }));
    parts.push(trail);
  } else parts.push(el("span", "chip-note", "최상위"));
  const change = drawerButton("바꾸기…", () =>
    openParentSheet({ task: t, tasks: related, levels, onPick: (pid) => changeHierarchy(t, { parent_task_id: pid }) }));
  change.dataset.fk = "parent";
  parts.push(change);
  if (t.parent_task_id != null) {
    parts.push(drawerButton("최상위로", () => changeHierarchy(t, { parent_task_id: null })));
  }
  return row("상위", "hier", ...parts);
}

function hierarchyWarnings(t) {
  const rank = (issue) => rankOf(issue, levels);
  const parent = related.find((issue) => issue.id === t.parent_task_id);
  const reversed = related.filter((issue) => issue.parent_task_id === t.id && rank(issue) > rank(t)).length;
  const warnings = [];
  if (parent && rank(parent) < rank(t)) warnings.push(el("span", "chip-note warn", "⤴ 역순 · 상위보다 높은 수준이에요."));
  if (reversed) warnings.push(el("span", "chip-note warn", `⤴ 역순 · 하위 ${reversed}개가 이 수준보다 높아요.`));
  return warnings;
}

function hierarchyRows(t) {
  const children = related.filter((issue) => issue.parent_task_id === t.id)
    .sort((a, b) => rankOf(b, levels) - rankOf(a, levels) || a.id - b.id);
  const links = el("div", "insp-children");
  links.append(...children.map(issueLink));
  if (structure) links.append(drawerButton("하위 추가", () => structure?.addChild(t.id)));
  const warnings = el("div", "insp-order-warnings");
  warnings.append(...hierarchyWarnings(t));
  return [row("수준", "hier", levelPicker(t), warnings), parentRow(t),
    row(`하위 ${children.length}개`, "hier", links)];
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

function paint() {
  stalePaint = false;
  const t = hub.task(openId);
  if (!t) return;
  const keep = document.activeElement?.dataset?.fk;
  const pickedLevel = document.activeElement?.closest(".level-picker button[data-level-id]");
  const headLevel = pickedLevel?.closest(".insp-head-level");
  const scroll = panel.querySelector(`[data-issue="${t.id}"] .insp-b`)?.scrollTop ?? 0;
  const head = el("div", "insp-h");
  const grow = el("div", "grow");
  const identity = el("div", "insp-identity");
  identity.append(el("div", "k", `이슈 #${t.id}`));
  const picker = el("div", "insp-head-level");
  picker.id = "insp-head-level";
  picker.hidden = !levelsExpanded;
  if (levelsExpanded) picker.append(levelPicker(t));
  const toggle = drawerButton("", () => {
    levelsExpanded = !levelsExpanded;
    toggle.setAttribute("aria-expanded", String(levelsExpanded));
    picker.hidden = !levelsExpanded;
    picker.replaceChildren(...(levelsExpanded ? [levelPicker(hub.task(t.id) ?? t)] : []));
  }, "chip insp-level-toggle");
  toggle.dataset.fk = "level";
  toggle.setAttribute("aria-expanded", String(levelsExpanded));
  toggle.setAttribute("aria-controls", picker.id);
  labelLevelToggle(toggle, levels.find((l) => l.id === t.level_id));
  identity.append(toggle);
  grow.append(identity, picker);
  const title = el("h3", "", t.title);
  title.contentEditable = "plaintext-only";
  title.spellcheck = false;
  title.setAttribute("role", "textbox");
  title.setAttribute("aria-label", "제목");
  title.dataset.fk = "title";
  title.dataset.savedTitle = t.title;
  title.addEventListener("keydown", (e) => {
    if (e.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); title.blur(); }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      title.textContent = hub.task(t.id)?.title ?? t.title;
      if (structure) structure.focusRow();
      else title.blur();
    }
  });
  title.addEventListener("blur", () => {
    const v = title.textContent.trim();
    if (v && v !== (hub.task(t.id)?.title ?? t.title)) write({ title: v }, t.id);
    else title.textContent = hub.task(openId)?.title ?? t.title;
  });
  grow.append(title);
  const close = dismissButton();
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
    ...hierarchyRows(t),
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
      revision: t.note_revision,
      draftKey: `memo:${id}`,
      loadLatest: async () => {
        const task = await api.getTodo(id);
        return { content: task.note || "", revision: task.note_revision };
      },
      pagePath: t.page_path || undefined,
      compact: true,
      label: "메모",
      placeholder: "이 이슈에 대한 메모 — 입력하면 자동으로 저장돼요 · 이미지는 붙여넣기",
      foldScope: `t:${id}`,
      // after the issue gets a page this URL keeps working (the server looks in the page folder first)
      fileUrl: (rel) => `/api/todos/${id}/file?name=${encodeURIComponent(rel.replace(/^files\//, ""))}`,
      upload: (file, name) => api.uploadTodoFile(id, file, name),
      save: async (md, revision) => {
        const task = await hub.patchTask(id, { note: md.trim() ? md : null, note_revision: revision });
        return task.note_revision;
      },
      onError: (e, retry) => {
        if (e.status !== 409) toast(`메모를 저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: retry } });
      },
    });
    memo = { id, ctl };
  } else {
    memo.ctl.syncFrom(t.note || "", t.note_revision);
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
  panel.firstChild.dataset.issue = t.id;
  panel.firstChild.append(head, body, foot);
  body.scrollTop = scroll;
  const nextFocus = pickedLevel
    ? (headLevel ? picker : body).querySelector('.level-picker button[aria-pressed="true"]')
    : keep && panel.querySelector(`[data-fk="${keep}"]`);
  nextFocus?.focus({ preventScroll: true });
}
