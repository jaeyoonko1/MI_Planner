// Structure screen (P2B-07 / P2B-08): hierarchy bar + compact worksheet (one row = hierarchy name, status / done count,
// product, requester, due) and the classification manager tab. Two modes share one row tree (structmodel.js):
//  - classification view: handle drag changes the whole perspective; dropping an issue on a group rewrites its values
//  - free layout: groups move with their children (cycles rejected); positions are stored apart from the page tree
//  - issue hierarchy (V-011, Jira style, the default): every row is an issue; 에픽 and other upper levels are issues
//    too, nesting comes from the parent link, so the inspector and this tree always agree
import { api } from "./api.js";
import { renderClasses } from "./classes.js";
import { renderRules } from "./rules.js";
import { hub } from "./hub.js";
import { openInspector } from "./inspector.js";
import { openLevelEditor } from "./leveldialog.js";
import { issueIcon, levelIcon } from "./levels.js";
import { buildFieldTree, buildFreeTree, buildIssueTree, flatten, hasKids, isInside, visibleRows } from "./structmodel.js";
import { VALUE_MODES, openDeleteSheet } from "./structdelete.js";
import { levelGlyph, openAddIssueSheet, openLevelSheet, openParentSheet } from "./structissue.js";
import { openAddGroupSheet, openMoveSheet } from "./structmove.js";
import { click as selClick, deleteItems, isTypingTarget, moveTo, neighbourAfterRemoval, prune, selectAll, single, toggleActive } from "./structselect.js";
import { createUndoStack } from "./structundo.js";
import { toast } from "./toast.js";
import { registerContext } from "./contextmenu.js";
import { dueInfo, el, emptyState, errorState, fmtMD, skeleton, svg } from "./ui.js";

const STATUS = { todo: "할일", doing: "진행", hold: "보류", done: "완료" };
let folded = new Set(); // folded group ids (tab session)
let selected = ""; // selected row id
let activeRefresh = null; // the mounted worksheet's task reload (hub subscriber)
let activeAdd = null; // the mounted worksheet's "이슈 추가" (hero button)
const history = createUndoStack(); // deletions of this browser session (V-004); the server keeps the snapshots
let detachKeys = null; // removes the mounted worksheet's document key handler

const labelOf = (field, v) => (v === undefined || v === null || v === "" ? "" : field?.options?.find((o) => o.value === v)?.label ?? String(v));

function gripCell() {
  const g = el("span", "grip");
  g.append(svg("grip", "i s"));
  return g;
}

function iconBtn(id, label, text) {
  const b = el("button", "btn sm tbtn");
  b.type = "button";
  b.append(svg(id, "i"), el("span", "", text ?? label));
  b.title = label;
  return b;
}

