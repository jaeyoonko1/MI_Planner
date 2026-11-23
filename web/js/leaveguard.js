// "Unsaved changes" guard for screens that keep a draft (e.g. page placement rules).
// A screen registers `isDirty`; main.js asks before the route changes, and the browser asks on reload/close.
let isDirty = null;

export function setLeaveGuard(fn) { isDirty = fn; }
export function hasUnsaved() { try { return !!isDirty?.(); } catch { return false; } }

window.addEventListener("beforeunload", (e) => {
  if (hasUnsaved()) { e.preventDefault(); e.returnValue = ""; }
});
