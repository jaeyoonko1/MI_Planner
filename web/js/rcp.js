// RCP management screen (P6-02): sources, name filter editor with live preview, manual collection + status.
// Read-only toward equipment: there is no write control here. Connection details never reach the browser
// (only FTP profile names do).
import { api } from "./api.js";
import {
  cleanRules, filterRecipes, filterSummary, formatStamp, isRunning, LAYOUTS, RULE_TYPES, runLine, runStatus,
  splitList, splitNames,
} from "./rcp-model.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, debounce, el, emptyState, errorState, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");

function toggleChip(label, pressed, onToggle, icon) {
  const b = el("button", "chip", label);
  b.type = "button";
  if (icon) b.prepend(svg(icon));
  b.setAttribute("aria-pressed", String(pressed));
  b.addEventListener("click", () => {
    const next = b.getAttribute("aria-pressed") !== "true";
    b.setAttribute("aria-pressed", String(next));
    onToggle(next);
  });
  return b;
}

function badge(status) {
  const [label, tone, icon] = runStatus(status);
  const b = el("span", `mos-badge ${tone}`);
  b.append(svg(icon, "i"), label);
  return b;
}

function stat(value, label, tone = "") {
  const box = el("div", `mos-stat ${tone}`);
  box.append(el("b", "", num(value)), el("span", "", label));
  return box;
}

// ---- screen ------------------------------------------------------------------------------------------------

