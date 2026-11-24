// PowerPoint attachments of a page (V-002): strip above the note, add dialog (upload copy | link only),
// slide viewer (thumbnails + full screen) and 'open in PowerPoint' with a confirm step. No external libraries.
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, skeleton, svg } from "./ui.js";
import {
  EXTS, formatSize, itemState, linkProblem, mediaUrl, slideLabel, slideUrl, stageKind, stepSlide, uploadProblem,
} from "./ppt-model.js";

const MODE_KEY = "mi.ppt.mode";

async function call(method, url, body, raw = false) {
  const res = await fetch(url, {
    method,
    headers: body && !raw ? { "Content-Type": "application/json" } : undefined,
    body: body ? (raw ? body : JSON.stringify(body)) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `요청 실패 (${res.status})`), { status: res.status });
  return data;
}

const q = (page) => `path=${encodeURIComponent(page)}`;
const ppt = {
  list: (page) => call("GET", `/api/ppt?${q(page)}`).then((d) => d.items),
  upload: (page, file) => call("POST", `/api/ppt/upload?${q(page)}&name=${encodeURIComponent(file.name)}`, file, true),
  link: (page, link) => call("POST", `/api/ppt/link?${q(page)}`, { link }),
  check: (link) => call("POST", "/api/ppt/check-link", { link }),
  outline: (page, id) => call("GET", `/api/ppt/${id}/outline?${q(page)}`),
  refresh: (page, id) => call("POST", `/api/ppt/${id}/refresh?${q(page)}`),
  open: (page, id) => call("POST", `/api/ppt/${id}/open?${q(page)}`, { confirm: true }),
  remove: (page, id) => call("DELETE", `/api/ppt/${id}?${q(page)}`),
};

const readMode = () => { try { return localStorage.getItem(MODE_KEY) === "link" ? "link" : "upload"; } catch { return "upload"; } };
const saveMode = (m) => { try { localStorage.setItem(MODE_KEY, m); } catch { /* private mode: fine */ } };

// ---- open in PowerPoint (always asks first) ------------------------------------------------------------------------
export async function editInPowerPoint(page, item, onDone, say = toast) {
  const where = item.mode === "link"
    ? el("code", "ppt-path", item.link)
    : el("span", "", "보관함에 복사된 파일이에요. 저장하면 이 복사본이 바뀌고, 원래 있던 파일은 그대로예요.");
  const ok = await confirmSheet({
    title: "PowerPoint에서 열까요?",
    sub: `‘${item.name}’을(를) 이 컴퓨터의 PowerPoint로 엽니다.`,
    content: [
      el("div", "ppt-confirm", ""),
      where,
      el("p", "ppt-hint", "PowerPoint에서 저장한 뒤 돌아와 ‘새로고침’을 누르면 미리보기가 바뀐 내용을 따라와요."),
    ],
    confirmLabel: "PowerPoint에서 열기",
  });
  if (!ok) return false;
  try {
    await ppt.open(page, item.id);
    say("PowerPoint를 열었어요. 저장한 뒤 ‘새로고침’을 눌러 주세요.");
    onDone?.();
    return true;
  } catch (err) {
    say(err.message);
    return false;
  }
}

