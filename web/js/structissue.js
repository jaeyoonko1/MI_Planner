// V-011 · Jira-style issue hierarchy sheets for the structure screen and the issue inspector:
//  - "이슈 추가": one sheet for every level (에픽 … 이슈) and every view mode (hierarchy / classification / free layout)
//  - "이슈 계층 편집": rename, shape, color, order, add, delete levels + bring classification values in as issues
//  - "상위 바꾸기": pick a parent issue (buttons + search, D-12)
// The leaf level "이슈" is implicit (level_id null) and always the lowest.
import { api } from "./api.js";
import { COLORS, SHAPES, colorName, issueIcon, levelIcon, shapeName } from "./levels.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { el, svg } from "./ui.js";

export const LEAF_LABEL = "이슈";
const rank = (levels, id) => (id == null ? 0 : levels.find((l) => l.id === id)?.rank ?? 0);
export const levelLabel = (levels, id) => (id == null ? LEAF_LABEL : levels.find((l) => l.id === id)?.label ?? LEAF_LABEL);
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

// ---- 이슈 추가 ------------------------------------------------------------------------------------
// mode "issues": parents = [context issue and its ancestors]; "fields"/"free": `place` says where it lands.
// submit({ title, level_id, parent_task_id }) -> created task. Returns nothing; the caller repaints.
export function openAddIssueSheet({ mode, levels, parents = [], place = "", initialParent = null, initialLevel, submit }) {
  const s = openSheet({
    title: "이슈 추가",
    sub: mode === "issues" ? "에픽 같은 상위 이슈도, 그 아래의 이슈도 여기서 바로 만들어요." : place || "분류 없이 최상위에 추가해요.",
  });
  let parent = initialParent;
  const parentRank = () => (parent == null ? Infinity : rank(levels, parents.find((p) => p.id === parent)?.level_id));
  // default: the top level at the top; under a parent, the level just below it (Jira: epic -> its issues)
  const top = () => (parent == null ? levels[0]?.id ?? null : levels.find((l) => l.rank < parentRank())?.id ?? null);
  let level = initialLevel !== undefined ? initialLevel : top();
  let again = false;
  const input = el("input", "pg-title");
  input.type = "text";
  input.maxLength = 200;
  input.placeholder = "제목 — 예: 프로젝트, 스터디, LOT-TEST-001 리뷰";
  input.setAttribute("aria-label", "이슈 제목");
  const rows = el("div", "pg-values");
  const err = el("p", "ferr");
  err.setAttribute("role", "alert");
  const made = el("p", "hint");
  made.setAttribute("aria-live", "polite");

  const paint = () => {
    rows.replaceChildren();
    if (mode === "issues") {
      const pr = parentRank();
      const lvItems = [...levels, null].map((l) => ({
        value: l ? l.id : null, label: l ? l.label : LEAF_LABEL, icon: levelGlyph(l, "i s"),
        disabled: l && l.rank > pr ? "상위 이슈보다 높은 수준은 그 아래에 만들 수 없어요" : "",
      }));
      rows.append(field("수준", chips("이슈 수준", lvItems, level, (v) => { level = v; paint(); })));
      const pItems = [{ value: null, label: "최상위" }, ...parents.map((p) => ({
        value: p.id, label: `#${p.id} ${p.title}`, icon: levelGlyph(levels.find((l) => l.id === p.level_id), "i s"),
      }))];
      rows.append(field("상위", chips("상위 이슈", pItems, parent, (v) => {
        parent = v;
        level = top();
        paint();
      })));
    }
    const more = el("button", "chip", "계속 추가");
    more.type = "button";
    more.title = "만든 뒤 창을 닫지 않고 다음 이슈를 이어서 입력해요";
    more.setAttribute("aria-pressed", String(again));
    more.addEventListener("click", () => { again = !again; more.setAttribute("aria-pressed", String(again)); });
    rows.append(field("", more));
  };
  paint();
  const ok = button("추가", "pri", null);
  // Submissions run one after another; with "계속 추가" the box clears at once so the next title can be typed
  // while the previous one is still being saved (a fast typist never merges two titles).
  let chain = Promise.resolve();
  let pending = 0;
  const go = () => {
    const title = input.value.trim();
    if (!title) { if (!pending) { err.textContent = "제목을 입력하세요."; input.focus(); } return; }
    const spec = { title, level_id: mode === "issues" ? level : null, parent_task_id: mode === "issues" ? parent : null };
    err.textContent = "";
    if (again) input.value = "";
    else ok.disabled = true;
    pending++;
    chain = chain.then(async () => {
      try {
        const t = await submit(spec);
        if (again) made.textContent = `#${t.id} ‘${t.title}’를 만들었어요. 다음 제목을 입력하세요.`;
        else s.close();
      } catch (e) {
        err.textContent = `‘${spec.title}’ · ${e.message}`;
        if (!input.value) input.value = spec.title;
      } finally {
        pending--;
        ok.disabled = false;
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
// Candidates: not itself, not inside its own subtree, and not a lower level than the issue (rank rule).
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
  const mine = rank(levels, task.level_id);
  const hasKids = new Set(kids.keys());
  return tasks
    .filter((t) => !banned.has(t.id) && rank(levels, t.level_id) >= mine)
    .sort((a, b) => rank(levels, b.level_id) - rank(levels, a.level_id) || Number(hasKids.has(b.id)) - Number(hasKids.has(a.id)) || a.id - b.id);
}

export function openParentSheet({ task, tasks, levels, onPick }) {
  const s = openSheet({ title: `#${task.id} 상위 이슈`, sub: "고른 이슈의 하위로 옮겨요. 하위 이슈도 함께 따라가요." });
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
    if (!hits.length && k) list.append(el("p", "hint", "맞는 이슈가 없어요. 더 낮은 수준의 이슈 아래로는 옮길 수 없어요."));
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
      const below = levels[i + 1]?.label ?? LEAF_LABEL;
      const ok = await confirmSheet({
        title: `수준 ‘${l.label}’ 삭제`,
        content: [el("p", "", l.used_by ? `이 수준의 이슈 ${l.used_by}개는 지우지 않고 ‘${below}’ 수준으로 바뀌어요. 상위·하위 연결은 그대로예요.` : "이 수준을 쓰는 이슈가 없어요.")],
        confirmLabel: "삭제", danger: true,
      });
      if (!ok) return;
      try {
        const res = await api.deleteLevel(l.id);
        await changed(`수준 ‘${l.label}’을(를) 지웠어요`, { ms: 8000, action: { label: "되돌리기", run: async () => { await api.structureRestore(res.trash_id); await changed("수준을 되돌렸어요"); } } });
      } catch (er) { fail(er); }
    });
    del.setAttribute("aria-label", `${l.label} 수준 삭제`);
    const grow = el("span", "grow");
    grow.append(name);
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
  const whereChips = [["top", "맨 위"], ["bottom", "이슈 바로 위"]].map(([k, label]) => {
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
        field("수준", chips("만들 수준", levels.map((l) => ({ value: l.id, label: l.label, icon: levelIcon(l, "i s") })), lid, (v) => { lid = v; paint(); })),
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
    const leaf = el("li", "lvrow fixed");
    leaf.append(el("span", "lvorder", String(levels.length + 1)));
    const pick = el("span", "lvpick static");
    pick.append(issueIcon(), el("span", "", LEAF_LABEL));
    leaf.append(pick, el("span", "grow"), el("small", "hint", "가장 아래 수준 · 고정"));
    list.append(leaf);
    await paintConvert();
  }

  const sec = el("section", "ds");
  sec.append(el("h3", "", "수준"), list, err);
  const sec2 = el("section", "ds");
  sec2.append(el("h3", "", "수준 추가"), where, addForm, el("p", "hint", "상위 이슈는 같거나 더 높은 수준이어야 해요. 순서를 바꿔 이 규칙이 깨지면 바꾸지 않고 알려 줘요."));
  s.body.append(sec, sec2, conv);
  s.foot.append(button("닫기", "pri", () => s.close()));
  load();
}
