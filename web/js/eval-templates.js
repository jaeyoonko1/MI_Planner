// Evaluation template editor (P4-07). Same apply/cancel contract as the hierarchy dialog (P2B-07):
// everything happens on a draft; only "적용" talks to the server, "취소"/Esc/backdrop discard it.
// Evaluations hold their own copy of stages and fields, so a template edit never changes them (D-30).
import { api } from "./api.js";
import {
  addField, addStage, colorName, draftOf, FIELD_TYPES, MAX_FIELDS, MAX_STAGES, moveItem, payloadOf,
  snapshot, STAGE_COLORS, validate,
} from "./eval-template-model.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, errorState, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");

export async function openTemplateEditor({ onChanged } = {}) {
  const sheet = openSheet({
    title: "평가 템플릿 편집", wide: true,
    sub: "새 평가를 만들 때 복사되는 단계와 값 항목이에요. 이미 만든 평가는 바뀌지 않고, 적용 전에는 아무것도 저장되지 않아요.",
  });
  sheet.dlg.classList.add("tpl-sheet");
  const { body, foot } = sheet;
  body.append(skeleton(4));
  foot.append(button("닫기", "", sheet.close));

  let templates;
  try {
    templates = await api.evalTemplates();
  } catch (error) {
    if (sheet.dlg.open) body.replaceChildren(errorState(error.message, () => { sheet.close(); openTemplateEditor({ onChanged }); }));
    return;
  }
  if (!sheet.dlg.open) return;

  let current = templates[0];
  let draft = draftOf(current);
  let initial = snapshot(draft);
  let usage = null;
  let activeStage = null;
  let applyError = "";
  let busy = false;
  let changed = false;
  let focusKey = null;
  const live = el("div", "sr-only");
  live.setAttribute("aria-live", "polite");
  const announce = (text) => { live.textContent = text; };
  const dirty = () => snapshot(draft) !== initial;

  async function loadUsage() {
    usage = null;
    try {
      usage = await api.evalTemplateUsage(current.id);
    } catch {
      usage = null; // the check is advisory; deleting still asks when it is unknown
    }
  }

  function select(template) {
    current = template;
    draft = draftOf(template);
    initial = snapshot(draft);
    activeStage = null;
    applyError = "";
    loadUsage().then(() => { if (sheet.dlg.open && !dirty()) paint(); });
    paint();
  }

  // ---- stages ------------------------------------------------------------------------------------

  async function removeStage(index) {
    const stage = draft.stages[index];
    const used = usage?.stages?.[stage.key];
    if (!stage.isNew && (used === undefined || used.evaluations || used.cells)) {
      const lines = used === undefined || !usage
        ? ["이 단계를 쓰는 평가가 있는지 확인하지 못했어요."]
        : [`이 단계 키를 쓰는 평가 ${num(used.evaluations)}건, 지금 이 단계에 있는 칸 ${num(used.cells)}개가 있어요.`];
      const ok = await confirmSheet({
        title: `'${stage.label}' 단계를 템플릿에서 뺄까요?`,
        content: [
          el("p", "", lines[0]),
          el("p", "hint", "이미 만든 평가는 자기 복사본을 가지고 있어서 그대로예요. 이 템플릿으로 새로 만드는 평가에서만 빠져요."),
          el("p", "hint", "적용을 누르기 전에는 저장되지 않아요."),
        ],
        confirmLabel: "단계 빼기", danger: true,
      });
      if (!ok) return;
    }
    draft.stages.splice(index, 1);
    if (activeStage === stage.key) activeStage = null;
    announce(`${stage.label} 단계를 뺐어요.`);
    paint("add-stage");
  }

  function stageRow(stage, index) {
    const error = validate(draft).stages[stage.key] ?? "";
    const row = el("div", "tplrow" + (stage.key === activeStage ? " on" : ""));
    row.dataset.key = stage.key;
    const order = el("span", "tplnum", String(index + 1));
    order.title = `${index + 1}번째 단계`;
    const swatch = el("button", "tplsw");
    swatch.type = "button";
    swatch.dataset.f = `color:${stage.key}`;
    swatch.style.setProperty("--c", stage.color);
    swatch.setAttribute("aria-expanded", String(stage.key === activeStage));
    swatch.setAttribute("aria-label", `${stage.label || "새 단계"} 색 고르기, 지금 ${colorName(stage.color)}`);
    swatch.title = `색: ${colorName(stage.color)}`;
    swatch.append(el("i", "tpldot"), el("span", "", String(index + 1)));
    swatch.addEventListener("click", () => { activeStage = activeStage === stage.key ? null : stage.key; paint(`color:${stage.key}`); });
    const label = el("input", "tplname");
    label.type = "text";
    label.maxLength = 40;
    label.value = stage.label;
    label.placeholder = "단계 이름";
    label.dataset.f = `label:${stage.key}`;
    label.setAttribute("aria-label", `${index + 1}번째 단계 이름`);
    label.setAttribute("aria-invalid", String(!!error && !stage.label.trim()));
    label.addEventListener("input", () => { stage.label = label.value; paintFoot(); markErrors(); });
    const warn = el("input", "tplwarn");
    warn.type = "text";
    warn.inputMode = "decimal";
    warn.maxLength = 6;
    warn.value = stage.warn;
    warn.placeholder = "끔";
    warn.dataset.f = `warn:${stage.key}`;
    warn.setAttribute("aria-label", `${stage.label || "새 단계"} 경고 기본 시간(시간 단위, 비우면 끔)`);
    warn.addEventListener("input", () => { stage.warn = warn.value; paintFoot(); markErrors(); });
    const unit = el("span", "tplunit", "시간");
    const mk = (id, name, disabled, run, f) => {
      const b = el("button", "ib sm");
      b.type = "button";
      b.disabled = disabled;
      b.dataset.f = f;
      b.title = name;
      b.setAttribute("aria-label", `${stage.label || "새 단계"} ${name}`);
      b.append(svg(id, "i s"));
      b.addEventListener("click", run);
      return b;
    };
    const up = mk("arrow-up", "위로", index === 0, () => { moveItem(draft.stages, index, index - 1); announce(`${stage.label} ${index}번째로 이동`); paint(`up:${stage.key}`); }, `up:${stage.key}`);
    const down = mk("arrow-down", "아래로", index === draft.stages.length - 1, () => { moveItem(draft.stages, index, index + 1); announce(`${stage.label} ${index + 2}번째로 이동`); paint(`down:${stage.key}`); }, `down:${stage.key}`);
    const del = mk("x", "빼기", draft.stages.length === 1, () => removeStage(index), `del:${stage.key}`);
    del.classList.add("tpldel");
    row.append(order, swatch, label, warn, unit, up, down, del);
    row.addEventListener("keydown", (event) => {
      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (moveItem(draft.stages, index, to)) { announce(`${stage.label} ${to + 1}번째로 이동`); paint(event.target.dataset.f?.replace(/^[a-z]+:/, "label:") ?? `label:${stage.key}`); }
    });
    const wrap = el("li", "tplcell");
    wrap.append(row);
    const msg = el("p", "ferr tplerr", error);
    msg.dataset.errFor = stage.key;
    wrap.append(msg);
    if (stage.key === activeStage) wrap.append(palette(stage));
    return wrap;
  }

  function palette(stage) {
    const box = el("div", "tplpal");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `${stage.label || "새 단계"} 색`);
    const colors = STAGE_COLORS.some(([c]) => c.toLowerCase() === stage.color.toLowerCase())
      ? STAGE_COLORS : [[stage.color, "사용자 색"], ...STAGE_COLORS];
    for (const [hex, name] of colors) {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.dataset.f = `pick:${stage.key}:${hex}`;
      chip.setAttribute("aria-pressed", String(hex.toLowerCase() === stage.color.toLowerCase()));
      const dot = el("i", "dot");
      dot.style.background = hex;
      chip.append(dot, name);
      chip.addEventListener("click", () => { stage.color = hex; paint(`pick:${stage.key}:${hex}`); });
      box.append(chip);
    }
    box.append(el("p", "hint", "색은 보조 표시예요. 단계 번호와 이름이 항상 같이 보여요."));
    return box;
  }

  // ---- value fields ------------------------------------------------------------------------------

  function fieldRow(field, index) {
    const error = validate(draft).fields[field.key] ?? "";
    const wrap = el("li", "tplcell");
    const row = el("div", "tplrow fld");
    const order = el("span", "tplnum", String(index + 1));
    const label = el("input", "tplname");
    label.type = "text";
    label.maxLength = 40;
    label.value = field.label;
    label.placeholder = "항목 이름";
    label.dataset.f = `flabel:${field.key}`;
    label.setAttribute("aria-label", `${index + 1}번째 값 항목 이름`);
    label.addEventListener("input", () => { field.label = label.value; paintFoot(); markErrors(); });
    const types = chipRow(FIELD_TYPES, field.type, (type) => { field.type = type; paint(`ftype:${field.key}:${type}`); }, "tpltypes");
    types.setAttribute("aria-label", `${field.label || "새 항목"} 입력 방식`);
    types.querySelectorAll(".chip").forEach((chip) => { chip.dataset.f = `ftype:${field.key}:${chip.dataset.value}`; });
    const mk = (id, name, disabled, run, f) => {
      const b = el("button", "ib sm");
      b.type = "button";
      b.disabled = disabled;
      b.dataset.f = f;
      b.title = name;
      b.setAttribute("aria-label", `${field.label || "새 항목"} ${name}`);
      b.append(svg(id, "i s"));
      b.addEventListener("click", run);
      return b;
    };
    row.append(order, label, types,
      mk("arrow-up", "위로", index === 0, () => { moveItem(draft.fields, index, index - 1); paint(`fup:${field.key}`); }, `fup:${field.key}`),
      mk("arrow-down", "아래로", index === draft.fields.length - 1, () => { moveItem(draft.fields, index, index + 1); paint(`fdown:${field.key}`); }, `fdown:${field.key}`),
      mk("x", "빼기", false, () => { draft.fields.splice(index, 1); announce(`${field.label} 값 항목을 뺐어요.`); paint("add-field"); }, `fdel:${field.key}`));
    const msg = el("p", "ferr tplerr", error);
    msg.dataset.errFor = field.key;
    wrap.append(row, msg);
    return wrap;
  }

  function adder(kind) {
    const form = el("form", "tpladd");
    const input = el("input");
    input.type = "text";
    input.maxLength = 40;
    input.placeholder = kind === "stage" ? "새 단계 이름 (예: 재검사)" : "새 값 항목 이름 (예: 측정 횟수)";
    input.dataset.f = kind === "stage" ? "add-stage" : "add-field";
    input.setAttribute("aria-label", kind === "stage" ? "새 단계 이름" : "새 값 항목 이름");
    const full = kind === "stage" ? draft.stages.length >= MAX_STAGES : draft.fields.length >= MAX_FIELDS;
    const submit = button(kind === "stage" ? "단계 추가" : "항목 추가", "", null);
    submit.type = "submit";
    submit.disabled = full;
    input.disabled = full;
    if (full) input.placeholder = `${kind === "stage" ? MAX_STAGES : MAX_FIELDS}개까지 둘 수 있어요`;
    form.append(input, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const label = input.value.trim();
      if (!label) { input.focus(); return; }
      if (kind === "stage") { const s = addStage(draft, label); announce(`${label} 단계를 추가했어요.`); paint(`label:${s.key}`); }
      else { const f = addField(draft, label); announce(`${label} 값 항목을 추가했어요.`); paint(`flabel:${f.key}`); }
    });
    return form;
  }

  // ---- layout ------------------------------------------------------------------------------------

  function markErrors() {
    const errors = validate(draft);
    body.querySelectorAll(".tplerr").forEach((node) => {
      node.textContent = errors.stages[node.dataset.errFor] ?? errors.fields[node.dataset.errFor] ?? "";
    });
    const nameErr = body.querySelector(".tplnameerr");
    if (nameErr) nameErr.textContent = errors.name;
  }

  async function duplicate() {
    busy = true;
    paintFoot();
    try {
      const copy = await api.createEvalTemplate({ name: `${current.name} 복사본`, stages: current.stages, fields: current.fields, is_master: false });
      templates = await api.evalTemplates();
      changed = true;
      select(templates.find((t) => t.id === copy.id) ?? templates[0]);
      toast("복사본을 만들었어요");
    } catch (error) {
      applyError = error.message;
    } finally {
      busy = false;
      paintFoot();
    }
  }

  async function dropTemplate() {
    const ok = await confirmSheet({
      title: `'${current.name}' 템플릿을 지울까요?`,
      content: [
        el("p", "", "이 템플릿으로 이미 만든 평가는 자기 복사본을 가지고 있어서 그대로예요."),
        el("p", "hint", "지운 템플릿은 되돌릴 수 없어요. 지금 편집 중인 내용도 사라져요."),
      ],
      confirmLabel: "템플릿 지우기", danger: true,
    });
    if (!ok) return;
    busy = true;
    try {
      await api.deleteEvalTemplate(current.id);
      templates = await api.evalTemplates();
      changed = true;
      select(templates[0]);
      toast("템플릿을 지웠어요");
    } catch (error) {
      applyError = error.message;
    } finally {
      busy = false;
      paintFoot();
    }
  }

  function paint(focus) {
    focusKey = focus ?? focusKey;
    const frag = [];
    // which template
    const pick = el("section", "ds");
    pick.append(el("h3", "", "템플릿"));
    const chips = chipRow(templates.map((t) => [t.id, t.name + (t.is_master ? " · 마스터" : "")]), current.id,
      (id) => { if (!dirty() && id !== current.id) select(templates.find((t) => t.id === id)); });
    chips.setAttribute("aria-label", "편집할 템플릿");
    if (dirty()) chips.querySelectorAll(".chip").forEach((c) => { if (c.dataset.value !== String(current.id)) c.disabled = true; });
    pick.append(chips);
    if (dirty()) pick.append(el("p", "hint", "다른 템플릿을 고르려면 먼저 적용하거나 취소하세요."));
    const tools = el("div", "tpltools");
    const copy = button("복사해서 새 템플릿", "sm", duplicate);
    copy.prepend(svg("copy", "i s"));
    copy.disabled = dirty() || busy;
    const drop = button("템플릿 지우기", "sm quiet danger", dropTemplate);
    drop.disabled = current.is_master || busy;
    drop.title = current.is_master ? "마스터는 지울 수 없어요. 다른 템플릿을 마스터로 지정한 뒤 지워 주세요." : "";
    tools.append(copy, drop);
    pick.append(tools);
    frag.push(pick);

    // basics
    const basics = el("section", "ds");
    basics.append(el("h3", "", "이름과 마스터"));
    const name = el("input", "tplname wide");
    name.type = "text";
    name.maxLength = 60;
    name.value = draft.name;
    name.dataset.f = "name";
    name.setAttribute("aria-label", "템플릿 이름");
    name.addEventListener("input", () => { draft.name = name.value; paintFoot(); markErrors(); });
    const master = el("button", "chip", draft.is_master ? "마스터 템플릿" : "마스터로 지정");
    master.type = "button";
    master.dataset.f = "master";
    master.setAttribute("aria-pressed", String(draft.is_master));
    master.disabled = current.is_master;
    master.title = current.is_master ? "다른 템플릿을 마스터로 지정하면 자동으로 바뀌어요" : "새 평가를 만들 때 기본으로 고르는 템플릿이에요";
    master.addEventListener("click", () => { draft.is_master = !draft.is_master; paint("master"); });
    const row = el("div", "tplrow2");
    row.append(name, master);
    basics.append(row, Object.assign(el("p", "ferr tplnameerr"), { textContent: validate(draft).name }));
    frag.push(basics);

    // stages
    const stages = el("section", "ds");
    const h = el("h3", "", `단계 · ${draft.stages.length}개`);
    stages.append(h);
    const head = el("div", "tplhead");
    head.setAttribute("aria-hidden", "true");
    head.append(el("span", "", "순서 · 색"), el("span", "grow", "이름"), el("span", "", "경고 기본 시간"));
    const list = el("ol", "tpllist");
    list.setAttribute("aria-label", "단계 순서");
    draft.stages.forEach((stage, i) => list.append(stageRow(stage, i)));
    stages.append(head, list, adder("stage"),
      el("p", "hint", "위 단계부터 아래 단계 순서로 진행돼요. 경고 기본 시간을 넘으면 주황, 2배를 넘으면 빨강으로 표시해요(비우면 끔). 이미 만든 평가의 경고 시간은 현황판에서 따로 바꿔요."));
    frag.push(stages);

    // fields
    const fields = el("section", "ds");
    fields.append(el("h3", "", `값 항목 · ${draft.fields.length}개`));
    const flist = el("ol", "tpllist");
    flist.setAttribute("aria-label", "값 항목 순서");
    if (!draft.fields.length) flist.append(el("li", "lvempty", "값 항목이 없어요. 칸에는 단계와 메모만 남아요."));
    draft.fields.forEach((field, i) => flist.append(fieldRow(field, i)));
    fields.append(flist, adder("field"),
      el("p", "hint", "칸마다 적는 값이에요. 이미 입력된 값은 항목 키로 보관되므로 이름을 바꿔도 그대로예요."));
    frag.push(fields);

    body.replaceChildren(...frag, live);
    paintFoot();
    if (focusKey) {
      const target = body.querySelector(`[data-f="${CSS.escape(focusKey)}"]:not(:disabled)`);
      const flip = { up: "down", down: "up", fup: "fdown", fdown: "fup" };
      const m = focusKey.match(/^(up|down|fup|fdown):(.*)$/);
      (target ?? (m ? body.querySelector(`[data-f="${CSS.escape(`${flip[m[1]]}:${m[2]}`)}"]:not(:disabled)`) : null))?.focus();
    }
    focusKey = null;
  }

  function paintFoot() {
    const errors = validate(draft);
    const isDirty = dirty();
    const left = el("div", "footl");
    const status = el("p", "tplstat" + (errors.count ? " bad" : ""));
    status.setAttribute("role", "status");
    status.textContent = errors.count ? `고칠 곳이 ${errors.count}군데 있어요.` : isDirty ? "저장하지 않은 변경이 있어요." : "바뀐 내용이 없어요.";
    const err = el("p", "ferr", applyError);
    err.setAttribute("role", "alert");
    left.append(status, err);
    const close = button(isDirty ? "취소" : "닫기", "", () => sheet.close());
    const apply = button(busy ? "적용 중…" : "적용", "pri", applyDraft);
    apply.disabled = busy || !isDirty || errors.count > 0;
    apply.title = !isDirty ? "바뀐 내용이 없어요" : errors.count ? "표시된 항목을 먼저 고쳐 주세요" : "";
    foot.replaceChildren(left, close, apply);
  }

  async function applyDraft() {
    if (busy || validate(draft).count) return;
    busy = true;
    applyError = "";
    paintFoot();
    try {
      const saved = await api.patchEvalTemplate(current.id, payloadOf(draft, current));
      templates = await api.evalTemplates();
      changed = true;
      toast("템플릿을 적용했어요");
      busy = false;
      select(templates.find((t) => t.id === saved.id) ?? templates[0]);
    } catch (error) {
      busy = false;
      applyError = `적용하지 못했어요. ${error.message}`;
      paintFoot();
    }
  }

  sheet.dlg.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  sheet.dlg.addEventListener("close", () => { if (changed) onChanged?.(); });
  loadUsage();
  paint("name");
}

