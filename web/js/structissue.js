// V-011 · Jira-style issue hierarchy sheets for the structure screen and the issue inspector:
//  - "이슈 추가": one sheet for every level (에픽 … 이슈) and every view mode (hierarchy / classification / free layout)
//  - "이슈 계층 편집": rename, shape, color, order, add, delete levels + bring classification values in as issues
//  - "상위 바꾸기": pick a parent issue (buttons + search, D-12)
import { api } from "./api.js";
import { registerContext } from "./contextmenu.js";
import { COLORS, SHAPES, colorName, issueIcon, levelIcon, shapeName } from "./levels.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { issueAncestorPath, issuePathLabel, missingIssueParentLabel } from "./structmodel.js";
import { toast } from "./toast.js";
import { el, svg } from "./ui.js";

const rank = (levels, id) => levels.find((l) => l.id === id)?.rank ?? 0;
export function levelGlyph(level, cls = "i") { return level ? levelIcon(level, cls) : issueIcon(cls); }

function chips(label, items, current, onPick) {
  const wrap = el("div", "chips");
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", label);
  for (const it of items) {
    const b = el("button", "chip");
    b.type = "button";
    if (it.icon) b.append(it.icon);
    b.append(el("span", "", it.label));
    b.setAttribute("aria-pressed", String(it.value === current));
    if (it.disabled) { b.disabled = true; b.title = it.disabled; }
    b.addEventListener("click", () => onPick(it.value));
    wrap.append(b);
  }
  return wrap;
}

function field(label, ...content) {
  const r = el("div", "pg-row");
  r.append(el("span", "k", label));
  const v = el("div", "pv");
  v.append(...content);
  r.append(v);
  return r;
}

