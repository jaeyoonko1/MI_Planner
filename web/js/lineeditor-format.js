// Inline formatting for the shared line editor (V-003). Pure text functions, no DOM, so Node can test them.
// The saved format is the note editor's (D-15): `**bold**` `*italic*` `~~strike~~` `<u>` `<mark>` / `<mark style="background:#hex">`
// and `<span style="color:#hex;font-size:Npx">`, with sizes/colors/highlights limited to the presets in mdconv.js.
// The textarea text stays the single source of truth: every operation parses a line body into styled characters,
// changes the style of the chosen range and writes the line back in one canonical spelling.
import { BASE_PX, COLORS, HLS, SIZES } from "./mdconv.js";
import { STEP, parseLine, run as coreRun } from "./lineeditor-core.js";
import { formatKeyAction, stepSizeIndex } from "./note-format-core.js";

const LINK_TAIL = /\s*→ 할일 #\d+\s*$/;
const WS = /\s/;
// characters a backslash can protect: the note format's list (mdconv.js inlineToHtml); an escape is kept as written
const ESCAPABLE = "\\*`~<>[]!#-.+_)|";
const TAG_RE = /<(\/?)(u|mark|span)(?:\s+style="([^"]*)")?\s*>/y;
const hexIn = (list, v) => list.find((c) => c.toLowerCase() === String(v).toLowerCase());

// ---- parsing ---------------------------------------------------------------------------
// A token is a visible character ({c, a, z} = char, raw start, raw end) or a style marker ({m, a, z}).
function tokenize(t) {
  const out = [];
  const open = {}; // kind -> index in out of the still-open marker
  const toggle = (kind, raw, a, z, canOpen, canClose) => {
    if (open[kind] !== undefined) {
      if (canClose) { out.push({ m: kind, on: false, a, z }); delete open[kind]; return; }
    } else if (canOpen) { open[kind] = out.length; out.push({ m: kind, on: true, a, z }); return; }
    for (let k = a; k < z; k++) out.push({ c: t[k], a: k, z: k + 1 });
  };
  for (let i = 0; i < t.length;) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] !== undefined && ESCAPABLE.includes(t[i + 1])) { out.push({ c: t[i + 1], a: i, z: i + 2, raw: t.slice(i, i + 2) }); i += 2; continue; }
    if (ch === "*" || (ch === "~" && t[i + 1] === "~")) {
      const q = ch === "*" ? "*" : "~~";
      let z = i;
      if (ch === "*") while (t[z] === "*") z++;
      else while (t[z] === "~") z++;
      const run = z - i;
      if (ch === "~" && run !== 2) { for (let k = i; k < z; k++) out.push({ c: "~", a: k, z: k + 1 }); i = z; continue; }
      const prev = t[i - 1], next = t[z];
      const canOpen = next !== undefined && !WS.test(next) && (ch !== "*" || next !== "*");
      const canClose = prev !== undefined && !WS.test(prev) && (ch !== "*" || prev !== "*");
      let at = i;
      if (q === "~~") { toggle("s", "~~", i, z, canOpen, canClose); }
      else {
        let left = run;
        while (left > 0) {
          const w = left >= 2 ? 2 : 1;
          toggle(w === 2 ? "b" : "i", "*".repeat(w), at, at + w, canOpen, canClose);
          at += w; left -= w;
        }
      }
      i = z; continue;
    }
    if (ch === "<") {
      TAG_RE.lastIndex = i;
      const m = TAG_RE.exec(t);
      if (m) {
        const [raw, slash, name, css] = m;
        const a = i, z = i + raw.length;
        if (slash) {
          const kind = name === "u" ? "u" : name === "mark" ? "hl" : "span";
          if (open[kind] !== undefined) { out.push({ m: kind, on: false, a, z }); delete open[kind]; i = z; continue; }
        } else if (name === "u") {
          if (open.u === undefined) { open.u = out.length; out.push({ m: "u", on: true, a, z }); i = z; continue; }
        } else if (name === "mark") {
          const bg = css === undefined ? HLS[0] : hexIn(HLS, (/^background:\s*(#[0-9a-fA-F]{6})\s*;?$/.exec(css) || [])[1]);
          if (bg && open.hl === undefined) { open.hl = out.length; out.push({ m: "hl", on: true, val: bg, a, z }); i = z; continue; }
        } else {
          const s = spanStyle(css);
          if (s && open.span === undefined) { open.span = out.length; out.push({ m: "span", on: true, ...s, a, z }); i = z; continue; }
        }
      }
    }
    out.push({ c: ch, a: i, z: i + 1 });
    i++;
  }
  // markers that never closed are plain text
  for (const idx of Object.values(open)) {
    const tk = out[idx];
    const lits = [];
    for (let k = tk.a; k < tk.z; k++) lits.push({ c: t[k], a: k, z: k + 1 });
    out[idx] = { lits };
  }
  return out.flatMap((x) => x.lits || [x]);
}

function spanStyle(css) {
  if (css === undefined) return null;
  const color = /(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})\s*(?=;|$)/.exec(css);
  const size = /(?:^|;)\s*font-size:\s*(\d{1,2})px\s*(?=;|$)/.exec(css);
  const rest = css.replace(/(?:^|;)\s*(?:color|font-size):\s*[^;]*/g, "").replace(/[;\s]/g, "");
  if (rest) return null;
  const c = color && hexIn(COLORS, color[1]);
  const z = size && SIZES.includes(+size[1]) ? +size[1] : 0;
  if (!c && !z) return null;
  // the default text color and the base size are "no style" (the note editor never writes them either)
  return { color: c && c !== COLORS[0] ? c : "", size: z && z !== BASE_PX ? z : 0 };
}

