// Page placement rules (P2B-09): "만약 [분류] [이(가)] [값] 그리고 … → 경로". The first matching rule wins,
// otherwise the default folder. Everything is edited on a draft; "저장" validates and saves in one PUT.
// Choices are buttons and chips (D-12). Per-rule match counts / examples come from the server, computed
// from the unsaved draft, so the effect is visible before saving. Saved rules never move existing pages.
import { api } from "./api.js";
import { openPageSheet } from "./pagedialog.js";
import { button } from "./sheet.js";
import { toast } from "./toast.js";
import { debounce, el, emptyState, svg } from "./ui.js";

const OPS = [["is", "이(가)"], ["not", "아님"], ["set", "값 있음"], ["empty", "비어 있음"]];
const OP_LABEL = Object.fromEntries(OPS);
const BASE_VARS = ["연", "월", "에픽위치"];
const toHash = (p) => "#/page/" + p.split("/").map(encodeURIComponent).join("/");
const hasOptions = (f) => f && ["choice", "multi"].includes(f.type);
const clone = (x) => JSON.parse(JSON.stringify(x));

function chip(label, pressed, onClick, extra) {
  const b = el("button", "chip", label);
  b.type = "button";
  b.setAttribute("aria-pressed", String(!!pressed));
  if (extra) b.title = extra;
  b.addEventListener("click", onClick);
  return b;
}

