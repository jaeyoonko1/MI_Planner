// Pure selection logic for the evaluation board (P4-05). No DOM, so Node can test it.
// `rows` is the list of rows currently shown (visibleRows), so hidden rows are never selected.
import { cellAt, isActive, stageCounts } from "./eval-board-model.js";

const result = () => ({ ids: [], skipped: 0 });

function collect(board, out, row, column) {
  const cell = row ? cellAt(board, row.index, column) : undefined;
  if (!cell) return;
  if (isActive(cell)) out.ids.push(cell.id); else out.skipped++;
}

// Rectangle between two {r, c} positions (indexes into the shown rows). Excluded cells are skipped, not selected.
export function rectIds(board, rows, a, b) {
  const out = result();
  const [r1, r2] = [Math.min(a.r, b.r), Math.max(a.r, b.r)];
  const [c1, c2] = [Math.min(a.c, b.c), Math.max(a.c, b.c)];
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) collect(board, out, rows[r], c);
  return out;
}

export function rowIds(board, row) {
  const out = result();
  for (let c = 0; c < board.columns; c++) collect(board, out, row, c);
  return out;
}

export function columnIds(board, rows, column) {
  const out = result();
  for (const row of rows) collect(board, out, row, column);
  return out;
}

export function lotIds(board, rows, lotId) {
  const out = result();
  for (const row of rows) if (row.lot.id === lotId) for (let c = 0; c < board.columns; c++) collect(board, out, row, c);
  return out;
}

export function allIds(board, rows) {
  const out = result();
  for (const row of rows) for (let c = 0; c < board.columns; c++) collect(board, out, row, c);
  return out;
}

// replace: new set. add: union. toggle: remove when everything is already selected, otherwise add.
export function mergeSelection(current, incoming, mode) {
  if (mode === "replace") return new Set(incoming);
  const next = new Set(current);
  if (mode === "toggle" && incoming.length && incoming.every((id) => next.has(id))) incoming.forEach((id) => next.delete(id));
  else incoming.forEach((id) => next.add(id));
  return next;
}

// Drop ids that are gone after a reload. An excluded cell may only be selected on its own (it is read-only).
export function pruneSelection(board, ids) {
  const kept = [...ids].filter((id) => board.byId.has(id));
  const active = kept.filter((id) => !board.byId.get(id).excluded);
  return active.length ? active : kept.slice(0, 1);
}

export const targetMoves = (ids, stageKey) => ids.map((id) => ({ cell_id: id, stage_key: stageKey }));

// Each cell goes to the stage after its own. Unassigned cells go to the first stage; last-stage cells stay.
export function nextStageMoves(board, ids) {
  const moves = [];
  for (const id of ids) {
    const cell = board.byId.get(id);
    if (!cell || cell.excluded) continue;
    const at = board.stageIndex.has(cell.stage_key) ? board.stageIndex.get(cell.stage_key) : -1;
    if (at + 1 < board.stages.length) moves.push({ cell_id: id, stage_key: board.stages[at + 1].key });
  }
  return moves;
}

export function stageDistribution(board, ids) {
  return stageCounts(board, ids.map((id) => board.byId.get(id)).filter(Boolean));
}

export function describeSelection(board, ids) {
  const equipment = new Set(), lots = new Set();
  for (const id of ids) {
    const cell = board.byId.get(id);
    const row = cell && board.rowByWafer.get(cell.wafer_id);
    if (!row) continue;
    equipment.add(cell.equipment_id);
    lots.add(row.lot.id);
  }
  return { cells: ids.length, equipment: equipment.size, lots: lots.size };
}

// Position of a cell: its row object and column index (null if the cell is unknown).
export function locate(board, id) {
  const cell = board.byId.get(id);
  const row = cell && board.rowByWafer.get(cell.wafer_id);
  return row ? { cell, row, column: board.columnById.get(cell.equipment_id) } : null;
}

// Mutate the model after the server confirmed a change, so no full reload is needed.
export function applyChanged(board, changed, at) {
  for (const item of changed) {
    const cell = board.byId.get(item.id);
    if (cell) { cell.stage_key = item.to; cell.at = at; }
  }
}