const EMPTY = Object.freeze({ b: false, i: false, s: false, u: false, hl: "", color: "", size: 0 });

/** Parses a line body into [{ch, st, a, z}] (visible characters with their style and raw span). */
export function styledChars(text) {
  const st = { ...EMPTY };
  const out = [];
  for (const tk of tokenize(text)) {
    if (tk.m) {
      if (tk.m === "hl") st.hl = tk.on ? tk.val : "";
      else if (tk.m === "span") { st.color = tk.on ? tk.color : ""; st.size = tk.on ? tk.size : 0; }
      else st[tk.m] = tk.on;
    } else out.push({ ch: tk.c, st: { ...st }, a: tk.a, z: tk.z, raw: tk.raw });
  }
  return out;
}

/** The visible text of a line body (formatting markers removed). */
export const plainText = (text) => styledChars(text).map((x) => x.ch).join("");

/** Raw offset of the caret that sits before visible character `k` (end of text when k is past the end). */
export function rawOffset(text, k) {
  const cs = styledChars(text);
  return k >= cs.length ? text.length : cs[k].a;
}

/** Index of the visible character that the raw offset points at (markers before it do not count). */
export function visibleIndex(text, off) {
  const cs = styledChars(text);
  let n = 0;
  while (n < cs.length && cs[n].a < off) n++;
  return n;
}

// ---- view rendering ---------------------------------------------------------------------
const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const sameStyle = (x, y) => x.b === y.b && x.i === y.i && x.s === y.s && x.u === y.u && x.hl === y.hl && x.color === y.color && x.size === y.size;

/** Safe HTML for the view mode: text is escaped, only the preset styles become tags. */
export function textToHtml(text) {
  let html = "";
  const cs = styledChars(text);
  for (let i = 0; i < cs.length;) {
    let j = i;
    let s = "";
    while (j < cs.length && sameStyle(cs[j].st, cs[i].st)) s += cs[j++].ch;
    const st = cs[i].st;
    let h = esc(s);
    if (st.b) h = `<b>${h}</b>`;
    if (st.i) h = `<i>${h}</i>`;
    if (st.s) h = `<s>${h}</s>`;
    if (st.u) h = `<u>${h}</u>`;
    if (st.hl) h = st.hl === HLS[0] ? `<mark>${h}</mark>` : `<mark style="--hl:${st.hl}">${h}</mark>`;
    if (st.color || st.size) h = `<span style="${[st.color && `color:${st.color}`, st.size && `font-size:calc(${st.size}px*var(--le-scale,1))`].filter(Boolean).join(";")}">${h}</span>`;
    html += h;
    i = j;
  }
  return html;
}

// ---- serializing -----------------------------------------------------------------------
// Edge whitespace cannot carry */~~ markers (the parser needs non-space next to them), so it is left unstyled.
function normalize(cs) {
  for (const f of ["b", "i", "s"]) {
    for (let k = 0; k < cs.length; k++) {
      if (!cs[k].st[f] || !WS.test(cs[k].ch)) continue;
      const first = k === 0 || !cs[k - 1].st[f];
      const last = k === cs.length - 1 || !cs[k + 1].st[f];
      if (first || last) cs[k].st[f] = false;
    }
    // a run of only whitespace after trimming can leave "a * b" style leftovers: nothing else to do
  }
}

const tagOpen = {
  u: () => "<u>",
  hl: (st) => (st.hl === HLS[0] ? "<mark>" : `<mark style="background:${st.hl}">`),
  span: (st) => `<span style="${[st.color && `color:${st.color}`, st.size && `font-size:${st.size}px`].filter(Boolean).join(";")}">`,
};
const tagClose = { u: "</u>", hl: "</mark>", span: "</span>" };