// ---- add dialog -------------------------------------------------------------------------------------------------------
function openAdd(page, onAdded) {
  const sheet = openSheet({ title: "PowerPoint 추가", sub: "파일을 보관함에 복사할지, 경로만 연결할지 고르세요." });
  sheet.dlg.classList.add("ppt-sheet");
  const st = { mode: readMode(), file: null, link: "", linkOk: null, busy: false, seq: 0 };

  const modes = el("div", "ppt-modes");
  const area = el("div", "ppt-area");
  const msg = el("div", "ppt-msg");
  msg.setAttribute("aria-live", "polite");
  sheet.body.append(modes, area, msg);
  const addBtn = button("추가", "pri", () => submit());
  sheet.foot.append(button("취소", "", () => sheet.close()), addBtn);

  const input = el("input");
  input.type = "file";
  input.accept = EXTS.join(",");
  input.hidden = true;
  input.addEventListener("change", () => { pick(input.files[0]); input.value = ""; });
  const drop = el("div", "pl-drop ppt-drop");
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  drop.addEventListener("click", () => input.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); });

  const path = el("input", "mos-in ppt-link");
  path.type = "text";
  path.placeholder = "D:\\보고\\주간.pptx   또는   \\\\서버\\공유\\주간.pptx";
  path.spellcheck = false;
  path.autocomplete = "off";
  path.setAttribute("aria-label", "PowerPoint 파일의 전체 경로");
  let timer = 0;
  path.addEventListener("input", () => {
    st.link = path.value;
    st.linkOk = null;
    clearTimeout(timer);
    const bad = linkProblem(path.value);
    if (bad || !path.value.trim()) { st.seq++; paint(); return; }
    paint();
    timer = setTimeout(verify, 350);
  });
  path.addEventListener("keydown", (e) => { if (e.key === "Enter" && !addBtn.disabled) { e.preventDefault(); submit(); } });

  async function verify() {
    const my = ++st.seq;
    try {
      const r = await ppt.check(st.link);
      if (my === st.seq) { st.linkOk = { ok: true, text: `${r.name} · ${formatSize(r.size)} · 파일을 찾았어요` }; paint(); }
    } catch (err) {
      if (my === st.seq) { st.linkOk = { ok: false, text: err.message }; paint(); }
    }
  }

  function pick(file) {
    if (!file) return;
    st.file = file;
    paint();
  }

  const valid = () => (st.mode === "upload"
    ? !!st.file && !uploadProblem(st.file)
    : !!st.link.trim() && !linkProblem(st.link) && st.linkOk?.ok === true);

  function paint() {
    modes.replaceChildren(
      chipRow([["upload", "파일 올리기", "보관함에 복사해 둬요"], ["link", "링크만", "경로만 기억하고 복사하지 않아요"]], st.mode, (m) => { st.mode = m; saveMode(m); paint(); }),
      el("p", "ppt-explain", st.mode === "upload"
        ? "파일을 이 페이지의 보관함(vault)에 복사해요. 원본이 옮겨져도 여기서 계속 볼 수 있어요. (300MB까지)"
        : "파일은 복사하지 않고 경로만 기억해요. 큰 파일이나 공유 폴더 파일에 알맞고, 파일이 옮겨지면 ‘찾을 수 없음’으로 표시돼요."));
    if (st.mode === "upload") {
      drop.replaceChildren(svg("upload"));
      const text = el("div", "pl-drop-t");
      if (st.file) text.append(el("b", "", st.file.name), el("span", "", `${formatSize(st.file.size)} · 눌러서 다른 파일 고르기`));
      else text.append(el("b", "", "PowerPoint 파일을 여기에 끌어놓거나 눌러서 고르세요"), el("span", "", ".pptx · .pptm · .ppt"));
      drop.append(text);
      area.replaceChildren(drop, input);
    } else {
      const lab = el("label", "ppt-field");
      lab.append(el("span", "ppt-k", "파일 경로"), path, el("span", "ppt-hint", "탐색기에서 파일을 Shift+우클릭 → ‘경로로 복사’ 후 붙여 넣으세요."));
      area.replaceChildren(lab);
    }
    const problem = st.mode === "upload" ? uploadProblem(st.file) : linkProblem(st.link);
    let note = null;
    if (problem) note = ["bad", problem];
    else if (st.mode === "link" && st.linkOk) note = [st.linkOk.ok ? "ok" : "bad", st.linkOk.text];
    msg.className = "ppt-msg" + (note ? ` ${note[0]}` : "");
    msg.textContent = note ? note[1] : "";
    if (note?.[0] === "bad") msg.setAttribute("role", "alert"); else msg.removeAttribute("role");
    addBtn.disabled = st.busy || !valid();
    addBtn.textContent = st.mode === "upload" ? "올려서 추가" : "링크로 추가";
  }

  async function submit() {
    if (st.busy || !valid()) return;
    st.busy = true;
    addBtn.disabled = true;
    msg.className = "ppt-msg";
    msg.textContent = st.mode === "upload" ? "보관함에 복사하는 중…" : "연결하는 중…";
    try {
      const item = st.mode === "upload" ? await ppt.upload(page, st.file) : await ppt.link(page, st.link);
      sheet.close();
      toast(st.mode === "upload" ? `‘${item.name}’을(를) 보관함에 올렸어요.` : `‘${item.name}’을(를) 링크로 연결했어요.`);
      onAdded(item);
    } catch (err) {
      st.busy = false;
      msg.className = "ppt-msg bad";
      msg.setAttribute("role", "alert");
      msg.textContent = err.message;
      addBtn.disabled = !valid();
    }
  }

  paint();
  (st.mode === "link" ? path : drop).focus();
}

