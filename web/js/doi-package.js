// DOI share packages (P5-04): export the shown/all/open DOIs to one .zip, or import such a zip (preview -> choices -> apply).
// Nothing is written before the final button; imported DOIs arrive read-only with their origin (D-35).
import { api } from "./api.js";
import {
  REASON_TEXT, STATE_LABEL, applyLabel, bulk, choiceOptions, defaultChoices, existingLine, exportSummary, metaLine, summarize,
} from "./doi-package-model.js";
import { formatSize } from "./plans-model.js";
import { button, confirmSheet, openSheet } from "./sheet.js";
import { toast } from "./toast.js";
import { chipRow, el, skeleton, store, svg } from "./ui.js";

const num = (n) => Number(n).toLocaleString("ko-KR");
const MAX_FILE = 300 * 1024 * 1024;

function note(kind, text) {
  const box = el("div", `di-note ${kind}`, text);
  if (kind === "bad") box.setAttribute("role", "alert");
  return box;
}

function field(label, control, hint) {
  const wrap = el("label", "dp-field");
  wrap.append(el("span", "dp-k", label), control);
  if (hint) wrap.append(el("span", "dp-hint", hint));
  return wrap;
}

// ---- export ----
// scopes: [{ key, label, items }]; items are full DOI records (with images).
export function openDoiExport({ scopes, initial }) {
  const sheet = openSheet({
    title: "DOI 공유 패키지 내보내기",
    sub: "고른 DOI를 이미지와 함께 zip 파일 하나로 묶어요. 사내 드라이브에 두면 다른 사람이 ‘패키지 가져오기’로 받을 수 있어요.",
  });
  sheet.dlg.classList.add("dp-sheet");
  const st = { scope: scopes.some((s) => s.key === initial) ? initial : scopes[0].key, busy: false };
  const scopeHost = el("div", "dp-scope");
  const summary = el("div", "di-summary");
  summary.setAttribute("role", "status");
  const sender = el("input", "mos-in");
  sender.maxLength = 80;
  sender.placeholder = "예: MI팀 A · 홍길동";
  sender.value = store.get("doi.sender", "");
  const noteIn = el("textarea", "mos-in");
  noteIn.maxLength = 500;
  noteIn.rows = 2;
  noteIn.placeholder = "받는 사람에게 남길 말 (선택)";
  const alert = el("div");
  const scopeLabel = el("div", "dp-k", "내보낼 범위");
  sheet.body.append(
    scopeLabel, scopeHost, summary,
    field("보내는 곳 (선택)", sender, "받는 사람의 DOI에 ‘출처’로 표시돼요."),
    field("메모 (선택)", noteIn),
    alert,
  );
  const cancel = button("취소", "", () => sheet.close());
  const go = button("내보내기", "pri", run);
  const goLabel = el("span", "", "내보내기");
  go.replaceChildren(svg("download"), goLabel);
  sheet.foot.append(cancel, go);

  const current = () => scopes.find((s) => s.key === st.scope);
  function paint() {
    scopeHost.replaceChildren(chipRow(scopes.map((s) => [s.key, `${s.label} ${num(s.items.length)}개`]), st.scope, (k) => { st.scope = k; paint(); }));
    const s = exportSummary(current().items);
    const bits = [`DOI ${num(s.count)}개`, `이미지 ${num(s.images)}장`, `약 ${formatSize(s.bytes)}`];
    if (s.skippedDrafts) bits.push(`초안 ${num(s.skippedDrafts)}개는 제외`);
    summary.replaceChildren(svg("lock", "i s"), el("span", "", `${bits.join(" · ")} · 이 PC에서 파일로만 만들어져요.`));
    go.disabled = st.busy || s.count === 0;
    alert.replaceChildren(...(s.count === 0 ? [note("warn", "내보낼 수 있는 DOI가 없어요. 초안과 휴지통의 DOI는 내보내지 않아요.")] : []));
  }
  paint();
  go.focus();

  async function run() {
    const ids = current().items.filter((i) => i.status !== "draft" && !i.deleted).map((i) => i.id);
    if (!ids.length || st.busy) return;
    st.busy = true;
    go.disabled = true;
    goLabel.textContent = "만드는 중…";
    try {
      store.set("doi.sender", sender.value.trim());
      const { blob, filename, count } = await api.doiPackageExport(ids, sender.value.trim(), noteIn.value.trim());
      const a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 30000);
      sheet.close();
      toast(`DOI ${num(count)}개를 ${filename}로 내보냈어요. 다운로드 폴더를 확인해 주세요.`);
    } catch (e) {
      st.busy = false;
      goLabel.textContent = "내보내기";
      alert.replaceChildren(note("bad", e.message));
      paint();
    }
  }
}