// The chip group owns level administration. Callers own the issue's selected level.
export function levelChips({ levels, current, onPick, onChanged, label = "이슈 수준" }) {
  const wrap = el("div", "level-picker");
  const options = el("div", "chips");
  options.setAttribute("role", "group");
  options.setAttribute("aria-label", label);
  const status = el("div", "level-status");
  status.setAttribute("role", "status");
  wrap.append(options, status);
  let busy = false;

  const report = (message, error = false) => {
    status.replaceChildren(el("span", error ? "ferr" : "hint", message));
  };
  const change = async (op, message, { select, focus } = {}) => {
    if (busy) return false;
    busy = true;
    report("");
    try {
      const result = await op();
      levels = await api.structureLevels();
      if (select) current = result.id;
      if (!levels.some((l) => l.id === current)) current = levels.find((l) => l.is_default)?.id;
      paint(focus ?? current);
      report(message);
      await onChanged?.(levels, current, (value) => {
        if (value === current) return;
        current = value;
        const active = options.contains(document.activeElement);
        paint(active ? value : undefined);
      });
      return result;
    } catch (e) {
      report(e.message, true);
      return false;
    } finally {
      busy = false;
    }
  };
  function editName(chip, item) {
    if (busy || options.querySelector("input")) return;
    const form = el("form", "level-name-edit");
    const input = el("input", "pg-path");
    input.maxLength = 30;
    input.value = item?.label ?? "";
    input.placeholder = "수준 이름";
    input.setAttribute("aria-label", item ? "수준 이름 바꾸기" : "새 수준 이름");
    const cancel = () => { form.replaceWith(chip); chip.focus(); };
    const save = button("저장", "sm", null);
    save.type = "submit";
    form.append(input, save, button("취소", "sm quiet", cancel));
    chip.replaceWith(form);
    form.addEventListener("keydown", (e) => {
      if (e.isComposing || input.disabled) return;
      if (e.key === "Enter" && e.target === input) {
        e.preventDefault();
        form.requestSubmit();
        return;
      }
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancel();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      if (value === item?.label) { cancel(); return; }
      const index = levels.findIndex((l) => l.id === current);
      input.disabled = true;
      const ok = await change(
        () => item ? api.patchLevel(item.id, { label: value }) : api.addLevel({ label: value, index: Math.max(0, index) }),
        item ? "수준 이름을 바꿨어요." : "새 수준을 만들었어요.",
        { select: !item, focus: item?.id },
      );
      if (!ok && input.isConnected) { input.disabled = false; input.focus(); }
    });
    input.focus();
    input.select();
  }

  async function remove(item, index) {
    const target = levels[index + 1] ?? levels[index - 1];
    if (busy || !target) return;
    const ok = await confirmSheet({
      title: `수준 ‘${item.label}’ 삭제`,
      content: [el("p", "", `이슈 ${item.used_by}개는 ‘${target.label}’ 수준으로 옮겨요.`)],
      confirmLabel: "삭제", danger: true,
    });
    if (!ok) return;
    const removed = await change(() => api.deleteLevel(item.id), `‘${item.label}’ 수준을 지웠어요.`);
    if (!removed) return;
    const undo = button("되돌리기", "sm", () =>
      change(() => api.structureRestore(removed.trash_id), "수준을 되돌렸어요.", { focus: item.id }));
    status.append(undo);
    undo.focus();
  }

  function paint(focusId) {
    options.replaceChildren();
    levels.forEach((item, index) => {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.dataset.levelId = item.id;
      chip.append(levelGlyph(item, "i s"), el("span", "", item.label));
      if (item.is_default) {
        const star = el("span", "level-star", "★");
        star.setAttribute("aria-label", "기본 수준");
        chip.append(star);
      }
      chip.setAttribute("aria-pressed", String(item.id === current));
      chip.title = "수준 선택 · 우클릭 또는 Shift+F10으로 관리";
      chip.addEventListener("click", () => {
        if (busy) return;
        current = item.id;
        for (const b of options.querySelectorAll("[aria-pressed]")) b.setAttribute("aria-pressed", String(b === chip));
        onPick(item.id);
      });
      const move = (offset) => {
        const ids = levels.map((l) => l.id);
        [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
        return change(() => api.orderLevels(ids), "수준 순서를 바꿨어요.", { focus: item.id });
      };
      registerContext(chip, () => [[
        { label: "이름 바꾸기", icon: "edit", run: () => editName(chip, item) },
        { label: "위로", icon: "arrow-up", disabled: index === 0 && "맨 위 수준이에요", run: () => move(-1) },
        { label: "아래로", icon: "arrow-down", disabled: index === levels.length - 1 && "맨 아래 수준이에요", run: () => move(1) },
        { label: "기본 수준으로", checked: item.is_default, disabled: item.is_default && "이미 기본 수준이에요", run: () => change(() => api.patchLevel(item.id, { is_default: true }), "기본 수준을 바꿨어요.", { focus: item.id }) },
        { label: "삭제…", icon: "trash", danger: true, disabled: levels.length === 1 && "마지막 수준은 삭제할 수 없어요", run: () => remove(item, index) },
      ]]);
      options.append(chip);
      if (item.id === focusId) chip.focus();
    });
    const add = button("+ 새 수준", "sm", () => editName(add));
    add.classList.add("chip");
    options.append(add);
  }
  paint();
  return wrap;
}

// ---- 이슈 추가 ------------------------------------------------------------------------------------
export function openAddIssueSheet({
  mode, levels, tasks, initialParent = null, asChild = false, location = [], props = {}, onLevelsChanged, onClose, submit,
}) {
  const s = openSheet({ title: "이슈 추가", onClose });
  let parent = initialParent;
  let level = levels.find((l) => l.is_default)?.id ?? null;
  if (asChild && parent != null) {
    const parentRank = rank(levels, tasks.find((t) => t.id === parent)?.level_id);
    level = levels.find((l) => l.rank < parentRank)?.id ?? level;
  }
  const values = { ...props };
  let again = false;
  const input = el("input", "pg-title");
  input.type = "text";
  input.maxLength = 200;
  input.placeholder = "제목";
  input.setAttribute("aria-label", "이슈 제목");
  const picker = levelChips({
    levels, current: level,
    onPick: (id) => { level = id; },
    onChanged: async (next, selected) => {
      levels = next;
      level = selected;
      repaintParent();
      await onLevelsChanged?.(next);
    },
  });
  const positions = el("div", "issue-add-position");
  const repaintParent = (focus = false) => {
    positions.replaceChildren();
    if (mode !== "issues") {
      const path = el("div", "chips");
      if (mode === "fields") {
        for (const { key, label } of location) {
          if (!Object.hasOwn(values, key)) continue;
          const chip = button(`${label} 빼기`, "sm", () => { delete values[key]; repaintParent(); });
          chip.classList.add("chip");
          path.append(chip);
        }
      } else {
        for (const label of location) path.append(el("span", "lvchip", label));
      }
      if (!path.childElementCount) path.append(el("span", "hint", mode === "free" ? "최상위" : "분류 값 미지정"));
      positions.append(field(mode === "free" ? "그룹" : "분류 값", path));
    }
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const { ancestors, missingParentId } = issueAncestorPath({ parent_task_id: parent }, byId);
    const parentPath = ancestors.map((t) =>
      issuePathLabel(t, mode === "issues" ? levels.find((l) => l.id === t.level_id) : null));
    if (missingParentId != null) parentPath.unshift(missingIssueParentLabel(missingParentId));
    const controls = el("div", "chips");
    const chooseParent = button(parent == null ? "상위 이슈 지정…" : "다른 상위…", "sm", () =>
      openParentSheet({
        task: { id: null, parent_task_id: parent }, tasks, levels,
        onPick: (id) => { parent = id; repaintParent(true); },
      }));
    if (parentPath.length || mode === "issues") controls.append(el("span", "lvchip", parentPath.join(" › ") || "최상위"));
    controls.append(chooseParent);
    if (parent != null) controls.append(button("최상위", "sm quiet", () => { parent = null; repaintParent(true); }));
    positions.append(field("상위", controls));
    if (mode !== "issues" && parent != null) positions.append(field("", el("span", "hint", "상하위 연결은 이슈 계층 보기에서 보여요.")));
    if (focus) chooseParent.focus();
  };
  repaintParent();
  const more = el("button", "chip", "계속 추가");
  more.type = "button";
  more.setAttribute("aria-pressed", "false");
  more.addEventListener("click", () => { again = !again; more.setAttribute("aria-pressed", String(again)); });
  const err = el("p", "ferr");
  err.setAttribute("role", "alert");
  const made = el("p", "hint");
  made.setAttribute("aria-live", "polite");
  const rows = el("div", "pg-values");
  rows.append(field("수준", picker), positions, field("", more));

  const ok = button("추가", "pri", null);
  let chain = Promise.resolve();
  let pending = 0;
  const go = () => {
    const title = input.value.trim();
    if (!title) { if (!pending) { err.textContent = "제목을 입력하세요."; input.focus(); } return; }
    if (ok.disabled) return;
    const spec = { title, level_id: level, parent_task_id: parent, props: { ...values } };
    const keepOpen = again;
    err.textContent = "";
    input.value = "";
    ok.disabled = !keepOpen;
    pending++;
    chain = chain.then(async () => {
      try {
        const t = await submit(spec);
        if (keepOpen) made.textContent = `#${t.id} ‘${t.title}’를 만들었어요.`;
        else s.close();
      } catch (e) {
        err.textContent = `‘${title}’ · ${e.message}`;
        if (!input.value) input.value = title;
      } finally {
        pending--;
        if (!pending) ok.disabled = false;
      }
    });
  };
  ok.addEventListener("click", go);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); go(); } });
  s.body.append(input, rows, err, made);
  s.foot.append(button("취소", "", () => s.close()), ok);
  input.focus();
}