// ---- viewer -------------------------------------------------------------------------------------------------------------
export function openViewer(page, item0, { onChange } = {}) {
  let item = item0;
  const opener = document.activeElement;
  const dlg = el("dialog", "ppt-viewer");
  const title = el("h2", "ppt-v-title", item.name);
  title.id = `ppt-v-${item.id}`;
  dlg.setAttribute("aria-labelledby", title.id);

  const state = el("span", "ppt-chip");
  const editBtn = button("편집", "ghost sm", () => editInPowerPoint(page, item, null, say));
  editBtn.prepend(svg("edit"));
  editBtn.title = "PowerPoint에서 열기 (E)";
  const refreshBtn = button("새로고침", "ghost sm", () => reload(true));
  refreshBtn.prepend(svg("refresh"));
  const fsBtn = button("전체 화면", "ghost sm", () => toggleFullscreen());
  fsBtn.title = "전체 화면 (F)";
  const closeBtn = el("button", "ib");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "닫기");
  closeBtn.append(svg("x"));
  closeBtn.addEventListener("click", () => dlg.close());
  const top = el("header", "ppt-v-top");
  const tw = el("div", "ppt-v-tw");
  tw.append(title, state);
  top.append(tw, el("div", "ppt-v-acts"), closeBtn);
  top.querySelector(".ppt-v-acts").append(editBtn, refreshBtn, fsBtn);

  const rail = el("div", "ppt-rail");
  rail.setAttribute("role", "listbox");
  rail.setAttribute("aria-label", "슬라이드 목록");
  const stageWrap = el("div", "ppt-stage-wrap");
  const stage = el("div", "ppt-stage");
  const live = el("div", "ppt-live");
  live.setAttribute("aria-live", "polite");
  const prev = el("button", "ppt-nav prev");
  const next = el("button", "ppt-nav next");
  for (const [b, label, rot] of [[prev, "이전 슬라이드", true], [next, "다음 슬라이드", false]]) {
    b.type = "button";
    b.setAttribute("aria-label", label);
    b.append(svg("chev"));
    b.addEventListener("click", () => go(stepSlide(cur, rot ? "ArrowLeft" : "ArrowRight", slides.length)));
  }
  const info = el("div", "ppt-info");
  const flashEl = el("div", "ppt-flash");
  flashEl.setAttribute("role", "status");
  let flashT = 0;
  const say = (m) => { flashEl.textContent = m; flashEl.classList.add("on"); clearTimeout(flashT); flashT = setTimeout(() => flashEl.classList.remove("on"), 3200); };
  stageWrap.append(stage, prev, next, flashEl);
  const main = el("div", "ppt-v-main");
  main.append(stageWrap, info, live);
  const body = el("div", "ppt-v-body");
  body.append(rail, main);
  dlg.append(top, body);

  let slides = [];
  let cur = 0;
  let notes = false;
  let stamp = String(Date.now());
  const thumbs = [];

  function paintState() {
    const s = itemState(item);
    state.className = `ppt-chip ${s.tone}`;
    state.textContent = s.label;
    state.title = s.hint;
    title.textContent = item.name;
    refreshBtn.classList.toggle("hot", !!item.changed);
  }

  function textCard(s, compact) {
    const card = el("div", "ppt-text" + (compact ? " mini" : ""));
    card.append(el("h3", "", s.title || "(제목 없음)"));
    if (s.body) card.append(el("p", "", compact ? s.body.slice(0, 90) : s.body));
    return card;
  }

  function thumbFor(s) {
    const box = el("span", "ppt-th");
    const kind = stageKind(s);
    if (kind === "rendered") box.append(Object.assign(el("img"), { src: slideUrl(page, item.id, s.index, stamp), alt: "", loading: "lazy" }));
    else if (kind === "images") box.append(Object.assign(el("img"), { src: mediaUrl(page, item.id, s.images[0]), alt: "", loading: "lazy" }));
    else box.append(textCard(s, true));
    return box;
  }

  function buildRail() {
    rail.replaceChildren();
    thumbs.length = 0;
    slides.forEach((s, i) => {
      const b = el("button", "ppt-item");
      b.type = "button";
      b.setAttribute("role", "option");
      b.setAttribute("aria-label", slideLabel(s, s.index) + (s.hidden ? " (숨김)" : ""));
      b.append(thumbFor(s), el("span", "ppt-n", String(s.index)));
      if (s.hidden) b.classList.add("hid");
      b.addEventListener("click", () => go(i));
      rail.append(b);
      thumbs.push(b);
    });
  }

  function paintStage() {
    const s = slides[cur];
    if (!s) return;
    const kind = stageKind(s);
    stage.replaceChildren();
    stage.dataset.kind = kind;
    if (kind === "rendered") {
      stage.append(Object.assign(el("img", "ppt-full"), { src: slideUrl(page, item.id, s.index, stamp), alt: slideLabel(s, s.index) }));
    } else {
      const card = el("div", "ppt-fallback");
      card.append(el("h3", "", s.title || "(제목 없음)"));
      if (s.body) card.append(el("p", "ppt-body", s.body));
      if (s.images.length) {
        const g = el("div", "ppt-imgs");
        for (const im of s.images) g.append(Object.assign(el("img"), { src: mediaUrl(page, item.id, im), alt: im.caption || "슬라이드 그림", loading: "lazy" }));
        card.append(g);
      }
      if (!s.title && !s.body && !s.images.length) card.append(el("p", "ppt-empty", "글이나 그림이 없는 슬라이드예요. 도형·차트는 PowerPoint에서 확인하세요."));
      stage.append(card);
    }
    if (s.hidden) stage.append(el("span", "ppt-badge", "숨긴 슬라이드"));
    info.replaceChildren();
    if (kind !== "rendered") {
      const hint = el("div", "ppt-limit");
      hint.append(el("span", "", "도형·차트·서식은 그리지 못해 글과 삽입된 그림만 보여줘요. 정확한 모습은 PowerPoint에서 확인하세요."));
      const open = button("PowerPoint에서 열기", "ghost sm", () => editInPowerPoint(page, item, null, say));
      hint.append(open);
      info.append(hint);
    }
    if (s.notes) {
      const t = button(notes ? "노트 숨기기" : "발표자 노트", "ghost sm", () => { notes = !notes; paintStage(); });
      t.setAttribute("aria-pressed", String(notes));
      info.append(t);
      if (notes) info.append(el("div", "ppt-notes", s.notes));
    }
    live.textContent = `슬라이드 ${s.index} / ${slides.length}. ${s.title || ""}`;
    prev.disabled = cur === 0;
    next.disabled = cur >= slides.length - 1;
    thumbs.forEach((b, i) => { b.setAttribute("aria-selected", String(i === cur)); b.classList.toggle("on", i === cur); });
    thumbs[cur]?.scrollIntoView({ block: "nearest" });
  }

  function go(i) {
    if (i === cur || i < 0 || i >= slides.length) return;
    cur = i;
    paintStage();
  }

  // Real full screen when the browser allows it; otherwise a 'focus view' (slide only, still inside the window).
  const setFsLabel = (on) => { fsBtn.lastChild.textContent = on ? "전체 화면 끝내기" : "전체 화면"; };
  function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen?.(); return; }
    if (dlg.classList.contains("fs")) { dlg.classList.remove("fs"); setFsLabel(false); return; }
    const done = () => { dlg.classList.add("fs"); setFsLabel(true); say("이 브라우저에서는 창 안에서 크게 보여줘요. Esc로 돌아가요."); };
    if (!dlg.requestFullscreen) { done(); return; }
    dlg.requestFullscreen().catch(done);
  }
  const onFs = () => {
    const on = document.fullscreenElement === dlg;
    dlg.classList.toggle("fs", on);
    setFsLabel(on);
  };
  document.addEventListener("fullscreenchange", onFs);

  async function reload(manual = false) {
    try {
      if (manual) {
        const r = await ppt.refresh(page, item.id);
        item = r;
        stamp = String(Date.now());
        say(r.refreshed ? "바뀐 내용을 다시 읽었어요." : "바뀐 내용이 없어요.");
        onChange?.();
      }
      const data = await ppt.outline(page, item.id);
      item = { ...item, ...data, slides: undefined };
      slides = data.slides || [];
      paintState();
      body.dataset.empty = slides.length ? "" : "1";
      if (!slides.length) {
        rail.replaceChildren();
        stage.replaceChildren(el("div", "ppt-fallback", ""));
        stage.firstChild.append(el("h3", "", "미리보기를 만들 수 없어요"), el("p", "ppt-body", data.reason || "슬라이드를 찾지 못했어요."));
        info.replaceChildren();
        prev.disabled = next.disabled = true;
        return;
      }
      cur = Math.min(cur, slides.length - 1);
      buildRail();
      paintStage();
    } catch (err) {
      stage.replaceChildren(el("div", "ppt-fallback", ""));
      stage.firstChild.append(el("h3", "", "열 수 없어요"), el("p", "ppt-body", err.message));
      item = { ...item, missing: err.status === 404 };
      paintState();
    }
  }

  dlg.addEventListener("cancel", (e) => { // Esc leaves the focus view first, a second Esc closes the viewer
    if (dlg.classList.contains("fs") && !document.fullscreenElement) { e.preventDefault(); dlg.classList.remove("fs"); setFsLabel(false); }
  });
  dlg.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.("input,textarea")) return;
    if (["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(e.key) || (e.key === " " && !e.target.closest?.("button"))) {
      e.preventDefault();
      go(stepSlide(cur, e.key, slides.length));
    } else if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
    else if (e.key === "e" || e.key === "E") { e.preventDefault(); editInPowerPoint(page, item, null, say); }
    else if (e.key === "n" || e.key === "N") { if (slides[cur]?.notes) { e.preventDefault(); notes = !notes; paintStage(); } }
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => {
    document.removeEventListener("fullscreenchange", onFs);
    if (document.fullscreenElement === dlg) document.exitFullscreen?.();
    dlg.remove();
    if (opener && document.contains(opener)) opener.focus();
  });
  // coming back from PowerPoint: notice that the file changed
  const onFocus = async () => {
    if (!dlg.isConnected) { window.removeEventListener("focus", onFocus); return; }
    try {
      const fresh = (await ppt.list(page)).find((x) => x.id === item.id);
      if (fresh && (fresh.changed !== item.changed || fresh.missing !== item.missing)) { item = { ...item, ...fresh }; paintState(); }
    } catch { /* offline server: keep the view */ }
  };
  window.addEventListener("focus", onFocus);

  paintState();
  stage.append(skeleton(3));
  document.body.append(dlg);
  dlg.showModal();
  rail.focus?.();
  reload(false);
}

