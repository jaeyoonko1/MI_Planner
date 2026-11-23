import { api } from "./api.js";
import { chipGroup } from "./chips.js";
import { renderTree } from "./tree.js";
import { renderJournal } from "./journal.js";
import { renderHtmlPage } from "./htmlpage.js";
import { renderTodos } from "./todos.js";
import { renderToday } from "./today.js";

const treeEl = document.getElementById("tree");
const viewEl = document.getElementById("view");
const TYPES = [
  { value: "note", label: "노트" },
  { value: "html", label: "HTML" },
  { value: "journal", label: "일지" },
  { value: "board", label: "현황판" },
  { value: "table", label: "표" },
];

// ---- routing: #/ (home) or #/page/<encoded path> ---------------------------
const toHash = (path) => "#/page/" + path.split("/").map(encodeURIComponent).join("/");

function currentPath() {
  const m = location.hash.match(/^#\/page\/(.+)$/);
  return m ? m[1].split("/").map(decodeURIComponent).join("/") : null;
}

let treeData = [];
let quickInput = null;

function paintTree() {
  renderTree(treeEl, treeData, { activePath: currentPath(), onAdd: showAddForm });
}

async function refreshTree() {
  treeData = await api.tree();
  paintTree();
}

function showScreen(name) {
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.screen === name));
}

async function route() {
  const path = currentPath();
  paintTree();
  const screen = location.hash.replace(/^#\//, "");
  showScreen(screen === "todos" || screen === "today" ? screen : "");
  if (screen === "today") {
    return renderToday(viewEl).catch((e) => viewEl.replaceChildren(el("p", "error", e.message)));
  }
  if (screen === "todos") {
    quickInput = null;
    return renderTodos(viewEl)
      .then((q) => { quickInput = q; })
      .catch((e) => viewEl.replaceChildren(el("p", "error", e.message)));
  }
  if (!path) return showHome();
  try {
    showPage(await api.page(path));
  } catch (err) {
    viewEl.replaceChildren(el("p", "error", err.message));
  }
}

// ---- views ----------------------------------------------------------------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function showHome() {
  const box = el("div", "card");
  box.append(el("h3", "", "MI_Planner"));
  box.append(el("p", "", treeData.length ? "왼쪽 트리에서 페이지를 고르세요." : "아직 페이지가 없습니다."));
  const btn = el("button", "btn", "페이지 만들기");
  btn.addEventListener("click", () => showAddForm(""));
  box.append(btn);
  viewEl.replaceChildren(box);
}

function showPage(page) {
  const typeLabel = TYPES.find((t) => t.value === page.meta.type)?.label ?? page.meta.type;
  const body = el("div", "content", page.content || "(내용 없음)");
  viewEl.replaceChildren(
    el("h2", "page-title", page.meta.title),
    el("div", "meta", `${typeLabel} · ${page.path}`),
    body,
  );
  if (page.meta.type === "html") {
    body.className = "html-host";
    renderHtmlPage(body, page).catch((e) => body.replaceChildren(el("p", "error", e.message)));
    return;
  }
  const month = page.path.split("/").pop();
  if (page.meta.type === "journal" && /^\d{4}-\d{2}$/.test(month)) {
    body.className = "journal";
    renderJournal(body, month).catch((e) => body.replaceChildren(el("p", "error", e.message)));
  }
}

function showAddForm(parent) {
  const box = el("div", "card");
  box.append(el("h3", "", parent ? `하위 페이지 추가 — ${parent}` : "최상위 페이지 추가"));
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "제목";
  const titleField = el("label", "field", "제목");
  titleField.append(input);
  const types = chipGroup(TYPES, "note");
  const typeField = el("div", "field", "종류");
  typeField.append(types);
  const err = el("div", "error");
  const ok = el("button", "btn", "만들기");
  const cancel = el("button", "btn ghost", "취소");
  cancel.addEventListener("click", route);
  async function submit() {
    try {
      const page = await api.create(parent, input.value, types.getValue());
      await refreshTree();
      location.hash = toHash(page.path);
    } catch (e) {
      err.textContent = e.message;
    }
  }
  ok.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => e.key === "Enter" && submit());
  const actions = el("div", "actions");
  actions.append(ok, cancel);
  box.append(titleField, typeField, err, actions);
  viewEl.replaceChildren(box);
  input.focus();
}

// N = new todo (jump to the todo screen's quick-add box)
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
  e.preventDefault();
  if (location.hash === "#/todos" && quickInput) quickInput.focus();
  else {
    location.hash = "#/todos";
    setTimeout(() => quickInput?.focus(), 150);
  }
});

document.getElementById("btn-new-root").addEventListener("click", () => showAddForm(""));
document.addEventListener("tree-changed", paintTree);
window.addEventListener("hashchange", route);

refreshTree().then(route).catch((e) => viewEl.replaceChildren(el("p", "error", e.message)));
