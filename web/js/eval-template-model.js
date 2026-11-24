// Pure rules of the evaluation template editor (P4-07): drafts, keys, validation, payload. No DOM.

export const STAGE_COLORS = [
  ["#8f9bb5", "회청"], ["#729eff", "파랑"], ["#8a5cff", "보라"], ["#ffd15c", "노랑"], ["#2de6ff", "하늘"],
  ["#39e58c", "초록"], ["#ff8ba1", "분홍"], ["#ff9f5c", "주황"], ["#c78bff", "연보라"], ["#b6c3d9", "은색"],
];
export const FIELD_TYPES = [["number", "숫자"], ["text", "글자"], ["okng", "OK / NG"], ["check", "체크"]];
export const MAX_STAGES = 20;
export const MAX_FIELDS = 20;
export const MAX_WARN_HOURS = 8760;

export const colorName = (hex) => STAGE_COLORS.find(([c]) => c.toLowerCase() === String(hex).toLowerCase())?.[1] ?? "사용자 색";
export const typeName = (type) => FIELD_TYPES.find(([t]) => t === type)?.[1] ?? type;

export function warnText(hours) {
  return hours == null ? "" : String(hours);
}

// "" -> {value:null} (off); "12" / "1.5" -> number; anything else -> error.
export function parseWarn(text) {
  const raw = String(text ?? "").trim().replace(/,/g, "");
  if (raw === "") return { value: null };
  if (!/^\d+(\.\d+)?$/.test(raw)) return { error: "경고 시간은 숫자로 적어 주세요. 비우면 경고를 끕니다." };
  const value = Number(raw);
  if (!(value > 0 && value <= MAX_WARN_HOURS)) return { error: "경고 시간은 0보다 크고 8,760시간 이하여야 해요." };
  return { value };
}

export function uniqueKey(prefix, existing) {
  const used = new Set(existing.map((item) => item.key));
  let n = existing.length + 1;
  while (used.has(`${prefix}_${n}`)) n++;
  return `${prefix}_${n}`;
}

export function draftOf(template) {
  return {
    name: template.name,
    is_master: template.is_master,
    stages: template.stages.map((s) => ({ key: s.key, label: s.label, color: s.color, warn: warnText(s.warn_hours), isNew: false })),
    fields: template.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, isNew: false })),
  };
}

export function nextColor(stages) {
  const used = new Set(stages.map((s) => s.color.toLowerCase()));
  return (STAGE_COLORS.find(([c]) => !used.has(c))?.[0]) ?? STAGE_COLORS[stages.length % STAGE_COLORS.length][0];
}

export function addStage(draft, label) {
  const stage = { key: uniqueKey("stage", draft.stages), label: label.trim(), color: nextColor(draft.stages), warn: "", isNew: true };
  draft.stages.push(stage);
  return stage;
}

export function addField(draft, label, type = "text") {
  const field = { key: uniqueKey("field", draft.fields), label: label.trim(), type, isNew: true };
  draft.fields.push(field);
  return field;
}

export function moveItem(list, from, to) {
  if (from === to || to < 0 || to >= list.length) return false;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item);
  return true;
}

// Returns { name, stages: {key: msg}, fields: {key: msg}, count }.
export function validate(draft) {
  const errors = { name: "", stages: {}, fields: {}, count: 0 };
  const bump = () => { errors.count++; };
  if (!draft.name.trim()) { errors.name = "템플릿 이름을 입력해 주세요."; bump(); }
  const seen = new Map();
  for (const stage of draft.stages) {
    const label = stage.label.trim();
    let msg = "";
    if (!label) msg = "단계 이름을 입력해 주세요.";
    else if (seen.has(label.toLowerCase())) msg = "같은 이름의 단계가 있어요.";
    else seen.set(label.toLowerCase(), true);
    if (!msg) msg = parseWarn(stage.warn).error ?? "";
    if (msg) { errors.stages[stage.key] = msg; bump(); }
  }
  if (!draft.stages.length) { errors.stages._ = "단계는 하나 이상 있어야 해요."; bump(); }
  const fieldSeen = new Set();
  for (const field of draft.fields) {
    const label = field.label.trim();
    let msg = "";
    if (!label) msg = "값 항목 이름을 입력해 주세요.";
    else if (fieldSeen.has(label.toLowerCase())) msg = "같은 이름의 값 항목이 있어요.";
    fieldSeen.add(label.toLowerCase());
    if (msg) { errors.fields[field.key] = msg; bump(); }
  }
  return errors;
}

export function payloadOf(draft, original) {
  const payload = {
    name: draft.name.trim(),
    stages: draft.stages.map((s) => ({ key: s.key, label: s.label.trim(), color: s.color, warn_hours: parseWarn(s.warn).value })),
    fields: draft.fields.map((f) => ({ key: f.key, label: f.label.trim(), type: f.type })),
  };
  if (draft.is_master && !original.is_master) payload.is_master = true;
  return payload;
}

export function snapshot(draft) {
  return JSON.stringify([
    draft.name.trim(), draft.is_master,
    draft.stages.map((s) => [s.key, s.label.trim(), s.color.toLowerCase(), parseWarn(s.warn).value ?? s.warn.trim()]),
    draft.fields.map((f) => [f.key, f.label.trim(), f.type]),
  ]);
}
