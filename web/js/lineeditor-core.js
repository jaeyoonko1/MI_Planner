// Pure text operations for the shared line editor (P2B-02, D-21). No DOM here so they can be unit tested.
// A state is { v: string, s: number, e: number } = text + selection start/end offsets.
// Stored line format: `<indent>- [ ] text` (marks: ' ' todo, x done, * star, ! urgent); highlight = <mark>…</mark>.

export const STEP = 2;
export const MARK_ORDER = ["", " ", "x", "*", "!"]; // none -> todo -> done -> star -> urgent -> none

const LINE_RE = /^( *)(?:[-*] (?:\[([ xX*!])\] ?)?)?([\s\S]*)$/;
const BULLET_RE = /^( *)[-*] (?:\[([ xX*!])\] ?)?/;

export function parseLine(raw) {
  const m = raw.match(LINE_RE);
  const hasBullet = BULLET_RE.test(raw);
  const mark = m[2] === undefined ? "" : m[2].toLowerCase() === "x" ? "x" : m[2];
  return { ind: m[1].length, bullet: hasBullet, mark, text: m[3] };
}

export function buildLine(p) {
  const bullet = p.bullet || p.mark !== "";
  return " ".repeat(p.ind) + (bullet ? "- " : "") + (p.mark !== "" ? `[${p.mark}] ` : "") + p.text;
}

export const prefixLength = (raw) => raw.length - parseLine(raw).text.length;
const isBlank = (raw) => raw.trim() === "";

// ---- selection helpers -----------------------------------------------------
function lineRange(v, s, e) {
  const first = v.lastIndexOf("\n", s - 1) + 1;
  let endPos = e;
  if (e > s && v[e - 1] === "\n") endPos = e - 1; // selection ending right after a newline excludes the next line
  let last = v.indexOf("\n", endPos);
  if (last < 0) last = v.length;
  return [first, last];
}

// Rewrites every selected line with fn(parsed, index, prevNewRaw). Selection follows the edits.
function mapLines(st, fn) {
  const [a, b] = lineRange(st.v, st.s, st.e);
  const before = st.v.slice(0, a);
  const after = st.v.slice(b);
  const old = st.v.slice(a, b).split("\n");
  const prevAbove = before ? before.slice(0, -1).split("\n").filter((l) => !isBlank(l)).pop() : undefined;
  const out = [];
  let prev = prevAbove;
  old.forEach((raw, i) => {
    const next = fn(parseLine(raw), i, prev, raw);
    const res = next === undefined ? raw : typeof next === "string" ? next : buildLine(next);
    out.push(res);
    if (!isBlank(res)) prev = res;
  });
  const v = before + out.join("\n") + after;
  const delta0 = out[0].length - old[0].length;
  const total = out.join("\n").length - old.join("\n").length;
  const s = Math.max(a, st.s + delta0);
  const e = Math.max(s, st.e + total);
  return { v, s, e };
}

// ---- operations ------------------------------------------------------------
export function indent(st, dir) {
  return mapLines(st, (p, _i, prev) => {
    if (isBlank(p.text) && !p.bullet) return undefined;
    if (dir < 0) return { ...p, ind: Math.max(0, p.ind - STEP) };
    const cap = prev === undefined ? 0 : parseLine(prev).ind + STEP;
    return { ...p, ind: Math.min(p.ind + STEP, cap) };
  });
}

export function toggleBullet(st) {
  const [a, b] = lineRange(st.v, st.s, st.e);
  const all = st.v.slice(a, b).split("\n").every((l) => parseLine(l).bullet);
  return mapLines(st, (p) => (all ? { ...p, bullet: false, mark: "" } : { ...p, bullet: true }));
}

export function cycleMark(st) {
  return mapLines(st, (p) => {
    const next = MARK_ORDER[(MARK_ORDER.indexOf(p.mark) + 1) % MARK_ORDER.length];
    return { ...p, mark: next, bullet: next !== "" ? true : p.bullet };
  });
}

export function setMark(st, mark) {
  const [a, b] = lineRange(st.v, st.s, st.e);
  const all = st.v.slice(a, b).split("\n").every((l) => parseLine(l).mark === mark);
  return mapLines(st, (p) => (all ? { ...p, mark: "" } : { ...p, mark, bullet: true }));
}

export function toggleDone(st) {
  return mapLines(st, (p) => ({ ...p, mark: p.mark === "x" ? " " : "x", bullet: true }));
}

export function toggleDoneRaw(raw) {
  const p = parseLine(raw);
  return buildLine({ ...p, mark: p.mark === "x" ? " " : "x", bullet: true });
}

