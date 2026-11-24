// DOI library (P5-02): image-card gallery + table, filter chips, detail panel, add/edit sheet.
// Everything is local: images are uploaded to the app, thumbnails are drawn on a canvas in the browser.
import { api } from "./api.js";
import {
  facets, filterItems, gridMove, metaLine, move, originLabel, parseTags, pickImage, sortItems, suggestions, thumbSize, toggle,
} from "./doi-model.js";
import { decode, drawThumb } from "./doi-thumb.js";
import { openDoiImport } from "./doi-import.js";
import { openDoiExport, openDoiPackageImport } from "./doi-package.js";
import { formatSize, formatStamp } from "./plans-model.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, emptyState, errorState, skeleton, store, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");
const imgUrl = (img) => `/api/doi-images/${img.id}/file?v=${img.sha256.slice(0, 8)}`;
const thumbUrl = (img) => `/api/doi-images/${img.id}/thumb?v=${img.sha256.slice(0, 8)}${img.thumb_path ? "t" : ""}`;
const COLUMNS = [
  ["title", "제목"], ["product", "제품"], ["step", "Step"], ["defect_type", "결함 종류"], ["images", "이미지"], ["updated_at", "수정"],
];
const MAX_IMAGES = 40;
const MAX_BYTES = 25 * 1024 * 1024;
const drawerMode = () => window.matchMedia("(max-width: 1239px)").matches;

// ---- image helpers (browser side only) -----------------------------------------------------------------------

function fallbackTile(label = "이미지를 불러오지 못했어요") {
  const box = el("span", "doi-noimg");
  box.append(svg("image"), el("span", "", label));
  return box;
}

// <img> that swaps itself for a placeholder when the file is missing (e.g. moved out of the data folder).
function picture(src, alt, cls, onFail = "이미지를 불러오지 못했어요") {
  const img = el("img", cls);
  img.alt = alt;
  img.decoding = "async";
  img.loading = "lazy";
  img.src = src;
  img.addEventListener("error", () => img.replaceWith(fallbackTile(onFail)), { once: true });
  return img;
}

// ---- screen --------------------------------------------------------------------------------------------------