// ---- import ----
export function openDoiPackageImport({ onDone }) {
  const sheet = openSheet({
    title: "DOI 공유 패키지 가져오기", wide: true,
    sub: "다른 사람이 내보낸 zip 패키지를 골라요. 아래에서 확인하고 ‘가져오기’를 누르기 전에는 아무것도 저장되지 않아요.",
    onClose: () => {
      st.closed = true;
      if (st.token && !st.finished) api.doiPackageCancel(st.token);
      if (st.done) onDone(st.done);
    },
  });
  sheet.dlg.classList.add("di-sheet", "dp-sheet");
  const st = { file: null, token: "", data: null, choices: {}, filter: "all", busy: false, closed: false, finished: false, seq: 0, done: null };

  const input = el("input");
  input.type = "file";
  input.accept = ".zip,application/zip";
  input.hidden = true;
  const drop = el("div", "pl-drop di-drop");
  drop.tabIndex = 0;
  drop.setAttribute("role", "button");
  const paintDrop = () => {
    drop.replaceChildren(svg("upload"));
    const text = el("div", "pl-drop-t");
    if (st.file) text.append(el("b", "", st.file.name), el("span", "", `${formatSize(st.file.size)} · 눌러서 다른 파일 고르기`));
    else text.append(el("b", "", "DOI 공유 패키지(.zip)를 여기에 끌어놓거나 눌러서 고르세요"), el("span", "", "파일은 이 PC 안에서만 열려요 · 이미지 무결성(sha256)을 먼저 검사해요"));
    drop.append(text);
    drop.setAttribute("aria-label", st.file ? `선택한 파일 ${st.file.name}. 다른 파일 고르기` : "DOI 공유 패키지 파일 고르기");
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
  const make = button("", "pri", apply);
  const makeLabel = el("span", "", "가져올 항목 없음");
  make.replaceChildren(svg("download"), makeLabel);
  make.disabled = true;
  sheet.foot.append(closeBtn, make);
  drop.focus();

  async function choose(file) {
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) {
      area.replaceChildren(note("bad", "DOI 공유 패키지(.zip) 파일만 가져올 수 있어요."));
      return;
    }
    if (file.size > MAX_FILE) {
      area.replaceChildren(note("bad", "패키지가 300MB를 넘어 가져올 수 없어요. 보낸 사람에게 나눠서 내보내 달라고 해 주세요."));
      return;
    }
    const mine = ++st.seq;
    if (st.token) api.doiPackageCancel(st.token);
    Object.assign(st, { file, token: "", data: null, choices: {}, filter: "all" });
    paintDrop();
    make.disabled = true;
    makeLabel.textContent = "가져올 항목 없음";
    const box = el("div", "di-progress");
    box.append(skeleton(2), el("b", "", "패키지를 검사하는 중…"), el("span", "", "파일 구조와 이미지 무결성을 확인해요."));
    area.replaceChildren(box);
    try {
      const data = await api.doiPackagePreview(file);
      if (mine !== st.seq || st.closed) { api.doiPackageCancel(data.token); return; }
      st.token = data.token;
      st.data = data;
      st.choices = defaultChoices(data.items);
      paintPreview();
    } catch (e) {
      if (mine !== st.seq) return;
      area.replaceChildren(note("bad", e.message));
    }
  }

  function paintPreview() {
    const { package: p, items, counts } = st.data;
    const parts = [];
    const head = el("div", "di-summary");
    const when = p.created_at ? ` · ${p.created_at.slice(0, 10)} 작성` : "";
    head.append(svg("lock", "i s"), el("span", "", `미리보기예요. DOI ${num(items.length)}개${p.sender ? ` · 보낸 곳 ${p.sender}` : ""}${when} · 아직 아무것도 저장되지 않았어요.`));
    parts.push(head);
    if (p.note) parts.push(note("info", `보낸 사람 메모: ${p.note}`));

    const stateChips = el("div", "chips dp-filter");
    stateChips.setAttribute("role", "group");
    stateChips.setAttribute("aria-label", "상태별 보기");
    for (const [key, label, n] of [["all", "전체", items.length], ["new", STATE_LABEL.new, counts.new], ["conflict", STATE_LABEL.conflict, counts.conflict], ["identical", STATE_LABEL.identical, counts.identical]]) {
      if (key !== "all" && !n) continue;
      const b = el("button", "chip");
      b.type = "button";
      b.append(document.createTextNode(label), el("span", "n", num(n)));
      b.setAttribute("aria-pressed", String(st.filter === key));
      b.addEventListener("click", () => { st.filter = key; paintPreview(); });
      stateChips.append(b);
    }
    const bulkRow = el("div", "dp-bulk");
    bulkRow.append(stateChips);
    if (counts.conflict) {
      bulkRow.append(
        button("충돌 모두 건너뛰기", "sm", () => { st.choices = bulk(items, st.choices, "skip"); paintPreview(); }),
        button("충돌 모두 둘 다 두기", "sm", () => { st.choices = bulk(items, st.choices, "both"); paintPreview(); }),
      );
    }
    if (counts.new) {
      const none = items.filter((i) => i.state === "new").every((i) => st.choices[i.uid] === "skip");
      bulkRow.append(button(none ? "새 항목 모두 가져오기" : "새 항목 모두 건너뛰기", "sm", () => { st.choices = bulk(items, st.choices, "new", none); paintPreview(); }));
    }
    parts.push(bulkRow);

    const list = el("ul", "dp-list");
    for (const item of items) {
      if (st.filter !== "all" && item.state !== st.filter) continue;
      list.append(row(item));
    }
    parts.push(list);
    area.replaceChildren(...parts);
    paintApply();
  }

  function row(item) {
    const li = el("li", `dp-row ${item.state}`);
    const main = el("div", "dp-main");
    const t = el("div", "dp-title");
    t.append(el("b", "", item.title), el("span", `di-badge ${item.state === "new" ? "ok" : item.state === "conflict" ? "warn" : ""}`, STATE_LABEL[item.state]));
    const meta = [metaLine(item), `이미지 ${num(item.images.length)}장`, item.tags.length ? item.tags.map((x) => `#${x}`).join(" ") : ""].filter(Boolean).join(" · ");
    main.append(t, el("div", "dp-meta", meta));
    if (item.state === "conflict") main.append(el("div", "dp-why", `${REASON_TEXT[item.reason] ?? ""} ${existingLine(item)}`.trim()));
    else if (item.state === "identical") main.append(el("div", "dp-why", `내용이 같아서 할 일이 없어요. ${existingLine(item)}`.trim()));
    li.append(main);
    if (item.state !== "identical") {
      const chips = chipRow(choiceOptions(item), st.choices[item.uid], (v) => { st.choices[item.uid] = v; paintPreview(); }, "dp-choices");
      chips.setAttribute("aria-label", `${item.title} 처리 방법`);
      li.append(chips);
    }
    return li;
  }

  function paintApply() {
    const sum = summarize(st.data.items, st.choices);
    makeLabel.textContent = applyLabel(sum);
    make.disabled = st.busy || sum.import + sum.both + sum.overwrite === 0;
  }

  async function apply() {
    const sum = summarize(st.data.items, st.choices);
    if (sum.overwrite) {
      const ok = await confirmSheet({
        title: `내가 만든 DOI ${num(sum.overwrite)}개를 덮어쓸까요?`,
        sub: "덮어쓴 DOI는 보낸 사람의 내용으로 바뀌고 읽기 전용(가져옴)이 돼요.",
        content: [note("warn", "이전 내용은 data/doi/.trash 폴더에 JSON 파일로, 이전 이미지도 같은 폴더로 옮겨 두니 필요하면 거기서 찾을 수 있어요.")],
        confirmLabel: "덮어쓰고 가져오기", danger: true,
      });
      if (!ok || st.closed) return;
    }
    st.busy = true;
    make.disabled = true;
    try {
      const res = await api.doiPackageApply(st.token, st.choices);
      st.finished = true;
      st.done = res;
      const bits = [];
      if (res.imported) bits.push(`새로 ${num(res.imported)}개`);
      if (res.both) bits.push(`둘 다 두기 ${num(res.both)}개`);
      if (res.overwritten) bits.push(`덮어씀 ${num(res.overwritten)}개`);
      sheet.close();
      toast(`DOI를 가져왔어요: ${bits.join(" · ")}. 가져온 DOI는 읽기 전용이에요.`);
    } catch (e) {
      st.busy = false;
      area.prepend(note("bad", e.message));
      paintApply();
    }
  }
}
