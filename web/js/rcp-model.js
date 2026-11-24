// Pure helpers for the RCP screen (P6-02): labels, filter rule cleanup, run status text. Easy to test in Node.

export const RULE_TYPES = [["contains", "포함"], ["prefix", "시작"], ["suffix", "끝"], ["glob", "패턴"]];
const RULE_LABEL = Object.fromEntries(RULE_TYPES);
export const LAYOUTS = [["folder", "폴더 = 레시피"], ["file", "파일 = 레시피"]];

// status -> [label, tone, icon]; text always carries the meaning, color only reinforces it.
export const RUN_STATUS = {
  running: ["수집 중", "warn", "refresh"],
  ok: ["완료", "ok", "check"],
  partial: ["일부 실패", "warn", "alert"],
  error: ["실패", "bad", "alert"],
  cancelled: ["취소됨", "mute", "x"],
  dry_run: ["미리보기", "mute", "search"],
};

export function runStatus(status) {
  return RUN_STATUS[status] ?? [status, "mute", "clock"];
}

export const isRunning = (run) => !!run && run.status === "running";

/** Rules the server accepts: blank values dropped, trimmed, flags normalized. */
export function cleanRules(rules) {
  return rules
    .map((r) => ({ type: r.type, value: String(r.value ?? "").trim(), exclude: !!r.exclude }))
    .filter((r) => r.value);
}

export function ruleText(rule) {
  return `${rule.exclude ? "제외 · " : ""}${RULE_LABEL[rule.type] ?? rule.type} ${rule.value}`;
}

export function filterSummary(rules) {
  return rules.length ? rules.map(ruleText) : ["전체 (필터 없음)"];
}

/** "a, b ,,c" -> ["a","b","c"] (file patterns). */
export function splitList(text) {
  return String(text ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

export function splitNames(text) {
  return [...new Set(String(text ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean))];
}

export function runLine(run) {
  if (!run) return "아직 수집한 적이 없어요";
  const [label] = runStatus(run.status);
  if (run.status === "running") return `${label} · 확인 ${run.matched}개 · 받은 파일 ${run.downloaded}개`;
  return `${label} · 레시피 ${run.matched}개 · 새 버전 ${run.new_snapshots} · 변화 없음 ${run.unchanged}`;
}

export function formatStamp(iso) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "";
}

/** Recipes shown in the table: optional missing ones, plain substring search on the name. */
export function filterRecipes(items, { query = "", showMissing = false } = {}) {
  const q = query.trim().toLowerCase();
  return items.filter((r) => (showMissing || !r.missing) && (!q || r.name.toLowerCase().includes(q)));
}
