// MOS paste adapter, pure logic (P4-08). No DOM, no network, so Node can test it.
// Text copied from a MOS table (tab / CSV / aligned columns) + a header-name mapping
// -> a dry-run plan of stage moves for evaluation cells. Nothing here writes anything.
import { cellAt } from "./eval-board-model.js";
import { parseAt } from "./eval-wait-model.js";

export const ROLES = [
  ["lot", "Lot", true],
  ["wafer", "웨이퍼", false],
  ["equipment", "설비", true],
  ["stage", "단계", true],
  ["time", "시각", false],
];

export const DEFAULT_MAPPING = {
  lot: "Lot ID, LOT_ID, Lot No, Lot, 로트",
  wafer: "Wafer ID, Wafer No, Wafer, Slot, 웨이퍼",
  equipment: "Equipment ID, EQP_ID, EQP, Equipment, Tool, 설비",
  stage: "Stage, Status, Step, State, 단계, 상태",
  time: "Track In Time, Event Time, Update Time, Timestamp, Time, 시각, 시간",
  stageMap: {},
};

export const MAX_ROWS = 5000;
const CAP = 200; // rows listed in the preview; counts always cover every row

// "Lot ID" == "LOT_ID" == "lot-id": compare names without case, spaces and separators.
export const norm = (text) => String(text ?? "").normalize("NFKC").toLowerCase().replace(/[\s_\-.()[\]/]+/g, "");

export const aliasList = (text) => String(text || "").split(/[,;\n]/).map((part) => part.trim()).filter(Boolean);

// ---- mapping (stored in the `mos_mapping` setting as JSON) ----------------------------------------------

export function readMapping(stored) {
  let saved = {};
  try { saved = stored ? JSON.parse(stored) : {}; } catch { saved = {}; }
  if (!saved || typeof saved !== "object") saved = {};
  const mapping = { stageMap: {} };
  for (const [role] of ROLES) mapping[role] = typeof saved[role] === "string" && saved[role].trim() ? saved[role] : DEFAULT_MAPPING[role];
  if (saved.stageMap && typeof saved.stageMap === "object" && !Array.isArray(saved.stageMap)) {
    for (const [from, to] of Object.entries(saved.stageMap)) {
      if (typeof to === "string" && from.trim() && to.trim()) mapping.stageMap[from.trim()] = to.trim();
    }
  }
  return mapping;
}

export const serializeMapping = (mapping) => JSON.stringify(mapping);

// One "MOS value = 단계 이름" per line (also accepts "->" and an arrow).
export function parseStageMapText(text) {
  const map = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = line.match(/^(.*?)\s*(?:=>|->|=|→)\s*(.+)$/);
    if (!m) continue;
    const from = m[1].trim();
    const to = m[2].trim();
    if (from && to) map[from] = to;
  }
  return map;
}

export const stageMapText = (map) => Object.entries(map || {}).map(([from, to]) => `${from} = ${to}`).join("\n");

// ---- table text ----------------------------------------------------------------------------------------------

function splitQuoted(line, delimiter) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"' && cur === "") quoted = true;
    else if (ch === delimiter) { cells.push(cur); cur = ""; } else cur += ch;
  }
  cells.push(cur);
  return cells.map((cell) => cell.trim());
}

function detectDelimiter(lines) {
  const sample = lines.slice(0, 5);
  if (sample.some((line) => line.includes("\t"))) return "\t";
  for (const delimiter of [",", ";", "|"]) {
    if (sample.every((line) => line.split(delimiter).length > 1)) return delimiter;
  }
  return sample.every((line) => /\S {2,}\S/.test(line)) ? "  " : "\t";
}