function escapeLiteral(chars, k) {
  const ch = chars[k].ch;
  const prev = chars[k - 1]?.ch, next = chars[k + 1]?.ch;
  if (ch === "*") return (prev === undefined || WS.test(prev)) && (next === undefined || WS.test(next)) ? "*" : "\\*";
  if (ch === "~") return next === "~" || prev === "~" ? "\\~" : "~";
  if (ch === "<") return /^<\/?(?:u|mark|span)[\s>]/.test(chars.slice(k, k + 12).map((x) => x.ch).join("")) ? "\\<" : "<";
  return ch;
}

/** Writes styled characters back as a line body. Returns {text, pos[], ends[], end}: raw offset before / after each character, and after the last one. */
export function serialize(cs) {
  normalize(cs);
  let out = "";
  const pos = [];
  const ends = [];
  const stack = []; // open tag kinds, outermost first
  let cur = { ...EMPTY };
  const tagKey = (kind, st) => (kind === "u" ? st.u : kind === "hl" ? st.hl : `${st.color}|${st.size}`);
  const wants = (kind, st) => (kind === "u" ? st.u : kind === "hl" ? !!st.hl : !!(st.color || st.size));
  const move = (next) => {
    // 1) tags whose value changes or that are no longer wanted close (inner ones are closed first and reopened).
    //    Star markers sit outside the tags, so when one of them toggles every open tag closes first: the markup always nests.
    const starChange = cur.b !== next.b || cur.i !== next.i || cur.s !== next.s;
    let cut = starChange ? 0 : stack.findIndex((k) => !wants(k, next) || tagKey(k, cur) !== tagKey(k, next));
    if (starChange && !stack.length) cut = -1;
    if (cut >= 0) {
      for (let k = stack.length - 1; k >= cut; k--) out += tagClose[stack[k]];
      stack.length = cut;
    }
    // 2) star / tilde markers: closing ones first, then opening ones (b and i toggle independently of each other)
    out += (cur.i && !next.i ? "*" : "") + (cur.b && !next.b ? "**" : "") + (cur.s && !next.s ? "~~" : "");
    out += (!cur.s && next.s ? "~~" : "") + (!cur.b && next.b ? "**" : "") + (!cur.i && next.i ? "*" : "");
    // 3) tags that must be open now
    for (const k of ["span", "hl", "u"]) {
      if (wants(k, next) && !stack.includes(k)) { out += tagOpen[k](next); stack.push(k); }
    }
    cur = next;
  };
  cs.forEach((x, k) => {
    move(x.st);
    pos.push(out.length);
    out += cs[k].raw ?? escapeLiteral(cs, k);
    ends.push(out.length);
  });
  // close everything (stars/tilde and tags)
  const end = out.length;
  move({ ...EMPTY });
  return { text: out, pos, ends, end };
}

// ---- operations ------------------------------------------------------------------------
const lineBounds = (v, s, e) => {
  const a = v.lastIndexOf("\n", s - 1) + 1;
  let endPos = e;
  if (e > s && v[e - 1] === "\n") endPos = e - 1;
  let b = v.indexOf("\n", endPos);
  if (b < 0) b = v.length;
  return [a, b];
};

/** Splits a raw line into {head (indent/bullet/mark), body, tail (task link)}. */
export function splitLine(raw) {
  const p = parseLine(raw);
  const head = raw.slice(0, raw.length - p.text.length);
  const m = LINK_TAIL.exec(p.text);
  return { head, body: m ? p.text.slice(0, m.index) : p.text, tail: m ? p.text.slice(m.index) : "" };
}

const allOf = (cs, f) => cs.length > 0 && cs.every(f);

/** op: {t:"b"|"i"|"u"|"s"} | {t:"color", i} | {t:"hl", i} | {t:"size", px} | {t:"step", dir} | {t:"clear"}. */
function applyOp(cs, op) {
  const set = (fn) => cs.forEach((x) => fn(x.st));
  switch (op.t) {
    case "b": case "i": case "u": case "s": {
      const on = !allOf(cs, (x) => x.st[op.t]);
      set((st) => { st[op.t] = on; });
      break;
    }
    case "color": {
      const c = op.i > 0 ? COLORS[op.i] : "";
      const on = !!c && !allOf(cs, (x) => x.st.color === c);
      set((st) => { st.color = on ? c : ""; });
      break;
    }
    case "hl": {
      const c = op.i >= 0 ? HLS[op.i] : "";
      const on = !!c && !allOf(cs, (x) => x.st.hl === c);
      set((st) => { st.hl = on ? c : ""; });
      break;
    }
    case "size": {
      const on = op.px !== BASE_PX && !allOf(cs, (x) => x.st.size === op.px);
      set((st) => { st.size = on ? op.px : 0; });
      break;
    }
    case "step": {
      const from = cs[0]?.st.size || BASE_PX;
      const px = SIZES[stepSizeIndex(from, op.dir, SIZES)];
      set((st) => { st.size = px === BASE_PX ? 0 : px; });
      break;
    }
    case "clear": set((st) => Object.assign(st, EMPTY)); break;
    default: break;
  }
}

