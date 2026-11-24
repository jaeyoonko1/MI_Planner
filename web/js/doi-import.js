// DOI PPT import (P5-03): pick a .pptx -> review every slide (nothing is saved yet) -> create DRAFT DOIs.
// Slide thumbnails are the pictures embedded in the deck; the server stages them and detects duplicates by sha256.
import { api } from "./api.js";
import { parseTags } from "./doi-model.js";
import {
  FILTERS, applyResult, buildDescription, buildPayload, chosenKeys, fallbackTitle, initRows, rebuildDescriptions, slideBadges, summarize, visible,
} from "./doi-import-model.js";
import { decode, drawThumb } from "./doi-thumb.js";
import { formatSize } from "./plans-model.js";
import { button, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, skeleton, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");
const MAX_FILE = 300 * 1024 * 1024;

function note(kind, text) {
  const box = el("div", `di-note ${kind}`, text);
  if (kind === "bad") box.setAttribute("role", "alert");
  return box;
}

export function openDoiImport({ onDone }) {
  const sheet = openSheet({
    title: "PPT에서 DOI 가져오기", wide: true,
    sub: "슬라이드마다 DOI 초안을 하나씩 만들어요. 아래에서 확인하고 ‘만들기’를 누르기 전에는 아무것도 저장되지 않아요.",
    onClose: () => {
      st.closed = true;
      if (st.token && !st.finished) api.doiImportCancel(st.token);
      if (st.created) onDone({ created: st.created });
    },
  });
  sheet.dlg.classList.add("di-sheet");
  const st = {
    created: 0, file: null, token: "", data: null, rows: [], filter: "all", busy: false, closed: false, finished: false, seq: 0,
    opts: { body: true, notes: false }, common: { product: "", plan: "", step: "", source_dept: "", tags: [] }, rowViews: [],
  };

  // ---- file pick ----
  const input = el("input");
  input.type = "file";
  input.accept = ".pptx,.pptm,.ppsx,application/vnd.openxmlformats-officedocument.presentationml.presentation";
  input.hidden = true;
  const drop = el("div", "pl-drop di-drop");
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  const paintDrop = () => {
    drop.replaceChildren(svg("upload"));
    const text = el("div", "pl-drop-t");
    if (st.file) text.append(el("b", "", st.file.name), el("span", "", `${formatSize(st.file.size)} · 눌러서 다른 파일 고르기`));
    else text.append(el("b", "", "PowerPoint 파일(.pptx)을 여기에 끌어놓거나 눌러서 고르세요"), el("span", "", "회사 파일은 이 PC 밖으로 나가지 않아요 · 이미지는 슬라이드에 삽입된 그림만 가져와요"));
    drop.append(text);
    drop.setAttribute("aria-label", st.file ? `선택한 파일 ${st.file.name}. 다른 파일 고르기` : "PowerPoint 파일 고르기");
  };
  paintDrop();
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); choose(e.dataTransfer.files[0]); });
  input.addEventListener("change", () => { choose(input.files[0]); input.value = ""; });

  const area = el("div", "di-area");
  area.setAttribute("aria-live", "polite");
  sheet.body.append(input, drop, area);
  const closeBtn = button("닫기", "", () => sheet.close());
  const make = button("초안 만들기", "pri");
  make.disabled = true;
  sheet.foot.append(closeBtn, make);
  drop.focus();

  async function choose(file) {
    if (!file) return;
    if (/\.ppt$/i.test(file.name)) {
      area.replaceChildren(note("bad", "옛 형식(.ppt)은 읽을 수 없어요. PowerPoint에서 ‘다른 이름으로 저장 → .pptx’로 저장한 뒤 다시 골라 주세요."));
      return;
    }
    if (!/\.(pptx|pptm|ppsx)$/i.test(file.name)) {
      area.replaceChildren(note("bad", "PowerPoint(.pptx) 파일만 가져올 수 있어요."));
      return;
    }
    if (file.size > MAX_FILE) {
      area.replaceChildren(note("bad", `파일이 너무 커요 (${formatSize(file.size)}). 300MB 이하로 나눠서 저장해 주세요.`));
      return;
    }
    const mine = ++st.seq;
    if (st.token) api.doiImportCancel(st.token);
    Object.assign(st, { file, token: "", data: null, rows: [], filter: "all" });
    paintDrop();
    make.disabled = true;
    make.textContent = "초안 만들기";
    area.replaceChildren(progress(`${file.name} 읽는 중…`, formatSize(file.size) + " · 큰 파일은 잠시 걸려요"));
    try {
      const data = await api.doiImportPreview(file);
      if (mine !== st.seq || st.closed) { api.doiImportCancel(data.token); return; }
      st.token = data.token;
      st.data = data;
      st.rows = initRows(data.slides, st.opts);
      paintPreview();
    } catch (e) {
      if (mine !== st.seq) return;
      area.replaceChildren(note("bad", e.message));
    }
  }

  function progress(title, sub) {
    const box = el("div", "di-progress");
    box.append(skeleton(2), el("b", "", title), el("span", "", sub));
    return box;
  }

  // ---- preview ----
  let listHost;
  let statusEl;
  function paintPreview() {
    const { slides, warnings, filename } = st.data;
    const parts = [];
    const total = slides.reduce((n, s) => n + s.images.length, 0);
    const head = el("div", "di-summary");
    head.append(svg("lock", "i s"), el("span", "", `미리보기예요. 슬라이드 ${num(slides.length)}장 · 이미지 ${num(total)}장 · 아직 아무것도 저장되지 않았어요.`));
    parts.push(head);
    for (const w of warnings) parts.push(note("warn", w));

    // shared fields
    const shared = el("fieldset", "di-shared");
    shared.append(el("legend", "", "모든 초안에 함께 넣을 항목 (선택)"));
    const grid = el("div", "di-shared-grid");
    for (const [key, label, ph] of [["product", "제품", "예: PROD-TEST-A"], ["plan", "Plan", "예: PLAN-A1"], ["step", "Step", "예: S0010"], ["source_dept", "출처 부서", ""]]) {
      const f = el("label", "mos-field");
      const i = el("input", "mos-in");
      i.type = "text";
      i.maxLength = 120;
      i.placeholder = ph;
      i.autocomplete = "off";
      i.value = st.common[key];
      i.addEventListener("input", () => { st.common[key] = i.value; });
      f.append(el("span", "k", label), i);
      grid.append(f);
    }
    const tagF = el("label", "mos-field di-tagf");
    const tagIn = el("input", "mos-in");
    tagIn.type = "text";
    tagIn.placeholder = "쉼표로 여러 개 (예: edge, scratch)";
    tagIn.value = st.common.tags.join(", ");
    tagIn.autocomplete = "off";
    tagIn.addEventListener("input", () => { st.common.tags = parseTags(tagIn.value); });
    tagF.append(el("span", "k", "태그"), tagIn);
    grid.append(tagF);
    shared.append(grid);

    const opts = el("div", "di-opts");
    opts.append(el("span", "k", "설명에 넣기"));
    const optChips = el("div", "chips");
    for (const [key, label] of [["body", "슬라이드 본문"], ["notes", "발표자 노트"]]) {
      const c = el("button", "chip", label);
      c.type = "button";
      c.setAttribute("aria-pressed", String(st.opts[key]));
      c.addEventListener("click", () => {
        st.opts[key] = !st.opts[key];
        c.setAttribute("aria-pressed", String(st.opts[key]));
        rebuildDescriptions(st.rows, slides, st.opts);
        st.rowViews.forEach((v) => v.sync());
      });
      optChips.append(c);
    }
    opts.append(optChips, el("span", "mos-hint", "직접 고친 설명은 바뀌지 않아요."));
    shared.append(opts);
    parts.push(shared);

    // toolbar
    const tools = el("div", "di-tools");
    const filters = el("div", "di-filters");
    statusEl = el("span", "di-count");
    statusEl.setAttribute("role", "status");
    const bulk = el("div", "di-bulk");
    bulk.append(
      button("모두 선택", "sm", () => setAll(true)),
      button("모두 해제", "sm", () => setAll(false)),
      button("이미지 있는 것만", "sm", () => { st.rows.forEach((r) => { r.sel = chosenKeys(r).length > 0 && !st.data.slides[r.index - 1].duplicate_slide; }); syncAll(); }),
    );
    tools.append(filters, bulk, statusEl);
    parts.push(tools);

    listHost = el("div", "di-list");
    listHost.setAttribute("role", "list");
    listHost.setAttribute("aria-label", "슬라이드 목록");
    st.rowViews = slides.map((s, i) => rowView(s, st.rows[i]));
    listHost.append(...st.rowViews.map((v) => v.node));
    const empty = el("p", "di-empty", "이 조건에 맞는 슬라이드가 없어요.");
    empty.hidden = true;
    st.emptyEl = empty;
    st.filtersEl = filters;
    parts.push(listHost, empty);
    area.replaceChildren(...parts);
    paintFilters();
    syncAll();
  }

  function paintFilters() {
    const row = chipRow(FILTERS, st.filter, (v) => { st.filter = v; paintFilters(); applyFilter(); });
    row.setAttribute("aria-label", "슬라이드 거르기");
    st.filtersEl.replaceChildren(row);
  }

  function applyFilter() {
    const show = new Set(visible(st.data.slides, st.rows, st.filter).map((s) => s.index));
    let n = 0;
    st.rowViews.forEach((v, i) => {
      const on = show.has(i + 1);
      v.node.hidden = !on;
      if (on) n += 1;
    });
    st.emptyEl.hidden = n > 0;
  }

  function setAll(on) {
    st.rows.forEach((r) => { r.sel = on; });
    syncAll();
  }

  function syncAll() {
    st.rowViews.forEach((v) => v.sync());
    refresh();
  }

  function refresh() {
    const sum = summarize(st.data.slides, st.rows);
    statusEl.textContent = `${num(sum.selected)}장 선택 · 이미지 ${num(sum.images)}장`;
    make.disabled = st.busy || sum.selected === 0;
    make.textContent = sum.selected ? `초안 ${num(sum.selected)}개 만들기` : "초안 만들기";
    applyFilter();
  }

  function rowView(slide, row) {
    const node = el("article", "di-row");
    node.setAttribute("role", "listitem");
    const check = el("button", "di-check");
    check.type = "button";
    check.setAttribute("role", "checkbox");
    check.append(svg("check"));
    const num_ = el("span", "di-num", String(slide.index));

    const pics = el("div", "di-pics");
    const picBtns = new Map();
    pics.setAttribute("role", "group");
    pics.setAttribute("aria-label", `슬라이드 ${slide.index} 이미지`);
    if (!slide.images.length) {
      const none = el("div", "di-nopic");
      none.append(svg("image"), el("span", "", slide.skipped.length ? "가져올 수 있는 그림 없음" : "이미지 없음"));
      pics.append(none);
    }
    for (const img of slide.images) {
      const b = el("button", "di-pic");
      b.type = "button";
      const label = [img.name, img.width ? `${img.width}×${img.height}` : "", formatSize(img.size), img.cropped ? "잘린 그림(원본 전체 가져옴)" : ""].filter(Boolean).join(" · ");
      b.title = `${label}\n누르면 이 이미지를 넣거나 뺍니다`;
      const pic = el("img");
      pic.alt = "";
      pic.loading = "lazy";
      pic.decoding = "async";
      pic.src = `/api/doi-import/${st.token}/image/${img.key}`;
      b.append(pic);
      const tag = img.duplicate ? "이미 있음" : img.repeated ? "반복" : "";
      if (tag) b.append(el("span", "di-pic-tag", tag));
      b.append(el("span", "di-pic-off", "제외"));
      b.addEventListener("click", () => { row.images[img.key] = !row.images[img.key]; if (row.images[img.key] && !row.sel) row.sel = true; sync(); refresh(); });
      picBtns.set(img.key, [b, img]);
      pics.append(b);
    }

    const main = el("div", "di-main");
    const title = el("input", "mos-in di-title");
    title.type = "text";
    title.maxLength = 200;
    title.placeholder = fallbackTitle(slide);
    title.setAttribute("aria-label", `슬라이드 ${slide.index} 제목`);
    title.addEventListener("input", () => { row.title = title.value; });
    const meta = el("div", "di-meta");
    for (const [kind, label] of slideBadges(slide)) meta.append(el("span", `di-badge ${kind}`, label));
    if (slide.duplicate_slide) {
      const a = el("a", "doi-a", `‘${slide.duplicate_slide.title}’ 보기`);
      a.href = `#/doi/${slide.duplicate_slide.doi_id}`;
      a.addEventListener("click", () => sheet.close());
      meta.append(a);
    }
    const doneTag = el("span", "di-badge ok", "초안으로 만듦");
    doneTag.hidden = true;
    meta.prepend(doneTag);
    const skipped = el("ul", "di-skip");
    for (const k of slide.skipped) {
      const li = el("li");
      li.append(el("b", "", k.name || "그림"), document.createTextNode(` — ${k.reason}`));
      skipped.append(li);
    }
    const more = el("button", "linkbtn di-more", "설명·결함 종류");
    more.type = "button";
    more.setAttribute("aria-expanded", "false");
    const detail = el("div", "di-detail");
    detail.hidden = true;
    const defect = el("input", "mos-in");
    defect.type = "text";
    defect.maxLength = 120;
    defect.placeholder = "예: Scratch";
    defect.autocomplete = "off";
    defect.addEventListener("input", () => { row.defect_type = defect.value; });
    const desc = el("textarea", "mos-in");
    desc.rows = 4;
    desc.maxLength = 4000;
    desc.addEventListener("input", () => { row.desc = desc.value; row.descEdited = true; });
    const f1 = el("label", "mos-field");
    f1.append(el("span", "k", "결함 종류"), defect);
    const f2 = el("label", "mos-field");
    f2.append(el("span", "k", "설명"), desc);
    detail.append(f1, f2);
    more.addEventListener("click", () => {
      row.open = !row.open;
      detail.hidden = !row.open;
      more.setAttribute("aria-expanded", String(row.open));
    });
    main.append(title, meta);
    if (slide.skipped.length) main.append(skipped);
    main.append(more, detail);

    check.addEventListener("click", () => { row.sel = !row.sel; sync(); refresh(); });
    node.append(check, num_, pics, main);

    function sync() {
      node.classList.toggle("off", !row.sel);
      node.classList.toggle("done", Boolean(row.done));
      doneTag.hidden = !row.done;
      check.setAttribute("aria-checked", String(row.sel));
      check.setAttribute("aria-label", `슬라이드 ${slide.index}${slide.title ? ` ${slide.title}` : ""} 가져오기`);
      for (const [key, [b]] of picBtns) {
        b.setAttribute("aria-pressed", String(Boolean(row.images[key])));
        b.setAttribute("aria-label", `${picBtns.get(key)[1].name} ${row.images[key] ? "넣음" : "뺌"}`);
      }
      if (title.value !== row.title) title.value = row.title;
      if (desc.value !== row.desc) desc.value = row.desc;
      if (defect.value !== row.defect_type) defect.value = row.defect_type;
      detail.hidden = !row.open;
    }
    sync();
    return { node, sync };
  }

  // ---- create ----
  make.addEventListener("click", () => create());

  async function create() {
    if (st.busy || !st.data) return;
    const payload = buildPayload(st.data.slides, st.rows, st.common);
    if (!payload.length) return;
    st.busy = true;
    make.disabled = true;
    make.textContent = "만드는 중…";
    area.querySelector(".di-note")?.remove();
    area.prepend(note("info", "초안을 만들고 있어요. 이미지가 많으면 조금 걸려요."));
    try {
      const result = await api.doiImportConfirm(st.token, payload);
      applyResult(st.rows, result);
      st.created += result.created.length;
      st.busy = false;
      const images = result.created.flatMap((c) => c.images);
      if (result.failed.length) {
        paintFailures(result);
        if (result.created.length) toast(`초안 ${num(result.created.length)}개를 만들었어요. 실패한 ${num(result.failed.length)}장은 다시 시도할 수 있어요.`, { error: true });
        makeThumbs(images);
      } else {
        st.finished = true;
        await finish(result.created.length, images);
      }
    } catch (e) {
      st.busy = false;
      area.querySelector(".di-note")?.remove();
      area.prepend(note("bad", e.message));
      refresh();
    }
  }

  function paintFailures(result) {
    area.querySelector(".di-note")?.remove();
    const list = el("ul", "di-failed");
    for (const f of result.failed) list.append(el("li", "", `슬라이드 ${f.index ?? "?"}: ${f.message}`));
    const box = el("div", "di-note bad");
    box.setAttribute("role", "alert");
    box.append(el("b", "", `${result.failed.length}장은 만들지 못했어요.`), list, el("span", "", "나머지는 초안으로 만들어졌어요. 실패한 슬라이드는 다시 선택돼 있어요. 확인하고 ‘초안 만들기’를 다시 눌러 주세요."));
    area.prepend(box);
    for (const f of result.failed) {
      const r = st.rows.find((x) => x.index === f.index);
      if (r) { r.sel = true; r.done = false; }
    }
    st.rowViews.forEach((v) => v.sync());
    refresh();
  }

  // Browser thumbnails drawn from the stored files (no server imaging); a missing thumbnail falls back to the original.
  async function makeThumbs(images, onStep = () => {}) {
    const queue = [...images];
    let done = 0;
    const worker = async () => {
      while (queue.length && !st.closed) {
        const img = queue.shift();
        try {
          const blob = await (await fetch(`/api/doi-images/${img.id}/file`)).blob();
          const decoded = await decode(blob);
          if (decoded) {
            const thumb = await drawThumb(decoded);
            decoded.bmp.close?.();
            if (thumb) await api.doiPutThumb(img.id, thumb);
          }
        } catch { /* keep the original */ }
        done += 1;
        onStep(done);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
  }

  async function finish(count, images) {
    const box = el("div", "di-done");
    const bar = el("div", "di-bar");
    const fill = el("i");
    bar.append(fill);
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-label", "미리보기 이미지 준비");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(images.length));
    bar.setAttribute("aria-valuenow", "0");
    const label = el("span", "di-done-t", `초안 ${num(count)}개를 만들었어요. 미리보기 이미지를 준비하는 중…`);
    label.setAttribute("role", "status");
    const ring = el("span", "di-done-i");
    ring.append(svg("check"));
    box.append(ring, label, bar);
    area.replaceChildren(box);
    drop.hidden = true;
    make.hidden = true;
    closeBtn.textContent = "닫기";
    await makeThumbs(images, (n) => {
      fill.style.width = `${Math.round((n / images.length) * 100)}%`;
      bar.setAttribute("aria-valuenow", String(n));
    });
    if (st.closed) return;
    fill.style.width = "100%";
    label.textContent = `초안 ${num(count)}개를 만들었어요. 내용을 확인한 뒤 ‘초안 확정’을 눌러 주세요.`;
    const view = button("초안 보기", "pri", () => sheet.close());
    box.append(view);
    sheet.foot.append(view);
    view.focus();
  }
}
