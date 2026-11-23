// Pure helpers for the note formatting toolbar (P3-04). No DOM here, so Node can test them.
// Saved format stays preset-only (D-15): sizes, text colors and highlights come from the lists in mdconv.js.

export const KEYS = {
  bold: "Ctrl+B", italic: "Ctrl+I", underline: "Ctrl+U", strike: "Ctrl+-",
  highlight: "Ctrl+Alt+H", clear: "Ctrl+Space", sizeUp: "Ctrl+Shift+.", sizeDown: "Ctrl+Shift+,",
  body: "Ctrl+Alt+0", h1: "Ctrl+Alt+1", h2: "Ctrl+Alt+2", h3: "Ctrl+Alt+3", bullet: "Ctrl+.",
  foldHere: "Ctrl+Shift+[", unfoldHere: "Ctrl+Shift+]",
};

export function rgbToHex(css) {
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(String(css || "").trim());
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return "";
    return "#" + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  }
  return /^#[0-9a-f]{6}$/i.test(String(css || "").trim()) ? css.trim().toLowerCase() : "";
}

/** Index of `css` inside a preset list, or -1 when it is not a preset (custom or default look). */
export function presetIndex(css, presets) {
  const hex = rgbToHex(css);
  return hex ? presets.findIndex((p) => p.toLowerCase() === hex) : -1;
}

/** Index of the preset size that matches the rendered font size (within half a pixel), else -1. */
export function sizeIndex(px, sizes) {
  return sizes.findIndex((z) => Math.abs(z - px) < 0.5);
}

/** Step one preset up (+1) or down (-1) from the rendered size; clamps at both ends. */
export function stepSizeIndex(px, dir, sizes) {
  let i = sizes.findIndex((z) => z >= px - 0.5);
  if (i < 0) i = sizes.length - 1;
  return Math.max(0, Math.min(sizes.length - 1, i + dir));
}

/**
 * Note-only shortcuts that the shared line editor (keyAction) does not own.
 * They follow the "editor shortcuts" switch from P2B-02: with the switch off only Tab, Enter and Backspace
 * stay special, and the browser's own Ctrl+B/I/U keep working.
 * Returns {type, value?} or null.
 */
export function formatKeyAction(e, on) {
  if (!on) return null;
  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl) return null;
  const code = e.code || "";
  const key = e.key || "";
  if (e.altKey && !e.shiftKey && /^[0-3]$/.test(key)) return { type: "block", value: key };
  if (e.shiftKey && !e.altKey && (code === "BracketLeft" || code === "BracketRight")) {
    return { type: "fold", value: code === "BracketLeft" };
  }
  if (e.shiftKey && !e.altKey) {
    if (key === "." || key === ">" || code === "Period") return { type: "size", value: 1 };
    if (key === "," || key === "<" || code === "Comma") return { type: "size", value: -1 };
    if (key === "N" || key === "n") return { type: "clear" };
  }
  if (!e.altKey && !e.shiftKey) {
    if (key === " " || code === "Space") return { type: "clear" };
    if (key === "-" || code === "Minus") return { type: "strike" };
  }
  return null;
}

/** Tooltip text: label plus shortcut; the shortcut is dropped while editor shortcuts are off. */
export function tip(label, keys, on = true) {
  return keys && on ? `${label} · ${keys}` : label;
}
