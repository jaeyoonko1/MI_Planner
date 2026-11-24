// Pure wait-time logic for the evaluation board (P4-06). Mirrors app/eval_wait.py; no DOM, so Node can test it.
// Wait time is never stored (D-09): it is `now - entered_at`, where entered_at is the newest eval_stage_log time
// the server sent as `cell.at`. Calendar hours, Asia/Seoul. A string without an offset is read as +09:00.

const HOUR = 3600e3;

export function parseAt(iso) {
  if (!iso) return null;
  const text = String(iso).trim();
  const ms = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : text + "+09:00");
  return Number.isNaN(ms) ? null : ms;
}

export function waitHours(iso, nowMs) {
  const at = parseAt(iso);
  return at === null ? null : Math.max(0, (nowMs - at) / HOUR);
}

// 0 = fine or no threshold, 1 = over warn_hours, 2 = over twice warn_hours.
export function warnLevel(hours, warnHours) {
  if (hours === null || hours === undefined || !(warnHours > 0)) return 0;
  return hours > warnHours * 2 ? 2 : hours > warnHours ? 1 : 0;
}

// "방금" / "45분" / "3시간" / "1일 4시간" / "12일". Short on purpose: it sits inside a board cell.
export function formatWait(hours) {
  if (hours === null || hours === undefined) return "";
  const minutes = Math.floor(hours * 60);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h}시간`;
  const d = Math.floor(h / 24), rest = h % 24;
  return d >= 10 || !rest ? `${d}일` : `${d}일 ${rest}시간`;
}

export function formatThreshold(hours) {
  return hours % 24 === 0 && hours >= 24 ? `${hours / 24}일` : `${hours}시간`;
}

export const LEVEL_TEXT = ["", "경고", "심각"];

// Wait info for one board cell, or null when a cell does not wait: excluded, unassigned, unknown stage, the
// last (finished) stage, or no usable entry time. `clock` = server now minus client now, so a wrong PC clock
// does not shift the result.
export function cellWait(board, cell, nowMs) {
  if (!cell || cell.excluded || !board.stageIndex.has(cell.stage_key) || cell.stage_key === board.lastKey) return null;
  if (cell.wait_h === null || cell.wait_h === undefined) return null; // server found no matching log entry
  const hours = waitHours(cell.at, nowMs);
  if (hours === null) return null;
  const stage = board.stages[board.stageIndex.get(cell.stage_key)];
  const level = warnLevel(hours, stage.warn_hours);
  return { hours, level, text: formatWait(hours), warnHours: stage.warn_hours || null, stage };
}

export const boardNow = (board, clientNow = Date.now()) => clientNow + (board.clockOffset || 0);

// Screen-reader / tooltip sentence: "대기 3일 (경고: 기준 24시간 초과)".
export function waitSentence(info, warnOn) {
  if (!info) return "";
  const rule = warnOn && info.level ? ` (${LEVEL_TEXT[info.level]}: 기준 ${formatThreshold(info.warnHours)}${info.level === 2 ? "의 2배" : ""} 초과)` : "";
  return `대기 ${info.text}${rule}`;
}

// Totals for the summary: counts per level, per stage, and the longest-waiting cell.
export function waitSummary(board, cells, nowMs) {
  const perStage = new Map(board.stages.map((stage) => [stage.key, { stage, n: 0, warn: 0, alert: 0, max: null, maxCell: null }]));
  let warn = 0, alert = 0, longest = null;
  for (const cell of cells) {
    const info = cellWait(board, cell, nowMs);
    if (!info) continue;
    const row = perStage.get(cell.stage_key);
    row.n++;
    if (info.level === 1) { warn++; row.warn++; }
    if (info.level === 2) { alert++; row.alert++; }
    if (row.max === null || info.hours > row.max) { row.max = info.hours; row.maxCell = cell; }
    if (!longest || info.hours > longest.hours) longest = { ...info, cell };
  }
  return { warn, alert, longest, stages: [...perStage.values()].filter((row) => row.n) };
}

// Time spent per history entry (items are newest first): entry i lasted until entry i-1, the newest until now.
export function historyDurations(items, nowMs) {
  return items.map((item, i) => {
    const start = parseAt(item.at);
    const end = i === 0 ? nowMs : parseAt(items[i - 1].at);
    return start === null || end === null ? null : Math.max(0, (end - start) / HOUR);
  });
}