const WRAP_RE = /^<mark>([\s\S]*)<\/mark>$/;

export function highlight(st) {
  const { v, s, e } = st;
  if (s !== e && !v.slice(s, e).includes("\n")) {
    const sel = v.slice(s, e);
    const w = sel.match(WRAP_RE);
    if (w) return { v: v.slice(0, s) + w[1] + v.slice(e), s, e: s + w[1].length };
    if (v.slice(Math.max(0, s - 6), s) === "<mark>" && v.slice(e, e + 7) === "</mark>") {
      return { v: v.slice(0, s - 6) + sel + v.slice(e + 7), s: s - 6, e: e - 6 };
    }
    return { v: v.slice(0, s) + "<mark>" + sel + "</mark>" + v.slice(e), s: s + 6, e: e + 6 };
  }
  // No selection or several lines: highlight the whole text of each affected line.
  const [a, b] = lineRange(v, s, e);
  const lines = v.slice(a, b).split("\n").map(parseLine).filter((p) => p.text.trim());
  const all = lines.length > 0 && lines.every((p) => WRAP_RE.test(p.text));
  return mapLines(st, (p) => {
    if (!p.text.trim()) return undefined;
    const w = p.text.match(WRAP_RE);
    return { ...p, text: all ? (w ? w[1] : p.text) : w ? p.text : `<mark>${p.text}</mark>` };
  });
}

// Blocks: a line plus the following lines that are indented deeper than it.
function childEnd(lines, i) {
  const base = parseLine(lines[i]).ind;
  let j = i;
  while (j + 1 < lines.length && !isBlank(lines[j + 1]) && parseLine(lines[j + 1]).ind > base) j++;
  return j;
}

export function foldInfo(lines) {
  return lines.map((_, i) => (isBlank(lines[i]) ? 0 : childEnd(lines, i) - i));
}

export function moveBlock(st, dir) {
  const lines = st.v.split("\n");
  const [a0, b0] = lineRange(st.v, st.s, st.e);
  const firstIdx = st.v.slice(0, a0).split("\n").length - 1;
  const lastIdx = firstIdx + st.v.slice(a0, b0).split("\n").length - 1;
  const endIdx = childEnd(lines, lastIdx);
  const ind = parseLine(lines[firstIdx]).ind;
  const len = (arr) => arr.reduce((n, l) => n + l.length + 1, 0);
  if (dir < 0) {
    let i = firstIdx - 1;
    while (i >= 0 && !isBlank(lines[i]) && parseLine(lines[i]).ind > ind) i--;
    if (i < 0 || parseLine(lines[i]).ind < ind) return null;
    const prev = lines.slice(i, firstIdx);
    const block = lines.slice(firstIdx, endIdx + 1);
    const out = [...lines.slice(0, i), ...block, ...prev, ...lines.slice(endIdx + 1)];
    const shift = len(prev);
    return { v: out.join("\n"), s: st.s - shift, e: st.e - shift };
  }
  const j = endIdx + 1;
  if (j >= lines.length || parseLine(lines[j]).ind < ind) return null;
  const k = childEnd(lines, j);
  const next = lines.slice(j, k + 1);
  const block = lines.slice(firstIdx, endIdx + 1);
  const out = [...lines.slice(0, firstIdx), ...next, ...block, ...lines.slice(k + 1)];
  const shift = len(next);
  return { v: out.join("\n"), s: st.s + shift, e: st.e + shift };
}

// Enter: keep indent and bullet, drop the mark. Returns null when the browser default is fine.
export function enter(st) {
  let { v, s, e } = st;
  if (s !== e) { v = v.slice(0, s) + v.slice(e); e = s; }
  const a = v.lastIndexOf("\n", s - 1) + 1;
  let b = v.indexOf("\n", s);
  if (b < 0) b = v.length;
  const raw = v.slice(a, b);
  const p = parseLine(raw);
  const col = s - a;
  const pre = prefixLength(raw);
  if (!p.bullet && p.ind === 0) return s !== st.e ? { v, s, e } : null;
  if (p.bullet && col < pre) return null;
  if (p.bullet && isBlank(p.text) && col >= raw.length) {
    const next = p.ind > 0 ? { ...p, ind: Math.max(0, p.ind - STEP), mark: "" } : { ind: 0, bullet: false, mark: "", text: "" };
    const line = buildLine(next);
    const nv = v.slice(0, a) + line + v.slice(b);
    return { v: nv, s: a + line.length, e: a + line.length };
  }
  const head = raw.slice(0, col);
  const tail = raw.slice(col);
  const lead = " ".repeat(p.ind) + (p.bullet ? "- " : "");
  const nv = v.slice(0, a) + head + "\n" + lead + tail + v.slice(b);
  const pos = a + head.length + 1 + lead.length;
  return { v: nv, s: pos, e: pos };
}