export async function renderDoi(host, selectedId) {
  const st = {
    items: [], trash: false, view: store.get("doi.view", "grid") === "table" ? "table" : "grid",
    query: "", product: "", step: "", defect: "", tags: [], draftsOnly: false,
    sort: { key: "updated_at", dir: "desc" }, selected: selectedId, imageId: null, hasAny: true,
  };
  const page = el("div", "page doi");
  const hero = el("div", "hero doi-hero");
  const title = el("div", "grow");
  title.append(el("div", "eyebrow", "MI 정보"), el("h1", "h1", "DOI 라이브러리"));
  title.append(el("p", "lead", "Defect of Interest를 이미지와 함께 모아 두고, 제품·Step·결함 종류로 바로 찾아요."));
  const addBtn = button("DOI 추가", "pri", () => openForm());
  addBtn.prepend(svg("plus"));
  const importBtn = button("PPT에서 가져오기", "", () => openDoiImport({ onDone: afterImport }));
  importBtn.prepend(svg("upload"));
  const heroActions = el("div", "doi-hero-actions");
  const pkgImportBtn = button("패키지 가져오기", "", () => openDoiPackageImport({ onDone: afterPackage }));
  pkgImportBtn.prepend(svg("upload"));
  pkgImportBtn.title = "다른 사람이 내보낸 DOI 공유 패키지(.zip) 가져오기";
  const pkgExportBtn = button("패키지 내보내기", "", () => exportPackage());
  pkgExportBtn.prepend(svg("download"));
  pkgExportBtn.title = "DOI를 이미지와 함께 공유 패키지(.zip)로 내보내기";
  heroActions.append(importBtn, pkgImportBtn, pkgExportBtn, addBtn);
  hero.append(title, heroActions);

  const tools = el("div", "doi-tools");
  const search = el("input", "doi-search");
  search.type = "search";
  search.placeholder = "제목·설명·태그·이미지 설명 찾기";
  search.setAttribute("aria-label", "DOI 찾기");
  search.autocomplete = "off";
  const viewGroup = el("div", "chips doi-views");
  viewGroup.setAttribute("role", "group");
  viewGroup.setAttribute("aria-label", "보기 방식");
  const trashChip = el("button", "chip", "휴지통");
  trashChip.type = "button";
  trashChip.prepend(svg("trash"));
  const count = el("span", "doi-count");
  count.setAttribute("role", "status");
  count.setAttribute("aria-live", "polite");
  tools.append(search, viewGroup, trashChip, count);

  const filters = el("div", "doi-filters");
  filters.setAttribute("aria-label", "필터");
  const split = el("div", "doi-split");
  const listHost = el("section", "doi-list");
  listHost.setAttribute("aria-label", "DOI 목록");
  const scrim = el("div", "doi-scrim");
  scrim.hidden = true;
  const panel = el("aside", "doi-panel");
  panel.setAttribute("aria-label", "DOI 상세");
  panel.hidden = true;
  split.append(listHost, scrim, panel);
  page.append(hero, tools, filters, split);
  host.replaceChildren(page);
  listHost.append(skeleton(4));

  // -- data --
  async function load() {
    st.items = await api.doiList(st.trash);
    if (!st.trash) st.hasAny = st.items.length > 0;
    else st.hasAny = true;
    if (st.selected != null && !st.items.some((i) => i.id === st.selected)) {
      if (selectedId === st.selected) toast("그 DOI는 목록에 없어요. 휴지통에 있거나 지워졌을 수 있어요.", { error: true });
      st.selected = null;
      setHash(null);
    }
    paint();
  }
  const fail = (e) => listHost.replaceChildren(errorState(e.message, () => load().catch(fail)));

  const current = () => st.items.find((i) => i.id === st.selected) ?? null;
  const state = () => ({ query: st.query, product: st.product, step: st.step, defect: st.defect, tags: st.tags, draftsOnly: st.draftsOnly });
  const hasFilter = () => Boolean(st.query.trim() || st.product || st.step || st.defect || st.tags.length || st.draftsOnly);
  function setHash(id) {
    history.replaceState(null, "", id == null ? "#/doi" : `#/doi/${id}`);
  }

  // -- painting --
  function paint() {
    paintTools();
    paintFilters();
    paintList();
    paintPanel();
  }

  function paintTools() {
    viewGroup.replaceChildren();
    for (const [value, label, icon] of [["grid", "카드", "grid"], ["table", "표", "rows"]]) {
      const b = el("button", "chip", label);
      b.type = "button";
      b.prepend(svg(icon));
      b.setAttribute("aria-pressed", String(st.view === value));
      b.addEventListener("click", () => { st.view = value; store.set("doi.view", value); paint(); });
      viewGroup.append(b);
    }
    trashChip.setAttribute("aria-pressed", String(st.trash));
    trashChip.title = st.trash ? "휴지통을 닫고 목록으로" : "휴지통에 있는 DOI 보기";
  }

  function paintFilters() {
    filters.replaceChildren();
    if (!st.items.length) return;
    const f = facets(st.items, state());
    const group = (label, items, current, pick) => {
      if (!items.length) return;
      const g = el("div", "fgroup");
      g.setAttribute("role", "group");
      g.setAttribute("aria-label", label);
      g.append(el("span", "k", label));
      const all = el("button", "chip", "전체");
      all.type = "button";
      all.setAttribute("aria-pressed", String(!current));
      all.addEventListener("click", () => pick(""));
      g.append(all);
      for (const [value, n] of items) {
        const b = el("button", "chip");
        b.type = "button";
        b.append(document.createTextNode(value), el("span", "n", num(n)));
        b.setAttribute("aria-pressed", String(current === value));
        b.setAttribute("aria-label", `${value} ${n}개`);
        b.addEventListener("click", () => pick(current === value ? "" : value));
        g.append(b);
      }
      filters.append(g);
    };
    group("제품", f.products, st.product, (v) => { st.product = v; st.step = ""; paint(); });
    group("Step", f.steps, st.step, (v) => { st.step = v; paint(); });
    group("결함 종류", f.defects, st.defect, (v) => { st.defect = v; paint(); });
    if (f.tags.length || st.tags.length) {
      const g = el("div", "fgroup");
      g.setAttribute("role", "group");
      g.setAttribute("aria-label", "태그 (여러 개 고르면 모두 가진 DOI)");
      g.append(el("span", "k", "태그"));
      const names = new Set(f.tags.map((t) => t[0]));
      const list = [...f.tags, ...st.tags.filter((t) => !names.has(t)).map((t) => [t, 0])];
      for (const [tag, n] of list) {
        const b = el("button", "chip tag");
        b.type = "button";
        b.append(document.createTextNode(`#${tag}`), el("span", "n", num(n)));
        b.setAttribute("aria-pressed", String(st.tags.includes(tag)));
        b.setAttribute("aria-label", `태그 ${tag} ${n}개`);
        b.addEventListener("click", () => { st.tags = toggle(st.tags, tag); paint(); });
        g.append(b);
      }
      filters.append(g);
    }
    if (!st.trash && st.items.some((i) => i.status === "draft")) {
      const g = el("div", "fgroup");
      const b = el("button", "chip", "초안만 보기");
      b.type = "button";
      b.setAttribute("aria-pressed", String(st.draftsOnly));
      b.addEventListener("click", () => { st.draftsOnly = !st.draftsOnly; paint(); });
      g.append(b);
      if (st.draftsOnly) {
        const drafts = filterItems(st.items, state()).filter((i) => i.status === "draft");
        if (drafts.length) g.append(button(`보이는 초안 ${drafts.length}개 모두 확정`, "sm", () => confirmDrafts(drafts)));
      }
      filters.append(g);
    }
    if (hasFilter()) {
      const clear = el("button", "linkbtn", "필터 모두 지우기");
      clear.type = "button";
      clear.addEventListener("click", clearFilters);
      filters.append(clear);
    }
  }

  function clearFilters() {
    Object.assign(st, { query: "", product: "", step: "", defect: "", tags: [], draftsOnly: false });
    search.value = "";
    paint();
  }

  function shownItems() {
    const rows = filterItems(st.items, state());
    return st.view === "table" ? sortItems(rows, st.sort.key, st.sort.dir) : rows;
  }

  function paintList() {
    const rows = shownItems();
    count.textContent = hasFilter() ? `${num(rows.length)} / ${num(st.items.length)}개` : `${num(st.items.length)}개`;
    split.classList.toggle("has-panel", Boolean(current()));
    if (!rows.length) {
      listHost.replaceChildren(emptyView());
      return;
    }
    listHost.replaceChildren(st.view === "table" ? tableView(rows) : gridView(rows));
  }

  function emptyView() {
    if (st.trash && !st.items.length) {
      return emptyState({ title: "휴지통이 비어 있어요", icon: "trash", desc: "지운 DOI는 이곳에 남아 있다가 언제든 되돌릴 수 있어요." });
    }
    if (!st.hasAny && !hasFilter()) {
      return emptyState({
        title: "아직 DOI가 없어요", icon: "image",
        desc: "결함 이미지를 끌어놓거나 붙여넣어 첫 DOI를 만들어 보세요. 이미지는 이 PC의 data 폴더에만 저장돼요.",
        action: { label: "DOI 추가", run: () => openForm() },
      });
    }
    return emptyState({
      title: "조건에 맞는 DOI가 없어요", icon: "search", desc: "필터를 줄이거나 다른 단어로 찾아 보세요.",
      action: { label: "필터 모두 지우기", run: clearFilters },
    });
  }

  function badges(item) {
    const out = [];
    if (item.status === "draft") out.push(el("span", "doi-badge draft", "초안"));
    const o = originLabel(item);
    if (o) {
      const b = el("span", "doi-badge imported");
      b.append(svg("lock", "i"), o);
      out.push(b);
    }
    return out;
  }

  function gridView(rows) {
    const ul = el("ul", "doi-grid");
    for (const item of rows) {
      const li = el("li");
      const card = el("button", "doi-card");
      card.type = "button";
      card.dataset.id = String(item.id);
      if (item.id === st.selected) card.setAttribute("aria-current", "true");
      card.setAttribute("aria-label", [item.title, metaLine(item), item.defect_type, `이미지 ${item.images.length}장`].filter(Boolean).join(", "));
      const thumb = el("span", "doi-thumb");
      const cover = item.images[0];
      thumb.append(cover ? picture(thumbUrl(cover), "", "doi-img") : fallbackTile("이미지 없음"));
      if (item.images.length > 1) {
        const n = el("span", "doi-n");
        n.append(svg("image", "i"), String(item.images.length));
        thumb.append(n);
      }
      const body = el("span", "doi-card-b");
      body.append(el("b", "doi-card-t", item.title));
      const meta = metaLine(item);
      if (meta) body.append(el("span", "doi-card-m", meta));
      const foot = el("span", "doi-card-f");
      if (item.defect_type) foot.append(el("span", "doi-type", item.defect_type));
      for (const b of badges(item)) foot.append(b);
      for (const t of item.tags.slice(0, 3)) foot.append(el("span", "doi-tag", `#${t}`));
      if (item.tags.length > 3) foot.append(el("span", "doi-tag more", `+${item.tags.length - 3}`));
      if (foot.childElementCount) body.append(foot);
      card.append(thumb, body);
      card.addEventListener("click", () => select(item.id));
      li.append(card);
      ul.append(li);
    }
    ul.addEventListener("keydown", (e) => {
      const cur = e.target.closest?.(".doi-card");
      if (!cur || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
      const cards = [...ul.querySelectorAll(".doi-card")];
      const top = cards[0].getBoundingClientRect().top;
      const cols = Math.max(1, cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 4).length);
      const next = gridMove(cards.indexOf(cur), e.key, cols, cards.length);
      if (next >= 0 && cards[next] !== cur) { e.preventDefault(); cards[next].focus(); }
      else e.preventDefault();
    });
    return ul;
  }

  function tableView(rows) {
    const wrap = el("div", "doi-tablewrap");
    wrap.tabIndex = 0;
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", "DOI 표");
    const table = el("table", "doi-table");
    const head = el("tr");
    const th0 = el("th", "pic");
    th0.scope = "col";
    th0.append(el("span", "sr-only", "대표 이미지"));
    head.append(th0);
    for (const [key, label] of COLUMNS) {
      const th = el("th", (key === "images" ? "n" : "") + (key === "images" || key === "updated_at" ? " opt" : ""));
      th.scope = "col";
      const active = st.sort.key === key;
      th.setAttribute("aria-sort", active ? (st.sort.dir === "asc" ? "ascending" : "descending") : "none");
      const b = el("button", "doi-sort", label);
      b.type = "button";
      if (active) b.append(el("span", "arrow", st.sort.dir === "asc" ? "▲" : "▼"));
      b.addEventListener("click", () => {
        st.sort = { key, dir: active && st.sort.dir === "asc" ? "desc" : key === "updated_at" || key === "images" ? "desc" : "asc" };
        paintList();
        listHost.querySelector(`.doi-sort[data-k="${key}"]`)?.focus();
      });
      b.dataset.k = key;
      th.append(b);
      head.append(th);
    }
    const thead = el("thead");
    thead.append(head);
    const tbody = el("tbody");
    for (const item of rows) {
      const tr = el("tr");
      tr.dataset.id = String(item.id);
      if (item.id === st.selected) tr.setAttribute("aria-selected", "true");
      const pic = el("td", "pic");
      const cover = item.images[0];
      pic.append(cover ? picture(thumbUrl(cover), "", "doi-mini") : el("span", "doi-mini none"));
      const t = el("td", "t");
      const link = el("button", "doi-link", item.title);
      link.type = "button";
      link.setAttribute("aria-label", `${item.title} 상세 열기`);
      link.addEventListener("click", (e) => { e.stopPropagation(); select(item.id); });
      t.append(link, ...badges(item));
      tr.append(pic, t, el("td", "", item.product), el("td", "", item.step), el("td", "", item.defect_type),
        el("td", "n opt", String(item.images.length)), el("td", "d opt", formatStamp(item.updated_at).slice(0, 10)));
      tr.addEventListener("click", () => select(item.id));
      tbody.append(tr);
    }
    table.append(thead, tbody);
    wrap.append(table);
    return wrap;
  }

  // -- selection + panel --
  function select(id, { focusPanel = false } = {}) {
    st.selected = id;
    st.imageId = null;
    setHash(id);
    paintList();
    paintPanel();
    if (id != null && (focusPanel || drawerMode())) panel.querySelector(".doi-close")?.focus();
  }

  function closePanel() {
    const id = st.selected;
    select(null);
    listHost.querySelector(`[data-id="${id}"]`)?.focus();
  }
  scrim.addEventListener("click", closePanel);
  page.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && st.selected != null && !e.defaultPrevented && !document.querySelector("dialog[open]")) {
      if (e.target === search && search.value) return;
      closePanel();
    }
  });

  function paintPanel() {
    const item = current();
    panel.hidden = !item;
    scrim.hidden = !item || !drawerMode();
    if (!item) { panel.replaceChildren(); return; }
    panel.replaceChildren(panelView(item));
  }

  function panelView(item) {
    const wrap = el("div", "doi-pv");
    const head = el("header", "doi-ph");
    const h = el("h2", "", item.title);
    const close = el("button", "ib doi-close");
    close.type = "button";
    close.setAttribute("aria-label", "상세 닫기");
    close.append(svg("x"));
    close.addEventListener("click", closePanel);
    head.append(h, close);
    wrap.append(head);
    const bs = badges(item);
    if (bs.length) {
      const row = el("div", "doi-badges");
      row.append(...bs);
      wrap.append(row);
    }
    if (item.status === "draft" && !item.deleted) {
      const banner = el("div", "doi-draftbar");
      banner.append(svg("alert"), el("span", "", "PPT에서 만든 초안이에요. 이미지와 내용을 확인하고 확정하면 초안 표시가 사라져요."));
      banner.append(button("초안 확정", "pri sm", () => confirmDrafts([item])));
      wrap.append(banner);
    }
    wrap.append(viewer(item));

    const dl = el("dl", "doi-dl");
    const row = (k, v) => {
      if (v == null || v === "" || (v instanceof Node && !v.textContent)) return;
      const box = el("div", "doi-row");
      const dd = el("dd");
      if (v instanceof Node) dd.append(v); else dd.textContent = v;
      box.append(el("dt", "", k), dd);
      dl.append(box);
    };
    row("제품", item.product);
    let plan = item.plan;
    if (item.plan && item.plan_id) {
      plan = el("a", "doi-a", item.plan);
      plan.href = `#/plans/${item.plan_id}`;
      plan.title = "Plan · Step 표에서 보기";
    }
    row("Plan", plan);
    row("Step", item.step);
    row("결함 종류", item.defect_type);
    row("설비·조건", item.tool_condition);
    row("출처", [item.source_dept, item.source_author].filter(Boolean).join(" · "));
    row(item.origin === "imported" ? "가져온 곳" : "가져온 파일", item.source_ref);
    if (item.tags.length) {
      const tags = el("div", "doi-taglist");
      for (const t of item.tags) {
        const b = el("button", "chip tag", `#${t}`);
        b.type = "button";
        b.title = "이 태그로 거르기";
        b.addEventListener("click", () => { if (!st.tags.includes(t)) st.tags = [...st.tags, t]; paint(); });
        tags.append(b);
      }
      row("태그", tags);
    }
    if (item.description) {
      const d = el("p", "doi-desc", item.description);
      row("설명", d);
    }
    row("수정", formatStamp(item.updated_at));
    wrap.append(dl);

    const actions = el("div", "doi-actions");
    if (item.deleted) {
      const r = button("되돌리기", "pri", () => restore(item));
      actions.append(r);
    } else {
      const edit = button("편집", "", () => openForm(item));
      edit.prepend(svg("edit"));
      if (item.origin === "imported") {
        edit.disabled = true;
        edit.title = "가져온 DOI는 읽기 전용이에요";
      }
      const del = button("휴지통으로", "quiet danger", () => trash(item));
      del.prepend(svg("trash"));
      actions.append(edit, del);
      if (item.status !== "draft") {
        const share = button("패키지로 내보내기", "quiet", () => exportPackage(item));
        share.prepend(svg("download"));
        actions.append(share);
      }
    }
    wrap.append(actions);
    if (item.origin === "imported") wrap.append(el("p", "doi-note", "가져온 DOI는 읽기 전용이에요. 출처 정보를 그대로 보존하기 위해서예요."));
    return wrap;
  }

  function viewer(item) {
    const box = el("div", "doi-viewer");
    if (!item.images.length) {
      box.append(emptyTile(item));
      return box;
    }
    const active = pickImage(item.images, st.imageId);
    st.imageId = active.id;
    const idx = item.images.indexOf(active);
    const stage = el("div", "doi-stage");
    const open = el("button", "doi-zoom");
    open.type = "button";
    open.setAttribute("aria-label", `이미지 크게 보기 ${idx + 1} / ${item.images.length}`);
    open.append(picture(imgUrl(active), active.caption || item.title, "doi-big"));
    open.addEventListener("click", () => openLightbox(item, idx));
    stage.append(open);
    if (item.images.length > 1) {
      for (const [dir, label] of [[-1, "이전 이미지"], [1, "다음 이미지"]]) {
        const b = el("button", `doi-nav ${dir < 0 ? "prev" : "next"}`);
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.append(svg("chev"));
        b.addEventListener("click", () => {
          st.imageId = item.images[(idx + dir + item.images.length) % item.images.length].id;
          paintPanel();
          panel.querySelector(`.doi-nav.${dir < 0 ? "prev" : "next"}`)?.focus();
        });
        stage.append(b);
      }
    }
    box.append(stage);
    box.append(el("p", "doi-cap", active.caption || (item.images.length > 1 ? `${idx + 1} / ${item.images.length}` : "")));
    if (item.images.length > 1) {
      const strip = el("div", "doi-strip");
      strip.setAttribute("role", "group");
      strip.setAttribute("aria-label", "이미지 고르기");
      item.images.forEach((img, i) => {
        const b = el("button", "doi-st");
        b.type = "button";
        b.setAttribute("aria-label", `이미지 ${i + 1}${img.caption ? `: ${img.caption}` : ""}`);
        b.setAttribute("aria-pressed", String(img.id === active.id));
        b.append(picture(thumbUrl(img), "", "doi-img"));
        b.addEventListener("click", () => { st.imageId = img.id; paintPanel(); panel.querySelectorAll(".doi-st")[i]?.focus(); });
        strip.append(b);
      });
      box.append(strip);
    }
    return box;
  }

  function emptyTile(item) {
    const t = el("div", "doi-emptytile");
    t.append(svg("image"), el("span", "", "이미지가 없어요"));
    if (!item.deleted && item.origin !== "imported") {
      const b = button("이미지 추가", "sm", () => openForm(item));
      t.append(b);
    }
    return t;
  }

  // -- actions --
  async function confirmDrafts(list) {
    try {
      for (const d of list) await api.doiPatch(d.id, { status: "ready" });
      if (!st.items.some((i) => i.status === "draft" && !list.includes(i))) st.draftsOnly = false;
      await load();
      toast(list.length === 1 ? "초안을 확정했어요" : `초안 ${list.length}개를 확정했어요`);
    } catch (e) { toast(e.message, { error: true }); }
  }

  function exportPackage(only = null) {
    if (st.trash && !only) { toast("휴지통에서는 내보낼 수 없어요. 목록으로 돌아가 주세요.", { error: true }); return; }
    const scopes = [];
    if (only) scopes.push({ key: "open", label: "지금 연 DOI", items: [only] });
    scopes.push({ key: "shown", label: hasFilter() ? "필터에 보이는 DOI" : "보이는 DOI", items: shownItems() });
    if (hasFilter()) scopes.push({ key: "all", label: "전체", items: st.items });
    openDoiExport({ scopes: st.trash ? scopes.slice(0, 1) : scopes, initial: only ? "open" : "shown" });
  }

  async function afterPackage() {
    if (st.trash) st.trash = false;
    Object.assign(st, { product: "", step: "", defect: "", tags: [], query: "", draftsOnly: false });
    search.value = "";
    try { await load(); } catch (e) { fail(e); }
  }

  async function afterImport({ created }) {
    if (st.trash) st.trash = false;
    Object.assign(st, { product: "", step: "", defect: "", tags: [], query: "", draftsOnly: created > 0 });
    search.value = "";
    try { await load(); } catch (e) { fail(e); }
    if (created) toast(`초안 ${created}개가 만들어졌어요. 확인하고 ‘초안 확정’을 눌러 주세요.`);
  }

  async function trash(item) {
    try {
      await api.doiTrash(item.id);
      st.selected = null;
      setHash(null);
      await load();
      toast("휴지통으로 옮겼어요", { action: { label: "되돌리기", run: () => restore(item, true) } });
    } catch (e) { toast(e.message, { error: true }); }
  }

  async function restore(item, fromToast = false) {
    try {
      await api.doiRestore(item.id);
      await load();
      if (!fromToast) toast("되돌렸어요");
    } catch (e) { toast(e.message, { error: true }); }
  }

  function openForm(item = null) {
    openDoiForm({
      item, items: st.items,
      onSaved: async (id) => {
        if (st.trash) st.trash = false;
        try {
          await load();
          select(id);
        } catch (e) { fail(e); }
      },
    });
  }

  // -- events --
  search.addEventListener("input", () => { st.query = search.value; paintFilters(); paintList(); paintPanel(); });
  search.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && search.value) { search.value = ""; st.query = ""; paint(); e.stopPropagation(); }
  });
  trashChip.addEventListener("click", async () => {
    st.trash = !st.trash;
    st.selected = null;
    setHash(null);
    Object.assign(st, { product: "", step: "", defect: "", tags: [], draftsOnly: false });
    try { await load(); } catch (e) { fail(e); }
  });
  window.matchMedia("(max-width: 1239px)").addEventListener?.("change", () => { if (page.isConnected) paintPanel(); });

  try { await load(); } catch (e) { fail(e); }
}