// ---- 상위 바꾸기 ------------------------------------------------------------------------------------
// Only the issue itself and its descendants are excluded.
export function parentCandidates(task, tasks, levels) {
  const kids = new Map();
  for (const t of tasks) {
    if (t.parent_task_id == null) continue;
    if (!kids.has(t.parent_task_id)) kids.set(t.parent_task_id, []);
    kids.get(t.parent_task_id).push(t.id);
  }
  const banned = new Set([task.id]);
  const stack = [task.id];
  while (stack.length) for (const c of kids.get(stack.pop()) || []) if (!banned.has(c)) { banned.add(c); stack.push(c); }
  const hasKids = new Set(kids.keys());
  return tasks
    .filter((t) => !banned.has(t.id))
    .sort((a, b) => rank(levels, b.level_id) - rank(levels, a.level_id) || Number(hasKids.has(b.id)) - Number(hasKids.has(a.id)) || a.id - b.id);
}

export function openParentSheet({ task, tasks, levels, onPick }) {
  const s = openSheet({ title: task.id == null ? "상위 이슈 지정" : `#${task.id} 상위 이슈`,
    sub: task.id == null ? "새 이슈의 상위를 골라요." : "고른 이슈의 하위로 옮겨요. 하위 이슈도 함께 따라가요." });
  const all = parentCandidates(task, tasks, levels);
  const q = el("input", "pg-path");
  q.type = "search";
  q.placeholder = "번호나 제목으로 찾기";
  q.setAttribute("aria-label", "상위 이슈 찾기");
  const list = el("div", "dest");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "상위 이슈");
  const pick = (v) => { s.close(); onPick(v); };
  const add = (label, value, icon, here) => {
    const b = el("button", "dest-btn");
    b.type = "button";
    if (icon) b.append(icon);
    b.append(el("span", "dest-name", label));
    if (here) { b.append(el("span", "badge", "현재")); b.disabled = true; }
    b.addEventListener("click", () => pick(value));
    list.append(b);
  };
  const paint = () => {
    list.replaceChildren();
    const k = q.value.trim().toLowerCase().replace(/^#/, "");
    add("최상위 (상위 없음)", null, null, task.parent_task_id == null);
    const hits = all.filter((t) => !k || String(t.id) === k || t.title.toLowerCase().includes(k));
    for (const t of hits.slice(0, 60)) {
      const lv = levels.find((l) => l.id === t.level_id);
      add(`#${t.id} ${t.title}${lv ? ` · ${lv.label}` : ""}`, t.id, levelGlyph(lv), task.parent_task_id === t.id);
    }
    if (hits.length > 60) list.append(el("p", "hint", `${hits.length - 60}개 더 있어요. 검색으로 좁혀 보세요.`));
    if (!hits.length && k) list.append(el("p", "hint", "맞는 이슈가 없어요."));
  };
  q.addEventListener("input", paint);
  paint();
  s.body.append(q, list);
  s.foot.append(button("취소", "", () => s.close()));
  q.focus();
}

