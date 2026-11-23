// Sidebar page tree. Titles are inserted with textContent (never innerHTML).
const ICONS = { note: "📝", html: "🌐", journal: "📅", board: "📊", table: "🗂" };

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

export function renderTree(container, nodes, { activePath, onAdd }) {
  container.replaceChildren(buildList(nodes, activePath, onAdd));
}

function buildList(nodes, activePath, onAdd) {
  const ul = document.createElement("ul");
  ul.className = "tree-list";
  for (const n of nodes) ul.append(buildNode(n, activePath, onAdd));
  return ul;
}

function buildNode(n, activePath, onAdd) {
  const li = document.createElement("li");
  li.className = "node";
  const row = document.createElement("div");
  row.className = "row" + (n.path === activePath ? " active" : "");

  const twisty = document.createElement("span");
  twisty.className = "twisty";
  const hasKids = n.children.length > 0;
  const isOpen = !collapsed.has(n.path);
  twisty.textContent = hasKids ? (isOpen ? "▾" : "▸") : "";
  twisty.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!hasKids) return;
    collapsed.has(n.path) ? collapsed.delete(n.path) : collapsed.add(n.path);
    saveCollapsed();
    document.dispatchEvent(new CustomEvent("tree-changed"));
  });

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = `${ICONS[n.type] ?? "📄"} ${n.title}`;

  const add = document.createElement("button");
  add.className = "icon-btn add";
  add.title = "하위 페이지 추가";
  add.textContent = "＋";
  add.addEventListener("click", (e) => {
    e.stopPropagation();
    onAdd(n.path);
  });

  row.append(twisty, label, add);
  row.addEventListener("click", () => {
    location.hash = "#/page/" + n.path.split("/").map(encodeURIComponent).join("/");
  });
  li.append(row);
  if (hasKids && isOpen) li.append(buildList(n.children, activePath, onAdd));
  return li;
}