export async function renderRules(host, { reload }) {
  const [saved, fields] = await Promise.all([api.pageRules(), api.todoFields()]);
  const byKey = Object.fromEntries(fields.map((f) => [f.key, f]));
  let rules = clone(saved.rules);
  let fallback = saved.fallback;
  const baseline = () => JSON.stringify([saved.rules, saved.fallback]);
  const dirty = () => JSON.stringify([rules, fallback]) !== baseline();
  let overview = await api.rulesOverview().catch(() => ({ rules: [], pages: [], fallbacks: [] }));
  let tray = null; // { r, c, part }
  let busy = false;
  const vars = [...BASE_VARS, ...fields.map((f) => f.label)];

  const panel = el("section", "panel rl");
  const head = el("div", "panel-head");
  const list = el("div", "rl-list");
  const fbBox = el("div", "rl-fallback");
  const pagesBox = el("div", "rl-pages");
  const err = el("div", "ferr pad");
  err.setAttribute("role", "alert");
  const state = el("span", "rl-state");
  state.setAttribute("aria-live", "polite");
  const save = button("저장", "pri sm", () => commit());
  const undo = button("되돌리기", "sm quiet", () => { rules = clone(saved.rules); fallback = saved.fallback; tray = null; err.textContent = ""; paint(); scheduleOverview(); });
  const heading = el("div", "grow");
  heading.append(el("h2", "", "페이지 위치 규칙"), el("p", "rl-lead", "위에서부터 먼저 맞는 규칙 하나만 적용돼요. 조건은 모두(AND) 맞아야 해요."));
  head.append(heading, state, undo, save);
  panel.append(head, list, fbBox, err, pagesBox);
  host.replaceChildren(panel);

  // ---- editing helpers ----
  const touch = () => { err.textContent = ""; paintHead(); scheduleOverview(); };
  const defaultCond = (f) => (hasOptions(f) ? { field: f.key, op: "is", value: f.options[0]?.value } : { field: f.key, op: "set" });
  const optLabel = (f, v) => f?.options?.find((o) => o.value === v)?.label ?? String(v ?? "");

  function move(i, to) {
    if (to < 0 || to >= rules.length) return;
    const [r] = rules.splice(i, 1);
    rules.splice(to, 0, r);
    tray = null;
    paint();
    touch();
    list.querySelector(`[data-rule="${to}"] .rl-up`)?.focus();
  }

  function condPill(i, c, j) {
    const f = byKey[c.field];
    const pill = el("span", "rl-cond");
    const part = (kind, label, cls = "") => {
      const b = el("button", `rl-part ${cls}`, label);
      b.type = "button";
      b.setAttribute("aria-expanded", String(tray?.r === i && tray?.c === j && tray?.part === kind));
      b.addEventListener("click", () => {
        tray = tray?.r === i && tray?.c === j && tray?.part === kind ? null : { r: i, c: j, part: kind };
        paint();
      });
      return b;
    };
    pill.append(part("field", f?.label ?? "(없는 분류)", f ? "" : "bad"), part("op", OP_LABEL[c.op], "op"));
    if (c.op === "is" || c.op === "not") pill.append(part("value", optLabel(f, c.value) || "값 고르기", c.value == null ? "bad" : ""));
    const x = el("button", "ib sm");
    x.type = "button";
    x.setAttribute("aria-label", `조건 ${j + 1} 지우기`);
    x.append(svg("x", "i s"));
    x.addEventListener("click", () => { rules[i].conditions.splice(j, 1); tray = null; paint(); touch(); });
    pill.append(x);
    return pill;
  }

  function trayFor(i) {
    if (!tray || tray.r !== i) return null;
    const c = rules[i].conditions[tray.c];
    if (!c) return null;
    const f = byKey[c.field];
    const box = el("div", "rl-tray");
    box.setAttribute("role", "group");
    const set = (patch) => { Object.assign(c, patch); tray = null; paint(); touch(); };
    if (tray.part === "field") {
      box.append(el("span", "k", "분류"));
      for (const x of fields) box.append(chip(x.label, x.key === c.field, () => set(defaultCond(x))));
    } else if (tray.part === "op") {
      box.append(el("span", "k", "조건"));
      for (const [v, l] of OPS) {
        if (!hasOptions(f) && (v === "is" || v === "not")) continue;
        box.append(chip(l, v === c.op, () => {
          const patch = { op: v };
          if ((v === "is" || v === "not") && c.value == null) patch.value = f?.options?.[0]?.value;
          if (v === "set" || v === "empty") patch.value = undefined;
          set(patch);
        }));
      }
    } else {
      box.append(el("span", "k", "값"));
      const depth = (o) => { let n = 0, p = o.parent; while (p != null && n < 8) { n++; p = f.options.find((x) => x.value === p)?.parent; } return n; };
      for (const o of f?.options || []) box.append(chip(`${"· ".repeat(depth(o))}${o.label}`, o.value === c.value, () => set({ value: o.value })));
      if (!f?.options?.length) box.append(el("span", "rl-none", "선택지가 없어요. 분류 관리에서 먼저 추가하세요."));
    }
    return box;
  }

  function insertToken(input, i, v) {
    const s = input.selectionStart ?? input.value.length, e = input.selectionEnd ?? s;
    input.value = `${input.value.slice(0, s)}{${v}}${input.value.slice(e)}`;
    const at = s + v.length + 2;
    input.setSelectionRange(at, at);
    input.focus();
    rules[i].path = input.value;
    touch();
  }

  function ruleCard(r, i) {
    const card = el("article", "rl-rule");
    card.dataset.rule = String(i);
    const no = el("span", "rl-no", String(i + 1));
    const when = el("div", "rl-when");
    when.append(el("span", "rl-and", "만약"));
    r.conditions.forEach((c, j) => {
      if (j) when.append(el("span", "rl-and", "그리고"));
      when.append(condPill(i, c, j));
    });
    const add = chip("조건 추가", false, () => {
      const f = fields[0];
      if (!f) return;
      r.conditions.push(defaultCond(f));
      tray = { r: i, c: r.conditions.length - 1, part: "field" };
      paint();
      touch();
    });
    add.prepend(svg("plus", "i s"));
    add.classList.add("add");
    when.append(add);
    if (!r.conditions.length) when.append(el("span", "rl-warn", "조건이 없으면 이 규칙은 적용되지 않아요"));
    const tools = el("div", "rl-tools");
    const tbtn = (id, label, fn, dis, cls = "") => {
      const b = el("button", `ib sm ${cls}`);
      b.type = "button";
      b.disabled = !!dis;
      b.setAttribute("aria-label", `규칙 ${i + 1} ${label}`);
      b.title = label;
      b.append(svg(id, "i s"));
      b.addEventListener("click", fn);
      return b;
    };
    tools.append(
      tbtn("arrow-up", "위로", () => move(i, i - 1), i === 0, "rl-up"),
      tbtn("arrow-down", "아래로", () => move(i, i + 1), i === rules.length - 1),
      tbtn("x", "삭제", () => { rules.splice(i, 1); tray = null; paint(); touch(); }),
    );
    const top = el("div", "rl-top");
    top.append(no, when, tools);

    const path = el("div", "rl-path");
    path.append(el("span", "rl-arrow", "→"));
    const input = el("input");
    input.type = "text";
    input.value = r.path;
    input.placeholder = "예) MI 공정업무/셋업/{제품}";
    input.setAttribute("aria-label", `규칙 ${i + 1} 폴더 경로`);
    input.addEventListener("input", () => { r.path = input.value; touch(); });
    path.append(input);
    const toks = el("div", "rl-toks");
    toks.setAttribute("role", "group");
    toks.setAttribute("aria-label", "경로에 넣을 변수");
    for (const v of vars) {
      const b = el("button", "tok", `{${v}}`);
      b.type = "button";
      b.addEventListener("click", () => insertToken(input, i, v));
      toks.append(b);
    }
    const meta = el("div", "rl-meta");
    meta.dataset.meta = String(i);
    card.append(top);
    const t = trayFor(i);
    if (t) card.append(t);
    card.append(path, toks, meta);
    return card;
  }

  function paintHead() {
    const d = dirty();
    state.textContent = d ? "저장하지 않은 변경" : "";
    state.classList.toggle("on", d);
    save.disabled = !d || busy;
    undo.disabled = !d || busy;
  }

  function paint() {
    list.replaceChildren();
    if (!rules.length) {
      list.append(emptyState({ title: "규칙이 없어요", desc: "규칙이 없으면 모든 페이지가 아래 기본 위치에 만들어져요.", icon: "folder" }));
    }
    rules.forEach((r, i) => list.append(ruleCard(r, i)));
    const addRule = el("div", "rl-add");
    const b = button("규칙 추가", "sm", () => {
      const typeField = byKey.type || fields.find((f) => hasOptions(f));
      rules.push({ conditions: [], path: typeField ? `MI 공정업무/{${typeField.label}}` : "MI 공정업무" });
      tray = null;
      paint();
      touch();
      list.querySelector(`[data-rule="${rules.length - 1}"] .rl-path input`)?.focus();
    });
    b.prepend(svg("plus", "i s"));
    addRule.append(b);
    list.append(addRule);

    fbBox.replaceChildren();
    fbBox.append(el("b", "", "맞는 규칙이 없으면"));
    const row = el("div", "chips");
    row.setAttribute("role", "group");
    for (const f of overview.fallbacks || []) row.append(chip(f.label, f.key === fallback, () => { fallback = f.key; paint(); touch(); }));
    fbBox.append(row);
    const cur = (overview.fallbacks || []).find((f) => f.key === fallback);
    if (cur) fbBox.append(el("code", "loc", `${cur.template}/`));
    paintMeta();
    paintHead();
  }

  function paintMeta() {
    for (const m of list.querySelectorAll("[data-meta]")) {
      const o = overview.rules?.[Number(m.dataset.meta)];
      m.replaceChildren();
      if (!o) continue;
      if (!o.matches) { m.append("지금 해당하는 이슈 없음"); continue; }
      m.append(`해당 이슈 ${o.matches}개`);
      if (o.example) {
        m.append(" · 예) ", el("span", "rl-ex", `#${o.example.id}`), " → ", el("code", "loc", `${o.example.folder}/`));
      }
    }
    pagesBox.replaceChildren();
    const pages = overview.pages || [];
    const h = el("div", "rl-ph");
    h.append(el("h3", "", `이슈 페이지 ${pages.length}개 · 지금 위치`), el("span", "rl-lead", "분류를 바꿔도 만든 페이지는 자동으로 옮겨지지 않아요."));
    pagesBox.append(h);
    if (!pages.length) { pagesBox.append(el("p", "rl-none pad", "아직 이슈 페이지가 없어요. 이슈 상세에서 '페이지로 확장'하면 여기에 보여요.")); return; }
    const table = el("table", "rl-table");
    const thead = el("thead");
    const hr = el("tr");
    for (const t of ["이슈", "현재 위치", "지금 규칙이라면", ""]) hr.append(el("th", "", t));
    thead.append(hr);
    const tb = el("tbody");
    for (const p of pages) {
      const tr = el("tr");
      const a = el("a", "rl-link", `#${p.task_id} ${p.title}`);
      a.href = toHash(p.path);
      const c1 = el("td");
      c1.append(a);
      const c2 = el("td");
      c2.append(el("code", "loc", `${p.folder}/`));
      const c3 = el("td");
      c3.append(el("code", "loc" + (p.differs ? " diff" : ""), `${p.rule_folder}/`), " ", el("span", "by", p.by));
      const c4 = el("td", "rl-act");
      if (p.differs) {
        const mv = button("옮기기", "sm", () => openPageSheet({ task: { id: p.task_id }, relocate: true, onDone: async () => { await refreshOverview(); } }));
        c4.append(el("span", "badge warn", "다른 위치"), mv);
      } else c4.append(el("span", "badge ok", "규칙과 같음"));
      tr.append(c1, c2, c3, c4);
      tb.append(tr);
    }
    table.append(thead, tb);
    pagesBox.append(table);
  }

  async function refreshOverview() {
    try {
      overview = await api.rulesOverview(dirty() ? rules : null, fallback);
      err.textContent = "";
      paint();
    } catch (e) {
      err.textContent = e.message; // an unfinished draft (empty path, unknown variable): keep editing
      paintMeta();
    }
  }
  const scheduleOverview = debounce(refreshOverview, 260);

  async function commit() {
    if (busy || !dirty()) return;
    busy = true;
    paintHead();
    try {
      const res = await api.savePageRules(rules, fallback);
      saved.rules = res.rules;
      saved.fallback = res.fallback;
      rules = clone(res.rules);
      fallback = res.fallback;
      overview = await api.rulesOverview();
      err.textContent = "";
      tray = null;
      toast("위치 규칙을 저장했어요 · 이미 만든 페이지는 그대로예요");
      paint();
    } catch (e) {
      err.textContent = `저장하지 못했어요 · ${e.message}`;
    } finally {
      busy = false;
      paintHead();
    }
  }

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && tray) { tray = null; paint(); e.stopPropagation(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); commit(); }
  });
  paint();
}
