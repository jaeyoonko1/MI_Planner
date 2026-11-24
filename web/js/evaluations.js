import { api } from "./api.js";
import { renderBoard } from "./eval-board.js";
import { openTemplateEditor } from "./eval-templates.js";
import { parseEquipment, parseLots } from "./evaluation-input.js";
import { button, openSheet } from "./sheet.js";
import { chipRow, el, emptyState, errorState, skeleton, svg } from "./ui.js";

const STEPS = ["템플릿", "설비", "Lot · 웨이퍼", "조합 확인"];
const STATE = { active: "진행 중", done: "완료", hold: "보류" };
const SAMPLES = [
  "EQ-A01\nEQ-A02\tTEST-VENDOR",
  "LOT-TEST-001  01,02,03\nLOT-TEST-002\t01",
];

function field(label, input, hint) {
  const wrap = el("label", "eval-field", label);
  wrap.append(input);
  if (hint) wrap.append(el("small", "muted", hint));
  return wrap;
}

function comboKey(equipment, lot, wafer) {
  return JSON.stringify([equipment.name, lot, wafer]);
}

function combinationGrid(equipment, lots, excluded, onToggle) {
  const grid = el("div", "eval-matrix");
  const table = el("table", "");
  table.setAttribute("aria-label", "평가 조합 포함 여부");
  const header = el("tr", "");
  header.append(el("th", "", "Lot · 웨이퍼"));
  for (const item of equipment) {
    const column = el("th", "", item.name);
    column.scope = "col";
    header.append(column);
  }
  const head = el("thead", "");
  head.append(header);
  table.append(head);
  const tbody = el("tbody", "");
  const rows = lots.flatMap((lot) => lot.wafers.map((wafer) => [lot.lot_no, wafer]));
  let tabStop = null;
  for (const [row, [lot, wafer]] of rows.entries()) {
    const tr = el("tr", "");
    const caption = el("th", "", lot + " · " + wafer);
    caption.scope = "row";
    tr.append(caption);
    for (const [column, item] of equipment.entries()) {
      const cell = el("td", "");
      const box = el("input", "");
      const key = comboKey(item, lot, wafer);
      box.type = "checkbox";
      box.checked = !excluded.has(key);
      box.dataset.row = row;
      box.dataset.column = column;
      box.tabIndex = tabStop ? -1 : 0;
      if (!tabStop) tabStop = box;
      box.setAttribute("aria-label", lot + " 웨이퍼 " + wafer + " · " + item.name + " 포함");
      box.addEventListener("change", () => onToggle(key, box.checked));
      cell.append(box);
      tr.append(cell);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  grid.append(table);
  table.addEventListener("focusin", ({ target }) => {
    if (target.matches("input") && target !== tabStop) {
      tabStop.tabIndex = -1;
      target.tabIndex = 0;
      tabStop = target;
    }
  });
  table.addEventListener("keydown", (event) => {
    if (!event.target.matches("input")) return;
    const shifts = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
    const delta = shifts[event.key];
    if (!delta) return;
    event.preventDefault();
    const row = Number(event.target.dataset.row) + delta[0];
    const column = Number(event.target.dataset.column) + delta[1];
    table.querySelector('[data-row="' + row + '"][data-column="' + column + '"]')?.focus();
  });
  return grid;
}

export async function openEvaluationWizard({ parent, name = "", onCreated }) {
  const sheet = openSheet({ title: "평가 만들기", wide: true });
  const loading = skeleton(3);
  sheet.body.append(loading);
  const cancel = button("취소", "", sheet.close);
  sheet.foot.append(cancel);
  let templates;
  try {
    templates = await api.evalTemplates();
    if (!templates.length) throw new Error("사용할 평가 템플릿이 없어요.");
  } catch (error) {
    if (sheet.dlg.open) sheet.body.replaceChildren(errorState(error.message));
    return;
  }
  if (!sheet.dlg.open) return;

  let step = 0;
  let busy = false;
  let equipment = [];
  let lots = [];
  let template = templates[0];
  const excluded = new Set();
  const requests = new Map();
  const title = el("input", "");
  title.type = "text";
  title.maxLength = 120;
  title.value = name;
  const equipmentText = el("textarea", "");
  const lotsText = el("textarea", "");
  const textAreas = [equipmentText, lotsText];
  textAreas.forEach((input, index) => {
    input.rows = 7;
    input.spellcheck = false;
    input.placeholder = SAMPLES[index];
  });
  const choose = chipRow(templates.map((item) => [item.id, item.name + (item.is_master ? " · 마스터" : "")]),
    template.id, (id) => { template = templates.find((item) => item.id === id); paintTemplate(); });
  choose.setAttribute("aria-label", "평가 템플릿");
  const templatePreview = el("div", "eval-template-preview");
  function paintTemplate() {
    const steps = el("ol", "");
    for (const stage of template.stages) {
      const item = el("li", "", stage.label);
      item.style.setProperty("--stage-color", stage.color);
      steps.append(item);
    }
    templatePreview.replaceChildren(steps, el("small", "muted", "값 항목 · " +
      (template.fields.map((item) => item.label).join(" · ") || "없음")));
  }
  paintTemplate();
  const base = [
    field("평가 이름", title),
    el("h3", "", "평가 템플릿"),
    choose,
    templatePreview,
  ];
  const sequence = el("ol", "eval-steps");
  const status = el("p", "error eval-error");
  status.setAttribute("role", "alert");
  const back = button("이전", "", () => {
    step--;
    render();
  });
  const next = button("다음", "pri", advance);
  const closer = sheet.dlg.querySelector(".sheet-h button");
  sheet.foot.append(back, next);
  sheet.dlg.addEventListener("cancel", (event) => { if (busy) event.preventDefault(); });
  sheet.dlg.addEventListener("click", (event) => {
    if (busy && event.target === sheet.dlg) event.stopImmediatePropagation();
  }, true);

  function summaryPanel() {
    const total = lots.reduce((sum, lot) => sum + lot.wafers.length, 0) * equipment.length;
    const summary = el("p", "eval-count");
    summary.setAttribute("role", "status");
    const update = () => {
      summary.textContent = (total - excluded.size).toLocaleString() + "개 평가 · " + excluded.size.toLocaleString() + "개 제외";
      next.disabled = excluded.size === total;
    };
    update();
    return [
      el("h3", "", title.value.trim()),
      el("p", "muted", "평가에서 뺄 조합의 체크를 해제하세요. 방향키로 조합을 이동할 수 있어요."),
      summary,
      combinationGrid(equipment, lots, excluded, (key, included) => {
        if (included) excluded.delete(key); else excluded.add(key);
        update();
      }),
    ];
  }

  function render() {
    sequence.replaceChildren(...STEPS.map((label, index) => {
      const item = el("li", "", (index + 1) + " " + label);
      if (step === index) item.setAttribute("aria-current", "step");
      return item;
    }));
    const panels = [
      () => base,
      () => [field("설비 목록", equipmentText, "한 줄에 설비 하나를 입력하세요. 두 번째 탭 열에 설비사를 붙여넣을 수 있어요.")],
      () => [field("Lot · 웨이퍼", lotsText, "엑셀 두 열을 복사하거나 Lot 번호 뒤에 공백 두 칸과 쉼표로 나눈 웨이퍼를 입력하세요.")],
      summaryPanel,
    ];
    status.textContent = "";
    next.disabled = false;
    sheet.body.replaceChildren(sequence, ...panels[step](), status);
    back.hidden = step === 0;
    next.textContent = step === 3 ? "평가 만들기" : "다음";
    (step === 0 ? title : step === 3 ? next : textAreas[step - 1]).focus();
  }

  async function advance() {
    if (busy) return;
    status.textContent = "";
    try {
      if (step === 0 && !title.value.trim()) throw new Error("평가 이름을 입력해 주세요.");
      if (step === 1) equipment = parseEquipment(equipmentText.value);
      if (step === 2) {
        lots = parseLots(lotsText.value);
        const valid = new Set(lots.flatMap((lot) => lot.wafers.flatMap((wafer) =>
          equipment.map((item) => comboKey(item, lot.lot_no, wafer)))));
        for (const key of excluded) if (!valid.has(key)) excluded.delete(key);
      }
      if (step < 3) {
        step++;
        render();
        return;
      }
      const payload = {
        name: title.value.trim(), template_id: template.id, equipment, lots,
        excluded: [...excluded].sort().map((key) => {
          const [equipmentName, lot_no, wafer_no] = JSON.parse(key);
          return { equipment: equipmentName, lot_no, wafer_no };
        }),
      };
      if (parent !== undefined) payload.parent = parent;
      const serialized = JSON.stringify(payload);
      if (!requests.has(serialized)) requests.set(serialized, crypto.randomUUID());
      const toggles = [...sheet.body.querySelectorAll("input[type=checkbox]")];
      busy = true;
      for (const control of [next, back, cancel, closer, ...toggles]) control.disabled = true;
      next.textContent = "만드는 중…";
      try {
        const { evaluation } = await api.createEvaluation({ ...payload, request_id: requests.get(serialized) });
        sheet.close();
        onCreated(evaluation.page_path);
      } finally {
        busy = false;
        for (const control of [next, back, cancel, closer, ...toggles]) control.disabled = false;
        next.textContent = "평가 만들기";
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }
  render();
}

function evaluationCounts(evaluation) {
  return "설비 " + evaluation.equipment_count + " · Lot " + evaluation.lot_count + " · 웨이퍼 " +
    evaluation.wafer_count + " · 평가 " + evaluation.cell_count + "칸 · 제외 " + evaluation.excluded_count + "칸";
}

export async function renderEvaluations(host, { onAdd, pageHref }) {
  const page = el("div", "page");
  const hero = el("div", "hero eval-hero");
  const title = el("div", "grow");
  const eyebrow = el("div", "eyebrow", "설비사 평가");
  title.append(eyebrow, el("h1", "h1", "평가 현황판"));
  const add = button("평가 만들기", "pri", onAdd);
  add.prepend(svg("plus"));
  const templates = button("템플릿 편집", "", () => openTemplateEditor());
  templates.prepend(svg("hier"));
  hero.append(title, templates, add);
  const content = el("div", "eval-list");
  content.append(skeleton(3));
  page.append(hero, content);
  host.replaceChildren(page);
  const items = await api.evaluations();
  if (!items.length) {
    content.replaceChildren(emptyState({
      title: "평가가 아직 없어요", desc: "템플릿을 고르고 설비와 웨이퍼를 붙여넣어 시작하세요.", icon: "board",
    }));
    return;
  }
  content.replaceChildren(...items.map((evaluation) => {
    const card = el("article", "card eval-row");
    const label = el(evaluation.page_path ? "a" : "b", "", evaluation.name);
    if (evaluation.page_path) label.href = pageHref(evaluation.page_path);
    const details = el("div", "");
    details.append(label, el("p", "muted", evaluationCounts(evaluation)));
    card.append(details, el("span", "chip", evaluation.page_path ? STATE[evaluation.status] : "연결 페이지 없음"));
    return card;
  }));
}

export function renderEvaluationPage(host, page, onError) {
  return renderBoard(host, page, onError);
}
