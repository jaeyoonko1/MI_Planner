// Pure logic for equipment / Lot attributes on the evaluation board (V-005). No DOM, so Node can test it.
// Status is a label the user sets; it never feeds wait-time or progress math (D-09 stays untouched).

export const ENTITY_STATUS = [
  { key: "wait", label: "대기", icon: "clock", hint: "아직 시작 전이에요" },
  { key: "active", label: "진행", icon: "play", hint: "평가를 진행하고 있어요" },
  { key: "hold", label: "보류", icon: "pause", hint: "잠시 멈춘 상태예요 (점검·재작업 등)" },
  { key: "done", label: "완료", icon: "check", hint: "이 설비·Lot의 평가를 마쳤어요" },
];
export const EVALUATION_STATUS = [
  { key: "active", label: "진행 중", icon: "play", hint: "평가를 진행하고 있어요" },
  { key: "hold", label: "보류", icon: "pause", hint: "평가를 잠시 멈췄어요" },
  { key: "done", label: "완료", icon: "check", hint: "평가를 마쳤어요" },
];
export const NAME_MAX = 120;
export const NOTE_MAX = 500;
export const KIND_LABEL = { equipment: "설비", lot: "Lot", evaluation: "평가" };

export function statusMeta(kind, key) {
  const list = kind === "evaluation" ? EVALUATION_STATUS : ENTITY_STATUS;
  return list.find((item) => item.key === key) || { key, label: String(key || "진행"), icon: "play", hint: "" };
}

export const entityList = (board, kind) => (kind === "lot" ? board.lots : board.equipment);
export const entityName = (kind, item) => (kind === "lot" ? item.lot_no : item.name);
export const findEntity = (board, kind, id) => entityList(board, kind).find((item) => item.id === id) || null;
export const statusOf = (item) => item?.status || "active";

// Equipment and Lots touched by a set of selected cells, in board order.
export function touchedEntities(board, ids) {
  const equipment = new Set(), lots = new Set();
  for (const id of ids) {
    const cell = board.byId.get(id);
    const row = cell && board.rowByWafer.get(cell.wafer_id);
    if (!row) continue;
    equipment.add(cell.equipment_id);
    lots.add(row.lot.id);
  }
  return {
    equipment: board.equipment.filter((item) => equipment.has(item.id)).map((item) => item.id),
    lots: board.lots.filter((item) => lots.has(item.id)).map((item) => item.id),
  };
}

// How many of the given entities have each status; `uniform` is the shared status or null when mixed.
export function statusSummary(board, kind, ids) {
  const counts = new Map(ENTITY_STATUS.map((item) => [item.key, 0]));
  for (const id of ids) {
    const item = findEntity(board, kind, id);
    if (item) counts.set(statusOf(item), (counts.get(statusOf(item)) || 0) + 1);
  }
  const used = [...counts].filter(([, n]) => n > 0);
  return { counts, uniform: used.length === 1 ? used[0][0] : null, total: ids.length };
}

export const statusTargets = (kind, ids, status) => ids.map((id) => ({ kind, id, status }));
export const undoTargets = (changed) => changed.map((item) => ({ kind: item.kind, id: item.id, status: item.from }));

// Client-side name check mirroring the server rules, so errors show before a round trip.
export function validateName(board, kind, id, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, value, error: "이름을 입력해 주세요." };
  if (value.length > NAME_MAX) return { ok: false, value, error: `${NAME_MAX}자까지 입력할 수 있어요.` };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(value)) return { ok: false, value, error: "줄바꿈·제어 문자는 쓸 수 없어요." };
  const same = entityList(board, kind).find((item) => item.id !== id && entityName(kind, item) === value);
  if (same) return { ok: false, value, error: `같은 이름이 이미 있어요: ${value}` };
  return { ok: true, value, error: "" };
}

// Mutate the model after the server confirmed a change, so no full reload is needed.
export function applyEntity(board, kind, id, patch) {
  const item = findEntity(board, kind, id);
  if (!item) return null;
  if ("name" in patch) item[kind === "lot" ? "lot_no" : "name"] = patch.name;
  for (const key of ["vendor", "status", "note"]) if (key in patch) item[key] = patch[key];
  return item;
}

export function applyStatusChanges(board, changed) {
  for (const item of changed) applyEntity(board, item.kind, item.id, { status: item.to });
}

// One sentence for screen readers and tooltips: "EQ-A01 · 설비 · 보류".
export function entitySentence(kind, item) {
  return `${entityName(kind, item)} · ${KIND_LABEL[kind]} · ${statusMeta(kind, statusOf(item)).label}`;
}

// "5개 설비를 보류로" style message for toasts.
export function statusMessage(kind, count, status) {
  return `${KIND_LABEL[kind]} ${count.toLocaleString("ko-KR")}개를 ${statusMeta(kind, status).label} 상태로 바꿨어요`;
}
