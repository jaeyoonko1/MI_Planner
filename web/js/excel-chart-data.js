// Resolve chart references against the current note body, including tables in other columns.
import { isExcelTableId, readExcelTable } from "./excel-table-block.js";

const isSelection = ids => Array.isArray(ids) && ids.length > 0
  && new Set(ids).size === ids.length && Array.from(ids).every(isExcelTableId);
const numberOf = cell => cell?.value?.type === "number" ? Number(cell.value.raw) : null;

export function isExcelChartSource(source) {
  if (Object.getPrototypeOf(source ?? false) !== Object.prototype
    || !Object.keys(source).every(key =>
      ["tableId", "rowIds", "xColumnId", "yColumnIds", "xAxis", "headerRowId"].includes(key))) return false;
  const { tableId, rowIds, xColumnId, yColumnIds, xAxis, headerRowId = null } = source;
  return isExcelTableId(tableId) && isExcelTableId(xColumnId) && isSelection(rowIds) && isSelection(yColumnIds)
    && ["category", "number"].includes(xAxis)
    && (headerRowId === null || (isExcelTableId(headerRowId) && !rowIds.includes(headerRowId)));
}

/**
 * Return rows in current table order and series in the requested column order.
 * Null coordinates are gaps. A scatter renderer skips rows whose X is null.
 */
export function readExcelChartData(markdown, source) {
  if (!isExcelChartSource(source)) return { status: "invalid-source" };
  const { tableId, rowIds, xColumnId, yColumnIds, xAxis, headerRowId = null } = source;

  const table = readExcelTable(markdown, tableId);
  if (!table) return { status: "unavailable-table" };

  const selectedRows = new Set(rowIds);
  const rows = table.rows.filter(row => selectedRows.has(row.id));
  const header = headerRowId === null ? null : table.rows.find(row => row.id === headerRowId);
  const columnIndexes = new Map(table.columns.map((id, index) => [id, index]));
  const xIndex = columnIndexes.get(xColumnId);
  const yIndexes = yColumnIds.map(id => columnIndexes.get(id));
  if (rows.length !== selectedRows.size || (headerRowId !== null && !header)
    || xIndex === undefined || yIndexes.includes(undefined)) return { status: "missing-reference" };

  return {
    status: "ready",
    series: yColumnIds.map((columnId, index) => ({
      columnId,
      label: header?.cells[yIndexes[index]]?.displayText ?? null,
    })),
    rows: rows.map(row => {
      const xCell = row.cells[xIndex];
      return {
        rowId: row.id,
        x: xAxis === "number" ? numberOf(xCell) : xCell?.displayText ?? null,
        y: yIndexes.map(index => numberOf(row.cells[index])),
      };
    }),
  };
}