async function renderTree(container, initialView, reloadScreen) {
  let view = initialView;
  let tasks = [], fields = {}, free = null, tree = [], index = new Map(), rowEls = new Map();
  let dragging = null;
  let picked = new Set(); // every selected row id; `selected` is the active one (keyboard focus, single-row tools)
  let anchor = ""; // where a Shift range grows from
  detachKeys?.();

  const free_ = () => view.mode === "free";
  const issues_ = () => view.mode === "issues";
  const ilevels = () => view.issue_levels ?? [];
  const levelByKey = () => Object.fromEntries([...view.levels, ...view.available].map((l) => [l.key, l]));
  const productKey = () => Object.values(fields).find((f) => f.key === "product" || f.label === "제품")?.key ?? null;

  async function fetchAll() {
    const [t, f] = await Promise.all([api.todos({}), api.todoFields()]);
    tasks = t.items;
    fields = Object.fromEntries(f.map((x) => [x.key, x]));
    free = free_() ? await api.structureFree() : null;
  }
  function rebuild() {
    tree = issues_() ? buildIssueTree(tasks, ilevels())
      : free_() ? buildFreeTree(free, tasks, levelByKey()) : buildFieldTree(tasks, view.mode === "fields" ? view.levels : [], fields);
    index = new Map(flatten(tree).map((n) => [n.id, n]));
    adopt(prune(cur(), new Set(index.keys())));
  }
  const cur = () => ({ ids: picked, anchor, active: selected });
  const adopt = (sel) => { picked = sel.ids; anchor = sel.anchor; selected = sel.active; };

  // ---- hierarchy bar -------------------------------------------------------------------
  const bar = el("div", "hbar");
  const toolbar = el("div", "stools");
  const live = el("span", "slive");
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  const panel = el("section", "panel sview");
  const head = el("div", "shead");
  const rows = el("div", "srows");
  rows.setAttribute("role", "treegrid");
  rows.setAttribute("aria-label", "업무 구조");
  rows.setAttribute("aria-multiselectable", "true");
  const foot = el("div", "panel-foot");
  panel.append(head, rows, foot);
  const notice = el("div");

  const saveStyles = () => Object.fromEntries(view.levels.map((l) => [l.key, { icon: l.icon, color: l.color }]));
  const persistView = async (levels, mode = "fields") => {
    view = await api.saveStructureView({ mode, levels, styles: saveStyles() });
    folded = new Set();
    adopt(single(""));
    await fetchAll();
    draw();
  };

  async function reorderLevels(from, to, after) {
    const keys = view.levels.map((l) => l.key);
    const i = keys.indexOf(from);
    if (i < 0 || from === to) return;
    keys.splice(i, 1);
    let j = keys.indexOf(to);
    if (j < 0) return;
    if (after) j++;
    keys.splice(j, 0, from);
    const before = view.levels.map((l) => l.key);
    if (keys.join() === before.join()) return;
    try {
      await persistView(keys);
      toast("계층 순서를 바꿨어요", { action: { label: "되돌리기", run: () => persistView(before) } });
      bar.querySelector(`[data-level="${from}"]`)?.focus();
    } catch (e) {
      toast(`순서를 바꾸지 못했어요 · ${e.message}`, { error: true });
    }
  }

  function drawBar() {
    bar.replaceChildren(el("span", "k", "계층"));
    if (free_()) {
      bar.append(el("span", "freebadge", "자유 배치"));
    } else if (issues_()) {
      for (const l of ilevels()) {
        const t = el("span", "lvchip");
        t.append(levelIcon(l), l.label);
        bar.append(t, el("span", "sep", "›"));
      }
      const t = el("span", "lvchip issue");
      t.append(issueIcon(), "이슈");
      bar.append(t);
    } else {
      view.levels.forEach((l, i) => {
        const t = el("button", "lvchip lvdrag");
        t.type = "button";
        t.draggable = true;
        t.dataset.level = l.key;
        t.title = "끌어서 순서를 바꿔요 · Alt+←/→";
        t.setAttribute("aria-label", `${l.label} 단계, ${i + 1}번째. Alt+왼쪽·오른쪽 화살표로 순서 변경`);
        t.append(svg("grip", "i s grip"), levelIcon(l), l.label);
        t.addEventListener("dragstart", (e) => { dragging = { level: l.key }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.key); t.classList.add("dragging"); });
        t.addEventListener("dragend", () => { dragging = null; bar.querySelectorAll(".drop-before,.drop-after,.dragging").forEach((x) => x.classList.remove("drop-before", "drop-after", "dragging")); });
        t.addEventListener("dragover", (e) => {
          if (!dragging?.level || dragging.level === l.key) return;
          e.preventDefault();
          const r = t.getBoundingClientRect();
          const after = e.clientX > r.left + r.width / 2;
          t.classList.toggle("drop-after", after);
          t.classList.toggle("drop-before", !after);
        });
        t.addEventListener("dragleave", () => t.classList.remove("drop-before", "drop-after"));
        t.addEventListener("drop", (e) => {
          if (!dragging?.level) return;
          e.preventDefault();
          const after = t.classList.contains("drop-after");
          const from = dragging.level;
          t.classList.remove("drop-before", "drop-after");
          reorderLevels(from, l.key, after);
        });
        t.addEventListener("keydown", (e) => {
          if (!e.altKey || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
          e.preventDefault();
          const keys = view.levels.map((x) => x.key);
          const n = keys[keys.indexOf(l.key) + (e.key === "ArrowLeft" ? -1 : 1)];
          if (n) reorderLevels(l.key, n, e.key === "ArrowRight");
        });
        bar.append(t, el("span", "sep", "›"));
      });
      const t = el("span", "lvchip issue");
      t.append(issueIcon(), "이슈");
      bar.append(t);
    }
    // layout mode toggle (chips, D-12)
    const modes = el("div", "chips modesw");
    modes.setAttribute("role", "group");
    modes.setAttribute("aria-label", "배치 방식");
    for (const [k, label] of [["issues", "이슈 계층"], ["fields", "분류 기준"], ["free", "자유 배치"]]) {
      const b = el("button", "chip", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(k === view.mode));
      b.addEventListener("click", () => switchMode(k));
      modes.append(b);
    }
    const edit = el("button", "btn sm hedit", "계층 편집");
    edit.type = "button";
    edit.prepend(svg("hier", "i"));
    edit.addEventListener("click", () => (issues_()
      ? openLevelSheet({ onChanged: reloadScreen })
      : openLevelEditor(view, { onApplied: reloadScreen, openClasses: () => { location.hash = "#/structure/classes"; } })));
    bar.append(el("span", "grow"), modes, edit);
  }

  async function switchMode(k) {
    if (k === view.mode) return;
    try {
      if (k === "free") {
        await persistView(view.levels.map((l) => l.key), "free");
        toast("자유 배치로 바꿨어요. 그룹을 끌어 옮겨 보세요", { ms: 3200 });
      } else if (k === "issues") {
        await persistView(view.levels.map((l) => l.key), "issues");
        toast("이슈 계층으로 바꿨어요. 에픽도 이슈라서 바로 추가·수정·삭제할 수 있어요", { ms: 3200 });
      } else if (view.free_reason || !view.levels.length) {
        openLevelEditor({ ...view, mode: "fields" }, { onApplied: reloadScreen, openClasses: () => { location.hash = "#/structure/classes"; } });
      } else {
        await persistView(view.levels.map((l) => l.key), "fields");
      }
    } catch (e) {
      toast(`전환하지 못했어요 · ${e.message}`, { error: true });
    }
  }

  // ---- toolbar -------------------------------------------------------------------------
  const bExpand = iconBtn("expand-all", "모두 펼치기");
  const bCollapse = iconBtn("collapse-all", "모두 접기");
  const bCopy = iconBtn("copy", "복사");
  const bMove = iconBtn("move-to", "이동", "이동…");
  const bOpen = iconBtn("note", "이슈 열기");
  const bAdd = iconBtn("folder", "그룹 추가");
  const bAddIssue = iconBtn("plus", "이슈 추가");
  const bDelete = iconBtn("trash", "삭제", "삭제");
  const bUndo = iconBtn("undo", "되돌리기", "되돌리기");
  bDelete.classList.add("danger");
  const info = el("small", "sinfo");
  toolbar.append(bExpand, bCollapse, el("span", "vr"), bAddIssue, bAdd, bCopy, bMove, bOpen, el("span", "vr"), bDelete, bUndo, el("span", "grow"), live);
  bAddIssue.addEventListener("click", () => addIssue());
  bExpand.addEventListener("click", () => { folded = new Set(); draw(); });
  bCollapse.addEventListener("click", () => { folded = new Set(flatten(tree).filter(hasKids).map((n) => n.id)); draw(); });
  bOpen.addEventListener("click", () => { const n = index.get(selected); if (n?.task) openInspector(n.task.id); });
  bCopy.addEventListener("click", () => copySelected());
  bDelete.addEventListener("click", () => requestDelete());
  bUndo.addEventListener("click", () => undoLast());
  bMove.addEventListener("click", () => {
    const n = index.get(selected);
    if (!n) return;
    if (issues_()) {
      openParentSheet({ task: n.task, tasks, levels: ilevels(), onPick: (pid) => placeNode(n, pid == null ? null : index.get(`i${pid}`) ?? { task: { id: pid } }, null) });
      return;
    }
    openMoveSheet({ node: n, tree, free: free_(), onPick: (dest) => placeNode(n, dest, null) });
  });
  bAdd.addEventListener("click", () => {
    const n = index.get(selected);
    const parent = !n ? null : n.kind === "group" ? n : n.parent;
    openAddGroupSheet({
      parentLabel: parent?.label,
      onCreate: async (label) => {
        free = await api.structureAddGroup({ label, parent_id: parent?.nodeId ?? null });
        if (parent) folded.delete(parent.id);
        rebuild();
        draw();
        toast(`‘${label}’ 그룹을 만들었어요`);
      },
    });
  });

  // ---- 이슈 추가 (V-011): any level, any mode -----------------------------------------------------
  const assignProps = (g) => Object.fromEntries(Object.entries(g?.assign ?? {}).filter(([, v]) => v != null));
  async function created(t) {
    await refreshTasks(true);
    if (free_()) free = await api.structureFree();
    rebuild();
    reveal(`i${t.id}`);
    say(`#${t.id} ‘${t.title}’를 만들었어요.`);
    return t;
  }
  function addIssue(ctx = picked.size > 1 ? null : index.get(selected), { asChild = false } = {}) {
    const levels = ilevels();
    if (issues_()) {
      const parents = [];
      for (let p = ctx; p; p = p.parent) parents.push(p.task);
      const t = ctx?.task;
      const initialParent = !t ? null : asChild || t.level_id != null || ctx.children?.length ? t.id : ctx.parent?.task.id ?? null;
      openAddIssueSheet({
        mode: "issues", levels, parents, initialParent,
        submit: async (d) => created(await hub.createTask({ title: d.title, level_id: d.level_id, parent_task_id: d.parent_task_id })),
      });
      return;
    }
    const g = !ctx ? null : ctx.kind === "group" ? ctx : ctx.parent;
    const props = assignProps(g);
    if (free_()) {
      openAddIssueSheet({
        mode: "free", levels, place: g ? `‘${g.label}’ 그룹 안에 추가해요.` : "",
        submit: async (d) => {
          const t = await hub.createTask({ title: d.title, ...(Object.keys(props).length ? { props } : {}) });
          if (g?.nodeId != null) free = (await api.structureFreeMove({ kind: "issue", id: t.id, parent_id: g.nodeId, before: null })).free;
          return created(t);
        },
      });
      return;
    }
    const where = Object.keys(props).length ? pathText(props) : "";
    openAddIssueSheet({
      mode: "fields", levels, place: where ? `${where} 그룹에 추가해요. 이 분류 값이 새 이슈에 들어가요.` : "",
      submit: async (d) => created(await hub.createTask({ title: d.title, ...(where ? { props } : {}) })),
    });
  }
  activeAdd = () => addIssue();

  function syncTools() {
    const many = picked.size > 1;
    const n = many ? null : index.get(selected);
    const group = n?.kind === "group";
    const copyLabel = !n ? "복사" : n.kind === "issue" ? (n.level ? `${n.level.label} 복사` : "이슈 복사") : n.key === "epic" ? "에픽 복사" : "그룹 복사";
    bCopy.querySelector("span").textContent = copyLabel;
    let why = "";
    if (many) why = "행을 하나만 골라야 복사할 수 있어요";
    else if (!n) why = "복사할 행을 먼저 고르세요";
    else if (group && !free_() && (n.none || fields[n.key]?.type !== "choice")) why = n.none ? "미분류 그룹은 복사할 수 없어요" : "이 분류의 그룹은 복사할 수 없어요";
    bCopy.disabled = Boolean(why) || !n;
    bCopy.title = why || (n?.kind === "group" && !free_() && n.key === "epic" ? "같은 에픽의 모든 유형 가지의 이슈를 새 번호로 복사해요" : "새 번호의 독립된 복사본을 만들어요");
    bMove.disabled = !n || (group && !free_());
    bMove.title = issues_() ? "상위 이슈 바꾸기" : group && !free_() ? "그룹은 계층 순서를 바꿔 옮겨요" : "다른 그룹으로 이동";
    bOpen.disabled = !n || group;
    bAdd.hidden = !free_();
    const doomed = deleteItems([...picked], index, { free: free_() });
    bDelete.disabled = !doomed.items.length;
    bDelete.querySelector("span").textContent = doomed.items.length > 1 ? `삭제 ${doomed.items.length}` : "삭제";
    bDelete.title = !picked.size ? "삭제할 행을 먼저 고르세요" : !doomed.items.length ? "미분류 묶음은 분류 값이 아니라 지울 수 없어요" : "휴지통으로 보내요 · Delete";
    const last = history.peekUndo();
    bUndo.disabled = !last || history.busy;
    bUndo.title = last ? `${last.label} 되돌리기 · Ctrl+Z` : "되돌릴 삭제가 없어요";
    const groups = flatten(tree).filter(hasKids).length;
    info.textContent = issues_() ? `${tasks.length}개 이슈 · 하위가 있는 이슈 ${groups}개` : `${tasks.length}개 이슈 · ${groups}개 그룹`;
    if (!foot.contains(info)) foot.prepend(info);
    const all = groups > 0 && [...index.values()].filter(hasKids).every((g) => folded.has(g.id));
    bExpand.disabled = folded.size === 0;
    bCollapse.disabled = groups === 0 || all;
  }

  // ---- rows ---------------------------------------------------------------------------
  const pk = () => productKey();
  function drawHead() {
    head.replaceChildren(el("span", "", "계층 / 이슈"), el("span", "", "상태 · 완료"), ...(pk() ? [el("span", "h-prod", "제품")] : []), el("span", "", "요청자"), el("span", "", "납기"));
    panel.classList.toggle("noprod", !pk());
  }

  function foldBtn(n, label) {
    const open = !folded.has(n.id);
    const fold = el("button", "fold");
    fold.type = "button";
    fold.tabIndex = -1;
    fold.setAttribute("aria-label", `${label} ${open ? "접기" : "펼치기"}`);
    fold.setAttribute("aria-expanded", String(open));
    fold.append(svg("chev", "i s"));
    fold.dataset.act = "fold";
    return fold;
  }

  function rollCell(n) {
    const roll = el("span", "rollc");
    const bar_ = el("span", "roll");
    const fill = el("i");
    fill.style.width = (n.items.length ? Math.round((n.done / n.items.length) * 100) : 0) + "%";
    bar_.append(fill);
    roll.append(bar_, el("span", "cnt", `${n.done}/${n.items.length}`));
    roll.setAttribute("aria-label", `완료 ${n.done} / 전체 ${n.items.length}`);
    return roll;
  }

  function groupRow(n, depth) {
    const open = !folded.has(n.id);
    const r = el("div", "srow grp");
    const first = el("div", "c1");
    const name = el("b", "gname" + (n.none ? " none" : ""), n.label);
    name.dataset.act = "gname";
    first.append(foldBtn(n, n.label), levelIcon(n.level), name, el("small", "lvname", n.level.label));
    if (free_()) first.append(gripCell());
    r.append(first, rollCell(n));
    r.setAttribute("aria-expanded", String(open));
    return r;
  }

  function issueRow(n) {
    const t = n.task;
    const kids = issues_() && n.children?.length > 0;
    const head = issues_() && (kids || n.level);
    const r = el("div", "srow issue" + (t.status === "done" ? " done" : "") + (head ? " head" : ""));
    const first = el("div", "c1");
    first.append(kids ? foldBtn(n, t.title) : el("span", "fold sp"), issues_() ? levelGlyph(n.level) : issueIcon(), el("span", "tid", `#${t.id}`));
    const title = el("span", "stitle", t.title);
    title.dataset.act = "title";
    first.append(title);
    if (issues_() && n.level) first.append(el("small", "lvname", n.level.label));
    if (free_()) first.append(gripCell());
    const st = el("span", "c-st");
    st.append(el("span", `pill st-${t.status}`, STATUS[t.status] ?? t.status));
    if (kids) {
      st.append(el("span", "cnt sub", `${n.done}/${n.items.length}`));
      st.title = `하위 이슈 완료 ${n.done} / 전체 ${n.items.length}`;
      r.setAttribute("aria-expanded", String(!folded.has(n.id)));
    }
    const cells = [first, st];
    if (pk()) cells.push(el("span", "c-tx c-prod", labelOf(fields[pk()], t.props?.[pk()]) || "—"));
    cells.push(el("span", "c-tx", t.requester ? `@${t.requester}` : "—"));
    const due = el("span", "c-due");
    const di = dueInfo(t.due_date, t.status === "done");
    due.append(di ? el("span", `pill ${di.level}`, t.due_date && di.level === "none" ? fmtMD(t.due_date) : di.text) : el("span", "c-tx", "—"));
    cells.push(due);
    r.append(...cells);
    return r;
  }

  function draw() {
    const prevFocus = rows.contains(document.activeElement) ? document.activeElement.closest(".srow")?.dataset.id : null;
    drawBar();
    drawHead();
    rebuild();
    rows.replaceChildren();
    rowEls = new Map();
    adopt(prune(cur(), new Set(visibleRows(tree, folded).map((v) => v.node.id)))); // a folded-away row is never "selected"
    if (!tasks.length) {
      rows.append(emptyState({
        title: "아직 이슈가 없어요", icon: "hier",
        desc: issues_() ? "에픽 같은 상위 이슈부터 만들어 보세요. 예: 프로젝트, 스터디, 업무" : "이슈를 추가하면 여기에 분류별로 모여요.",
        action: { label: "이슈 추가", run: () => addIssue(null) },
      }));
    } else {
      const vis = visibleRows(tree, folded);
      vis.forEach(({ node: n, depth }, i) => {
        const r = n.kind === "group" ? groupRow(n, depth) : issueRow(n);
        r.dataset.id = n.id;
        r.setAttribute("role", "row");
        r.setAttribute("aria-level", String(depth + 1));
        r.setAttribute("aria-selected", String(picked.has(n.id)));
        r.style.setProperty("--d", depth);
        r.tabIndex = n.id === selected || (!selected && i === 0) ? 0 : -1;
        r.draggable = free_() || n.kind === "issue";
        rows.append(r);
        rowEls.set(n.id, r);
      });
    }
    foot.replaceChildren(
      info,
      el("span", "", issues_() ? "이슈 가운데에 놓으면 그 하위로 · 가장자리는 같은 상위로 · Alt+→ 앞 이슈 안으로 · Alt+← 바깥으로"
        : free_() ? "그룹 가운데에 놓으면 하위로 · 가장자리는 앞뒤 순서 · Alt+방향키로 이동" : "이슈를 그룹에 놓으면 그 그룹의 분류 값으로 바뀌어요 · 계층 칩을 끌어 관점 변경"),
      el("span", "", "Enter 상세 · F2 제목 수정 · Shift·Ctrl 다중 선택 · Delete 삭제 · Ctrl+Z 되돌리기"),
    );
    notice.replaceChildren();
    if (view.free_reason) {
      const w = el("div", "notice warn");
      w.setAttribute("role", "status");
      w.append(svg("alert", "i s"), el("span", "", view.free_reason));
      const fix = el("button", "btn sm", "계층 다시 설정");
      fix.type = "button";
      fix.addEventListener("click", () => openLevelEditor({ ...view, mode: "fields" }, { onApplied: reloadScreen, openClasses: () => { location.hash = "#/structure/classes"; } }));
      w.append(fix);
      notice.append(w);
    }
    syncTools();
    head.style.paddingRight = `calc(var(--px) + ${rows.offsetWidth - rows.clientWidth}px)`;
    if (prevFocus && rowEls.has(prevFocus)) rowEls.get(prevFocus).focus({ preventScroll: true });
  }

  function select(id, opts) { choose(single(id), opts); }
  function choose(sel, { focus = false } = {}) {
    adopt(sel);
    rows.querySelectorAll('.srow[aria-selected="true"]').forEach((x) => x.setAttribute("aria-selected", "false"));
    rows.querySelectorAll(".srow[tabindex='0']").forEach((x) => { x.tabIndex = -1; });
    for (const id of picked) rowEls.get(id)?.setAttribute("aria-selected", "true");
    const r = rowEls.get(selected);
    if (r) {
      r.tabIndex = 0;
      if (focus) r.focus();
    }
    syncTools();
  }

  function reveal(id) {
    let n = index.get(id);
    if (!n) return;
    for (let p = n.parent; p; p = p.parent) folded.delete(p.id);
    adopt(single(id));
    draw();
    rowEls.get(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // ---- actions ------------------------------------------------------------------------
  const pathText = (assign) => Object.entries(assign).map(([k, v]) => `${fields[k]?.label ?? k} ${labelOf(fields[k], v) || "미분류"}`).join(" · ");

  async function placeNode(node, dest, before) {
    // dest: group node or null (top level); before: sibling node or null (end)
    if (issues_()) {
      const t = node.task;
      const to = dest?.task?.id ?? null;
      const prev = t.parent_task_id ?? null;
      if (dest?.kind && isInside(dest, node)) { say("이슈를 자기 하위로 옮길 수 없어요. 순환이 생겨요."); return; }
      if (prev === to) { say("이미 이 위치에 있어요."); return; }
      try {
        await hub.patchTask(t.id, { parent_task_id: to });
        if (dest?.id) folded.delete(dest.id);
        await refreshTasks(true);
        rebuild();
        reveal(node.id);
        const where = dest?.task?.title ? `#${to} ‘${dest.task.title}’ 아래` : to ? `#${to} 아래` : "최상위";
        toast(`#${t.id} → ${where}`, { action: { label: "되돌리기", run: () => hub.patchTask(t.id, { parent_task_id: prev }) } });
      } catch (e) {
        toast(`옮기지 못했어요 · ${e.message}`, { error: true });
      }
      return;
    }
    if (free_()) {
      if (node.kind === "group" && dest && isInside(dest, node)) { say("그룹을 자기 하위로 옮길 수 없어요. 순환이 생겨요."); return; }
      try {
        const res = await api.structureFreeMove({
          kind: node.kind, id: node.kind === "group" ? node.nodeId : node.task.id, parent_id: dest?.nodeId ?? null,
          before: before ? { kind: before.kind, id: before.kind === "group" ? before.nodeId : before.task.id } : null,
        });
        free = res.free;
        if (res.changed.length) await refreshTasks(true);
        if (dest) folded.delete(dest.id);
        rebuild();
        reveal(node.id);
        toast(res.changed.length ? `${res.changed.length}개 이슈의 분류 값이 바뀌었어요 · ${dest ? pathText(dest.assign) : ""}`.replace(/ · $/, "") : "위치를 옮겼어요");
      } catch (e) {
        toast(e.message, { error: true });
      }
      return;
    }
    // classification view: the destination group's values become the issue's values
    const t = node.task;
    const diff = {};
    const prev = {};
    for (const [k, v] of Object.entries(dest.assign)) {
      const cur = t.props?.[k] ?? null;
      if (cur !== v) { diff[k] = v; prev[k] = cur; }
    }
    if (!Object.keys(diff).length) { say("이미 이 그룹에 있어요."); return; }
    try {
      await hub.patchTask(t.id, { props: diff });
      toast(`#${t.id} → ${pathText(dest.assign)}`, { action: { label: "되돌리기", run: () => hub.patchTask(t.id, { props: prev }) } });
      adopt(single(node.id));
    } catch (e) {
      toast(`옮기지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => placeNode(node, dest, before) } });
    }
  }

  async function copySelected() {
    const n = index.get(selected);
    if (!n || bCopy.disabled) return;
    try {
      let res, focusId;
      if (n.kind === "issue") {
        res = await api.structureCopy({ kind: "issue", task_id: n.task.id });
        focusId = `i${res.created[0]}`;
      } else if (free_()) {
        res = await api.structureCopy({ kind: "node", node_id: n.nodeId });
        free = res.free;
        focusId = `g${res.node_id}`;
      } else {
        res = await api.structureCopy({ kind: "group", field_key: n.key, value: n.value, task_ids: n.items.map((t) => t.id) });
        focusId = res.created.length ? `i${res.created[0]}` : "";
      }
      await refreshTasks(true);
      if (res.option) fields = Object.fromEntries((await api.todoFields()).map((x) => [x.key, x]));
      rebuild();
      reveal(index.has(focusId) ? focusId : n.id);
      if (n.kind === "issue") {
        const id = res.created[0];
        toast(`새 이슈 #${id}로 복사했어요`, { action: { label: "열기", run: () => openInspector(id) } });
      } else {
        toast(`하위 이슈 ${res.created.length}개를 새 번호의 독립된 복사본으로 만들었어요${res.option ? ` · ‘${res.option.label}’` : ""}`);
      }
    } catch (e) {
      toast(`복사하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: copySelected } });
    }
  }

  async function refreshTasks(silent = false) {
    const t = await api.todos({});
    tasks = t.items;
    if (!silent) { rebuild(); draw(); }
  }
  activeRefresh = async (all = false) => {
    try {
      if (all) fields = Object.fromEntries((await api.todoFields()).map((x) => [x.key, x]));
      await refreshTasks();
    } catch { /* keep the last picture */ }
  };

  let sayTimer = 0;
  function say(msg) {
    live.textContent = msg;
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => { live.textContent = ""; }, 3500);
  }

  function renameIssue(n, rowEl) {
    const titleEl = rowEl.querySelector(".stitle");
    if (!titleEl || rowEl.querySelector(".ttitle-edit")) return;
    const t = n.task;
    const input = el("input", "ttitle-edit sedit");
    input.type = "text";
    input.value = t.title;
    input.setAttribute("aria-label", "이슈 제목");
    rowEl.draggable = false;
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      rowEl.draggable = true;
      if (save && v && v !== t.title) {
        titleEl.textContent = v;
        input.replaceWith(titleEl);
        try { await hub.patchTask(t.id, { title: v }); } catch (e) {
          titleEl.textContent = t.title;
          toast(`저장하지 못했어요 · ${e.message}`, { error: true });
        }
      } else {
        input.replaceWith(titleEl);
        if (save && !v) toast("제목은 비울 수 없어요", { error: true });
      }
    };
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); rowEl.focus(); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); rowEl.focus(); }
    });
    input.addEventListener("blur", () => finish(true));
    titleEl.replaceWith(input);
    input.focus();
    input.select();
  }

  // V-011: a group of the classification view is a classification value -> rename the option in place
  const renamable = (n) => n?.kind === "group" && !free_() && !n.none && fields[n.key]?.type === "choice";
  function renameGroup(n, rowEl) {
    const nameEl = rowEl.querySelector(".gname");
    if (!nameEl || !renamable(n) || rowEl.querySelector(".sedit")) return;
    const field = fields[n.key];
    const input = el("input", "ttitle-edit sedit");
    input.type = "text";
    input.value = n.label;
    input.maxLength = 50;
    input.setAttribute("aria-label", `${field.label} 값 이름`);
    let done = false;
    const setLabel = (label) => api.patchField(n.key, { options: field.options.map((o) => (o.value === n.value ? { ...o, label } : o)) });
    const finish = async (save) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.replaceWith(nameEl);
      if (!save || !v || v === n.label) return;
      const before = n.label;
      try {
        await setLabel(v);
        hub.emit({ kind: "fields" });
        toast(`${field.label} ‘${before}’ → ‘${v}’`, { action: { label: "되돌리기", run: async () => { await api.patchField(n.key, { options: (await api.todoFields()).find((f) => f.key === n.key).options.map((o) => (o.value === n.value ? { ...o, label: before } : o)) }); hub.emit({ kind: "fields" }); } } });
      } catch (e) { toast(`이름을 바꾸지 못했어요 · ${e.message}`, { error: true }); }
    };
    input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      e.stopPropagation();
      if (e.key === "Enter") { e.preventDefault(); finish(true); rowEl.focus(); }
      if (e.key === "Escape") { e.preventDefault(); finish(false); rowEl.focus(); }
    });
    input.addEventListener("blur", () => finish(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  // ---- delete / undo / redo (V-004) ----------------------------------------------------
  // Deleting is a soft delete on the server (one trash record per operation). The stack below only remembers the
  // record ids, so Ctrl+Z can restore several deletions in reverse order and Ctrl+Shift+Z / Ctrl+Y repeats them.
  const labelFor = (items, res) => {
    if (items.length === 1 && items[0].kind === "issue") {
      const t = tasks.find((x) => x.id === items[0].id);
      return t ? `#${t.id} ‘${t.title.length > 24 ? `${t.title.slice(0, 24)}…` : t.title}’` : res.summary;
    }
    return res.summary;
  };

  // Rows changed on the server: reload what the picture is made of, then repaint.
  async function settle(res, then) {
    if (free_() && res.free) free = res.free;
    hub.applyDays(res.journal_days);
    await refreshTasks(true);
    fields = Object.fromEntries((await api.todoFields()).map((x) => [x.key, x])); // a value delete / restore edits options
    rebuild();
    then?.();
    draw();
  }

  function focusRow(id) {
    const r = rowEls.get(id);
    if (!r) return;
    r.focus({ preventScroll: true });
    r.scrollIntoView({ block: "nearest" });
  }

  async function requestDelete() {
    const ids = [...picked].filter((id) => rowEls.has(id));
    if (!ids.length) { say("삭제할 행을 먼저 고르세요."); return; }
    const { items, blockedGroups } = deleteItems(ids, index, { free: free_() });
    if (!items.length) { say("미분류 묶음은 분류 값이 아니라 지울 수 없어요."); return; }
    const onlyValues = items.every((i) => i.kind === "value");
    const hasGroups = items.some((i) => i.kind !== "issue") || ids.some((id) => index.get(id)?.kind === "issue" && index.get(id).children?.length > 0);
    try {
      let children = "move_up";
      const impact = await api.structureDeletePreview({ items, children });
      if (impact.needs_confirm) {
        children = await openDeleteSheet({ hasGroups, modes: onlyValues ? VALUE_MODES : undefined, fetchImpact: (c) => api.structureDeletePreview({ items, children: c }) });
        if (!children) { focusRow(selected); return; }
      }
      await runDelete(items, children, blockedGroups);
    } catch (e) {
      toast(`삭제하지 못했어요 · ${e.message}`, { error: true });
    }
  }

  async function runDelete(items, children, blockedGroups = 0) {
    const vis = [...rowEls.keys()];
    const res = await api.structureDelete({ items, children });
    const label = labelFor(items, res);
    history.push({ label, items, children, trashId: res.trash_id });
    await settle(res, () => {
      const gone = new Set(vis.filter((id) => !index.has(id)));
      adopt(single(neighbourAfterRemoval(vis, gone)));
    });
    focusRow(selected);
    const skip = blockedGroups ? ` · 미분류 묶음 ${blockedGroups}개는 건너뛰었어요` : "";
    say(`${label} 삭제됨. Ctrl+Z로 되돌릴 수 있어요.`);
    toast(`${label} 삭제했어요${skip}`, { action: { label: "되돌리기", run: undoLast }, ms: 8000 });
  }

  const rowIds = (res) => [...res.groups.map((g) => `g${g}`), ...res.issues.map((t) => `i${t}`)];
  function showRestored(res) {
    const ids = rowIds(res).filter((id) => index.has(id));
    for (const id of ids) for (let p = index.get(id).parent; p; p = p.parent) folded.delete(p.id);
    const first = ids[0] ?? "";
    adopt({ ids: new Set(ids), anchor: first, active: first });
  }

  async function undoLast() {
    const e = history.takeUndo();
    if (!e) { say("되돌릴 삭제가 없어요."); return; }
    try {
      const res = await api.structureRestore(e.trashId);
      history.doneUndo(e);
      await settle(res, () => showRestored(res));
      focusRow(selected);
      say(`${e.label} 되돌렸어요.`);
      const note = res.journal_skipped ? ` · 일지 줄 ${res.journal_skipped}개는 바뀌어 있어 연결을 다시 걸지 못했어요` : "";
      toast(`${e.label} 되돌렸어요${note}`, history.peekRedo() ? { action: { label: "다시 삭제", run: redoLast } } : {});
    } catch (err) {
      history.failUndo(e, !(err.status === 404 || err.status === 409)); // gone / already restored: drop the entry
      toast(`되돌리지 못했어요 · ${err.message}`, { error: true });
      syncTools();
    }
  }

  async function redoLast() {
    const e = history.takeRedo();
    if (!e) { say("다시 삭제할 항목이 없어요."); return; }
    try {
      const vis = [...rowEls.keys()];
      const res = await api.structureDelete({ items: e.items, children: e.children });
      e.trashId = res.trash_id;
      history.doneRedo(e);
      await settle(res, () => {
        const gone = new Set(vis.filter((id) => !index.has(id)));
        adopt(single(neighbourAfterRemoval(vis, gone)));
      });
      focusRow(selected);
      say(`${e.label} 다시 삭제했어요.`);
      toast(`${e.label} 다시 삭제했어요`, { action: { label: "되돌리기", run: undoLast } });
    } catch (err) {
      history.failRedo(e, !(err.status === 404 || err.status === 409));
      toast(`다시 삭제하지 못했어요 · ${err.message}`, { error: true });
      syncTools();
    }
  }

  // Document-level keys so Delete / Ctrl+Z also work right after a click on empty space. Typing targets, open dialogs
  // and the inspector keep their own keys.
  function onDocKey(e) {
    if (!rows.isConnected) { detachKeys?.(); return; }
    if (e.defaultPrevented || e.isComposing || e.altKey) return;
    if (document.querySelector("dialog[open]") || isTypingTarget(e.target) || e.target.closest?.("aside.insp")) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.code === "KeyZ" ? "z" : e.code === "KeyY" ? "y" : e.key;
    if (mod && k === "z") { e.preventDefault(); (e.shiftKey ? redoLast : undoLast)(); return; }
    if (mod && !e.shiftKey && k === "y") { e.preventDefault(); redoLast(); return; }
    const inList = e.target === document.body || panel.contains(e.target);
    if (!mod && e.key === "Delete" && inList) { e.preventDefault(); requestDelete(); }
    else if (e.metaKey && e.key === "Backspace" && inList) { e.preventDefault(); requestDelete(); }
  }
  document.addEventListener("keydown", onDocKey);
  detachKeys = () => { document.removeEventListener("keydown", onDocKey); detachKeys = null; };

  // ---- events (delegated) --------------------------------------------------------------
  const rowOf = (e) => e.target.closest?.(".srow");
  const toggleFold = (id) => { folded.has(id) ? folded.delete(id) : folded.add(id); draw(); };

  rows.addEventListener("mousedown", (e) => { if (e.shiftKey && rowOf(e)) e.preventDefault(); }); // no text selection while ranging
  rows.addEventListener("click", (e) => {
    const r = rowOf(e);
    if (!r) return;
    const n = index.get(r.dataset.id);
    const mods = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey };
    if (e.target.closest('[data-act="fold"]')) { select(n.id); toggleFold(n.id); return; }
    choose(selClick(cur(), n.id, mods, [...rowEls.keys()]));
    if (!mods.shift && !mods.ctrl && n.kind === "issue" && e.target.closest('[data-act="title"]') && e.detail === 1) renameIssue(n, r);
  });
  rows.addEventListener("dblclick", (e) => {
    const r = rowOf(e);
    if (!r) return;
    const n = index.get(r.dataset.id);
    rows.querySelector(".sedit")?.blur();
    getSelection()?.removeAllRanges();
    if (n.kind === "group") toggleFold(n.id);
    else openInspector(n.task.id);
  });

  const siblingsOf = (n) => (n.parent ? n.parent.children : tree);
  rows.addEventListener("keydown", (e) => {
    const r = rowOf(e);
    if (!r || e.target !== r) return;
    const n = index.get(r.dataset.id);
    const ids = [...rowEls.keys()];
    const i = ids.indexOf(n.id);
    const go = (id) => { if (id) { e.preventDefault(); choose(moveTo(cur(), id, { shift: e.shiftKey }, ids), { focus: true }); } };
    if ((e.ctrlKey || e.metaKey) && (e.code === "KeyA" || e.key.toLowerCase() === "a")) { e.preventDefault(); choose(selectAll(cur(), ids), { focus: true }); return; }
    if (e.altKey && issues_()) {
      const sib = siblingsOf(n), k = sib.indexOf(n);
      if (e.key === "ArrowRight" && k > 0) placeNode(n, sib[k - 1], null);
      else if (e.key === "ArrowRight") say("앞에 같은 상위의 이슈가 없어요.");
      else if (e.key === "ArrowLeft" && n.parent) placeNode(n, n.parent.parent ?? null, null);
      else if (e.key === "ArrowLeft") say("이미 최상위예요.");
      else if (e.key === "ArrowUp" || e.key === "ArrowDown") say("이슈 계층의 순서는 수준·번호 순이에요. Alt+→ 하위로, Alt+← 바깥으로 옮겨요.");
      if (e.key.startsWith("Arrow")) e.preventDefault();
      return;
    }
    if (e.altKey && free_()) {
      const sib = siblingsOf(n), k = sib.indexOf(n);
      let handled = true;
      if (e.key === "ArrowUp" && k > 0) placeNode(n, n.parent, sib[k - 1]);
      else if (e.key === "ArrowDown" && k < sib.length - 1) placeNode(n, n.parent, sib[k + 2] ?? null);
      else if (e.key === "ArrowRight" && k > 0 && sib[k - 1].kind === "group") placeNode(n, sib[k - 1], null);
      else if (e.key === "ArrowLeft" && n.parent) { const gp = n.parent.parent; const ps = siblingsOf(n.parent); placeNode(n, gp ?? null, ps[ps.indexOf(n.parent) + 1] ?? null); }
      else handled = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key);
      if (handled) e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") go(ids[i + 1]);
    else if (e.key === "ArrowUp") go(ids[i - 1]);
    else if (e.key === "Home") go(ids[0]);
    else if (e.key === "End") go(ids[ids.length - 1]);
    else if (e.key === "ArrowRight" && hasKids(n)) { if (folded.has(n.id)) { e.preventDefault(); toggleFold(n.id); } else go(ids[i + 1]); }
    else if (e.key === "ArrowLeft" && hasKids(n) && !folded.has(n.id)) { e.preventDefault(); toggleFold(n.id); }
    else if (e.key === "ArrowLeft" && n.parent) go(n.parent.id);
    else if (e.key === "Enter") { e.preventDefault(); n.kind === "group" ? toggleFold(n.id) : openInspector(n.task.id); }
    else if (e.key === " ") { e.preventDefault(); (e.ctrlKey || e.metaKey) ? choose(toggleActive(cur())) : select(n.id); }
    else if (e.key === "Escape" && picked.size > 1) { e.preventDefault(); select(n.id); }
    else if (e.key === "F2" && n.kind === "issue") { e.preventDefault(); renameIssue(n, r); }
    else if (e.key === "F2" && renamable(n)) { e.preventDefault(); renameGroup(n, r); }
  });

  // ---- context menu (V-010): the toolbar buttons' own handlers, so delete keeps its confirm sheet and undo stack ----
  registerContext(rows, (ctx) => {
    const r = ctx.target.closest?.(".srow");
    const n = r && index.get(r.dataset.id);
    if (!n) return null;
    if (!picked.has(n.id)) select(n.id, { focus: true });
    const many = picked.size > 1;
    const group = n.kind === "group";
    const sib = siblingsOf(n);
    const k = sib.indexOf(n);
    const doomed = deleteItems([...picked], index, { free: free_() });
    const last = history.peekUndo();
    const place = issues_() && !many ? [
      { label: "앞 이슈 안으로", icon: "indent", keys: "Alt+→", disabled: !(k > 0) && "앞에 같은 상위의 이슈가 없어요", run: () => placeNode(n, sib[k - 1], null) },
      { label: "한 단계 바깥으로", icon: "outdent", keys: "Alt+←", disabled: !n.parent && "이미 최상위예요", run: () => placeNode(n, n.parent.parent ?? null, null) },
      { separator: true },
    ] : free_() && !many ? [
      { label: "위로", icon: "arrow-up", keys: "Alt+↑", disabled: k <= 0 && "맨 위예요", run: () => placeNode(n, n.parent, sib[k - 1]) },
      { label: "아래로", icon: "arrow-down", keys: "Alt+↓", disabled: k >= sib.length - 1 && "맨 아래예요", run: () => placeNode(n, n.parent, sib[k + 2] ?? null) },
      { label: "앞 그룹 안으로", icon: "indent", keys: "Alt+→", disabled: !(k > 0 && sib[k - 1].kind === "group") && "앞에 그룹이 없어요", run: () => placeNode(n, sib[k - 1], null) },
      { label: "한 단계 바깥으로", icon: "outdent", keys: "Alt+←", disabled: !n.parent && "이미 최상위예요", run: () => { const ps = siblingsOf(n.parent); placeNode(n, n.parent.parent ?? null, ps[ps.indexOf(n.parent) + 1] ?? null); } },
      { separator: true },
    ] : [];
    return [
      [
        !many && !group ? { label: "이슈 열기", icon: "open", keys: "Enter", run: () => openInspector(n.task.id) } : null,
        !many && hasKids(n) ? { label: folded.has(n.id) ? "펼치기" : "접기", icon: "chev", keys: folded.has(n.id) ? "→" : "←", run: () => toggleFold(n.id) } : null,
        !many && !group ? { label: "이름 변경", icon: "edit", keys: "F2", run: () => renameIssue(n, rowEls.get(n.id)) } : null,
        !many && renamable(n) ? { label: "값 이름 변경", icon: "edit", keys: "F2", run: () => renameGroup(n, rowEls.get(n.id)) } : null,
      ],
      [
        !many && issues_() ? { label: "하위 이슈 추가", icon: "plus", run: () => addIssue(n, { asChild: true }) } : null,
        !many && !issues_() ? { label: group ? "이 그룹에 이슈 추가" : "같은 그룹에 이슈 추가", icon: "plus", run: () => addIssue(n) } : null,
      ],
      [
        { label: bCopy.textContent.trim() || "복사", icon: "copy", disabled: bCopy.disabled && (bCopy.title || "복사할 수 없어요"), run: copySelected },
        { label: "이동", icon: "move-to", disabled: bMove.disabled && (many ? "행을 하나만 골라야 해요" : bMove.title), items: many ? null : [...place, { label: issues_() ? "상위 이슈 바꾸기…" : "다른 그룹으로…", icon: "move-to", run: () => bMove.click() }] },
      ],
      [
        last ? { label: `${last.label} 삭제 되돌리기`, icon: "undo", keys: "Ctrl+Z", disabled: history.busy && "처리 중이에요", run: undoLast } : null,
        { label: doomed.items.length > 1 ? `삭제 ${doomed.items.length}개` : "삭제", icon: "trash", danger: true, keys: "Delete", disabled: !doomed.items.length && "미분류 묶음은 지울 수 없어요", run: requestDelete },
      ],
    ];
  });

  // drag and drop: where would it land?
  const clearDrop = () => rows.querySelectorAll(".drop-in,.drop-before,.drop-after,.drop-bad").forEach((x) => x.classList.remove("drop-in", "drop-before", "drop-after", "drop-bad"));
  function dropPlan(target, e) {
    const src = dragging?.node;
    if (!src || target === src) return null;
    if (issues_()) {
      const r = rowEls.get(target.id).getBoundingClientRect();
      const f = (e.clientY - r.top) / r.height;
      if (f < 0.25) return { dest: target.parent, before: target, mode: "before" };
      if (f > 0.75) return { dest: target.parent, before: null, mode: "after" };
      return { dest: target, before: null, mode: "in" };
    }
    if (!free_()) return target.kind === "group" ? { dest: target, before: null, mode: "in" } : target.parent ? { dest: target.parent, before: null, mode: "in", row: target.parent } : null;
    const r = rowEls.get(target.id).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    if (target.kind === "group") {
      if (f < 0.28) return { dest: target.parent, before: target, mode: "before" };
      return { dest: target, before: null, mode: "in" };
    }
    if (f < 0.5) return { dest: target.parent, before: target, mode: "before" };
    const sib = siblingsOf(target);
    return { dest: target.parent, before: sib[sib.indexOf(target) + 1] ?? null, mode: "after" };
  }
  rows.addEventListener("dragstart", (e) => {
    const r = rowOf(e);
    if (!r || r.querySelector(".sedit")) { e.preventDefault(); return; }
    const n = index.get(r.dataset.id);
    dragging = { node: n };
    select(n.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", n.id);
    r.classList.add("dragging");
  });
  rows.addEventListener("dragend", () => { dragging = null; clearDrop(); rows.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging")); });
  rows.addEventListener("dragover", (e) => {
    const r = rowOf(e);
    if (!r || !dragging?.node) return;
    const target = index.get(r.dataset.id);
    clearDrop();
    const plan = dropPlan(target, e);
    if (!plan) return;
    if ((dragging.node.kind === "group" || issues_()) && plan.dest && isInside(plan.dest, dragging.node)) {
      r.classList.add("drop-bad");
      e.dataTransfer.dropEffect = "none";
      say(issues_() ? "이슈를 자기 하위로 옮길 수 없어요." : "그룹을 자기 하위로 옮길 수 없어요.");
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (plan.mode === "in") (plan.row ? rowEls.get(plan.row.id) : r).classList.add("drop-in");
    else r.classList.add(plan.mode === "before" ? "drop-before" : "drop-after");
  });
  rows.addEventListener("dragleave", (e) => { if (!rows.contains(e.relatedTarget)) clearDrop(); });
  rows.addEventListener("drop", (e) => {
    const r = rowOf(e);
    if (!r || !dragging?.node) return;
    e.preventDefault();
    const target = index.get(r.dataset.id);
    const plan = dropPlan(target, e);
    const src = dragging.node;
    clearDrop();
    dragging = null;
    if (plan) placeNode(src, plan.dest, plan.before);
  });

  await fetchAll();
  panel.replaceChildren(toolbar, head, rows, foot);
  container.replaceChildren(bar, notice, panel);
  draw();
}

export async function renderStructure(container, tab = "tree") {
  const page = el("div", "page structure");
  const hero = el("div", "hero");
  const grow = el("div", "grow");
  const lead = el("p", "lead");
  lead.append(el("b", "", "에픽도 이슈"), "예요. 어느 수준이든 여기서 바로 추가·수정·삭제하고, 분류 기준으로도 묶어 볼 수 있어요.");
  grow.append(el("div", "eyebrow", "구조"), el("h1", "h1", "업무 구조"), lead);
  hero.append(grow);
  const tabs = el("div", "chips tabsw");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "구조 화면");
  for (const [k, label, href] of [["tree", "이슈 구조", "#/structure"], ["classes", "분류 관리", "#/structure/classes"], ["rules", "페이지 위치 규칙", "#/structure/rules"]]) {
    const b = el("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(tab === k));
    b.addEventListener("click", () => { if (tab !== k) location.hash = href; });
    tabs.append(b);
  }
  hero.append(tabs);
  if (tab === "tree") {
    const add = el("button", "btn pri hero-add");
    add.type = "button";
    add.append(svg("plus", "i s"), el("span", "", "이슈 추가"));
    add.title = "선택한 위치에 이슈를 추가해요 · 에픽 같은 상위 이슈도 여기서";
    add.addEventListener("click", () => activeAdd?.());
    hero.insertBefore(add, tabs);
  }
  const host = el("div", "shost");
  page.append(hero, host);
  container.replaceChildren(page);
  host.replaceChildren(skeleton(5));
  activeRefresh = null;
  activeAdd = null;
  hub.on((info) => { if (info.kind === "task" || info.kind === "fields") activeRefresh?.(info.kind === "fields"); });
  const load = async () => {
    try {
      if (tab === "classes") await renderClasses(host, { reload: load });
      else if (tab === "rules") await renderRules(host, { reload: load });
      else {
        const view = await api.structureView();
        await renderTree(host, view, load);
      }
    } catch (e) {
      host.replaceChildren(errorState(e.message, load));
    }
  };
  await load();
}
