import { api } from "./api.js";
import { chipGroup } from "./chips.js";
import { renderTree } from "./tree.js";

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

function paintTree() {
  renderTree(treeEl, treeData, { activePath: currentPath(), onAdd: showAddForm });
}

async function refreshTree() {
  treeData = await api.tree();
  paintTree();
}

async function route() {
  const path = currentPath();
  paintTree();
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
  viewEl.replaceChildren(
    el("h2", "page-title", page.meta.title),
    el("div", "meta", `${typeLabel} · ${page.path}`),
    el("div", "content", page.content || "(내용 없음)"),
  );
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

document.getElementById("btn-new-root").addEventListener("click", () => showAddForm(""));
document.addEventListener("tree-changed", paintTree);
window.addEventListener("hashchange", route);

refreshTree().then(route).catch((e) => viewEl.replaceChildren(el("p", "error", e.message)));
