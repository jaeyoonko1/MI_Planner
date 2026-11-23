import { segment } from "./mdblocks.js";

const BOUNDARY = "<!-- column -->";
export const MAX_COLUMNS = 4;
const ENDING = /(?:\r\n|\r|\n)$/;
const BEGINNING = /^(?:\r\n|\r|\n)/;

export function splitColumns(md) {
  const { blocks, eol, pre } = segment(md);
  const parts = [];
  const separators = [];
  let pos = pre.length;
  let start = 0;
  for (const block of blocks) {
    if (block.kind === "comment" && block.src === BOUNDARY && separators.length < MAX_COLUMNS - 1) {
      parts.push(md.slice(start, pos));
      const following = BEGINNING.exec(block.gap)?.[0] || "";
      separators.push(block.src + following);
      start = pos + block.src.length + following.length;
    }
    pos += block.src.length + block.gap.length;
  }
  parts.push(md.slice(start));
  return { parts, separators, eol };
}

export function joinColumns({ parts, separators, eol }) {
  let md = parts[0];
  separators.forEach((separator, i) => {
    if (md && !ENDING.test(md)) md += eol;
    md += separator;
    const next = parts[i + 1];
    if (next && !ENDING.test(separator)) md += eol;
    md += next;
  });
  return md;
}

export function appendColumn(document) {
  if (document.parts.length >= MAX_COLUMNS) return null;
  const proposal = {
    ...document,
    parts: [...document.parts, ""],
    separators: [...document.separators, BOUNDARY + document.eol],
  };
  const split = splitColumns(joinColumns(proposal));
  // An unfinished fenced block or comment absorbs the new boundary. Leave the text untouched.
  return split.parts.length === proposal.parts.length ? split : null;
}

export function layoutFor(meta, count) {
  const mode = meta?.mode === "scroll" ? "scroll" : "fit";
  const widths = meta?.widths;
  const valid = Array.isArray(widths) && widths.length === count
    && widths.every(width => Number.isInteger(width) && width > 0)
    && widths.reduce((sum, width) => sum + width, 0) === 100;
  if (valid) return { mode, widths: [...widths] };
  const base = Math.floor(100 / count);
  return { mode, widths: Array.from({ length: count }, (_, i) => base + Number(i < 100 % count)) };
}

export function resizePair(widths, index, left) {
  const total = widths[index] + widths[index + 1];
  const min = Math.min(10, Math.floor(total / 2));
  const next = [...widths];
  next[index] = Math.min(total - min, Math.max(min, Math.round(left)));
  next[index + 1] = total - next[index];
  return next;
}
