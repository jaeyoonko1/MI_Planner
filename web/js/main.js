import { api } from "./api.js";
import { chipGroup } from "./chips.js";
import { renderTree } from "./tree.js";
import { renderJournal } from "./journal.js";
import { renderHtmlPage } from "./htmlpage.js";
import { flushNote, renderNote } from "./note.js";
import { renderTodos } from "./todos.js";
import { renderToday } from "./today.js";
import { renderWeek } from "./week.js";
import { openEvaluationWizard, renderEvaluationPage, renderEvaluations } from "./evaluations.js";
import { renderDoi } from "./doi.js";
import { renderPlans } from "./plans.js";
import { renderRcp } from "./rcp.js";
import { renderStructure } from "./structure.js";
import { hub } from "./hub.js";
import { hasUnsaved, setLeaveGuard } from "./leaveguard.js";
import { confirmSheet } from "./sheet.js";
import { newTaskPage } from "./pagedialog.js";
import { closeInspector, openInspector } from "./inspector.js";
import { errorState, todayISO } from "./ui.js";
import { flash, initShell, setCrumb } from "./shell.js";
import { mountSearchPalette } from "./search-palette.js";
import { mountAiRequest } from "./ai-request.js";
import { installContextMenu } from "./contextmenu.js";
import { toast } from "./toast.js";
import { mountBacklinks, pageHash as toHash, setWikiPages } from "./wikilinks.js";

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
function currentPath() {
  const m = location.hash.match(/^#\/page\/([^?]+)(?:\?.*)?$/); // "?cell=ID" selects a board cell (P4-08)
  return m ? m[1].split("/").map(decodeURIComponent).join("/") : null;
}

let treeData = [];
let quickInput = null;

function paintTree() {
  renderTree(treeEl, treeData, { activePath: currentPath(), onAdd: showAddForm, onCreateRoot: createRoot, onMove: movePage, onRename: renamePage, onTrash: trashPage });
}

async function createRoot(title) {
  try {
    const page = await api.create("", title, "note");
    await refreshTree();
    location.hash = toHash(page.path);
  } catch (e) {
    flash(false, e.message);
  }
}

const findNode = (nodes, path) => {
  for (const n of nodes) {
    if (n.path === path) return n;
    const hit = findNode(n.children, path);
    if (hit) return hit;
  }
  return null;
};

// Move `from` under `parent` at a position: Infinity = last, {before, target} = next to a sibling.
async function movePage(from, parent, where) {
  try {
    const siblings = (parent ? findNode(treeData, parent)?.children : treeData) ?? [];
    const rest = siblings.filter((n) => n.path !== from);
    let at = rest.length;
    if (where !== Infinity) {
      const i = rest.findIndex((n) => n.path === where.target);
      at = i < 0 ? rest.length : where.before ? i : i + 1;
    }
    const moved = await api.movePage(from, { parent, order: at });
    await Promise.all(rest.map((n, i) => {
      const pos = i < at ? i : i + 1;
      return n.order === pos ? null : api.movePage(n.path, { order: pos });
    }));
    const active = currentPath();
    await refreshTree();
    if (active && (active === from || active.startsWith(from + "/"))) location.hash = toHash(moved.path + active.slice(from.length));
    flash(true, "옮겼어요");
  } catch (e) {
    flash(false, e.message);
    await refreshTree();
  }
}

// Sidebar context menu (V-010): rename keeps the page's place; trash moves the folder to vault/.trash and offers undo.
async function renamePage(path, title) {
  try {
    const page = await api.movePage(path, { title });
    const active = currentPath();
    await refreshTree();
    if (active && (active === path || active.startsWith(path + "/"))) location.hash = toHash(page.path + active.slice(path.length));
    flash(true, "이름을 바꿨어요");
  } catch (e) {
    flash(false, e.message);
    await refreshTree();
  }
}

async function trashPage(node) {
  try {
    const { trashed } = await api.deletePage(node.path);
    const active = currentPath();
    await refreshTree();
    if (active && (active === node.path || active.startsWith(node.path + "/"))) location.hash = "#/";
    const kids = node.children.length ? ` · 하위 ${node.children.length}개 포함` : "";
    toast(`‘${node.title}’ 페이지를 휴지통으로 보냈어요${kids}`, {
      ms: 9000,
      action: { label: "되돌리기", run: async () => {
        const back = await api.restorePage(trashed, node.path);
        await refreshTree();
        location.hash = toHash(back.path);
      } },
    });
  } catch (e) {
    flash(false, e.message);
  }
}

async function refreshTree() {
  treeData = await api.tree();
  setWikiPages(treeData);
  paintTree();
}

function showEvaluationWizard(parent, name) {
  return openEvaluationWizard({
    parent, name, onCreated: (path) => {
      location.hash = path ? toHash(path) : "#/evaluations";
      refreshTree().catch((error) => flash(false, error.message));
    },
  });
}

function showScreen(name) {
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.dataset.screen === name));
}