// ---- lightbox ------------------------------------------------------------------------------------------------

function openLightbox(item, start) {
  const opener = document.activeElement;
  const dlg = el("dialog", "doi-lightbox");
  dlg.setAttribute("aria-label", `${item.title} 이미지`);
  let i = start;
  const stage = el("div", "lb-stage");
  const cap = el("p", "lb-cap");
  cap.setAttribute("aria-live", "polite");
  const close = el("button", "ib lb-close");
  close.type = "button";
  close.setAttribute("aria-label", "닫기");
  close.append(svg("x"));
  close.addEventListener("click", () => dlg.close());
  const nav = (dir) => {
    const b = el("button", `doi-nav ${dir < 0 ? "prev" : "next"}`);
    b.type = "button";
    b.setAttribute("aria-label", dir < 0 ? "이전 이미지" : "다음 이미지");
    b.append(svg("chev"));
    b.addEventListener("click", () => go(dir));
    b.hidden = item.images.length < 2;
    return b;
  };
  function show() {
    const img = item.images[i];
    stage.replaceChildren(picture(imgUrl(img), img.caption || item.title, "lb-img"));
    const dims = img.width && img.height ? ` · ${img.width}×${img.height}` : "";
    cap.textContent = `${i + 1} / ${item.images.length}${img.caption ? ` · ${img.caption}` : ""}${dims} · ${formatSize(img.size)}`;
  }
  function go(dir) { i = (i + dir + item.images.length) % item.images.length; show(); }
  dlg.append(close, nav(-1), stage, nav(1), cap);
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); } else if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target === stage) dlg.close(); });
  dlg.addEventListener("close", () => { dlg.remove(); if (opener && document.contains(opener)) opener.focus(); });
  document.body.append(dlg);
  show();
  dlg.showModal();
}

