// Hierarchy edit dialog (P2B-07). Everything happens on a draft; only "적용" talks to the server
// (one atomic PUT), "취소"/Esc/backdrop throw the draft away. Hiding a level never touches issue values.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { colorName, COLORS, issueIcon, levelIcon, SHAPES, shapeName } from "./levels.js";
import { button, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, svg } from "./ui.js";

const MAX_NAME = 50;

// opts: { onApplied(view), openClasses() }
export function openLevelEditor(view, opts = {}) {
  const known = [...view.levels, ...view.available];
  const draft = { mode: view.mode, levels: view.levels.map((l) => ({ ...l })), active: view.levels[0]?.key ?? null };
  const snapshot = () => JSON.stringify([draft.mode, draft.levels.map((l) => [l.key, l.icon, l.color])]);
  const initial = snapshot();
  let newSeq = 0;
  let nameText = "";
  let nameError = "";
  let applyError = "";
  let busy = false;
  let focusKey = null;
  let dragKey = null;

  const sheet = openSheet({ title: "계층 편집", sub: "업무 구조를 어떤 분류로 묶어 볼지 정해요. 적용 전에는 아무것도 바뀌지 않아요.", wide: true });
  const { body, foot } = sheet;

  const pool = () => known.filter((k) => !draft.levels.some((l) => l.key === k.key));
  const active = () => draft.levels.find((l) => l.key === draft.active);
  const allLabels = () => [...known.map((k) => k.label), ...draft.levels.map((l) => l.label), "이슈"].map((s) => s.toLowerCase());

  function move(from, to) {
    if (to < 0 || to >= draft.levels.length || from === to) return;
    const [x] = draft.levels.splice(from, 1);
    draft.levels.splice(to, 0, x);
    announce(`${x.label} ${to + 1}번째로 이동`);
  }

  // First shape/color not yet used by another level, so a newly added level is distinguishable at a glance.
  function fresh(base) {
    const shapes = SHAPES.map(([k]) => k), colors = COLORS.map(([k]) => k);
    const clash = (k, v) => draft.levels.some((l) => l[k] === v);
    return {
      icon: clash("icon", base.icon) ? shapes.find((k) => !clash("icon", k)) ?? base.icon : base.icon,
      color: clash("color", base.color) ? colors.find((k) => !clash("color", k)) ?? base.color : base.color,
    };
  }

  function announce(text) { live.textContent = text; }

  function remove(i) {
    const [x] = draft.levels.splice(i, 1);
    if (draft.active === x.key) draft.active = draft.levels[Math.min(i, draft.levels.length - 1)]?.key ?? null;
    announce(`${x.label} 보기에서 제외`);
  }

  function addNew() {
    const label = nameText.trim();
    if (!label) { nameError = "새 분류 이름을 입력하세요."; return paint("name"); }
    if (label.length > MAX_NAME) { nameError = `이름은 ${MAX_NAME}자까지예요.`; return paint("name"); }
    if (allLabels().includes(label.toLowerCase())) { nameError = `'${label}' 이름은 이미 있어요.`; return paint("name"); }
    if (draft.levels.length >= 8) { nameError = "계층은 8단계까지 둘 수 있어요."; return paint("name"); }
    const lv = { key: `new:n${++newSeq}`, tmp: `n${newSeq}`, label, isNew: true, ...fresh({ icon: "ring", color: "yellow" }) };
    draft.levels.push(lv);
    draft.active = lv.key;
    nameText = "";
    nameError = "";
    paint("name");
  }

  const live = el("div", "sr-only");
  live.setAttribute("aria-live", "polite");

  function levelRow(l, i) {
    const row = el("li", "lvrow" + (l.key === draft.active ? " on" : ""));
    row.dataset.key = l.key;
    row.draggable = true;
    const grip = el("span", "grip");
    grip.setAttribute("aria-hidden", "true");
    grip.append(svg("grip"));
    const pick = el("button", "lvpick");
    pick.type = "button";
    pick.dataset.f = `pick:${l.key}`;
    pick.setAttribute("aria-pressed", String(l.key === draft.active));
    pick.title = "아이콘·색 고르기";
    pick.append(levelIcon(l), el("b", "", l.label));
    if (l.isNew) pick.append(el("span", "badge", "새 분류"));
    pick.addEventListener("click", () => { draft.active = l.key; paint(`pick:${l.key}`); });
    const order = el("span", "lvorder", `${i + 1}`);
    const mk = (id, label, dis, fn, f) => {
      const b = el("button", "ib sm");
      b.type = "button";
      b.disabled = dis;
      b.dataset.f = f;
      b.setAttribute("aria-label", `${l.label} ${label}`);
      b.title = label;
      b.append(svg(id, "i s"));
      b.addEventListener("click", fn);
      return b;
    };
    const up = mk("arrow-up", "위로", i === 0, () => { move(i, i - 1); paint(`up:${l.key}`); }, `up:${l.key}`);
    const down = mk("arrow-down", "아래로", i === draft.levels.length - 1, () => { move(i, i + 1); paint(`down:${l.key}`); }, `down:${l.key}`);
    const hide = el("button", "btn sm quiet hide");
    hide.type = "button";
    hide.dataset.f = `hide:${l.key}`;
    hide.append(svg("eye-off", "i s"), l.isNew ? "취소" : "보기에서 제외");
    hide.title = l.isNew ? "만들기 취소" : "이 보기에서만 숨겨요. 이슈의 값은 그대로예요.";
    hide.addEventListener("click", () => { remove(i); paint("pool"); });
    row.append(grip, order, pick, el("span", "grow"), up, down, hide);
    row.addEventListener("keydown", (e) => {
      if (!e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
      e.preventDefault();
      const to = i + (e.key === "ArrowUp" ? -1 : 1);
      move(i, to);
      paint(`pick:${l.key}`);
    });
    row.addEventListener("dragstart", (e) => { dragKey = l.key; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", l.key); row.classList.add("dragging"); });
    row.addEventListener("dragend", () => { dragKey = null; body.querySelectorAll(".lvrow").forEach((r) => r.classList.remove("dragging", "drop-before", "drop-after")); });
    row.addEventListener("dragover", (e) => {
      if (!dragKey || dragKey === l.key) return;
      e.preventDefault();
      const after = e.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
      row.classList.toggle("drop-after", after);
      row.classList.toggle("drop-before", !after);
    });
    row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
    row.addEventListener("drop", (e) => {
      if (!dragKey || dragKey === l.key) return;
      e.preventDefault();
      const after = row.classList.contains("drop-after");
      const from = draft.levels.findIndex((x) => x.key === dragKey);
      let to = i + (after ? 1 : 0);
      if (from < to) to -= 1;
      move(from, to);
      paint(`pick:${dragKey}`);
    });
    return row;
  }

  function paint(focus) {
    focusKey = focus ?? focusKey;
    const rest = pool();
    const frag = [];

    // mode
    const modeBox = el("section", "ds");
    modeBox.append(el("h3", "", "보는 방식"));
    modeBox.append(chipRow([["fields", "분류 기준 (계층)"], ["free", "자유 배치"]], draft.mode, (v) => { draft.mode = v; paint(); }));
    modeBox.append(el("p", "hint", draft.mode === "fields"
      ? "아래 순서대로 이슈를 묶어 보여줘요. 이슈를 그룹에 놓으면 그 이슈의 분류 값이 바뀌어요."
      : "계층 순서는 무시하고 그룹을 직접 쌓아요. 아래 설정은 그대로 보관돼서 언제든 분류 기준으로 돌아올 수 있어요."));
    frag.push(modeBox);

    // levels
    const lv = el("section", "ds");
    lv.append(el("h3", "", "업무 계층"));
    const list = el("ol", "lvlist" + (draft.mode === "free" ? " muted" : ""));
    list.setAttribute("aria-label", "업무 계층 순서");
    if (!draft.levels.length) list.append(el("li", "lvempty", "계층이 없어요. 이슈가 한 줄로 나열돼요. 아래에서 분류를 추가해 보세요."));
    draft.levels.forEach((l, i) => list.append(levelRow(l, i)));
    const last = el("li", "lvrow fixed");
    last.append(el("span", "grip"), el("span", "lvorder", String(draft.levels.length + 1)));
    const lastTag = el("span", "lvpick static");
    lastTag.append(issueIcon(), el("b", "", "이슈"), el("span", "badge", "항상 마지막"));
    last.append(lastTag);
    list.append(last);
    lv.append(list);
    lv.append(el("p", "hint", "끌어서 순서를 바꾸거나 ↑ ↓ 버튼, 또는 Alt + ↑ ↓ 를 쓰세요."));
    frag.push(lv);

    // style editor of the active level
    const a = active();
    if (a) {
      const st = el("section", "ds styler");
      const h = el("h3");
      h.append(`'${a.label}' 모양과 색 `, el("small", "", `${shapeName(a.icon)} · ${colorName(a.color)}`));
      st.append(h);
      const shapes = el("div", "chips swatches");
      shapes.setAttribute("role", "group");
      shapes.setAttribute("aria-label", "모양");
      for (const [id, name] of SHAPES) {
        const b = el("button", "chip");
        b.type = "button";
        b.dataset.f = `shape:${id}`;
        b.setAttribute("aria-pressed", String(a.icon === id));
        b.append(levelIcon({ icon: id, color: a.color }), name);
        b.addEventListener("click", () => { a.icon = id; paint(`shape:${id}`); });
        shapes.append(b);
      }
      const colors = el("div", "chips swatches");
      colors.setAttribute("role", "group");
      colors.setAttribute("aria-label", "색");
      for (const [id, name] of COLORS) {
        const b = el("button", "chip");
        b.type = "button";
        b.dataset.f = `color:${id}`;
        b.setAttribute("aria-pressed", String(a.color === id));
        const dot = el("i", "dot");
        dot.style.background = `var(--lv-${id})`;
        b.append(dot, name);
        b.addEventListener("click", () => { a.color = id; paint(`color:${id}`); });
        colors.append(b);
      }
      st.append(shapes, colors);
      frag.push(st);
    }

    // add from existing / create
    const add = el("section", "ds");
    add.append(el("h3", "", "분류 추가"));
    const poolRow = el("div", "chips");
    poolRow.dataset.f = "pool";
    if (rest.length) {
      for (const k of rest) {
        const b = el("button", "chip");
        b.type = "button";
        b.dataset.f = `add:${k.key}`;
        b.append(levelIcon(k), `${k.label}`);
        b.title = `${k.label} 분류를 계층에 추가`;
        b.addEventListener("click", () => { draft.levels.push({ ...k, ...fresh(k) }); draft.active = k.key; paint(`pick:${k.key}`); });
        poolRow.append(b);
      }
    } else {
      poolRow.append(el("span", "hint", "추가할 수 있는 기존 분류가 없어요."));
    }
    add.append(poolRow);
    const form = el("form", "newcls");
    form.addEventListener("submit", (e) => { e.preventDefault(); addNew(); });
    const input = el("input");
    input.type = "text";
    input.maxLength = MAX_NAME;
    input.placeholder = "새 분류 이름 (예: 고객사, 공정)";
    input.value = nameText;
    input.dataset.f = "name";
    input.setAttribute("aria-label", "새 분류 이름");
    input.setAttribute("aria-invalid", String(!!nameError));
    input.addEventListener("input", () => { nameText = input.value; if (nameError) { nameError = ""; err.textContent = ""; input.setAttribute("aria-invalid", "false"); } });
    const mk = button("분류 만들기", "", null);
    mk.type = "submit";
    const err = el("p", "ferr", nameError);
    form.append(input, mk);
    add.append(form, err);
    add.append(el("p", "hint", "새 분류는 '적용'을 누를 때 만들어지는 선택형 항목이에요. 선택지는 이후에 채워요."));
    frag.push(add);

    // deletion pointer
    const del = el("section", "ds note");
    del.append(svg("alert", "i s"));
    const t = el("div");
    t.append(el("b", "", "분류 자체를 지우려면"), el("p", "hint", "여기서 '보기에서 제외'해도 이슈에 입력한 값은 지워지지 않아요. 정의·선택지 삭제는 영향 범위와 규칙 참조를 확인할 수 있는 분류 관리에서 해요."));
    const goto = el("button", "linkbtn", "분류 관리 열기");
    goto.type = "button";
    goto.addEventListener("click", () => { sheet.close(); opts.openClasses?.(); });
    t.append(goto);
    del.append(t);
    frag.push(del);

    body.replaceChildren(...frag, live);
    paintFoot();
    if (focusKey) {
      const target = body.querySelector(`[data-f="${CSS.escape(focusKey)}"]:not(:disabled)`) ?? body.querySelector('[data-f^="pick:"]');
      target?.focus({ preventScroll: false });
    }
  }

  function paintFoot() {
    const dirty = snapshot() !== initial;
    const preview = el("div", "pv grow");
    preview.setAttribute("aria-label", "적용 후 계층");
    if (draft.mode === "free") preview.append(el("span", "chip-note", "자유 배치"));
    else {
      for (const l of draft.levels) {
        const t = el("span", "lv");
        t.append(levelIcon(l), l.label);
        preview.append(t, el("span", "sep", "›"));
      }
      const t = el("span", "lv");
      t.append(issueIcon(), "이슈");
      preview.append(t);
    }
    const errBox = el("p", "ferr", applyError);
    errBox.setAttribute("role", "alert");
    const cancel = button("취소", "", () => sheet.close());
    const apply = button(busy ? "적용 중…" : "적용", "pri", apply_);
    apply.disabled = busy || !dirty;
    apply.title = dirty ? "" : "바뀐 내용이 없어요";
    const left = el("div", "footl");
    left.append(preview, errBox);
    foot.replaceChildren(left, cancel, apply);
  }

  async function apply_() {
    busy = true;
    applyError = "";
    paintFoot();
    try {
      const saved = await api.saveStructureView({
        mode: draft.mode,
        levels: draft.levels.map((l) => l.key),
        new_fields: draft.levels.filter((l) => l.isNew).map((l) => ({ tmp: l.tmp, label: l.label })),
        styles: Object.fromEntries(draft.levels.map((l) => [l.key, { icon: l.icon, color: l.color }])),
      });
      sheet.close();
      toast("계층을 적용했어요");
      hub.emit({ kind: "fields" });
      opts.onApplied?.(saved);
    } catch (e) {
      busy = false;
      applyError = `적용하지 못했어요. ${e.message}`;
      paintFoot();
    }
  }

  paint(draft.levels.length ? `pick:${draft.active}` : "name");
}