// Backspace at the very start of a line's text peels off mark -> bullet -> indent.
export function backspace(st) {
  if (st.s !== st.e) return null;
  const a = st.v.lastIndexOf("\n", st.s - 1) + 1;
  let b = st.v.indexOf("\n", st.s);
  if (b < 0) b = st.v.length;
  const raw = st.v.slice(a, b);
  const p = parseLine(raw);
  if (st.s - a !== prefixLength(raw) || (p.ind === 0 && !p.bullet)) return null;
  const next = p.mark !== "" ? { ...p, mark: "" }
    : p.bullet ? { ...p, bullet: false }
    : { ...p, ind: Math.max(0, p.ind - STEP) };
  const line = buildLine(next);
  const pos = a + prefixLength(line);
  return { v: st.v.slice(0, a) + line + st.v.slice(b), s: pos, e: pos };
}

// ---- keyboard map (testable with plain objects) ------------------------------
export const KEY_HELP = [
  ["들여쓰기 · 내어쓰기 (선택한 줄 모두)", "Tab · Shift+Tab", true],
  ["불렛 켜기/끄기", "Ctrl+.", false],
  ["표시 순환  ☐ → ☑ → ★ → !", "Ctrl+1 · Alt+1 · Ctrl+Alt+1", false],
  ["완료 전환", "Ctrl+Enter", false],
  ["별표 켜기/끄기", "Ctrl+Alt+S · Alt+Shift+S", false],
  ["형광펜 (선택 영역 또는 줄 전체)", "Ctrl+Alt+H · Alt+Shift+H", false],
  ["블록 위·아래 이동 (하위 줄 포함)", "Alt+↑ · Alt+↓", false],
  ["새 줄 (불렛·들여쓰기 이어받기)", "Enter", true],
  ["표시 → 불렛 → 들여쓰기 차례로 해제", "줄 시작에서 Backspace", true],
];

// Returns an action name or null. `on` = editor shortcuts enabled. Tab/Enter/Backspace always work.
export function keyAction(e, on) {
  const ctrl = e.ctrlKey || e.metaKey;
  const code = e.code || "";
  const key = (e.key || "").toLowerCase();
  if (e.key === "Tab" && !ctrl && !e.altKey) return e.shiftKey ? "outdent" : "indent";
  if (e.key === "Enter" && !ctrl && !e.altKey && !e.shiftKey) return "enter";
  if (e.key === "Backspace" && !ctrl && !e.altKey && !e.shiftKey) return "backspace";
  if (!on) return null;
  if (ctrl && !e.altKey && !e.shiftKey && (key === "." || code === "Period")) return "bullet";
  if (!e.shiftKey && (ctrl || e.altKey) && (code === "Digit1" || key === "1")) return "cycle";
  if (ctrl && !e.altKey && !e.shiftKey && e.key === "Enter") return "done";
  if ((ctrl && e.altKey && !e.shiftKey && key === "s") || (e.altKey && e.shiftKey && !ctrl && key === "s")) return "star";
  if ((ctrl && e.altKey && !e.shiftKey && key === "h") || (e.altKey && e.shiftKey && !ctrl && key === "h")) return "highlight";
  if (e.altKey && !ctrl && !e.shiftKey && e.key === "ArrowUp") return "up";
  if (e.altKey && !ctrl && !e.shiftKey && e.key === "ArrowDown") return "down";
  return null;
}

export function run(action, st) {
  switch (action) {
    case "indent": return indent(st, 1);
    case "outdent": return indent(st, -1);
    case "bullet": return toggleBullet(st);
    case "cycle": return cycleMark(st);
    case "done": return toggleDone(st);
    case "star": return setMark(st, "*");
    case "highlight": return highlight(st);
    case "up": return moveBlock(st, -1);
    case "down": return moveBlock(st, 1);
    case "enter": return enter(st);
    case "backspace": return backspace(st);
    default: return null;
  }
}

// ---- view rendering (escape everything, then allow only <mark>) -----------------
export const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const textToHtml = (t) => esc(t).replace(/&lt;mark&gt;([\s\S]*?)&lt;\/mark&gt;/g, "<mark>$1</mark>");