// ---- add / edit sheet ----------------------------------------------------------------------------------------

const TEXT_KEYS = ["title", "product", "plan", "step", "defect_type", "tool_condition", "source_dept", "source_author", "description"];

function uniq(items, key) { return [...new Set(items.map((i) => i[key]).filter(Boolean))]; }

function openDoiForm({ item, items, onSaved }) {
  const editing = Boolean(item);
  const sheet = openSheet({
    title: editing ? "DOI 편집" : "DOI 추가", wide: true,
    sub: "이미지는 끌어놓거나 붙여넣기(Ctrl+V)로도 넣을 수 있어요. 저장 전에는 아무것도 바뀌지 않아요.",
  });
  sheet.dlg.classList.add("doi-sheet");
  const st = {
    id: item?.id ?? null,
    tags: [...(item?.tags ?? [])],
    imgs: (item?.images ?? []).map((i) => ({ key: `s${i.id}`, id: i.id, img: i, url: thumbUrl(i), caption: i.caption, saved: i.caption })),
    removed: [], busy: false, seq: 0,
  };
  const initial = JSON.stringify([...TEXT_KEYS.map((k) => item?.[k] ?? ""), st.tags, st.imgs.map((i) => i.id)]);
  const inputs = {};
  const body = sheet.body;
  const err = el("div", "mos-error");
  err.hidden = true;
  err.setAttribute("role", "alert");

  const field = (key, label, { area = false, hint = "", sug } = {}) => {
    const wrap = el("label", "mos-field doi-f" + (area ? " wide" : ""));
    const input = el(area ? "textarea" : "input", "mos-in doi-in");
    if (area) input.rows = 4; else input.type = "text";
    input.value = item?.[key] ?? "";
    input.setAttribute("autocomplete", "off");
    input.maxLength = area ? 4000 : key === "title" ? 200 : 120;
    inputs[key] = input;
    wrap.append(el("span", "k", label), input);
    if (hint) wrap.append(el("small", "", hint));
    if (sug) {
      const row = el("span", "doi-sug");
      row.setAttribute("aria-label", `${label} 제안`);
      const refresh = async () => {
        const list = suggestions(await sug(), input.value);
        row.replaceChildren(...list.map((v) => {
          const b = el("button", "chip sm", v);
          b.type = "button";
          b.addEventListener("click", (e) => { e.preventDefault(); input.value = v; input.dispatchEvent(new Event("input")); input.focus(); });
          return b;
        }));
      };
      input.addEventListener("input", () => refresh());
      refresh();
      wrap.append(row);
    }
    return wrap;
  };

  // Plan / Step suggestions: known Plan · Step tables first, then values already used by other DOIs.
  let plansCache = null;
  const plans = async () => (plansCache ??= await api.plans().then((d) => d.items).catch(() => []));
  const stepCache = new Map();
  const stepsOf = async (plan) => {
    if (!stepCache.has(plan.id)) stepCache.set(plan.id, await api.plan(plan.id).then((d) => d.steps.filter((s) => !s.stale)).catch(() => []));
    return stepCache.get(plan.id);
  };
  const planNames = async () => {
    const p = inputs.product.value.trim();
    return [...new Set([...(await plans()).filter((x) => !p || x.product === p).map((x) => x.name), ...uniq(items, "plan")])];
  };
  const stepNames = async () => {
    const p = inputs.product.value.trim();
    const name = inputs.plan.value.trim();
    const plan = (await plans()).find((x) => x.name === name && (!p || x.product === p));
    const own = plan ? (await stepsOf(plan)).map((s) => s.step_code || s.name) : [];
    return [...new Set([...own, ...uniq(items.filter((i) => !name || i.plan === name), "step")])];
  };

  const grid = el("div", "doi-fields");
  grid.append(
    field("title", "제목 (필수)"),
    field("product", "제품", { sug: async () => uniq(items, "product") }),
    field("plan", "Plan", { sug: planNames }),
    field("step", "Step", { sug: stepNames }),
    field("defect_type", "결함 종류", { sug: async () => uniq(items, "defect_type") }),
    field("tool_condition", "검출 설비·조건", { hint: "예: EQ-A01, 모드 B" }),
    field("source_dept", "출처 부서"),
    field("source_author", "작성자"),
    field("description", "설명", { area: true }),
  );
  inputs.title.setAttribute("required", "");
  // product changes which plans/steps are proposed
  inputs.product.addEventListener("input", () => { inputs.plan.dispatchEvent(new Event("input")); inputs.step.dispatchEvent(new Event("input")); });
  inputs.plan.addEventListener("input", () => inputs.step.dispatchEvent(new Event("input")));

  // tags
  const tagBox = el("div", "doi-tags mos-field");
  const tagIn = el("input", "mos-in doi-in");
  tagIn.type = "text";
  tagIn.placeholder = "태그를 쓰고 Enter (쉼표로 여러 개)";
  tagIn.setAttribute("aria-label", "태그 추가");
  const tagList = el("div", "doi-taglist");
  const tagSug = el("div", "doi-sug");
  const allTags = [...new Set(items.flatMap((i) => i.tags))];
  const paintTags = () => {
    tagList.replaceChildren(...st.tags.map((t) => {
      const b = el("button", "chip tag", `#${t}`);
      b.type = "button";
      b.append(svg("x"));
      b.setAttribute("aria-label", `태그 ${t} 빼기`);
      b.addEventListener("click", () => { st.tags = st.tags.filter((x) => x !== t); paintTags(); tagIn.focus(); });
      return b;
    }));
    tagSug.replaceChildren(...suggestions(allTags.filter((t) => !st.tags.includes(t)), tagIn.value.replace(/,.*$/, ""), 10).map((t) => {
      const b = el("button", "chip sm", `#${t}`);
      b.type = "button";
      b.addEventListener("click", () => { st.tags = parseTags(t, st.tags); tagIn.value = ""; paintTags(); tagIn.focus(); });
      return b;
    }));
  };
  const commitTags = () => { if (tagIn.value.trim()) { st.tags = parseTags(tagIn.value, st.tags); tagIn.value = ""; } paintTags(); };
  tagIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitTags(); }
    else if (e.key === "Backspace" && !tagIn.value && st.tags.length) { st.tags = st.tags.slice(0, -1); paintTags(); }
  });
  tagIn.addEventListener("input", paintTags);
  tagIn.addEventListener("blur", commitTags);
  tagBox.append(el("span", "k", "태그"), tagList, tagIn, tagSug);
  paintTags();

  // images
  const picker = el("input");
  picker.type = "file";
  picker.accept = "image/png,image/jpeg,image/gif,image/webp,image/bmp";
  picker.multiple = true;
  picker.hidden = true;
  const drop = el("div", "pl-drop doi-drop");
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  drop.setAttribute("aria-label", "이미지 고르기, 끌어놓기 또는 붙여넣기");
  const dropText = el("div", "pl-drop-t");
  dropText.append(el("b", "", "이미지를 끌어놓거나 눌러서 고르세요"), el("span", "", "붙여넣기(Ctrl+V)도 돼요 · PNG·JPG·GIF·WEBP·BMP · 장당 25MB까지"));
  drop.append(svg("image"), dropText);
  const tiles = el("ul", "doi-tiles");
  tiles.setAttribute("aria-label", "이미지 목록");
  const imgNote = el("p", "mos-hint");
  imgNote.setAttribute("role", "status");
  imgNote.setAttribute("aria-live", "polite");

  function paintTiles() {
    tiles.replaceChildren(...st.imgs.map((m, i) => {
      const li = el("li", "doi-tile");
      const pic = el("span", "doi-tile-pic");
      pic.append(picture(m.url, "", "doi-img", "미리볼 수 없어요"));
      if (i === 0) pic.append(el("span", "doi-cover", "대표"));
      const cap = el("input", "mos-in doi-cap-in");
      cap.type = "text";
      cap.placeholder = "이미지 설명 (선택)";
      cap.value = m.caption;
      cap.maxLength = 200;
      cap.setAttribute("aria-label", `이미지 ${i + 1} 설명`);
      cap.addEventListener("input", () => { m.caption = cap.value; });
      const bar = el("span", "doi-tile-bar");
      const mk = (label, icon, fn, disabled) => {
        const b = el("button", "ib");
        b.type = "button";
        b.disabled = disabled;
        b.title = label;
        b.setAttribute("aria-label", `이미지 ${i + 1} ${label}`);
        b.append(svg(icon));
        b.addEventListener("click", fn);
        return b;
      };
      bar.append(
        mk("앞으로", "arrow-up", () => { st.imgs = move(st.imgs, i, i - 1); paintTiles(); tiles.children[i - 1]?.querySelector(".ib:not(:disabled)")?.focus(); }, i === 0),
        mk("뒤로", "arrow-down", () => { st.imgs = move(st.imgs, i, i + 1); paintTiles(); tiles.children[i + 1]?.querySelector(".ib:not(:disabled)")?.focus(); }, i === st.imgs.length - 1),
        mk("빼기", "x", () => {
          if (m.id) st.removed.push(m.id);
          if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url);
          st.imgs.splice(i, 1);
          paintTiles();
          drop.focus();
        }, false),
      );
      li.append(pic, cap, bar);
      return li;
    }));
    imgNote.textContent = st.imgs.length ? `${st.imgs.length}장 · 맨 앞 이미지가 카드의 대표 이미지예요.` : "";
  }

  async function addFiles(files) {
    const list = [...files].filter((f) => f && (f.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name)));
    const skipped = files.length - list.length;
    let notes = skipped > 0 ? `이미지가 아닌 파일 ${skipped}개는 건너뛰었어요. ` : "";
    for (const file of list) {
      if (st.imgs.length >= MAX_IMAGES) { notes += `이미지는 ${MAX_IMAGES}장까지예요. `; break; }
      if (file.size > MAX_BYTES) { notes += `${file.name || "이미지"}: 25MB보다 커서 건너뛰었어요. `; continue; }
      st.imgs.push({ key: `n${++st.seq}`, file, url: URL.createObjectURL(file), caption: "", saved: "" });
    }
    paintTiles();
    if (notes) imgNote.textContent = notes.trim();
  }
  drop.addEventListener("click", () => picker.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.click(); } });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); addFiles(e.dataTransfer.files); });
  picker.addEventListener("change", () => { addFiles(picker.files); picker.value = ""; });
  sheet.dlg.addEventListener("paste", (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  paintTiles();

  const imgBox = el("div", "doi-imgs");
  imgBox.append(el("span", "k", "이미지"), picker, drop, tiles, imgNote);
  body.append(err, grid, tagBox, imgBox);

  const status = el("span", "mos-savestate");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const cancel = button("취소", "", () => sheet.close());
  const save = button(editing ? "저장" : "만들기", "pri", () => submit());
  sheet.foot.append(status, el("span", "grow"), cancel, save);
  inputs.title.focus();

  // Esc / X / backdrop ask first when there is something to lose.
  const dirty = () => JSON.stringify([...TEXT_KEYS.map((k) => inputs[k].value), st.tags, st.imgs.map((i) => i.id)]) !== initial
    || st.imgs.some((i) => i.file || i.caption !== i.saved) || st.removed.length > 0 || tagIn.value.trim() !== "";
  const realClose = sheet.dlg.close.bind(sheet.dlg);
  let forced = false;
  sheet.dlg.close = (v) => {
    if (forced || st.busy || !dirty() || !sheet.dlg.open) { realClose(v); return; }
    confirmSheet({ title: "저장하지 않고 닫을까요?", sub: "입력한 내용과 고른 이미지가 사라져요.", confirmLabel: "닫기", danger: true })
      .then((ok) => { if (ok) { forced = true; realClose(v); } });
  };
  sheet.dlg.addEventListener("cancel", (e) => { e.preventDefault(); sheet.dlg.close(); });
  sheet.dlg.addEventListener("close", () => { for (const m of st.imgs) if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url); });

  function fail(message) {
    err.textContent = message;
    err.hidden = false;
    status.textContent = "";
    st.busy = false;
    save.disabled = false;
    cancel.disabled = false;
  }

  async function submit() {
    if (st.busy) return;
    commitTags();
    err.hidden = true;
    const title = inputs.title.value.trim();
    if (!title) { fail("제목을 입력해 주세요."); inputs.title.focus(); return; }
    st.busy = true;
    save.disabled = true;
    const payload = Object.fromEntries(TEXT_KEYS.map((k) => [k, inputs[k].value]));
    payload.tags = st.tags;
    let step = "저장하는 중";
    try {
      status.textContent = step;
      const rec = st.id == null ? await api.doiCreate(payload) : await api.doiPatch(st.id, payload);
      st.id = rec.id;
      for (const id of st.removed.splice(0)) await api.doiDeleteImage(st.id, id);
      const todo = st.imgs.filter((m) => m.file);
      let done = 0;
      for (const m of todo) {
        status.textContent = `이미지 올리는 중 ${++done} / ${todo.length}`;
        const dec = await decode(m.file);
        const saved = await api.doiAddImage(st.id, m.file, { width: dec?.w ?? 0, height: dec?.h ?? 0 });
        m.id = saved.id;
        m.file = null;
        m.saved = "";
        if (dec) {
          try { const blob = await drawThumb(dec); if (blob) await api.doiPutThumb(saved.id, blob); } catch { /* the card falls back to the original */ }
          dec.bmp.close?.();
        }
      }
      status.textContent = "정리하는 중";
      for (const m of st.imgs) if (m.id && m.caption.trim() !== (m.saved ?? "").trim()) { await api.doiPatchImage(st.id, m.id, m.caption); m.saved = m.caption; }
      if (st.imgs.length > 1 || todo.length) await api.doiOrder(st.id, st.imgs.map((m) => m.id));
      forced = true;
      realClose();
      toast(editing ? "저장했어요" : "DOI를 만들었어요");
      await onSaved(st.id);
    } catch (e) {
      fail(`${e.message}${st.id != null && !editing ? " (DOI는 만들어졌어요. 다시 ‘저장’을 누르면 이어서 올려요.)" : ""}`);
    }
  }
  sheet.body.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  });
}
