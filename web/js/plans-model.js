// Plan / Step table logic, pure (P5-01). No DOM, so Node can test it.

export const BASE_COLUMNS = [
  ["step_code", "Step ID"],
  ["name", "Step 이름"],
  ["area", "공정 영역"],
  ["tool_group", "설비 그룹"],
  ["recipe", "레시피"],
  ["layer", "레이어"],
  ["note", "비고"],
];

// Columns that actually carry data in these steps, plus the unmapped Excel columns kept in `extra`.
export function visibleColumns(steps, extraColumns = []) {
  const cols = BASE_COLUMNS.filter(([key]) => steps.some((s) => s[key])).map(([key, label]) => ({ key, label, extra: false }));
  for (const name of extraColumns) if (steps.some((s) => s.extra && s.extra[name])) cols.push({ key: name, label: name, extra: true });
  return cols;
}

export const cellText = (step, col) => (col.extra ? step.extra?.[col.key] : step[col.key]) ?? "";

const fold = (text) => String(text ?? "").normalize("NFKC").toLowerCase();

// Search across every shown column; stale (missing from the latest file) steps are opt-in.
export function filterSteps(steps, columns, { query = "", showStale = false } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return steps.filter((step) => {
    if (step.stale && !showStale) return false;
    if (!words.length) return true;
    const hay = fold(columns.map((c) => cellText(step, c)).join("\n"));
    return words.every((w) => hay.includes(w));
  });
}

export function formatStamp(iso) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(iso || "");
  return m ? `${m[1]} ${m[2]}` : iso || "";
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)}KB` : `${(bytes / 1048576).toFixed(1)}MB`;
}

export const STATUS = {
  new: { label: "새로", icon: "plus", tone: "ok" },
  update: { label: "바뀜", icon: "refresh", tone: "warn" },
  same: { label: "같음", icon: "check", tone: "mute" },
};

export const FIELD_ORDER = [
  ["product", "제품", false],
  ["plan", "Plan", false],
  ["step_code", "Step ID", false],
  ["step_name", "Step 이름", false],
  ["area", "공정 영역", false],
  ["tool_group", "설비 그룹", false],
  ["recipe", "레시피", false],
  ["layer", "레이어", false],
  ["note", "비고", false],
];

// Rows of a dry run that match the chosen filter chip.
export function filterPreview(rows, filter) {
  return filter === "all" ? rows : rows.filter((r) => r.status === filter);
}

// Can the user press "apply"? Returns [enabled, label].
export function applyState(preview) {
  if (!preview) return [false, "가져오기"];
  if (!preview.can_apply) return [false, "가져오기"];
  const c = preview.counts;
  const n = c.new + c.update;
  if (n) return [true, `${n}개 반영`];
  if (c.missing) return [true, `파일에 없는 ${c.missing}개 표시`];
  return [false, "바뀐 내용 없음"];
}
