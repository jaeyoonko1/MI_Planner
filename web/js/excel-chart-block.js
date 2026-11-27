import { joinBlocks, segment } from "./mdblocks.js";
import { isExcelTableId } from "./excel-table-block.js";
import { isExcelChartSource, readExcelChartData } from "./excel-chart-data.js";

const OPEN = /^(`{3,}|~{3,})mi-excel-chart[ \t]*$/;
const CHART_KINDS = ["bar", "line", "scatter"];
const MAX_BLOCK_LENGTH = 128 * 1024;

function validChart(chart) {
  return Object.getPrototypeOf(chart ?? false) === Object.prototype
    && Object.keys(chart).every(key => ["version", "id", "kind", "source"].includes(key))
    && chart.version === 1 && isExcelTableId(chart.id) && CHART_KINDS.includes(chart.kind)
    && isExcelChartSource(chart.source)
    && chart.source.xAxis === (chart.kind === "scatter" ? "number" : "category");
}

function readPayload(block) {
  if (block.kind !== "code" || block.src.length > MAX_BLOCK_LENGTH) return null;
  const lines = block.src.split(/\r\n?|\n/);
  const match = OPEN.exec(lines[0]);
  if (!match || lines.length < 3) return null;
  const close = new RegExp(`^ {0,3}\\${match[1][0]}{${match[1].length},}[ \\t]*$`);
  if (!close.test(lines.at(-1))) return null;
  try {
    return JSON.parse(lines.slice(1, -1).join("\n"));
  } catch {
    return null;
  }
}

export function serializeExcelChart(chart, eol = "\n") {
  if (!validChart(chart) || !["\n", "\r\n", "\r"].includes(eol)) return null;
  const json = JSON.stringify(chart, null, 2).replaceAll("\n", eol);
  const block = ["```mi-excel-chart", json, "```"].join(eol);
  return block.length <= MAX_BLOCK_LENGTH ? block : null;
}

function findChart(document, id) {
  let match = null;
  for (const block of document.blocks) {
    const definition = readPayload(block);
    if (definition?.id !== id) continue;
    if (match) return null;
    match = { block, definition };
  }
  return match && validChart(match.definition) ? match : null;
}

/** A chart stores references only. Resolve its data anew against the whole note. */
export function readExcelChart(markdown, id) {
  if (!isExcelTableId(id)) return null;
  const match = findChart(segment(markdown), id);
  if (!match) return null;
  const { definition } = match;
  return { definition, data: readExcelChartData(markdown, definition.source) };
}

/** Replace one chart definition while retaining its ID and the rest of the note. */
export function replaceExcelChart(markdown, id, replacement) {
  if (!isExcelTableId(id) || replacement?.id !== id) return null;
  const document = segment(markdown);
  const match = findChart(document, id);
  if (!match) return null;
  const eol = match.block.src.match(/\r\n?|\n/)[0];
  const source = serializeExcelChart(replacement, eol);
  if (source === null) return null;
  match.block.src = source;
  return joinBlocks(document);
}