// -> { headers, rows: [{line, cells}], delimiter, error }  (line = 1-based line number in the pasted text)
export function parseTable(text) {
  const all = String(text ?? "").replace(/^﻿/, "").split(/\r\n|\r|\n/);
  const lines = [];
  all.forEach((raw, i) => { if (raw.trim()) lines.push({ line: i + 1, raw }); });
  if (!lines.length) return { headers: [], rows: [], delimiter: "\t", error: "붙여넣은 내용이 비어 있어요." };
  const delimiter = detectDelimiter(lines.map((l) => l.raw));
  const split = (raw) => (delimiter === "  " ? raw.trim().split(/ {2,}|\t/).map((c) => c.trim()) : splitQuoted(raw, delimiter));
  const headers = split(lines[0].raw);
  if (headers.length < 2) return { headers, rows: [], delimiter, error: "열을 나눌 수 없어요. MOS 표를 머리글째로 복사했는지 확인해 주세요." };
  const rows = lines.slice(1).map(({ line, raw }) => ({ line, cells: split(raw) }));
  return { headers, rows, delimiter, error: "" };
}

// ---- columns ---------------------------------------------------------------------------------------------------

// -> { index: {role: columnIndex}, headerOf: {role: header text}, missing: [role], duplicate: [role] }
export function resolveColumns(headers, mapping) {
  const index = {};
  const headerOf = {};
  const missing = [];
  const keys = headers.map(norm);
  for (const [role, , required] of ROLES) {
    let found = -1;
    for (const alias of aliasList(mapping[role])) {
      found = keys.indexOf(norm(alias));
      if (found >= 0) break;
    }
    if (found >= 0) { index[role] = found; headerOf[role] = headers[found]; } else if (required) missing.push(role);
  }
  const used = Object.values(index);
  const duplicate = ROLES.map(([role]) => role).filter((role) => role in index && used.filter((i) => i === index[role]).length > 1);
  return { index, headerOf, missing, duplicate };
}

// ---- values ----------------------------------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

