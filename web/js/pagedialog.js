// Page placement sheet (P2B-09). One component for three jobs:
//   expand   - give an existing issue its page (once)              openPageSheet({ task })
//   create   - "할일 페이지 추가": issue + page in one step          openPageSheet({ create: true })
//   relocate - explicitly move an existing issue page               openPageSheet({ task, relocate: true })
// The path is always previewed first (first matching rule -> default) and can be overridden: under the
// journal month or in a chosen folder. Nothing is written until the primary button.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { button, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { addDays, chipRow, debounce, el, store, svg, todayISO } from "./ui.js";

const MODES = [["auto", "규칙에 따라 자동"], ["journal", "일지 아래"], ["folder", "폴더 지정"]];
const toHash = (p) => "#/page/" + p.split("/").map(encodeURIComponent).join("/");

function flatten(nodes, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ path: n.path, title: n.title, depth, auto: n.auto });
    flatten(n.children, depth + 1, out);
  }
  return out;
}

// opts: { task, create, relocate, onDone(result) }
export async function openPageSheet(opts) {
  const { task, create = false, relocate = false } = opts;
  const title = create ? "할일 페이지 추가" : relocate ? "페이지 위치 변경" : "페이지로 확장";
  const sub = create
    ? "이슈와 페이지를 한 번에 만들어요. 위치는 아래에서 미리 확인하세요."
    : relocate
      ? "이미 만든 페이지를 지금 규칙(또는 지정한 폴더)의 위치로 옮겨요. 이슈 번호·메모·일지 연결은 그대로예요."
      : `이슈 #${task.id}에 페이지를 연결해요. 번호와 메모, 일지 연결은 그대로 유지돼요.`;
  const sheet = openSheet({ title, sub, wide: true });
  const { body, foot } = sheet;

  let fields = [];
  let tree = [];
  try { [fields, tree] = await Promise.all([create ? api.todoFields() : Promise.resolve([]), api.tree()]); } catch { /* preview shows the error */ }
  const choiceFields = fields.filter((f) => !f.builtin && !f.archived && ["choice", "multi"].includes(f.type));
  const saved = store.get("mi.qa", null) || {};
  const st = {
    mode: "auto", folder: "", seq: 0, busy: false, preview: null, error: "",
    title: "", planned: todayISO(),
    props: saved.remember === false ? {} : Object.fromEntries(Object.entries(saved.draft?.props || {}).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length))),
  };
  const folders = flatten(tree);

  const section = (label, ...content) => {
    const s = el("div", "pg-sec");
    s.append(el("h3", "", label), ...content);
    return s;
  };

  // ---- issue values (create mode only) ----
  const titleIn = el("input", "pg-title");
  titleIn.type = "text";
  titleIn.placeholder = "이슈 제목";
  titleIn.setAttribute("aria-label", "이슈 제목");
  titleIn.addEventListener("input", () => { st.title = titleIn.value; st.error = ""; refresh(); });
  titleIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
  const valuesBox = el("div", "pg-values");

  function paintValues() {
    const rows = [];
    const mk = (label, node) => { const r = el("div", "pg-row"); r.append(el("span", "k", label), node); rows.push(r); };
    mk("하기로 한 날", chipRow([[null, "없음"], [todayISO(), "오늘"], [addDays(todayISO(), 1), "내일"]], st.planned, (v) => { st.planned = v; paintValues(); refresh(); }));
    for (const f of choiceFields) {
      const items = f.options.map((o) => [o.value, o.label]);
      if (f.type === "choice") {
        mk(f.label, chipRow([[null, "없음"], ...items], st.props[f.key] ?? null, (v) => { st.props = { ...st.props, [f.key]: v }; paintValues(); refresh(); }));
      } else {
        const set = new Set(st.props[f.key] || []);
        const wrap = el("div", "chips");
        for (const [v, l] of items) {
          const b = el("button", "chip", l);
          b.type = "button";
          b.setAttribute("aria-pressed", String(set.has(v)));
          b.addEventListener("click", () => { set.has(v) ? set.delete(v) : set.add(v); st.props = { ...st.props, [f.key]: [...set] }; paintValues(); refresh(); });
          wrap.append(b);
        }
        mk(f.label, wrap);
      }
    }
    valuesBox.replaceChildren(...rows);
  }

  // ---- placement ----
  const modeBox = el("div");
  const pathCard = el("div", "pg-card");
  pathCard.setAttribute("aria-live", "polite");
  const pickBox = el("div", "pg-pick");
  const errBox = el("div", "ferr");
  errBox.setAttribute("role", "alert");

  const override = () => (st.mode === "journal" ? { kind: "journal" } : st.mode === "folder" ? { kind: "folder", path: st.folder } : null);

  function paintMode() {
    modeBox.replaceChildren(chipRow(MODES, st.mode, (v) => {
      st.mode = v;
      paintMode();
      paintPicker();
      refresh();
      if (v === "folder") pickBox.querySelector("input")?.focus();
    }));
  }

  function paintPicker() {
    pickBox.hidden = st.mode !== "folder";
    if (st.mode !== "folder") return;
    const list = el("div", "pg-folders");
    list.setAttribute("role", "group");
    list.setAttribute("aria-label", "폴더 고르기");
    if (!folders.length) list.append(el("p", "pg-none", "아직 폴더가 없어요. 아래에 경로를 쓰면 새로 만들어요."));
    for (const f of folders) {
      const b = el("button", "pg-folder");
      b.type = "button";
      b.style.paddingLeft = `${8 + f.depth * 14}px`;
      b.dataset.path = f.path;
      b.setAttribute("aria-pressed", String(f.path === st.folder));
      b.append(svg("folder", "i s"), el("span", "", f.title));
      if (f.auto) b.append(el("span", "badge", "자동"));
      b.addEventListener("click", () => { st.folder = f.path; input.value = f.path; paintPicker(); refresh(); });
      list.append(b);
    }
    const input = el("input", "pg-path");
    input.type = "text";
    input.value = st.folder;
    input.placeholder = "예) MI 공정업무/셋업  ·  없는 폴더는 새로 만들어요";
    input.setAttribute("aria-label", "폴더 경로");
    input.addEventListener("input", () => { st.folder = input.value; refresh(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
    pickBox.replaceChildren(list, input);
    for (const b of list.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.path === st.folder));
  }

  function paintPath() {
    const p = st.preview;
    pathCard.classList.toggle("empty", !p);
    if (st.error && !p) {
      pathCard.replaceChildren(el("p", "pg-msg warn", st.error));
      return;
    }
    if (!p) { pathCard.replaceChildren(el("p", "pg-msg", "위치를 계산하는 중…")); return; }
    const head = el("div", "pg-by");
    const why = el("span", "badge " + (p.kind === "rule" ? "ok" : ""), p.by);
    head.append(why, el("span", "pg-why", p.kind === "rule" ? "첫 번째로 맞은 규칙" : p.kind === "folder" ? "지정한 폴더" : p.kind === "journal" ? "이슈의 날짜가 속한 월" : "맞는 규칙이 없어요"));
    const path = el("ol", "pg-crumbs");
    const parts = p.folder.split("/");
    const fresh = new Set(p.new_folders);
    parts.forEach((seg, i) => {
      const li = el("li", fresh.has(parts.slice(0, i + 1).join("/")) ? "new" : "");
      li.append(svg("folder", "i s"), el("span", "", seg));
      path.append(li);
    });
    const last = el("li", "leaf");
    last.append(svg("doc", "i s"), el("span", "", p.page_path.split("/").pop()));
    path.append(last);
    path.setAttribute("aria-label", `${p.page_path} 위치`);
    const kids = [head, path];
    if (p.new_folders.length) {
      const note = el("p", "pg-msg");
      note.append(svg("plus", "i s"), `새 폴더 ${p.new_folders.length}개를 '자동' 폴더로 만들어요`);
      kids.push(note);
    }
    if (relocate && p.current) kids.push(el("p", "pg-msg", `지금 위치 · ${p.current}`));
    pathCard.replaceChildren(...kids);
    ok.disabled = st.busy || (create && !st.title.trim());
  }

  function request() {
    if (create) {
      return { draft: { title: st.title.trim() || "새 이슈", props: st.props, planned_date: st.planned }, override: override() };
    }
    return { task_id: task.id, relocate, override: override() };
  }

  const refresh = debounce(async () => {
    const mine = ++st.seq;
    if (st.mode === "folder" && !st.folder.trim()) { st.preview = null; st.error = "폴더를 고르거나 경로를 입력하세요."; paintPath(); ok.disabled = true; return; }
    try {
      const p = await api.pagePreview(request());
      if (mine !== st.seq) return;
      if (p.exists && !relocate) { st.preview = null; st.error = `이미 페이지가 있어요 · ${p.path}`; errBox.textContent = ""; paintPath(); ok.textContent = "페이지 열기"; ok.disabled = false; st.openPath = p.path; return; }
      st.preview = p;
      st.error = "";
      errBox.textContent = "";
    } catch (e) {
      if (mine !== st.seq) return;
      st.preview = null;
      st.error = e.message;
    }
    paintPath();
    ok.disabled = !st.preview || st.busy || (create && !st.title.trim());
  }, 140);

  // ---- actions ----
  const cancel = button("취소", "", () => sheet.close());
  const ok = button(create ? "이슈와 페이지 만들기" : relocate ? "여기로 이동" : "페이지 만들기", "pri");
  ok.disabled = true;
  foot.append(el("span", "grow"), cancel, ok);

  async function submit() {
    if (st.openPath) { sheet.close(); location.hash = toHash(st.openPath); return; }
    if (ok.disabled || st.busy) return;
    if (create && !st.title.trim()) { errBox.textContent = "제목을 입력하세요."; titleIn.focus(); return; }
    st.busy = true;
    ok.disabled = true;
    ok.textContent = "만드는 중…";
    errBox.textContent = "";
    try {
      let res;
      if (create) {
        const t = st.planned;
        res = await api.createWithPage({ title: st.title.trim(), props: Object.keys(st.props).length ? st.props : undefined, planned_date: t || undefined, override: override() });
      } else if (relocate) res = await api.relocatePage(task.id, override());
      else res = await api.expandPage(task.id, override());
      sheet.close();
      document.dispatchEvent(new CustomEvent("tree-reload"));
      const msg = create ? `이슈 #${res.task.id}와 페이지를 만들었어요`
        : relocate ? (res.moved ? "페이지를 옮겼어요" : "이미 그 위치예요")
          : res.created ? "페이지를 만들었어요" : "이미 있는 페이지예요";
      toast(`${msg} · ${res.path}`, { ms: 5200, ...(create ? {} : { action: { label: "열기", run: () => { location.hash = toHash(res.path); } } }) });
      opts.onDone?.(res);
    } catch (e) {
      errBox.textContent = `만들지 못했어요 · ${e.message}. 아무것도 바뀌지 않았어요.`;
      st.busy = false;
      ok.textContent = create ? "이슈와 페이지 만들기" : relocate ? "여기로 이동" : "페이지 만들기";
      refresh();
    }
  }
  ok.addEventListener("click", submit);

  // ---- assemble ----
  if (create) {
    body.append(section("이슈", titleIn, valuesBox));
    paintValues();
  }
  body.append(section("페이지 위치", modeBox, pathCard, pickBox), errBox);
  if (!relocate) body.append(el("p", "hint", "분류를 나중에 바꿔도 이미 만든 페이지는 자동으로 옮겨지지 않아요. 필요하면 '위치 변경'을 눌러 옮기세요."));
  paintMode();
  paintPicker();
  paintPath();
  refresh();
  (create ? titleIn : ok).focus();
}

// "할일 페이지 추가" (Alt+N): issue + page together, then open the new page.
export function newTaskPage() {
  return openPageSheet({
    create: true,
    onDone: (res) => {
      const { journal_days: days, ...task } = res.task;
      hub.putTask(task);
      hub.applyDays(days);
      hub.emit({ kind: "task", id: task.id });
      location.hash = toHash(res.path);
    },
  });
}
