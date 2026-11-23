// Sidebar page tree (D-24): six fixed top-level trees, keyboard navigation, drag to move/reorder.
// Titles are inserted with textContent (never innerHTML).
import { icon } from "./icons.js";

// The six top-level trees are always visible; a missing one is shown as a ghost row that creates it on click.
export const ROOTS = [
  { title: "일지", icon: "cal", color: "var(--cyan)" },
  { title: "MI 공정업무", icon: "cube", color: "var(--blue)" },
  { title: "연구 개발", icon: "sparkle", color: "var(--violet)" },
  { title: "성과", icon: "flag", color: "var(--green)" },
  { title: "업무 매뉴얼", icon: "doc", color: "var(--yellow)" },
  { title: "스터디", icon: "book", color: "var(--red)" },
];
const TYPE_ICON = { note: "note", html: "code", journal: "cal", board: "board", table: "board" };

function loadCollapsed() {
  try {
    return new Set(JSON.parse(localStorage.getItem("collapsed") || "[]"));
  } catch {
    return new Set();
  }
}
const collapsed = loadCollapsed();

function saveCollapsed() {
  try {
    localStorage.setItem("collapsed", JSON.stringify([...collapsed]));
  } catch {
    /* storage unavailable: collapse state just won't persist */
  }
}

const toHash = (p) => "#/page/" + p.split("/").map(encodeURIComponent).join("/");
const repaint = () => document.dispatchEvent(new CustomEvent("tree-changed"));

// opts: { activePath, onAdd(parentPath), onCreateRoot(title), onMove(path, parentPath, index) }
export function renderTree(container, nodes, opts) {
  const byTitle = new Map(nodes.map((n) => [n.title, n]));
  const rootEntries = ROOTS.map((r) => ({ spec: r, node: byTitle.get(r.title) }));
  const extras = nodes.filter((n) => !ROOTS.some((r) => r.title === n.title));
  const ul = list();
  ul.setAttribute("role", "tree");
  for (const { spec, node } of rootEntries) ul.append(node ? buildNode(node, 1, opts, spec) : ghostRow(spec, opts));
  if (extras.length) {
    const label = document.createElement("li");
    label.className = "rail-label";
    label.setAttribute("role", "presentation");
    label.textContent = "기타";
    ul.append(label);
    for (const n of extras) ul.append(buildNode(n, 1, opts, null));
  }
  container.replaceChildren(ul);
  initRoving(ul, opts.activePath);
}

function list() {
  const ul = document.createElement("ul");
  ul.className = "tree-list";
  return ul;
}

function ghostRow(spec, opts) {
  const li = document.createElement("li");
  li.className = "node";
  li.setAttribute("role", "none");
  const row = document.createElement("div");
  row.className = "tree-row root ghost";
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", "1");
  row.setAttribute("aria-label", `${spec.title} (아직 없음, Enter로 만들기)`);
  row.tabIndex = -1;
  row.style.paddingLeft = "4px";
  const ty = span("ty", icon(spec.icon));
  ty.style.color = "var(--dim)";
  row.append(span("tw"), ty, span("label", spec.title), plusButton("만들기", () => opts.onCreateRoot(spec.title)));
  row.addEventListener("click", () => opts.onCreateRoot(spec.title));
  row.dataset.action = "create";
  li.append(row);
  return li;
}

function span(cls, child) {
  const s = document.createElement("span");
  s.className = cls;
  if (typeof child === "string") s.textContent = child;
  else if (child) s.append(child);
  return s;
}

