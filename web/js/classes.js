// Classification manager (P2B-07). This is the only place a definition or option is deleted.
// "구조 보기에서 제외" (view only) and "삭제" are separate, and every deletion shows its impact first.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { el, emptyState, svg } from "./ui.js";

const TYPE_NAME = { choice: "선택", multi: "복수 선택", text: "글", person: "사람", date: "날짜", number: "숫자", check: "체크" };
let selected = null;

const rulesText = (r) => `위치 규칙 ${r.join("·")}번`;

function badge(text, cls = "") { return el("span", "badge " + cls, text); }

export async function renderClasses(host, { reload }) {
  const [rows, fields] = await Promise.all([api.structureClasses(), api.fieldsAll()]);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  if (!rows.some((r) => r.key === selected)) selected = rows[0]?.key ?? null;

  const wrap = el("div", "cm");
  const list = el("section", "panel cm-list");
  const detail = el("section", "panel cm-detail");
  detail.setAttribute("aria-live", "polite");
  const head = el("div", "panel-head");
  head.append(el("h2", "", "분류 목록"));
  const ul = el("ul", "cm-items");

  for (const r of rows) {
    const li = el("li");
    const b = el("button", "cm-item" + (r.key === selected ? " on" : "") + (r.archived ? " arch" : ""));
    b.type = "button";
    b.setAttribute("aria-pressed", String(r.key === selected));
    const main = el("span", "cm-main");
    main.append(el("b", "", r.label), el("small", "", `${TYPE_NAME[r.type] ?? r.type} · 이슈 ${r.used_by}개`));
    b.append(main);
    const tags = el("span", "cm-tags");
    if (r.in_view) tags.append(badge("보기에 사용", "ok"));
    if (r.archived) tags.append(badge("보관됨"));
    if (r.builtin) tags.append(badge("기본"));
    if (r.rules.length) tags.append(badge(rulesText(r.rules)));
    b.append(tags);
    b.addEventListener("click", () => { selected = r.key; for (const x of ul.querySelectorAll(".cm-item")) { x.classList.toggle("on", x === b); x.setAttribute("aria-pressed", String(x === b)); } paintDetail(); });
    li.append(b);
    ul.append(li);
  }
  list.append(head, ul);
  wrap.append(list, detail);
  host.replaceChildren(wrap);

  async function after(msg, opts) {
    if (msg) toast(msg, opts);
    hub.emit({ kind: "fields" });
    await reload();
  }

  async function paintDetail() {
    if (!selected) { detail.replaceChildren(emptyState({ title: "분류가 없어요", icon: "tag" })); return; }
    const key = selected;
    detail.replaceChildren(el("div", "panel-body", "불러오는 중…"));
    let imp;
    try { imp = await api.classImpact(key); } catch (e) { detail.replaceChildren(el("p", "ferr pad", e.message)); return; }
    if (key !== selected) return;
    const f = byKey[key];
    const parts = [];

    const h = el("div", "cm-h");
    const t = el("div", "grow");
    t.append(el("h2", "", f.label), el("small", "", `${TYPE_NAME[f.type] ?? f.type} · 키 ${f.key}`));
    const rename = button("이름 바꾸기", "sm", () => renameSheet(f));
    h.append(t, rename);
    parts.push(h);

    const facts = el("dl", "facts");
    const fact = (k, v, warn) => { const d = el("div", warn ? "warn" : ""); d.append(el("dt", "", k), el("dd", "", v)); facts.append(d); };
    fact("값이 있는 이슈", `${imp.used_by} / ${imp.total_tasks}개`);
    fact("구조 보기", imp.in_view ? "계층으로 사용 중" : "사용 안 함");
    fact("위치 규칙", imp.rules.length ? `${rulesText(imp.rules)}이 참조` : "참조 없음", imp.rules.length > 0);
    parts.push(facts);

    if (["choice", "multi"].includes(f.type)) parts.push(optionsBlock(f, imp));

    // actions: view-only vs. delete are deliberately separate blocks
    const acts = el("div", "cm-acts");
    const viewBlock = el("section", "act");
    viewBlock.append(el("h3", "", "구조 보기에서만 숨기기"), el("p", "hint", "이슈의 값과 정의는 그대로 두고, 구조 보기 계층에서만 뺍니다. 계층 편집에서도 같은 일을 할 수 있어요."));
    const hide = button(imp.in_view ? "구조 보기에서 제외" : "이미 제외됨", "sm", async () => {
      try {
        const v = await api.structureView();
        await api.saveStructureView({ mode: v.mode, levels: v.levels.filter((l) => l.key !== key).map((l) => l.key), styles: Object.fromEntries(v.levels.filter((l) => l.key !== key).map((l) => [l.key, { icon: l.icon, color: l.color }])) });
        await after("구조 보기에서 제외했어요. 이슈 값은 그대로예요");
      } catch (e) { toast(e.message, { error: true }); }
    });
    hide.disabled = !imp.in_view;
    viewBlock.append(hide);

    const delBlock = el("section", "act danger");
    delBlock.append(el("h3", "", "정의 삭제"));
    if (f.archived) {
      delBlock.append(el("p", "hint", "보관된 분류예요. 값은 이슈에 남아 있고 새 값을 쓸 수 없어요."));
      delBlock.append(button("복원", "sm", async () => {
        try { await api.patchField(key, { archived: false }); await after("복원했어요"); } catch (e) { toast(e.message, { error: true }); }
      }));
    } else {
      delBlock.append(el("p", "hint", imp.used_by || f.builtin ? "보관하면 목록·필터에서 사라지지만 이슈의 값은 보존돼요. 언제든 복원할 수 있어요." : "쓰는 이슈가 없어서 바로 삭제돼요."));
      delBlock.append(button(imp.used_by || f.builtin ? "보관" : "삭제", "sm", () => archive(f, imp)));
    }
    const purge = button("값까지 완전 삭제…", "sm danger", () => purgeSheet(f, imp));
    purge.disabled = f.builtin || imp.rules.length > 0;
    if (f.builtin) purge.title = "기본 항목은 보관만 할 수 있어요";
    else if (imp.rules.length) purge.title = `${rulesText(imp.rules)}이 쓰고 있어 삭제할 수 없어요`;
    delBlock.append(purge);
    if (imp.rules.length && !f.builtin) delBlock.append(el("p", "hint warn", `${rulesText(imp.rules)}이 이 분류를 쓰고 있어요. 규칙을 먼저 바꿔야 완전 삭제할 수 있어요.`));
    acts.append(viewBlock, delBlock);
    parts.push(acts);
    detail.replaceChildren(...parts);
  }

  function optionsBlock(f, imp) {
    const box = el("section", "opts");
    box.append(el("h3", "", `선택지 ${f.options.length}개`));
    const ul2 = el("ul", "optlist");
    if (!f.options.length) ul2.append(el("li", "optempty", "선택지가 없어요. 아래에서 추가하세요."));
    for (const o of f.options) {
      const info = imp.options.find((x) => x.value === o.value) ?? { count: 0, rules: [] };
      const li = el("li", "opt");
      li.append(el("b", "", o.label), el("span", "grow"));
      li.append(el("span", "cnt", `이슈 ${info.count}개`));
      if (info.rules.length) li.append(badge(rulesText(info.rules), "warn"));
      const rm = button("삭제", "sm quiet", () => removeOption(f, o, info));
      rm.setAttribute("aria-label", `${o.label} 삭제`);
      if (info.rules.length) { rm.disabled = true; rm.title = `${rulesText(info.rules)}이 쓰고 있어요`; }
      li.append(rm);
      ul2.append(li);
    }
    const form = el("form", "newopt");
    const input = el("input");
    input.type = "text";
    input.placeholder = "새 선택지 이름";
    input.maxLength = 40;
    input.setAttribute("aria-label", "새 선택지 이름");
    const add = button("추가", "sm", null);
    add.type = "submit";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const label = input.value.trim();
      if (!label) return;
      try { await api.addOption(f.key, { label }); await after(`'${label}' 선택지를 추가했어요`); } catch (er) { toast(er.message, { error: true }); }
    });
    form.append(input, add);
    box.append(ul2, form);
    return box;
  }

  function renameSheet(f) {
    const s = openSheet({ title: "이름 바꾸기", sub: "화면에 보이는 이름만 바뀌고 이슈의 값은 그대로예요." });
    const form = el("form", "newopt big");
    const input = el("input");
    input.type = "text";
    input.value = f.label;
    input.maxLength = 50;
    input.setAttribute("aria-label", "분류 이름");
    const err = el("p", "ferr");
    err.setAttribute("role", "alert");
    form.append(input);
    s.body.append(form, err);
    const ok = button("저장", "pri", null);
    ok.type = "button";
    const save = async () => {
      const label = input.value.trim();
      if (!label) { err.textContent = "이름을 입력하세요."; return; }
      try { await api.patchField(f.key, { label }); s.close(); await after("이름을 바꿨어요"); } catch (e) { err.textContent = e.message; }
    };
    ok.addEventListener("click", save);
    form.addEventListener("submit", (e) => { e.preventDefault(); save(); });
    s.foot.append(button("취소", "", () => s.close()), ok);
    input.focus();
    input.select();
  }

  async function archive(f, imp) {
    const keep = imp.used_by || f.builtin;
    const content = [
      el("p", "", keep
        ? `이슈 ${imp.used_by}개의 '${f.label}' 값은 그대로 보존돼요. 목록·필터·구조 보기에서만 사라지고, 언제든 복원할 수 있어요.`
        : `'${f.label}'을(를) 쓰는 이슈가 없어서 정의만 삭제돼요.`),
    ];
    if (imp.in_view) content.push(el("p", "hint warn", "구조 보기가 이 분류를 쓰고 있어요. 보관하면 계층 규칙이 깨져 자유 배치로 전환돼요."));
    if (!(await confirmSheet({ title: keep ? `'${f.label}' 보관` : `'${f.label}' 삭제`, content, confirmLabel: keep ? "보관" : "삭제", danger: !keep }))) return;
    try { await api.deleteField(f.key); await after(keep ? "보관했어요. 값은 보존돼요" : "삭제했어요"); } catch (e) { toast(e.message, { error: true }); }
  }

  async function purgeSheet(f, imp) {
    const content = [
      el("p", "", `정의와 이슈 ${imp.used_by}개의 '${f.label}' 값이 영구히 지워져요. 되돌릴 수 없어요.`),
    ];
    const list = el("ul", "impact");
    list.append(el("li", "", `영향 받는 이슈: ${imp.used_by}개 (전체 ${imp.total_tasks}개 중)`));
    for (const o of imp.options.filter((x) => x.count)) list.append(el("li", "", `선택지 '${o.label}' 값 ${o.count}개`));
    list.append(el("li", "", imp.rules.length ? `${rulesText(imp.rules)}이 참조 중` : "위치 규칙 참조 없음"));
    if (imp.in_view) list.append(el("li", "warn", "구조 보기가 자유 배치로 전환돼요"));
    content.push(list, el("p", "hint", "값을 남기고 싶다면 취소하고 '보관'을 쓰세요."));
    if (!(await confirmSheet({ title: `'${f.label}' 완전 삭제`, content, confirmLabel: "완전 삭제", danger: true }))) return;
    try { await api.deleteField(f.key, true); await after("완전히 삭제했어요"); } catch (e) { toast(e.message, { error: true }); }
  }

  function removeOption(f, o, info) {
    const others = f.options.filter((x) => x.value !== o.value);
    const s = openSheet({ title: `선택지 '${o.label}' 삭제`, sub: info.count ? `이 값을 가진 이슈 ${info.count}개가 있어요. 어떻게 할까요?` : "쓰는 이슈가 없어서 바로 삭제돼요." });
    let target = null; // null = clear, otherwise another option value
    const err = el("p", "ferr");
    err.setAttribute("role", "alert");
    const paint = () => {
      s.body.replaceChildren(err);
      if (!info.count) return;
      const chips = el("div", "chips");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "이슈의 값 처리");
      const mk = (label, val, extra) => {
        const b = el("button", "chip", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(target === val));
        if (extra) b.prepend(extra);
        b.addEventListener("click", () => { target = val; paint(); });
        return b;
      };
      chips.append(mk("값 비우기", null));
      for (const x of others) chips.append(mk(`'${x.label}'(으)로 옮기기`, x.value));
      err.before(chips, el("p", "hint", target === null ? `이슈 ${info.count}개의 '${f.label}' 값이 비워져요.` : `이슈 ${info.count}개가 '${others.find((x) => x.value === target)?.label}'(으)로 옮겨져요.`));
    };
    paint();
    const ok = button("삭제", "pri danger-fill", async () => {
      try {
        const body = { options: others };
        if (info.count) body.option_moves = { [o.value]: target };
        await api.patchField(f.key, body);
        s.close();
        await after("선택지를 삭제했어요");
      } catch (e) { err.textContent = e.message; }
    });
    s.foot.append(button("취소", "", () => s.close()), ok);
  }

  await paintDetail();
}
