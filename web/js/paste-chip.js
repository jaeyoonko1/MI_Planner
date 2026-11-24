// Small "paste options" bar shown after a table paste (V-001): result text, a 원본 서식 유지 / 텍스트만 toggle
// (toggle chips, D-12) and 되돌리기. One at a time; it fades out by itself unless the pointer or focus is on it.
import { el } from "./ui.js";

let bar = null;
let timer = null;

export function hidePasteChip() {
  clearTimeout(timer);
  bar?.classList.remove("show");
}

// opts: { message, notes: string[], canFormat, format, onFormat(bool), onUndo() }
export function showPasteChip(opts) {
  hidePasteChip();
  bar?.remove();
  bar = el("div", "paste-chip");
  bar.setAttribute("role", "status");
  const text = el("div", "paste-chip-text");
  text.append(el("span", "paste-chip-msg", opts.message));
  for (const note of opts.notes || []) text.append(el("span", "paste-chip-note", note));
  const parts = [text];
  if (opts.canFormat) {
    const group = el("div", "paste-chip-group");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "붙여넣기 방식");
    const make = (label, value) => {
      const chip = el("button", "chip", label);
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(opts.format === value));
      chip.addEventListener("click", () => {
        if (opts.format === value) return;
        opts.format = value;
        for (const other of group.children) other.setAttribute("aria-pressed", String(other === chip));
        opts.onFormat(value);
        arm();
      });
      return chip;
    };
    group.append(make("원본 서식 유지", true), make("텍스트만", false));
    parts.push(group);
  } else if (opts.canFormat === false) {
    parts.push(el("span", "paste-chip-note", "서식 없음"));
  }
  const undo = el("button", "toast-act", "되돌리기");
  undo.type = "button";
  undo.addEventListener("click", () => { hidePasteChip(); opts.onUndo(); });
  const close = el("button", "toast-x", "×");
  close.type = "button";
  close.setAttribute("aria-label", "닫기");
  close.addEventListener("click", hidePasteChip);
  parts.push(undo, close);
  bar.append(...parts);
  bar.addEventListener("mouseenter", () => clearTimeout(timer));
  bar.addEventListener("mouseleave", arm);
  bar.addEventListener("keydown", (event) => { if (event.key === "Escape") hidePasteChip(); });
  document.body.append(bar);
  requestAnimationFrame(() => bar?.classList.add("show"));
  arm();
}

function arm() {
  clearTimeout(timer);
  timer = setTimeout(() => { if (!bar?.matches(":focus-within, :hover")) hidePasteChip(); else arm(); }, 10000);
}
