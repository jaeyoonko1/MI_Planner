// Pure helpers for memo / note editing (P2B-10). No DOM, so they run under node (web/test/run_memo.mjs).

// ---- image width in markdown --------------------------------------------------------------------
// Stored right after the image, human- and LLM-readable:
//   ![alt](files/a.png)                 auto: natural size, never wider than the text column
//   ![alt](files/a.png){size=small}     small thumbnail (SMALL_PX)
//   ![alt](files/a.png){width=480}      fixed width in px (still capped by the text column)
//   ![alt](files/a.png){size=orig}      original resolution
export const SMALL_PX = 240;
export const MIN_W = 60;
export const MAX_W = 2400;
export const IMG_ATTR_RE = "(?:\\{(?:width=\\d{2,4}|size=(?:small|orig))\\})?";

/** "{width=480}" -> "480", "{size=small}" -> "small", anything else -> null (auto). */
export function parseImgAttr(s) {
  const m = /^\{(?:width=(\d{2,4})|size=(small|orig))\}$/.exec(s || "");
  if (!m) return null;
  if (m[2]) return m[2];
  return String(clampWidth(+m[1]));
}

/** data-w value -> markdown suffix ("" for auto/invalid). */
export function imgSuffix(w) {
  if (w === "small" || w === "orig") return `{size=${w}}`;
  if (/^\d{2,4}$/.test(w || "")) return `{width=${clampWidth(+w)}}`;
  return "";
}

export function clampWidth(n) {
  return Math.max(MIN_W, Math.min(MAX_W, Math.round(Number(n) || 0)));
}

/** CSS width for an image given its data-w ("" = leave to the stylesheet's auto rule). */
export function imgCssWidth(w) {
  if (w === "small") return `${SMALL_PX}px`;
  if (/^\d{2,4}$/.test(w || "")) return `${clampWidth(+w)}px`;
  return "";
}

// ---- folding ------------------------------------------------------------------------------------
// Fold state lives OUTSIDE the text (settings.memo_folds). A heading is identified by level + text +
// occurrence, so renaming a heading simply unfolds it and the file never carries view state.

/**
 * blocks: [{level: 0 for non-heading, 1..3 for headings, text}], folded: Set of keys.
 * Returns per block: key (headings only), hidden (inside a folded section), count (blocks hidden under it),
 * folded (heading is folded). Headings with nothing under them are not foldable (count 0).
 */
export function foldPlan(blocks, folded) {
  const seen = new Map();
  const out = blocks.map((b) => ({ key: null, hidden: false, count: 0, folded: false }));
  const keys = blocks.map((b) => {
    if (!b.level) return null;
    const base = `h${b.level}|${String(b.text || "").trim().slice(0, 60)}`;
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
  for (let i = 0; i < blocks.length; i++) {
    if (!blocks[i].level) continue;
    let end = i + 1;
    while (end < blocks.length && !(blocks[end].level && blocks[end].level <= blocks[i].level)) end++;
    out[i].key = keys[i];
    out[i].count = end - i - 1;
    if (out[i].count && folded.has(keys[i])) {
      out[i].folded = true;
      for (let j = i + 1; j < end; j++) out[j].hidden = true;
    }
  }
  return out;
}

/** The nearest heading at or before block `index`, or -1. */
export function ownerHeading(blocks, index) {
  for (let i = Math.min(index, blocks.length - 1); i >= 0; i--) if (blocks[i].level) return i;
  return -1;
}

/** Drop fold keys that no heading uses any more (keeps the settings value small). */
export function pruneFolds(blocks, folded) {
  const live = new Set(foldPlan(blocks, new Set()).map((p) => p.key).filter(Boolean));
  return new Set([...folded].filter((k) => live.has(k)));
}
