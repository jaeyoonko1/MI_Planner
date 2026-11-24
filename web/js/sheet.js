// Modal sheet on the native <dialog>: focus trap, Esc to close and focus return come from the platform.
import { el, svg } from "./ui.js";

let seq = 0;

// Returns { dlg, body, foot, close, setTitle }. Closing (Esc, backdrop, X, close()) always discards unapplied drafts.
export function openSheet({ title, sub, wide = false, onClose }) {
  const opener = document.activeElement;
  const dlg = el("dialog", "sheet" + (wide ? " wide" : ""));
  const id = `sheet-${++seq}`;
  dlg.setAttribute("aria-labelledby", id);
  const inner = el("div", "sheet-in");
  const head = el("header", "sheet-h");
  const titles = el("div", "sheet-t");
  const h = el("h2", "", title);
  h.id = id;
  titles.append(h);
  if (sub) titles.append(el("p", "sheet-sub", sub));
  const x = el("button", "ib");
  x.type = "button";
  x.setAttribute("aria-label", "닫기");
  x.append(svg("x"));
  x.addEventListener("click", () => dlg.close());
  head.append(titles, x);
  const body = el("div", "sheet-b");
  const foot = el("footer", "sheet-f");
  inner.append(head, body, foot);
  dlg.append(inner);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => {
    dlg.remove();
    if (opener && document.contains(opener)) opener.focus();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, body, foot, close: () => dlg.close(), setTitle: (t) => { h.textContent = t; } };
}

export function button(label, cls = "", onClick) {
  const b = el("button", "btn " + cls, label);
  b.type = "button";
  if (onClick) b.addEventListener("click", onClick);
  return b;
}

// Confirmation with consequences spelled out. Resolves true only on the confirm button.
export function confirmSheet({ title, sub, content = [], confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let answer = false;
    const s = openSheet({ title, sub, onClose: () => resolve(answer) });
    s.body.append(...content);
    const cancel = button("취소", "", () => s.close());
    const ok = button(confirmLabel, danger ? "pri danger-fill" : "pri", () => { answer = true; s.close(); });
    s.foot.append(cancel, ok);
    cancel.focus();
  });
}