export async function renderRcp(host, sourceId, { go }) {
  const page = el("div", "page rcp");
  const hero = el("div", "hero rcp-hero");
  const title = el("div", "grow");
  title.append(el("div", "eyebrow", "MI 정보"), el("h1", "h1", "RCP 관리"));
  const actions = el("div", "hero-actions");
  hero.append(title, actions);
  const note = el("div", "rcp-note");
  const body = el("div", "rcp-body");
  body.append(skeleton(4));
  page.append(hero, note, body);
  host.replaceChildren(page);

  const st = { enabled: false, items: [], profiles: [], poll: null, showMissing: false, query: "" };
  const stopPoll = () => { clearInterval(st.poll); st.poll = null; };
  // leaving the screen (route change replaces the host content) stops polling
  const alive = () => page.isConnected;

  async function load() {
    const [settings, sources, profiles] = await Promise.all([api.settings(), api.recipeSources(), api.recipeProfiles()]);
    st.enabled = settings.rcp_enabled === "on";
    st.items = sources;
    st.profiles = profiles;
    paintHeader();
    paintBody();
  }

  function paintHeader() {
    const toggle = toggleChip(st.enabled ? "수집 켜짐" : "수집 꺼짐", st.enabled, async (on) => {
      try {
        const s = await api.putSetting("rcp_enabled", on ? "on" : "off");
        st.enabled = s.rcp_enabled === "on";
        toast(st.enabled ? "RCP 수집을 켰어요" : "RCP 수집을 껐어요 · 설비에 연결하지 않아요");
        paintHeader();
        paintBody();
      } catch (e) { toast(e.message, { error: true }); }
    }, st.enabled ? "check" : "lock");
    toggle.classList.add("rcp-toggle");
    toggle.title = "켜면 설정한 FTP 소스에 연결할 수 있어요 (읽기 전용)";
    const add = button("소스 추가", "pri", () => editSource(null));
    add.prepend(svg("plus"));
    actions.replaceChildren(toggle, add);
    note.replaceChildren();
    note.hidden = st.enabled;
    if (!st.enabled) {
      note.append(svg("lock"), el("span", "", "RCP 수집이 꺼져 있어요. 켜기 전에는 설비(FTP)에 연결하지 않아요. 이 기능은 읽기 전용이라 설비의 레시피를 바꾸지 않아요."));
    }
  }

  function editSource(source) {
    openSourceEditor({ source, profiles: st.profiles, enabled: st.enabled, onSaved: async (saved) => {
      await load();
      if (saved && saved.id !== sourceId) go(saved.id);
    } });
  }

  function paintBody() {
    if (!st.items.length) {
      body.className = "rcp-body";
      body.replaceChildren(emptyState({
        title: "등록한 레시피 소스가 아직 없어요", icon: "cube",
        desc: "설비·라인별 FTP 경로를 소스로 등록하고, 이름 필터(예: ‘aabb’ 포함)로 가져올 레시피만 고르세요. 주소와 계정은 config/local.json의 프로필에만 두고 여기에는 프로필 이름만 적어요.",
        action: { label: "소스 추가", run: () => editSource(null) },
      }));
      return;
    }
    body.className = "rcp-body has";
    const selected = st.items.find((s) => s.id === sourceId) ?? st.items[0];
    const side = el("aside", "rcp-side");
    side.setAttribute("aria-label", "레시피 소스 목록");
    const list = el("ul", "rcp-list");
    for (const s of st.items) {
      const li = el("li");
      const a = el("a", "rcp-item");
      a.href = `#/rcp/${s.id}`;
      if (s.id === selected.id) a.setAttribute("aria-current", "page");
      const where = [s.line, s.equipment].filter(Boolean).join(" · ") || "라인·설비 미지정";
      a.append(el("b", "", s.name), el("span", "rcp-prod", where),
        el("span", "rcp-meta", `${num(s.recipe_count)}개 레시피${s.enabled ? "" : " · 꺼짐"}`));
      li.append(a);
      list.append(li);
    }
    side.append(list);
    const main = el("section", "rcp-main");
    main.setAttribute("aria-label", "소스 상세");
    main.append(skeleton(5));
    body.replaceChildren(side, main);
    showSource(main, selected);
  }

  async function showSource(main, source) {
    stopPoll();
    let recipes, runs;
    try {
      [recipes, runs] = await Promise.all([api.recipes({ source_id: source.id, include_missing: true }), api.recipeRuns(source.id)]);
    } catch (e) {
      main.replaceChildren(errorState(e.message, () => showSource(main, source)));
      return;
    }
    if (!alive()) return;
    const view = sourceView(source, recipes, runs);
    main.replaceChildren(view.root);
    if (isRunning(runs[0])) view.follow(runs[0].id);
  }

  function sourceView(source, recipes, runs) {
    const root = el("div", "rcp-view");
    const head = el("header", "rcp-head");
    const t = el("div", "rcp-title");
    t.append(el("h2", "", source.name));
    for (const bit of [source.vendor, source.model, source.equipment, source.line].filter(Boolean)) t.append(el("span", "rcp-chip", bit));
    if (!source.enabled) t.append(el("span", "rcp-chip off", "꺼짐"));
    const sub = el("p", "rcp-sub", `프로필 ${source.ftp_profile || "(없음)"} · 경로 ${source.remote_dir || "/"} · ${source.layout === "folder" ? "폴더 = 레시피" : "파일 = 레시피"}`);
    const left = el("div", "grow");
    left.append(t, sub);

    const runBtn = button("수집", "pri", () => start());
    runBtn.prepend(svg("download"));
    const cancelBtn = button("취소", "sm", async () => {
      try { await api.cancelRecipeRun(current.id); toast("취소를 요청했어요 · 현재 파일을 마치고 멈춰요"); } catch (e) { toast(e.message, { error: true }); }
    });
    cancelBtn.hidden = true;
    const editBtn = button("편집", "sm", () => editSource(source));
    editBtn.prepend(svg("edit", "i s"));
    const delBtn = button("지우기", "sm quiet danger", async () => {
      const ok = await confirmSheet({
        title: `‘${source.name}’ 소스를 지울까요?`, confirmLabel: "지우기", danger: true,
        sub: `수집해 둔 레시피 ${source.recipe_count}개와 버전 기록이 앱에서 사라져요. 설비의 레시피와 받아 둔 원본 파일은 그대로예요.`,
      });
      if (!ok) return;
      try {
        await api.deleteRecipeSource(source.id);
        toast("소스를 지웠어요");
        location.hash = "#/rcp";
        await load();
      } catch (e) { toast(e.message, { error: true }); }
    });
    const acts = el("div", "rcp-actions");
    acts.append(runBtn, cancelBtn, editBtn, delBtn);
    head.append(left, acts);

    const rules = el("div", "rcp-rules");
    rules.append(el("span", "k", "이름 필터"));
    for (const text of filterSummary(source.name_filter)) rules.append(el("span", "rcp-rule" + (text.startsWith("제외") ? " ex" : ""), text));
    if (source.file_globs.length) {
      rules.append(el("span", "k", "파일"));
      for (const g of source.file_globs) rules.append(el("span", "rcp-rule", g));
    }

    const status = el("section", "rcp-status");
    status.setAttribute("aria-label", "수집 상태");
    status.setAttribute("aria-live", "polite");
    let current = runs[0] ?? null;

    function paintStatus() {
      const run = current;
      const top = el("div", "rcp-status-top");
      top.append(el("b", "", "수집 상태"));
      if (run) top.append(badge(run.status), el("span", "rcp-meta", formatStamp(run.finished_at || run.started_at)));
      const parts = [top];
      if (!run) {
        parts.push(el("p", "mos-hint", st.enabled ? "‘수집’을 누르면 필터에 맞는 레시피만 내려받아 이 PC에 저장해요. 설비의 파일은 바꾸지 않아요." : "수집이 꺼져 있어요. 위의 ‘수집 꺼짐’을 눌러 켜면 수집할 수 있어요."));
      } else {
        const stats = el("div", "mos-stats rcp-stats");
        stats.append(stat(run.listed, "목록"), stat(run.matched, "필터 일치"), stat(run.downloaded, "받은 파일"),
          stat(run.new_snapshots, "새 버전", run.new_snapshots ? "ok" : ""), stat(run.unchanged, "변화 없음"));
        parts.push(stats);
        if (run.message) parts.push(el("p", "rcp-msg", run.message));
        if (run.errors.length) {
          const ul = el("ul", "rcp-errors");
          for (const e of run.errors.slice(0, 20)) {
            const li = el("li");
            li.append(el("b", "", e.recipe), el("span", "", e.file ? ` / ${e.file}` : ""), el("em", "", e.message));
            ul.append(li);
          }
          parts.push(ul);
          if (run.errors.length > 20) parts.push(el("p", "mos-hint", `앞 20건만 보여 줘요 (전체 ${run.errors.length}건).`));
        }
      }
      if (runs.length > 1) {
        const hist = el("details", "rcp-hist");
        hist.append(el("summary", "", `이전 수집 ${runs.length - 1}건`));
        const ul = el("ul");
        for (const r of runs.slice(1)) {
          const li = el("li");
          li.append(badge(r.status), el("span", "", `${formatStamp(r.started_at)} · ${runLine(r)}`));
          ul.append(li);
        }
        hist.append(ul);
        parts.push(hist);
      }
      status.replaceChildren(...parts);
      const running = isRunning(run);
      runBtn.disabled = running || !st.enabled || !source.enabled;
      runBtn.title = !st.enabled ? "RCP 수집이 꺼져 있어요" : !source.enabled ? "꺼져 있는 소스예요" : "";
      cancelBtn.hidden = !running;
    }

    async function follow(runId) {
      stopPoll();
      st.poll = setInterval(async () => {
        if (!alive()) { stopPoll(); return; }
        try {
          current = await api.recipeRun(runId);
          runs[0] = current;
          paintStatus();
          if (!isRunning(current)) {
            stopPoll();
            await refreshRecipes();
            const [label] = runStatus(current.status);
            toast(`수집 ${label} · ${current.message}`, { error: current.status === "error" });
          }
        } catch (e) { stopPoll(); toast(e.message, { error: true }); }
      }, 700);
    }

    async function start() {
      runBtn.disabled = true;
      try {
        current = await api.runRecipeSource(source.id);
        runs.unshift(current);
        paintStatus();
        follow(current.id);
      } catch (e) {
        toast(e.message, { error: true });
        paintStatus();
      }
    }

    const tableWrap = el("section", "rcp-recipes");
    async function refreshRecipes() {
      recipes = await api.recipes({ source_id: source.id, include_missing: true });
      paintRecipes();
      try {
        st.items = await api.recipeSources();
        const mine = st.items.find((s) => s.id === source.id);
        const meta = document.querySelector(`.rcp-item[href="#/rcp/${source.id}"] .rcp-meta`);
        if (mine && meta) meta.textContent = `${num(mine.recipe_count)}개 레시피${mine.enabled ? "" : " · 꺼짐"}`;
      } catch { /* the side list count is cosmetic */ }
    }

    function paintRecipes() {
      const missingCount = recipes.filter((r) => r.missing).length;
      const tools = el("div", "rcp-tools");
      const search = el("input", "rcp-search");
      search.type = "search";
      search.placeholder = "레시피 이름 찾기";
      search.value = st.query;
      search.autocomplete = "off";
      search.setAttribute("aria-label", "레시피 이름 찾기");
      tools.append(search);
      if (missingCount) tools.append(toggleChip(`누락 ${missingCount}개 보기`, st.showMissing, (v) => { st.showMissing = v; paintRecipes(); }));
      const count = el("span", "rcp-count");
      count.setAttribute("role", "status");
      tools.append(count);
      const scroll = el("div", "rcp-scroll");
      scroll.tabIndex = 0;
      scroll.setAttribute("role", "region");
      scroll.setAttribute("aria-label", "수집한 레시피 목록");
      const table = el("table", "rcp-table");
      const hr = el("tr");
      for (const h of ["레시피", "마지막 수집", "파라미터", "버전"]) {
        const th = el("th", "", h);
        th.scope = "col";
        hr.append(th);
      }
      const thead = el("thead");
      thead.append(hr);
      const tbody = el("tbody");
      table.append(thead, tbody);
      scroll.append(table);
      const empty = el("div", "rcp-empty");
      function fill() {
        const rows = filterRecipes(recipes, { query: st.query, showMissing: st.showMissing });
        const frag = document.createDocumentFragment();
        for (const r of rows) {
          const tr = el("tr", r.missing ? "missing" : "");
          const nm = el("td", "nm", r.name);
          if (r.missing) nm.append(el("em", "rcp-miss", "설비에서 안 보임"));
          tr.append(nm, el("td", "", formatStamp(r.collected_at) || "—"), el("td", "n", r.param_count ? num(r.param_count) : "—"),
            el("td", "mono", r.content_hash ? r.content_hash.slice(0, 8) : "—"));
          frag.append(tr);
        }
        tbody.replaceChildren(frag);
        const live = recipes.filter((r) => st.showMissing || !r.missing).length;
        count.textContent = st.query.trim() ? `${num(rows.length)} / ${num(live)}개` : `${num(live)}개 레시피`;
        scroll.hidden = rows.length === 0;
        empty.hidden = rows.length > 0;
        if (!rows.length) {
          empty.replaceChildren(el("b", "", st.query.trim() ? "찾는 레시피가 없어요" : "수집한 레시피가 아직 없어요"),
            el("span", "", st.query.trim() ? "다른 단어로 찾아 보세요." : "‘수집’을 눌러 가져오세요."));
        }
      }
      search.addEventListener("input", () => { st.query = search.value; fill(); });
      search.addEventListener("keydown", (e) => { if (e.key === "Escape" && search.value) { search.value = ""; st.query = ""; fill(); e.stopPropagation(); } });
      fill();
      tableWrap.replaceChildren(tools, scroll, empty);
    }

    paintStatus();
    paintRecipes();
    root.append(head, rules, status, tableWrap);
    return { root, follow };
  }

  try {
    await load();
  } catch (e) {
    body.replaceChildren(errorState(e.message, () => renderRcp(host, sourceId, { go })));
  }
}