// ---- the strip above the note ------------------------------------------------------------------------------------
export function mountPptPanel(page) {
  const root = el("section", "ppt-strip");
  root.setAttribute("aria-label", "PowerPoint 첨부");
  let items = [];

  async function load() {
    try {
      items = await ppt.list(page);
    } catch { items = []; }
    paint();
  }

  function card(item) {
    const s = itemState(item);
    const c = el("article", "ppt-card" + (item.missing ? " missing" : ""));
    const cover = el("button", "ppt-cover");
    cover.type = "button";
    cover.setAttribute("aria-label", `${item.name} 미리보기`);
    cover.disabled = item.missing;
    const fallback = el("span", "ppt-cover-i");
    fallback.append(svg("ppt"));
    cover.append(fallback);
    if (!item.missing && item.readable) {
      const img = Object.assign(el("img"), { alt: "", loading: "lazy", src: `/api/ppt/${item.id}/cover?${q(page)}&v=${item.sha256.slice(0, 8)}` });
      img.addEventListener("load", () => cover.classList.add("has"));
      img.addEventListener("error", () => img.remove());
      cover.append(img);
    }
    cover.addEventListener("click", () => view(item));
    const info = el("div", "ppt-info-c");
    const name = el("button", "ppt-name", item.name);
    name.type = "button";
    name.title = item.mode === "link" ? item.link : item.name;
    name.disabled = item.missing;
    name.addEventListener("click", () => view(item));
    const meta = el("div", "ppt-meta");
    meta.append(el("span", `ppt-chip ${s.tone}`, s.label), el("span", "", item.mode === "link" ? "복사 안 함" : formatSize(item.size)));
    if (item.rendered) meta.append(el("span", "ppt-chip mute", "슬라이드 그림 사용"));
    info.append(name, meta);
    if (item.mode === "link") info.append(el("div", "ppt-where", item.link));
    if (s.hint) info.append(el("div", "ppt-warn", s.hint));
    const acts = el("div", "ppt-acts");
    const mk = (label, ic, fn, cls = "") => { const b = button(label, `ghost sm ${cls}`, fn); b.prepend(svg(ic)); return b; };
    acts.append(
      Object.assign(mk("미리보기", "play", () => view(item), "pv"), { disabled: item.missing }),
      mk("편집", "edit", () => editInPowerPoint(page, item, load), ""),
      mk("새로고침", "refresh", () => refresh(item), item.changed ? "hot" : ""),
      mk("삭제", "trash", () => remove(item), "danger"),
    );
    c.append(cover, info, acts);
    return c;
  }

  function view(item) { openViewer(page, item, { onChange: load }); }

  async function refresh(item) {
    try {
      const r = await ppt.refresh(page, item.id);
      toast(r.refreshed ? "바뀐 내용을 다시 읽었어요." : "바뀐 내용이 없어요.");
    } catch (err) { toast(err.message); }
    load();
  }

  async function remove(item) {
    const ok = await confirmSheet({
      title: "PowerPoint 첨부를 지울까요?",
      sub: item.name,
      content: [el("p", "ppt-hint", item.mode === "link"
        ? "연결만 지워요. 원본 파일은 그대로 있어요."
        : "보관함의 복사본은 휴지통(vault/.trash)으로 옮겨요. 원래 있던 파일은 그대로예요.")],
      confirmLabel: "지우기",
      danger: true,
    });
    if (!ok) return;
    try { await ppt.remove(page, item.id); toast("첨부를 지웠어요."); } catch (err) { toast(err.message); }
    load();
  }

  function paint() {
    const head = el("div", "ppt-head");
    const label = el("span", "ppt-label");
    label.append(svg("ppt"), el("b", "", "PowerPoint"), el("span", "ppt-count", items.length ? String(items.length) : ""));
    const add = button("추가", "ghost sm", () => openAdd(page, load));
    add.prepend(svg("plus"));
    head.append(label, add);
    root.classList.toggle("empty", !items.length);
    if (!items.length) {
      head.append(el("span", "ppt-empty-t", "파일을 올리거나 경로만 연결해 슬라이드를 미리 볼 수 있어요."));
      root.replaceChildren(head);
      return;
    }
    const list = el("div", "ppt-list");
    for (const it of items) list.append(card(it));
    root.replaceChildren(head, list);
  }

  const onFocus = () => { if (!root.isConnected) window.removeEventListener("focus", onFocus); else load(); };
  window.addEventListener("focus", onFocus);
  paint();
  load();
  return root;
}
