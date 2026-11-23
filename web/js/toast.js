// Bottom toast with an optional action (undo / retry). One at a time; errors stay until dismissed.
import { el } from "./ui.js";

let host = null;
let timer = null;

function ensure() {
  if (host) return host;
  host = el("div", "toast");
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  document.body.append(host);
  return host;
}

export function hideToast() {
  clearTimeout(timer);
  host?.classList.remove("show");
}

// opts: { action: {label, run}, error: bool, ms }
export function toast(message, opts = {}) {
  const t = ensure();
  clearTimeout(timer);
  t.className = "toast" + (opts.error ? " err" : "");
  t.setAttribute("role", opts.error ? "alert" : "status");
  const msg = el("span", "toast-msg", message);
  const parts = [msg];
  if (opts.action) {
    const b = el("button", "toast-act", opts.action.label);
    b.type = "button";
    b.addEventListener("click", async () => {
      hideToast();
      try { await opts.action.run(); } catch (e) { toast(e.message, { error: true }); }
    });
    parts.push(b);
  }
  if (opts.error || opts.action) {
    const x = el("button", "toast-x", "×");
    x.type = "button";
    x.setAttribute("aria-label", "닫기");
    x.addEventListener("click", hideToast);
    parts.push(x);
  }
  t.replaceChildren(...parts);
  requestAnimationFrame(() => t.classList.add("show"));
  if (!opts.error) timer = setTimeout(hideToast, opts.ms ?? (opts.action ? 7000 : 2600));
}