// MOS time text -> "YYYY-MM-DDTHH:MM:SS+09:00" (Asia/Seoul when no offset is written), or null.
export function parseMosTime(text) {
  let s = String(text ?? "").trim();
  if (!s) return null;
  let m;
  let y; let mo; let d; let h = 0; let mi = 0; let sec = 0; let zone = "+09:00";
  const tail = s.match(/(Z|[+-]\d{2}:?\d{2})$/);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s) && tail) {
    zone = tail[1] === "Z" ? "+00:00" : tail[1].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
    s = s.slice(0, -tail[1].length);
  }
  const pm = /오후|PM/i.test(s);
  const am = /오전|AM/i.test(s);
  s = s.replace(/오전|오후|AM|PM/gi, " ").replace(/\s+/g, " ").trim();
  if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:[ T]?(\d{2})(\d{2})(\d{2})?)?$/))) {
    [, y, mo, d, h = 0, mi = 0, sec = 0] = m;
  } else if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\.?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/))) {
    [, y, mo, d, h = 0, mi = 0, sec = 0] = m;
  } else return null;
  [y, mo, d, h, mi, sec] = [y, mo, d, h, mi, sec].map(Number);
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59 || sec > 59 || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(sec)}${zone}`;
}

// "W01", "#1", "01" and "1" are the same wafer.
export function waferKey(text) {
  const s = String(text ?? "").trim().replace(/^(?:wafer|w|#|no\.?)\s*/i, "");
  return /^\d+$/.test(s) ? String(Number(s)) : norm(s);
}

// "", "ALL" -> every wafer; "01,02" / "1 3" / "1-5" / "01~05" -> those wafers. -> { keys: Set|null, bad: [text] }
export function parseWaferSpec(text, known) {
  const s = String(text ?? "").trim();
  if (!s || /^(all|전체|전부|\*)$/i.test(s)) return { keys: null, bad: [] };
  const keys = new Set();
  for (const part of s.split(/[,;/\s]+/).filter(Boolean)) {
    const range = part.match(/^(\d+)\s*[-~]\s*(\d+)$/);
    if (range && Number(range[2]) >= Number(range[1]) && Number(range[2]) - Number(range[1]) < 100) {
      for (let n = Number(range[1]); n <= Number(range[2]); n++) keys.add(String(n));
    } else keys.add(waferKey(part));
  }
  return { keys, bad: [...keys].filter((key) => !known.has(key)) };
}

// ---- plan ------------------------------------------------------------------------------------------------------

export const ROW_ERRORS = {
  unknown_lot: "이 평가에 없는 Lot",
  unknown_equipment: "이 평가에 없는 설비",
  unknown_wafer: "이 Lot에 없는 웨이퍼",
  unknown_stage: "알 수 없는 단계",
  bad_time: "시각을 읽을 수 없음",
  blank: "Lot·설비·단계 중 빈 칸",
  excluded: "제외한 칸뿐",
};

export const CELL_KINDS = {
  apply: "적용",
  same: "이미 같음",
  backward: "단계 되돌림",
  stale: "MOS가 더 오래됨",
  superseded: "뒤의 줄이 덮어씀",
  excluded: "제외",
};

function stageResolver(board, stageMap) {
  const byName = new Map();
  for (const stage of board.stages) { byName.set(norm(stage.label), stage); byName.set(norm(stage.key), stage); }
  const alias = new Map();
  for (const [from, to] of Object.entries(stageMap || {})) {
    const target = byName.get(norm(to));
    if (target) alias.set(norm(from), target);
  }
  return (text) => alias.get(norm(text)) || byName.get(norm(text)) || null;
}

/**
 * Dry run. `board` is buildBoard() output. -> {
 *   error, columns, rows: [{line, lot, wafer, equipment, stage, time, error, cells: [{id, wafer_no, from, to, at, kind}]}],
 *   counts: {rows, apply, same, backward, stale, superseded, skipped}, unknown: {lots, equipment, stages}
 * }
 */
export function planPaste(board, table, mapping) {
  const plan = {
    error: table.error || "", columns: null, rows: [],
    counts: { rows: 0, apply: 0, same: 0, backward: 0, stale: 0, superseded: 0, skipped: 0 },
    unknown: { lots: [], equipment: [], stages: [] },
  };
  if (plan.error) return plan;
  const columns = resolveColumns(table.headers, mapping);
  plan.columns = columns;
  if (columns.missing.length || columns.duplicate.length) {
    const label = (role) => ROLES.find(([r]) => r === role)[1];
    plan.error = columns.missing.length
      ? `열을 찾지 못했어요: ${columns.missing.map(label).join(", ")}`
      : `같은 열을 두 항목이 쓰고 있어요: ${columns.duplicate.map(label).join(", ")}`;
    return plan;
  }
  if (table.rows.length > MAX_ROWS) {
    plan.error = `한 번에 ${MAX_ROWS.toLocaleString("ko-KR")}줄까지만 처리할 수 있어요.`;
    return plan;
  }
  const { index } = columns;
  const lots = new Map(board.lots.map((lot) => [norm(lot.lot_no), lot]));
  const equipment = new Map(board.equipment.map((item, i) => [norm(item.name), i]));
  const wafersOf = new Map();
  for (const row of board.rows) {
    if (!wafersOf.has(row.lot.id)) wafersOf.set(row.lot.id, []);
    wafersOf.get(row.lot.id).push(row);
  }
  const resolveStage = stageResolver(board, mapping.stageMap);
  const get = (row, role) => (role in index ? (row.cells[index[role]] ?? "").trim() : "");
  const rank = (key) => (board.stageIndex.has(key) ? board.stageIndex.get(key) : -1);
  const unknown = { lots: new Set(), equipment: new Set(), stages: new Set() };
  const claim = new Map(); // cell id -> winning entry (later MOS time wins; same time -> later line)

  for (const source of table.rows) {
    const item = {
      line: source.line, lot: get(source, "lot"), wafer: get(source, "wafer"), equipment: get(source, "equipment"),
      stage: get(source, "stage"), time: get(source, "time"), error: "", iso: null, cells: [],
    };
    plan.rows.push(item);
    if (!item.lot || !item.equipment || !item.stage) { item.error = "blank"; continue; }
    const lot = lots.get(norm(item.lot));
    if (!lot) { item.error = "unknown_lot"; unknown.lots.add(item.lot); continue; }
    const column = equipment.get(norm(item.equipment));
    if (column === undefined) { item.error = "unknown_equipment"; unknown.equipment.add(item.equipment); continue; }
    const stage = resolveStage(item.stage);
    if (!stage) { item.error = "unknown_stage"; unknown.stages.add(item.stage); continue; }
    item.stageLabel = stage.label;
    if (item.time) {
      item.iso = parseMosTime(item.time);
      if (!item.iso) { item.error = "bad_time"; continue; }
    }
    const rows = wafersOf.get(lot.id) || [];
    const spec = parseWaferSpec(item.wafer, new Set(rows.map((r) => waferKey(r.wafer.wafer_no))));
    if (spec.bad.length) { item.error = "unknown_wafer"; continue; }
    const when = item.iso ? parseAt(item.iso) : null;
    for (const row of rows) {
      if (spec.keys && !spec.keys.has(waferKey(row.wafer.wafer_no))) continue;
      const cell = cellAt(board, row.index, column);
      if (!cell) continue;
      const entry = { id: cell.id, wafer_no: row.wafer.wafer_no, from: cell.stage_key, to: stage.key, at: item.iso, kind: "apply", line: item.line };
      const known = cell.at ? parseAt(cell.at) : null;
      if (cell.excluded) entry.kind = "excluded";
      else if (cell.stage_key === stage.key) entry.kind = "same";
      else if (rank(stage.key) < rank(cell.stage_key)) entry.kind = "backward";
      else if (when !== null && known !== null && when < known) entry.kind = "stale";
      item.cells.push(entry);
      if (entry.kind === "excluded") continue;
      const rival = claim.get(cell.id);
      if (rival) {
        const rivalAt = rival.at ? parseAt(rival.at) : 0;
        if (rivalAt > (when ?? 0)) { entry.kind = "superseded"; continue; }
        rival.kind = "superseded";
      }
      claim.set(cell.id, entry);
    }
    if (!item.cells.length) item.error = "unknown_wafer";
    else if (item.cells.every((c) => c.kind === "excluded")) item.error = "excluded";
  }

  for (const item of plan.rows) {
    plan.counts.rows++;
    if (item.error) { plan.counts.skipped++; continue; }
    for (const cell of item.cells) if (cell.kind in plan.counts) plan.counts[cell.kind]++;
  }
  plan.unknown = { lots: [...unknown.lots], equipment: [...unknown.equipment], stages: [...unknown.stages] };
  return plan;
}

/** Preview rows. `filter`: all | apply | risky | skipped. Counts stay exact; only the listing is capped. */
export function previewRows(plan, filter = "all") {
  const has = (item, kinds) => item.cells.some((c) => kinds.includes(c.kind));
  const pick = {
    all: () => true,
    apply: (item) => !item.error && has(item, ["apply"]),
    risky: (item) => !item.error && has(item, ["backward", "stale"]),
    skipped: (item) => Boolean(item.error) || !has(item, ["apply", "backward", "stale"]),
  }[filter] || (() => true);
  const rows = plan.rows.filter(pick);
  return { rows: rows.slice(0, CAP), total: rows.length, capped: rows.length > CAP };
}

/**
 * Stage moves for the atomic bulk API. Backward moves and "MOS is older" moves need an explicit opt-in.
 * `at` is only sent for plain forward moves and never in the future (the server rejects that).
 */
export function buildMoves(plan, { allowBackward = false, allowStale = false } = {}, nowMs = Date.now()) {
  const moves = [];
  for (const item of plan.rows) {
    if (item.error) continue;
    for (const cell of item.cells) {
      const ok = cell.kind === "apply" || (cell.kind === "backward" && allowBackward) || (cell.kind === "stale" && allowStale);
      if (!ok) continue;
      const move = { cell_id: cell.id, stage_key: cell.to };
      const when = cell.at && cell.kind === "apply" ? parseAt(cell.at) : null;
      if (when !== null && when <= nowMs) move.at = cell.at;
      moves.push(move);
    }
  }
  return moves;
}

/** Moves that put the cells back: one per changed cell, to the stage it came from. */
export const undoMoves = (changed) => changed.map((item) => ({ cell_id: item.id, stage_key: item.from }));
