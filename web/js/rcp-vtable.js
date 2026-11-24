// Small virtualized grid (P6-04): only the rows near the viewport exist in the DOM, so ~5000 parameters stay fast.
// Fixed row height; keyboard (arrows, PageUp/Down, Home/End), aria-rowindex/aria-activedescendant.
import { el } from "./ui.js";

const OVERSCAN = 8;
let seq = 0;

/**
 * columns: [{ label, width }] (CSS grid track, e.g. "minmax(160px, 1fr)")
 * render(item, rowEl, index): fill a row; items with `kind === "group"` are drawn as a full-width header.
 */
export function createVTable({ columns, ariaLabel, rowHeight = 34, minWidth = 0, render }) {
  const id = `vt-${++seq}`;
  const root = el("div", "vt");
  root.tabIndex = 0;
  root.setAttribute("role", "grid");
  root.setAttribute("aria-label", ariaLabel);
  root.setAttribute("aria-colcount", String(columns.length));
  const tracks = columns.map((c) => c.width).join(" ");
  root.style.setProperty("--vt-cols", tracks);
  root.style.setProperty("--vt-h", `${rowHeight}px`);
  if (minWidth) root.style.setProperty("--vt-min", `${minWidth}px`);

  const head = el("div", "vt-head");
  head.setAttribute("role", "row");
  head.setAttribute("aria-rowindex", "1");
  columns.forEach((c, i) => {
    const h = el("div", "vt-th", c.label);
    h.setAttribute("role", "columnheader");
    h.setAttribute("aria-colindex", String(i + 1));
    if (c.title) h.title = c.title;
    head.append(h);
  });
  const spacer = el("div", "vt-body");
  spacer.setAttribute("role", "rowgroup");
  const empty = el("div", "vt-empty");
  empty.hidden = true;
  root.append(head, spacer, empty);

  let items = [];
  let active = -1;
  let frame = 0;

  function rowEl(item, index) {
    const r = el("div", "vt-row" + (item.kind === "group" ? " vt-group" : "") + (index === active ? " active" : ""));
    r.id = `${id}-r${index}`;
    r.setAttribute("role", "row");
    r.setAttribute("aria-rowindex", String(index + 2));
    r.style.top = `${index * rowHeight}px`;
    render(item, r, index);
    return r;
  }

  function paint() {
    frame = 0;
    const view = root.clientHeight || 400;
    const top = Math.max(0, root.scrollTop - rowHeight);
    const first = Math.max(0, Math.floor(top / rowHeight) - OVERSCAN);
    const last = Math.min(items.length, Math.ceil((top + view) / rowHeight) + OVERSCAN);
    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.append(rowEl(items[i], i));
    spacer.replaceChildren(frag);
    if (active >= 0) root.setAttribute("aria-activedescendant", `${id}-r${active}`);
    else root.removeAttribute("aria-activedescendant");
  }

  const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
  root.addEventListener("scroll", schedule, { passive: true });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(schedule).observe(root);

  function reveal(index) {
    const y = index * rowHeight;
    const headH = head.offsetHeight;
    if (y < root.scrollTop) root.scrollTop = y;
    else if (y + rowHeight + headH > root.scrollTop + root.clientHeight) root.scrollTop = y + rowHeight + headH - root.clientHeight;
  }

  function move(to) {
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, to));
    reveal(active);
    paint();
  }

  root.addEventListener("keydown", (e) => {
    const page = Math.max(1, Math.floor((root.clientHeight - head.offsetHeight) / rowHeight) - 1);
    const keys = {
      ArrowDown: () => move(active + 1), ArrowUp: () => move(active < 0 ? 0 : active - 1),
      PageDown: () => move(active + page), PageUp: () => move(active - page),
      Home: () => move(0), End: () => move(items.length - 1),
    };
    if (keys[e.key] && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); keys[e.key](); }
  });
  root.addEventListener("click", (e) => {
    const row = e.target.closest(".vt-row");
    if (!row) return;
    const idx = Number(row.getAttribute("aria-rowindex")) - 2;
    if (idx >= 0) { active = idx; paint(); }
  });
  root.addEventListener("focus", () => { if (active < 0 && items.length) move(0); });

  return {
    el: root,
    activeItem: () => items[active],
    setItems(next, emptyText = "") {
      items = next;
      active = -1;
      spacer.style.height = `${items.length * rowHeight}px`;
      empty.hidden = items.length > 0;
      empty.textContent = emptyText;
      root.scrollTop = 0;
      paint();
    },
    repaint: paint,
    get size() { return items.length; },
  };
}
