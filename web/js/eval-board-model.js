// Pure board logic (P4-04): indexes, progress and filters. No DOM, so Node can test it.

export const UNASSIGNED = "__none__";

export function buildBoard(data) {
  const stages = data.evaluation.stages;
  const lastKey = stages[stages.length - 1].key;
  const stageIndex = new Map(stages.map((stage, i) => [stage.key, i]));
  const wafers = new Map();
  const rows = [];
  for (const lot of data.lots) {
    for (const wafer of lot.wafers) {
      const row = { lot, wafer, index: rows.length };
      wafers.set(wafer.id, row);
      rows.push(row);
    }
  }
  const equipmentIndex = new Map(data.equipment.map((item, i) => [item.id, i]));
  const grid = new Map();
  for (const cell of data.cells) {
    const row = wafers.get(cell.wafer_id);
    const column = equipmentIndex.get(cell.equipment_id);
    if (!row || column === undefined) continue;
    grid.set(row.index * data.equipment.length + column, cell);
  }
  return { ...data, fields: data.evaluation.fields || [], stages, lastKey, stageIndex, rows, grid, columns: data.equipment.length };
}

export const cellAt = (board, row, column) => board.grid.get(row * board.columns + column);
export const isActive = (cell) => Boolean(cell) && !cell.excluded;
export const isDone = (board, cell) => cell.stage_key === board.lastKey;
export const isRemaining = (board, cell) => isActive(cell) && !isDone(board, cell);

// Per-stage counts for active cells. Cells whose stage key is unknown count as unassigned.
export function stageCounts(board, cells = board.cells) {
  const counts = new Map([[UNASSIGNED, 0], ...board.stages.map((stage) => [stage.key, 0])]);
  let active = 0;
  for (const cell of cells) {
    if (cell.excluded) continue;
    active++;
    const key = board.stageIndex.has(cell.stage_key) ? cell.stage_key : UNASSIGNED;
    counts.set(key, counts.get(key) + 1);
  }
  return { counts, active, done: counts.get(board.lastKey), percent: active ? Math.round((counts.get(board.lastKey) / active) * 100) : 0 };
}

export function equipmentProgress(board) {
  return board.equipment.map((item) => stageCounts(board, board.cells.filter((cell) => cell.equipment_id === item.id)));
}

export function lotProgress(board, lot, equipmentId) {
  const ids = new Set(lot.wafers.map((wafer) => wafer.id));
  return stageCounts(board, board.cells.filter((cell) => ids.has(cell.wafer_id) && (equipmentId === undefined || cell.equipment_id === equipmentId)));
}

// Rows that still have at least one remaining cell (used by "remaining only").
export function visibleRows(board, remainingOnly) {
  if (!remainingOnly) return board.rows;
  return board.rows.filter((row) => {
    for (let c = 0; c < board.columns; c++) if (isRemaining(board, cellAt(board, row.index, c))) return true;
    return false;
  });
}

export function formatValue(field, value) {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "check") return value ? "✓" : "";
  if (field.type === "okng") return value === "ok" || value === true ? "OK" : value === "ng" || value === false ? "NG" : String(value);
  if (field.type === "number") return Number.isFinite(Number(value)) ? Number(value).toLocaleString("ko-KR") : String(value);
  return String(value);
}

// Cells for the by-stage view: grouped per stage, in board order.
export function cellsByStage(board, remainingOnly) {
  const groups = new Map([[UNASSIGNED, []], ...board.stages.map((stage) => [stage.key, []])]);
  for (const row of board.rows) {
    for (let c = 0; c < board.columns; c++) {
      const cell = cellAt(board, row.index, c);
      if (!isActive(cell) || (remainingOnly && isDone(board, cell))) continue;
      const key = board.stageIndex.has(cell.stage_key) ? cell.stage_key : UNASSIGNED;
      groups.get(key).push({ cell, row, column: c });
    }
  }
  return groups;
}
