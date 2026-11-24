// Rich paste for the line editor (V-003): OneNote / Word / web clipboard HTML -> lines in the note's markup.
// The conversion is paste-doc.js (V-007), the same one the note editor uses; this file only reshapes its markdown to
// "one row per line" (the line editor has no blank-line blocks, headings, tables or pictures).
import { docHasContent, docToMarkdown, inlineMarkdown, isInlineDoc, planPaste } from "./paste-doc.js";

const HEADING = /^#{1,6}[ \t]+(.*)$/;
const NEEDS_PLAIN = new Set(["code", "raw", "hr"]);
const TABLE_ROW = /^\|(.*)\|$/;
const TABLE_RULE = /^\|[\s:|-]+\|$/;

/**
 * Clipboard -> text to insert, or null when the browser's own plain-text paste is the better result
 * (nothing rich on the clipboard, a pure table or sheet, code, or only a picture).
 */
export function pasteToLines({ html = "", text = "" }) {
  const plan = planPaste({ html, text });
  if (!plan || plan.kind !== "doc") return null;
  const block = plan.block;
  if (block.items.some((item) => NEEDS_PLAIN.has(item.k)) || !docHasContent(block)) return null;
  if (isInlineDoc(block)) return inlineMarkdown(block) || null;
  const out = [];
  for (const line of docToMarkdown(block).split(/\r\n?|\n/)) {
    if (!line.trim() || TABLE_RULE.test(line.trim())) continue;
    const row = TABLE_ROW.exec(line.trim());
    if (row) { out.push(row[1].trim()); continue; } // a table inside a document: one row of text per table row
    const h = HEADING.exec(line);
    // a heading becomes a bold row: the line editor has no heading level
    out.push(h ? (/\*\*/.test(h[1]) ? h[1] : `**${h[1].trim()}**`) : line.replace(/\s+$/, ""));
  }
  return out.length ? out.join("\n") : null;
}