const MONTH_PAGE = /^일지\/\d{4}\/(\d{4}-\d{2})$/;
const monthPath = (month) => `일지/${month.slice(0, 4)}/${month}`;

// Open (and create when missing) a month page of the journal.
async function openMonth(month) {
  try {
    await api.journal(month); // creates the page tree on first use
    await refreshTree();
    location.hash = toHash(monthPath(month));
  } catch (e) {
    flash(false, e.message);
  }
}

async function route() {
  setLeaveGuard(null); // a screen with a draft registers itself again when it renders
  await flushNote(); // save a pending note edit before the view is replaced
  closeInspector();
  hub.reset(); // the previous view's editors and listeners are about to disappear
  const path = currentPath();
  paintTree();
  const screen = location.hash.replace(/^#\//, "");
  const week = screen.match(/^week(?:\/(\d{4}-\d{2}-\d{2}))?$/);
  if (screen === "month") {
    return openMonth(todayISO().slice(0, 7));
  }
  const isMonth = path && MONTH_PAGE.test(path);
  const struct = screen.match(/^structure(?:\/(classes|rules))?$/);
  const plans = screen.match(/^plans(?:\/(\d+))?$/);
  const doi = screen.match(/^doi(?:\/(\d+))?$/);
  const rcp = screen.match(/^rcp(?:\/(\d+))?$/);
  const name = rcp ? "rcp" : doi ? "doi" : plans ? "plans" : ["todos", "today", "evaluations"].includes(screen) ? screen : week ? "week" : struct ? "structure" : isMonth ? "month" : "";
  showScreen(name);
  setCrumb(screen === "today" ? ["오늘"] : screen === "todos" ? ["할일"] : screen === "evaluations" ? ["평가 현황판"] : plans ? ["MI 정보", "Plan · Step"] : rcp ? ["MI 정보", "RCP 관리"] : doi ? ["MI 정보", "DOI 라이브러리"] : struct ? ["구조", ...(struct[1] ? [struct[1] === "rules" ? "페이지 위치 규칙" : "분류 관리"] : [])] : week ? ["주간 일지"] : path ? path.split("/") : ["홈"]);
  const fail = (e) => viewEl.replaceChildren(errorState(e.message, route));
  if (screen === "today") {
    return renderToday(viewEl).catch(fail);
  }
  if (screen === "evaluations") {
    return renderEvaluations(viewEl, { onAdd: () => showEvaluationWizard(), pageHref: toHash }).catch(fail);
  }
  if (doi) {
    return renderDoi(viewEl, doi[1] ? Number(doi[1]) : null).catch(fail);
  }
  if (rcp) {
    return renderRcp(viewEl, rcp[1] ? Number(rcp[1]) : null, { go: (id) => { location.hash = `#/rcp/${id}`; } }).catch(fail);
  }
  if (plans) {
    return renderPlans(viewEl, plans[1] ? Number(plans[1]) : null, { go: (id) => { location.hash = `#/plans/${id}`; } }).catch(fail);
  }
  if (struct) {
    return renderStructure(viewEl, struct[1] || "tree").catch(fail);
  }
  if (week) {
    return renderWeek(viewEl, week[1], (d) => { location.hash = `#/week/${d}`; }).catch(fail);
  }
  if (screen === "todos") {
    quickInput = null;
    return renderTodos(viewEl)
      .then((q) => { quickInput = q; })
      .catch(fail);
  }
  if (!path) return showHome();
  try {
    const page = await api.page(path);
    if (currentPath() !== path) return;
    showPage(page);
    mountBacklinks(viewEl, page.path);
  } catch (err) {
    if (currentPath() === path) viewEl.replaceChildren(el("p", "error", err.message));
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
  const box = el("div", "card home");
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
  const meta = el("div", "meta", `${typeLabel} · ${page.path}`);
  if (page.meta.task_id) {
    const b = el("button", "linkbtn", `이슈 #${page.meta.task_id} 상세`);
    b.type = "button";
    b.addEventListener("click", () => openInspector(page.meta.task_id));
    meta.append(" · ", b);
  }
  viewEl.replaceChildren(el("h2", "page-title", page.meta.title), meta, body);
  if (page.meta.type === "note") {
    body.className = "note-host";
    renderNote(body, page);
    return;
  }
  if (page.meta.type === "html") {
    body.className = "html-host";
    const paint = () => renderHtmlPage(body, page).catch((e) => body.replaceChildren(errorState(e.message, paint)));
    paint();
    return;
  }
  if (page.meta.type === "board" && page.meta.eval_id) {
    showScreen("evaluations");
    renderEvaluationPage(body, page, route);
    return;
  }
  const month = page.path.split("/").pop();
  if (page.meta.type === "journal" && /^\d{4}-\d{2}$/.test(month)) {
    body.className = "journal";
    viewEl.replaceChildren(body); // the month screen has its own hero
    renderJournal(body, month, openMonth).catch((e) => body.replaceChildren(errorState(e.message, () => route())));
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
      if (types.getValue() === "board") return showEvaluationWizard(parent, input.value);
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
  if (document.querySelector("dialog[open]")) return;
  e.preventDefault();
  if (location.hash === "#/todos" && quickInput) quickInput.focus();
  else {
    location.hash = "#/todos";
    setTimeout(() => quickInput?.focus(), 150);
  }
});

initShell();
installContextMenu();
mountAiRequest();
const go = (path) => () => { location.hash = path; };
const cycle = (target) => () => {
  const buttons = [...document.querySelectorAll(target + " button")];
  const at = buttons.findIndex((button) => button.getAttribute("aria-pressed") === "true");
  buttons[(at + 1) % buttons.length]?.click();
};
mountSearchPalette({
  openIssue: openInspector,
  commands: [
    { title: "새 할일 페이지", detail: "Ctrl+N · Alt+N", run: newTaskPage },
    { title: "구조 보기", detail: "", run: go("#/structure") },
    { title: "항목 관리", detail: "", run: go("#/structure/classes") },
    { title: "페이지 위치 규칙", detail: "", run: go("#/structure/rules") },
    { title: "테마 바꾸기", detail: "", run: cycle("#seg-theme") },
    { title: "밀도 바꾸기", detail: "", run: cycle("#seg-density") },
  ],
});
document.getElementById("btn-new-root").addEventListener("click", () => showAddForm(""));
document.addEventListener("tree-changed", paintTree);
document.addEventListener("tree-reload", () => refreshTree().catch((e) => flash(false, e.message)));
// Alt+N (Ctrl+N where the browser lets it through) = 할일 페이지 추가: issue + page, with the path previewed.
document.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "n" || !(e.altKey || e.ctrlKey) || e.shiftKey || e.metaKey) return;
  if (document.querySelector("dialog[open]")) return;
  e.preventDefault();
  newTaskPage();
});
// Leaving a screen with an unsaved draft (rules tab): ask first; "계속 편집" restores the previous address.
let settledHash = location.hash;
let restoring = false;
window.addEventListener("hashchange", async () => {
  if (restoring) { restoring = false; return; }
  if (hasUnsaved()) {
    const leave = await confirmSheet({
      title: "저장하지 않은 변경이 있어요",
      content: [el("p", "", "이 화면에서 고친 내용은 저장하지 않으면 사라져요.")],
      confirmLabel: "저장하지 않고 이동",
      danger: true,
    });
    if (!leave) { restoring = true; location.hash = settledHash; return; }
  }
  settledHash = location.hash;
  route();
});

refreshTree().then(route).catch((e) => viewEl.replaceChildren(el("p", "error", e.message)));