/**
 * Applies a format op to the selection of `st` ({v,s,e}). A selection inside one line formats just that text;
 * a caret or a selection over several lines formats the whole text of every affected line (same rule as the highlighter).
 */
export function format(st, op) {
  const { v, s, e } = st;
  const [a, b] = lineBounds(v, s, e);
  const single = s !== e && !v.slice(s, e).includes("\n");
  const caretMode = s === e;
  let ns = s, ne = e;
  let lineStart = a;
  const lines = v.slice(a, b).split("\n").map((raw) => {
    const start = lineStart;
    lineStart += raw.length + 1;
    const { head, body, tail } = splitLine(raw);
    const cs = body.trim() ? styledChars(body) : [];
    if (!cs.length) return raw;
    const bodyStart = start + head.length;
    let from = 0, to = cs.length;
    if (single) {
      from = visibleIndex(body, Math.max(0, s - bodyStart));
      to = visibleIndex(body, Math.min(body.length, e - bodyStart));
      if (from >= to) return raw;
    }
    const caret = caretMode ? visibleIndex(body, Math.max(0, Math.min(body.length, s - bodyStart))) : -1;
    applyOp(cs.slice(from, to), op);
    const res = serialize(cs);
    const at = (k) => (k >= cs.length ? res.end : res.pos[k]);
    if (single) { ns = bodyStart + at(from); ne = bodyStart + res.ends[to - 1]; }
    else if (caretMode) ns = ne = bodyStart + at(caret);
    return head + res.text + tail;
  });
  const text = lines.join("\n");
  if (!single && !caretMode) { ns = a; ne = a + text.length; }
  return { v: v.slice(0, a) + text + v.slice(b), s: ns, e: ne };
}

// ---- keys and dispatch ------------------------------------------------------------------
/** Format shortcuts for the line editor; same switch as the other editor shortcuts. Returns an op or null. */
export function formatKey(e, on) {
  if (!on) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = (e.key || "").toLowerCase();
  if (ctrl && !e.altKey && !e.shiftKey && (key === "b" || key === "i" || key === "u")) return { t: key };
  const a = formatKeyAction(e, true);
  if (a?.type === "strike") return { t: "s" };
  if (a?.type === "clear") return { t: "clear" };
  if (a?.type === "size") return { t: "step", dir: a.value };
  return null;
}

/** Runs a line-editor action (core line operations plus the formatting ones). */
export function run(action, st) {
  if (action && typeof action === "object") return format(st, action);
  if (action === "highlight") return format(st, { t: "hl", i: 0 });
  return coreRun(action, st);
}

/** Style that applies to the whole selection (or caret line) of `st`; used to light up the toolbar chips. */
export function styleAt(st) {
  const [a, b] = lineBounds(st.v, st.s, st.e);
  const single = st.s !== st.e && !st.v.slice(st.s, st.e).includes("\n");
  const all = [];
  let start = a;
  for (const raw of st.v.slice(a, b).split("\n")) {
    const { head, body } = splitLine(raw);
    let cs = body.trim() ? styledChars(body) : [];
    if (single) {
      const bs = start + head.length;
      cs = cs.slice(visibleIndex(body, Math.max(0, st.s - bs)), visibleIndex(body, Math.min(body.length, st.e - bs)));
    }
    all.push(...cs);
    start += raw.length + 1;
  }
  const every = (f) => all.length > 0 && all.every((x) => f(x.st));
  const uni = (f, d) => (all.length && all.every((c) => f(c.st) === f(all[0].st)) ? f(all[0].st) : d);
  return {
    b: every((x) => x.b), i: every((x) => x.i), u: every((x) => x.u), s: every((x) => x.s),
    hl: uni((x) => x.hl, ""), color: uni((x) => x.color, ""), size: uni((x) => x.size, 0),
  };
}

/** Title text of a line (formatting stripped), used when a line is promoted to a task or synced to its title. */
export const stripFormat = plainText;

export { STEP };