function plusButton(title, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ib add";
  b.tabIndex = -1;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.append(icon("plus", "i s"));
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function buildNode(n, level, opts, spec) {
  const li = document.createElement("li");
  li.className = "node";
  li.setAttribute("role", "none");
  const hasKids = n.children.length > 0;
  const isOpen = hasKids && !collapsed.has(n.path);
  const row = document.createElement("div");
  row.className = "tree-row" + (spec ? " root" : "") + (n.path === opts.activePath ? " active" : "");
  row.setAttribute("role", "treeitem");
  row.setAttribute("aria-level", String(level));
  row.setAttribute("aria-selected", String(n.path === opts.activePath));
  if (hasKids) row.setAttribute("aria-expanded", String(isOpen));
  row.tabIndex = -1;
  row.dataset.path = n.path;
  row.style.paddingLeft = 4 + (level - 1) * 14 + "px";
  row.title = n.title;

  const tw = span("tw" + (isOpen ? " open" : ""), hasKids ? icon("chev") : null);
  tw.addEventListener("click", (e) => { e.stopPropagation(); toggle(n.path, hasKids); });
  const ty = span("ty", icon(spec ? spec.icon : TYPE_ICON[n.type] ?? "note"));
  ty.style.color = spec ? spec.color : "var(--dim)";
  row.append(tw, ty, span("label", n.title), plusButton("하위 페이지 추가", () => opts.onAdd(n.path)));
  row.addEventListener("click", () => { location.hash = toHash(n.path); });
  attachDrag(row, n, spec, opts);
  li.append(row);
  if (isOpen) {
    const ul = list();
    ul.setAttribute("role", "group");
    for (const c of n.children) ul.append(buildNode(c, level + 1, opts, null));
    li.append(ul);
  }
  return li;
}

function toggle(path, hasKids) {
  if (!hasKids) return;
  collapsed.has(path) ? collapsed.delete(path) : collapsed.add(path);
  saveCollapsed();
  repaint();
}

// ---- keyboard: roving tabindex + arrow keys -------------------------------
let focusPath = null;

function initRoving(ul, activePath) {
  const rows = () => [...ul.querySelectorAll(".tree-row")];
  const all = rows();
  const start = all.find((r) => r.dataset.path === focusPath) || all.find((r) => r.dataset.path === activePath) || all[0];
  if (start) start.tabIndex = 0;
  const go = (row) => {
    if (!row) return;
    rows().forEach((r) => (r.tabIndex = -1));
    row.tabIndex = 0;
    row.focus();
    focusPath = row.dataset.path ?? null;
  };
  ul.addEventListener("focusin", (e) => {
    const row = e.target.closest?.(".tree-row");
    if (row && e.target === row) focusPath = row.dataset.path ?? null;
  });
  ul.addEventListener("keydown", (e) => {
    const row = e.target.closest?.(".tree-row");
    if (!row || e.target !== row) return;
    const rs = rows();
    const i = rs.indexOf(row);
    const exp = row.getAttribute("aria-expanded");
    if (e.key === "ArrowDown") go(rs[i + 1]);
    else if (e.key === "ArrowUp") go(rs[i - 1]);
    else if (e.key === "Home") go(rs[0]);
    else if (e.key === "End") go(rs.at(-1));
    else if (e.key === "ArrowRight") {
      if (exp === "false") row.querySelector(".tw").click();
      else if (exp === "true") go(rs[i + 1]);
    } else if (e.key === "ArrowLeft") {
      if (exp === "true") row.querySelector(".tw").click();
      else {
        const lvl = +row.getAttribute("aria-level");
        for (let j = i - 1; j >= 0; j--) if (+rs[j].getAttribute("aria-level") < lvl) { go(rs[j]); break; }
      }
    } else if (e.key === "Enter" || e.key === " ") row.click();
    else return;
    e.preventDefault();
  });
}

// ---- drag & drop: drop in the middle = child, top/bottom edge = sibling order ----
let drag = null;

function zoneOf(e, row, allowSibling) {
  const r = row.getBoundingClientRect();
  const y = (e.clientY - r.top) / r.height;
  if (!allowSibling) return "in";
  return y < 0.28 ? "before" : y > 0.72 ? "after" : "in";
}
const clearDrop = () => document.querySelectorAll(".drop-in,.drop-before,.drop-after").forEach((x) => x.classList.remove("drop-in", "drop-before", "drop-after"));
const parentOf = (p) => p.split("/").slice(0, -1).join("/");

function attachDrag(row, n, spec, opts) {
  if (!spec) {
    row.draggable = true;
    row.addEventListener("dragstart", (e) => {
      drag = n.path;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", n.path);
    });
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); clearDrop(); drag = null; });
  }
  row.addEventListener("dragover", (e) => {
    if (!drag || drag === n.path || n.path.startsWith(drag + "/")) return;
    const z = zoneOf(e, row, !spec); // the six top-level trees accept children only
    e.preventDefault();
    clearDrop();
    row.classList.add("drop-" + z);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-in", "drop-before", "drop-after"));
  row.addEventListener("drop", (e) => {
    if (!drag) return;
    e.preventDefault();
    const z = zoneOf(e, row, !spec);
    clearDrop();
    const from = drag;
    drag = null;
    if (z === "in") opts.onMove(from, n.path, Infinity);
    else opts.onMove(from, parentOf(n.path), { before: z === "before", target: n.path });
  });
}