// ---- 이슈 계층 편집 ---------------------------------------------------------------------------------
// Every change is saved at once (each one is small and reversible); onChanged() repaints the structure.
export function openLevelSheet({ onChanged }) {
  const s = openSheet({ title: "이슈 계층 편집", sub: "에픽 같은 상위 수준도 이슈예요. 수준 이름·모양·순서는 바로 반영돼요.", wide: true });
  const list = el("ul", "lvlist");
  const err = el("p", "ferr");
  err.setAttribute("role", "alert");
  let levels = [];
  let fields = [];
  const changed = async (msg, opts) => { if (msg) toast(msg, opts); await onChanged?.(); await load(); };
  const fail = (e) => { err.textContent = e.message; };
  const cycle = (arr, cur) => arr[(arr.findIndex(([k]) => k === cur) + 1) % arr.length][0];

  function rowFor(l, i) {
    const li = el("li", "lvrow");
    li.append(el("span", "lvorder", String(i + 1)));
    const shape = el("button", "lvpick");
    shape.type = "button";
    shape.append(levelIcon(l));
    shape.title = `모양 ${shapeName(l.icon)} · 색 ${colorName(l.color)} — 누르면 모양, Shift+클릭은 색이 바뀌어요`;
    shape.setAttribute("aria-label", `${l.label} 모양 ${shapeName(l.icon)}, 색 ${colorName(l.color)}. 눌러 모양 바꾸기, Shift와 함께 눌러 색 바꾸기`);
    shape.addEventListener("click", async (e) => {
      const data = e.shiftKey ? { color: cycle(COLORS, l.color) } : { icon: cycle(SHAPES, l.icon) };
      try { await api.patchLevel(l.id, data); await changed(); } catch (er) { fail(er); }
    });
    const name = el("input", "lvname-in");
    name.type = "text";
    name.value = l.label;
    name.maxLength = 30;
    name.setAttribute("aria-label", `${l.label} 수준 이름`);
    const save = async () => {
      const v = name.value.trim();
      if (!v || v === l.label) { name.value = l.label; return; }
      try { await api.patchLevel(l.id, { label: v }); await changed(`수준 이름을 ‘${v}’(으)로 바꿨어요`); } catch (er) { name.value = l.label; fail(er); }
    };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); name.blur(); } });
    name.addEventListener("change", save);
    const used = el("small", "cnt", `이슈 ${l.used_by}개`);
    const move = async (d) => {
      const ids = levels.map((x) => x.id);
      const j = i + d;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      try { await api.orderLevels(ids); await changed("수준 순서를 바꿨어요"); } catch (er) { fail(er); }
    };
    const up = el("button", "ib sm");
    up.type = "button";
    up.append(svg("arrow-up", "i s"));
    up.setAttribute("aria-label", `${l.label} 위로`);
    up.disabled = i === 0;
    up.addEventListener("click", () => move(-1));
    const down = el("button", "ib sm");
    down.type = "button";
    down.append(svg("arrow-down", "i s"));
    down.setAttribute("aria-label", `${l.label} 아래로`);
    down.disabled = i === levels.length - 1;
    down.addEventListener("click", () => move(1));
    const del = button("삭제", "sm quiet danger", async () => {
      const target = levels[i + 1] ?? levels[i - 1];
      const ok = await confirmSheet({
        title: `수준 ‘${l.label}’ 삭제`,
        content: [el("p", "", l.used_by ? `이 수준의 이슈 ${l.used_by}개는 지우지 않고 ‘${target.label}’ 수준으로 바뀌어요. 상위·하위 연결은 그대로예요.` : "이 수준을 쓰는 이슈가 없어요.")],
        confirmLabel: "삭제", danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.deleteLevel(l.id);
        await changed(`수준 ‘${l.label}’을(를) 지웠어요`, { ms: 8000, action: { label: "되돌리기", run: async () => { await api.structureRestore(res.trash_id); await changed("수준을 되돌렸어요"); } } });
      } catch (er) { fail(er); }
    });
    del.setAttribute("aria-label", `${l.label} 수준 삭제`);
    del.disabled = levels.length === 1;
    const grow = el("span", "grow");
    grow.append(name);
    if (l.is_default) grow.append(el("small", "hint", "기본 수준"));
    li.append(shape, grow, used, up, down, del);
    return li;
  }

  const addForm = el("form", "newcls");
  const addIn = el("input");
  addIn.type = "text";
  addIn.maxLength = 30;
  addIn.placeholder = "새 수준 이름 — 예: 이니셔티브, 작업";
  addIn.setAttribute("aria-label", "새 수준 이름");
  let at = "bottom";
  const where = el("div", "chips");
  where.setAttribute("role", "group");
  where.setAttribute("aria-label", "새 수준 위치");
  const whereChips = [["top", "맨 위"], ["bottom", "맨 아래"]].map(([k, label]) => {
    const b = el("button", "chip", label);
    b.type = "button";
    b.setAttribute("aria-pressed", String(k === at));
    b.addEventListener("click", () => { at = k; whereChips.forEach((c, n) => c.setAttribute("aria-pressed", String(["top", "bottom"][n] === k))); });
    where.append(b);
    return b;
  });
  const addBtn = button("수준 추가", "sm", null);
  addBtn.type = "submit";
  addForm.append(addIn, addBtn);
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = addIn.value.trim();
    if (!label) { addIn.focus(); return; }
    try {
      await api.addLevel({ label, index: at === "top" ? 0 : levels.length });
      addIn.value = "";
      await changed(`‘${label}’ 수준을 만들었어요`);
    } catch (er) { fail(er); }
  });

  // explicit migration path: classification values -> upper-level issues
  const conv = el("section", "ds");
  async function paintConvert() {
    conv.replaceChildren(el("h3", "", "분류 값을 상위 이슈로 가져오기"));
    const usable = fields.filter((f) => f.type === "choice" && !f.builtin && !f.archived && f.options.some((o) => !o.archived));
    if (!usable.length || !levels.length) { conv.append(el("p", "hint", "가져올 선택형 분류가 없어요.")); return; }
    let key = usable[0].key;
    let lid = levels[0].id;
    const body = el("div", "pg-values");
    const paint = () => {
      const f = usable.find((x) => x.key === key);
      const n = f.options.filter((o) => !o.archived).length;
      body.replaceChildren(
        field("분류", chips("가져올 분류", usable.map((x) => ({ value: x.key, label: x.label })), key, (v) => { key = v; paint(); })),
        field("수준", levelChips({ levels, current: lid, label: "만들 수준", onPick: (v) => { lid = v; }, onChanged: async (next, selected) => {
          levels = next;
          lid = selected;
          list.replaceChildren(...levels.map(rowFor));
          await onChanged?.();
        } })),
        field("", el("span", "hint", `‘${f.label}’ 값 ${n}개마다 이슈를 하나씩 만들고, 그 값을 가진 최상위 이슈를 아래로 넣어요. 분류 값은 그대로 남고, 다시 해도 중복으로 만들지 않아요.`)),
        field("", button("가져오기", "sm", async () => {
          try {
            const res = await api.convertLevels({ field_key: key, level_id: lid });
            const created = res.created;
            await changed(`상위 이슈 ${created.length}개를 만들고 이슈 ${res.linked}개를 그 아래로 넣었어요`, created.length ? {
              ms: 9000,
              action: { label: "되돌리기", run: async () => { await api.structureDelete({ items: created.map((id) => ({ kind: "issue", id })), children: "move_up" }); await changed("가져오기를 되돌렸어요"); } },
            } : {});
          } catch (er) { fail(er); }
        })),
      );
    };
    paint();
    conv.append(body);
  }

  async function load() {
    try { [levels, fields] = await Promise.all([api.structureLevels(), api.fieldsAll()]); } catch (e) { fail(e); return; }
    err.textContent = "";
    list.replaceChildren(...levels.map(rowFor));
    await paintConvert();
  }

  const sec = el("section", "ds");
  sec.append(el("h3", "", "수준"), list, err);
  const sec2 = el("section", "ds");
  sec2.append(el("h3", "", "수준 추가"), where, addForm, el("p", "hint", "수준 순서는 같은 상위에 속한 이슈의 표시 순서에 적용돼요."));
  s.body.append(sec, sec2, conv);
  s.foot.append(button("닫기", "pri", () => s.close()));
  load();
}