// ---- source editor -----------------------------------------------------------------------------------------

function field(label, input, hint) {
  const wrap = el("label", "rcp-field");
  wrap.append(el("span", "k", label), input);
  if (hint) wrap.append(el("span", "mos-hint", hint));
  return wrap;
}

function textInput(value, placeholder = "") {
  const i = el("input", "mos-in");
  i.type = "text";
  i.value = value ?? "";
  i.placeholder = placeholder;
  i.autocomplete = "off";
  return i;
}

export function openSourceEditor({ source, profiles, enabled, onSaved }) {
  const isNew = !source;
  const sheet = openSheet({
    title: isNew ? "레시피 소스 추가" : `‘${source.name}’ 편집`, wide: true,
    sub: "FTP 주소·계정은 config/local.json의 프로필에만 있어요. 여기에는 프로필 이름만 골라요. 설비에는 읽기만 해요.",
  });
  sheet.dlg.classList.add("rcp-sheet");
  const d = {
    ftp_profile: source?.ftp_profile ?? profiles[0]?.name ?? "", layout: source?.layout ?? "folder",
    enabled: source?.enabled ?? true,
    rules: (source?.name_filter ?? []).map((r) => ({ ...r })),
  };
  const name = textInput(source?.name, "예: LINE1 · EQ-A01");
  const vendor = textInput(source?.vendor, "설비사");
  const model = textInput(source?.model, "모델");
  const equipment = textInput(source?.equipment, "예: EQ-A01");
  const line = textInput(source?.line, "예: LINE-1");
  const remote = textInput(source?.remote_dir, "예: /recipes");
  const globs = textInput((source?.file_globs ?? []).join(", "), "비우면 모든 파일 · 예: *.xml, params/*.ini");

  const err = el("div", "mos-error");
  err.hidden = true;
  err.setAttribute("role", "alert");

  const grid = el("div", "rcp-grid");
  grid.append(field("소스 이름", name), field("설비", equipment), field("라인", line), field("설비사", vendor), field("모델", model));

  const connBox = el("div", "rcp-block");
  const profileHost = el("div");
  function paintProfiles() {
    if (!profiles.length) {
      profileHost.replaceChildren(el("p", "mos-hint", "config/local.json에 FTP 프로필이 없어요. recipe_ftp.profiles에 프로필을 추가하면 여기에 나타나요."));
      return;
    }
    const row = chipRow(profiles.map((p) => [p.name, p.name, `${p.encoding} · ${p.passive ? "수동" : "능동"} 모드`]), d.ftp_profile, (v) => { d.ftp_profile = v; paintProfiles(); });
    row.setAttribute("aria-label", "FTP 프로필");
    profileHost.replaceChildren(row);
  }
  paintProfiles();
  const layoutHost = el("div");
  function paintLayout() {
    const row = chipRow(LAYOUTS, d.layout, (v) => { d.layout = v; paintLayout(); });
    row.setAttribute("aria-label", "레시피 단위");
    layoutHost.replaceChildren(row);
  }
  paintLayout();
  connBox.append(field("FTP 프로필", profileHost), field("경로", remote), field("레시피 단위", layoutHost,
    "폴더: 하위 폴더 하나가 레시피예요. 파일: 파일 하나가 레시피예요."), field("파일 패턴", globs, "폴더 안에서 받을 파일(쉼표로 구분, 대소문자 무시)."));

  // ---- name filter with live preview
  const filterBox = el("div", "rcp-block");
  filterBox.append(el("h3", "rcp-h", "이름 필터"));
  filterBox.append(el("p", "mos-hint", "포함 규칙이 하나라도 맞으면 가져오고, 제외 규칙이 하나라도 맞으면 뺍니다. 대소문자는 구분하지 않아요. 패턴은 * ? 만 써요 (정규식 없음)."));
  const rulesHost = el("div", "rcp-rulelist");
  const addRule = button("규칙 추가", "sm", () => { d.rules.push({ type: "contains", value: "", exclude: false }); paintRules(); rulesHost.querySelector(".rcp-rule-row:last-child .mos-in")?.focus(); });
  addRule.prepend(svg("plus", "i s"));

  const names = el("textarea", "mos-in rcp-names");
  names.rows = 6;
  names.placeholder = "미리볼 레시피 이름을 한 줄에 하나씩 적거나, 위의 ‘목록 불러오기’로 설비에서 가져와요.";
  names.setAttribute("aria-label", "미리볼 레시피 이름");
  const loadBtn = button("목록 불러오기", "sm", async () => {
    err.hidden = true;
    if (!d.ftp_profile) { showErr("FTP 프로필을 먼저 골라 주세요."); return; }
    loadBtn.disabled = true;
    loadBtn.textContent = "불러오는 중…";
    try {
      const r = await api.previewRecipeList({ ftp_profile: d.ftp_profile, remote_dir: remote.value.trim(), layout: d.layout });
      names.value = r.names.join("\n");
      listInfo.textContent = `설비에서 ${num(r.total)}개를 읽었어요${r.total > r.names.length ? ` (앞 ${num(r.names.length)}개만)` : ""}${r.rejected ? ` · 안전하지 않은 이름 ${r.rejected}개 제외` : ""}${r.list_fallback ? " · LIST 방식" : ""}. 파일은 받지 않았어요.`;
      refreshPreview();
    } catch (e) {
      showErr(e.message);
    } finally {
      loadBtn.disabled = !enabled;
      loadBtn.textContent = "목록 불러오기";
    }
  });
  loadBtn.disabled = !enabled;
  loadBtn.title = enabled ? "" : "RCP 수집이 꺼져 있어요 · 켜면 설비에서 목록을 읽을 수 있어요";
  const listInfo = el("p", "mos-hint", enabled ? "" : "RCP 수집이 꺼져 있어서 설비에서 목록을 읽을 수 없어요. 이름을 직접 적어 필터를 시험해 볼 수 있어요.");
  const previewHost = el("div", "rcp-preview");
  previewHost.setAttribute("aria-live", "polite");

  function paintRules() {
    const rows = d.rules.map((rule, i) => {
      const row = el("div", "rcp-rule-row");
      const types = chipRow(RULE_TYPES, rule.type, (v) => { rule.type = v; paintRules(); refreshPreview(); }, "rcp-types");
      types.setAttribute("aria-label", "규칙 종류");
      const input = textInput(rule.value, rule.type === "glob" ? "예: aabb_*" : "예: aabb");
      input.setAttribute("aria-label", "규칙 값");
      input.addEventListener("input", () => { rule.value = input.value; refreshPreview(); });
      const ex = toggleChip("제외", rule.exclude, (v) => { rule.exclude = v; refreshPreview(); });
      const rm = el("button", "ib", "");
      rm.type = "button";
      rm.setAttribute("aria-label", "규칙 지우기");
      rm.append(svg("x"));
      rm.addEventListener("click", () => { d.rules.splice(i, 1); paintRules(); refreshPreview(); });
      row.append(types, input, ex, rm);
      return row;
    });
    rulesHost.replaceChildren(...(rows.length ? rows : [el("p", "mos-hint", "규칙이 없으면 모든 레시피를 가져와요.")]));
  }
  paintRules();

  let seq = 0;
  const refreshPreview = debounce(async () => {
    const list = splitNames(names.value);
    const mine = ++seq;
    if (!list.length) { previewHost.replaceChildren(el("p", "mos-hint", "이름을 적으면 이 필터에 어떤 레시피가 걸리는지 바로 보여 드려요.")); return; }
    try {
      const out = await api.previewRecipeFilter(cleanRules(d.rules), list);
      if (mine !== seq) return;
      const hit = out.items.filter((i) => i.match).length;
      const head = el("p", "rcp-pcount");
      head.append(el("b", "", `${num(hit)}개`), ` 일치 / 전체 ${num(out.items.length)}개`);
      const ul = el("ul", "rcp-plist");
      for (const it of out.items.slice(0, 300)) {
        const li = el("li", it.match ? "yes" : "no");
        li.append(svg(it.match ? "check" : "x", "i s"), el("span", "", it.name), el("em", "", it.match ? "가져옴" : "건너뜀"));
        ul.append(li);
      }
      previewHost.replaceChildren(head, ul);
      if (out.items.length > 300) previewHost.append(el("p", "mos-hint", "앞 300개만 보여 줘요."));
    } catch (e) {
      if (mine === seq) previewHost.replaceChildren(el("p", "mos-error", e.message));
    }
  }, 250);
  names.addEventListener("input", refreshPreview);
  refreshPreview();

  const tools = el("div", "rcp-ptools");
  tools.append(addRule, loadBtn);
  filterBox.append(rulesHost, tools, el("h3", "rcp-h sm", "미리보기"), names, listInfo, previewHost);

  const enabledHost = el("div", "rcp-block row");
  const enabledChip = toggleChip(d.enabled ? "이 소스 사용" : "이 소스 꺼짐", d.enabled, (v) => { d.enabled = v; enabledChip.textContent = v ? "이 소스 사용" : "이 소스 꺼짐"; });
  enabledHost.append(enabledChip);

  function showErr(message) {
    err.textContent = message;
    err.hidden = false;
    err.scrollIntoView({ block: "nearest" });
  }

  sheet.body.append(err, grid, connBox, filterBox, enabledHost);
  const cancel = button("취소", "", () => sheet.close());
  const save = button(isNew ? "추가" : "저장", "pri", async () => {
    err.hidden = true;
    const payload = {
      name: name.value.trim(), vendor: vendor.value.trim(), model: model.value.trim(), equipment: equipment.value.trim(),
      line: line.value.trim(), ftp_profile: d.ftp_profile, remote_dir: remote.value.trim(), layout: d.layout,
      name_filter: cleanRules(d.rules), file_globs: splitList(globs.value), enabled: d.enabled,
    };
    save.disabled = true;
    try {
      const saved = isNew ? await api.createRecipeSource(payload) : await api.patchRecipeSource(source.id, payload);
      sheet.close();
      toast(isNew ? "소스를 추가했어요" : "저장했어요");
      onSaved?.(saved);
    } catch (e) {
      showErr(e.message);
      save.disabled = false;
    }
  });
  sheet.foot.append(cancel, save);
  name.focus();
}