// "이 평가 구성을 새 마스터로 저장": copy this evaluation's own stages/fields into a new template.
export function openSaveAsTemplate(evaluation) {
  const sheet = openSheet({
    title: "이 평가 구성을 템플릿으로 저장",
    sub: "이 평가의 단계(경고 기준 포함)와 값 항목을 새 템플릿으로 복사해요. 이 평가와 다른 평가는 바뀌지 않아요.",
  });
  sheet.dlg.classList.add("tpl-save");
  let asMaster = true;
  let busy = false;
  const name = el("input", "tplname wide");
  name.type = "text";
  name.maxLength = 60;
  name.value = `${evaluation.name} 구성`;
  name.setAttribute("aria-label", "새 템플릿 이름");
  const error = el("p", "ferr");
  error.setAttribute("role", "alert");
  const chips = chipRow([[true, "새 마스터로 저장"], [false, "마스터는 그대로"]], asMaster, (value) => {
    asMaster = value;
    chips.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String((c.dataset.value === "true") === asMaster)));
  });
  chips.setAttribute("aria-label", "마스터 지정");
  const preview = el("div", "eval-template-preview");
  const steps = el("ol", "");
  preview.append(steps);
  steps.append(...evaluation.stages.map((stage, i) => {
    const item = el("li", "", `${i + 1}. ${stage.label}`);
    item.style.setProperty("--stage-color", stage.color);
    return item;
  }));
  const save = button("저장", "pri", async () => {
    if (busy) return;
    if (!name.value.trim()) { error.textContent = "템플릿 이름을 입력해 주세요."; name.focus(); return; }
    busy = true;
    save.disabled = true;
    error.textContent = "";
    try {
      await api.saveEvaluationAsTemplate(evaluation.id, { name: name.value.trim(), is_master: asMaster });
      sheet.close();
      toast(asMaster ? "새 마스터 템플릿으로 저장했어요" : "템플릿으로 저장했어요");
    } catch (e) {
      busy = false;
      save.disabled = false;
      error.textContent = `저장하지 못했어요. ${e.message}`;
    }
  });
  const cancel = button("취소", "", sheet.close);
  sheet.body.append(el("h3", "", "이름"), name, el("h3", "", "마스터"), chips,
    el("p", "hint", "마스터는 평가를 만들 때 맨 먼저 고르는 템플릿이에요. 기존 마스터는 일반 템플릿으로 남아요."),
    el("h3", "", "단계"), preview, error);
  sheet.foot.append(cancel, save);
  name.focus();
  name.select();
}
