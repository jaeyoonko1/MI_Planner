// Status badges and the compact edit popover for equipment / Lots / the evaluation (V-005).
// Pure view: every data change goes through ctx.commit / ctx.setStatus, so the board stays the single owner of state.
import {
  ENTITY_STATUS, EVALUATION_STATUS, KIND_LABEL, NAME_MAX, NOTE_MAX, entityName, findEntity, statusMeta, statusOf, validateName,
} from "./eval-entity-model.js";
import { el, svg } from "./ui.js";

const esc = (text) => String(text).replace(/[&<>"']/g, (ch) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// Icon + words, so a status never relies on color alone.
export function badgeHtml(kind, status) {
  const meta = statusMeta(kind, status);
  return `<span class="eb-st s-${esc(meta.key)}"><svg class="i" aria-hidden="true"><use href="#${meta.icon}"></use></svg>${esc(meta.label)}</span>`;
}

export function statusBadge(kind, status) {
  const meta = statusMeta(kind, status);
  const badge = el("span", "eb-st s-" + meta.key);
  badge.append(svg(meta.icon), document.createTextNode(meta.label));
  return badge;
}

// One icon-only mark with a text label for tooltips; used where space is tight (stage list).
export function miniTag(kindLabel, kind, status) {
  const meta = statusMeta(kind, status);
  const tag = el("span", "eb-st mini s-" + meta.key);
  tag.title = `${kindLabel} ${meta.label}`;
  tag.append(svg(meta.icon), document.createTextNode(`${kindLabel} ${meta.label}`));
  return tag;
}

export function createEntityEditor(ctx) {
  let pop = null;
  let state = null;
  let off = [];

  const board = () => ctx.board();
  const current = () => (state.kind === "evaluation" ? board().evaluation : findEntity(board(), state.kind, state.id));
  const nameOf = () => (state.kind === "evaluation" ? board().evaluation.name : entityName(state.kind, current()));

  function field(label, input, hint) {
    const wrap = el("div", "eb-pfield");
    const id = "eb-pop-" + input.dataset.field;
    input.id = id;
    const lab = el("label", "", label);
    lab.htmlFor = id;
    const err = el("p", "eb-ferr");
    err.id = id + "-err";
    err.setAttribute("role", "alert");
    input.setAttribute("aria-describedby", err.id);
    wrap.append(lab, input, err);
    if (hint) wrap.append(el("p", "eb-since", hint));
    return { wrap, err };
  }

  function close(restore = true) {
    if (!pop) return;
    const { kind, id, anchor } = state;
    for (const fn of off) fn();
    off = [];
    pop.remove();
    pop = null;
    state = null;
    if (!restore) return;
    const next = ctx.host.querySelector(`[data-edit="${kind}"][data-id="${id}"]`);
    const target = next || (anchor?.isConnected ? anchor : null);
    if (target) target.focus({ preventScroll: true }); else ctx.release?.();
  }

  function position() {
    const rect = state.anchor.getBoundingClientRect();
    const width = pop.offsetWidth, height = pop.offsetHeight;
    const left = Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12));
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 12) top = Math.max(12, rect.top - height - 8);
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function statusChips() {
    const list = state.kind === "evaluation" ? EVALUATION_STATUS : ENTITY_STATUS;
    const group = el("div", "chips eb-schips");
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${KIND_LABEL[state.kind]} 상태`);
    const now = statusOf(current());
    list.forEach((item, i) => {
      const chip = el("button", "chip eb-schip s-" + item.key);
      chip.type = "button";
      chip.dataset.status = item.key;
      chip.title = `${item.hint} (${i + 1})`;
      chip.setAttribute("aria-pressed", String(item.key === now));
      chip.append(svg(item.icon), el("span", "", item.label));
      chip.addEventListener("click", () => setStatus(item.key));
      group.append(chip);
    });
    return group;
  }

  function say(text, error = false) {
    const line = pop?.querySelector(".eb-pstatus");
    if (!line) return;
    line.textContent = text;
    line.classList.toggle("err", error);
  }

  async function setStatus(status) {
    if (!state || statusOf(current()) === status) return;
    say("저장 중…");
    try {
      await ctx.setStatus(state.kind, state.id, status);
      if (!pop) return;
      pop.querySelector(".eb-schips")?.replaceWith(statusChips());
      pop.querySelector(`.eb-schip[data-status="${status}"]`)?.focus();
      say("저장됨");
    } catch (error) {
      say(error.message, true);
    }
  }

  function build() {
    const entity = current();
    const box = el("div", "eb-pop");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "false");
    const title = state.kind === "evaluation" ? "평가 상태" : `${KIND_LABEL[state.kind]} ${nameOf()}`;
    box.setAttribute("aria-label", `${title} 편집`);
    const head = el("header", "eb-pop-head");
    const text = el("div", "eb-pop-title");
    text.append(el("span", "eb-pop-kind", KIND_LABEL[state.kind]), el("b", "", nameOf()));
    const x = el("button", "icon-btn eb-pclose");
    x.type = "button";
    x.setAttribute("aria-label", "닫기");
    x.title = "닫기 (Esc)";
    x.append(svg("x"));
    x.addEventListener("click", () => close());
    head.append(text, x);
    box.append(head);

    const sec = el("section", "eb-psec");
    sec.append(el("h4", "", "상태"), statusChips());
    box.append(sec);

    const inputs = [];
    if (state.kind !== "evaluation") {
      const name = el("input", "eb-input");
      name.dataset.field = "name";
      name.type = "text";
      name.autocomplete = "off";
      name.spellcheck = false;
      name.maxLength = NAME_MAX;
      name.value = nameOf();
      const nameField = field("이름", name);
      inputs.push({ key: "name", input: name, err: nameField.err, original: nameOf() });
      box.append(nameField.wrap);
      if (state.kind === "equipment") {
        const vendor = el("input", "eb-input");
        vendor.dataset.field = "vendor";
        vendor.type = "text";
        vendor.autocomplete = "off";
        vendor.maxLength = NAME_MAX;
        vendor.placeholder = "예: 설비사";
        vendor.value = entity.vendor || "";
        const vendorField = field("설비사", vendor);
        inputs.push({ key: "vendor", input: vendor, err: vendorField.err, original: entity.vendor || "" });
        box.append(vendorField.wrap);
      }
      const note = el("textarea", "eb-input eb-note");
      note.dataset.field = "note";
      note.rows = 3;
      note.maxLength = NOTE_MAX;
      note.placeholder = state.kind === "lot" ? "이 Lot에 남길 메모 (예: 재작업, 스캔 대기)" : "이 설비에 남길 메모 (예: PM 중, 레시피 변경)";
      note.value = entity.note || "";
      const noteField = field("메모", note);
      inputs.push({ key: "note", input: note, err: noteField.err, original: entity.note || "" });
      box.append(noteField.wrap);
    }
    box.append(el("p", "eb-pop-keys", state.kind === "evaluation" ? "1·2·3 상태 선택 · Esc 닫기" : "1·2·3·4 상태 선택 · Enter 저장 · Esc 닫기"));
    const line = el("p", "eb-pstatus");
    line.setAttribute("role", "status");
    box.append(line);

    let saving = null;
    const save = async () => {
      if (saving || !state) return saving;
      const patch = {};
      for (const item of inputs) {
        item.err.textContent = "";
        item.input.removeAttribute("aria-invalid");
        const value = item.input.value.trim();
        if (value === item.original) continue;
        if (item.key === "name") {
          const check = validateName(board(), state.kind, state.id, value);
          if (!check.ok) {
            item.err.textContent = check.error;
            item.input.setAttribute("aria-invalid", "true");
            return false;
          }
        }
        patch[item.key] = value;
      }
      if (!Object.keys(patch).length) return true;
      say("저장 중…");
      saving = ctx.commit(state.kind, state.id, patch).then(() => {
        for (const item of inputs) if (item.key in patch) item.original = patch[item.key];
        say("저장됨");
        return true;
      }, (error) => {
        const bad = inputs.find((item) => item.key in patch && item.key === "name") || inputs.find((item) => item.key in patch);
        if (bad && pop) { bad.err.textContent = error.message; bad.input.setAttribute("aria-invalid", "true"); }
        say(error.message, true);
        return false;
      }).finally(() => { saving = null; });
      return saving;
    };
    for (const item of inputs) {
      item.input.addEventListener("input", () => { item.err.textContent = ""; item.input.removeAttribute("aria-invalid"); });
      item.input.addEventListener("blur", () => { if (pop && !pop.contains(document.activeElement)) save(); });
      item.input.addEventListener("keydown", (event) => {
        if (event.isComposing || event.keyCode === 229) return;
        const multi = item.input.tagName === "TEXTAREA";
        if (event.key === "Enter" && (!multi || event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          Promise.resolve(save()).then((ok) => { if (ok && pop) close(); });
        }
      });
    }
    box._revert = () => inputs.forEach((item) => { item.input.value = item.original; });
    return box;
  }

  function open(anchor, kind, id, opts = {}) {
    if (pop && state.kind === kind && state.id === id && !opts.focus) { close(); return; } // same badge again = toggle
    close(false);
    state = { kind, id, anchor };
    if (!current()) { state = null; return; }
    pop = build();
    ctx.host.append(pop);
    position();
    const onDown = (event) => {
      if (!pop || pop.contains(event.target) || state.anchor?.contains(event.target)) return;
      close(false);
    };
    const onKey = (event) => {
      if (!pop) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        pop._revert();
        close();
        return;
      }
      if (event.key === "Tab") {
        const nodes = [...pop.querySelectorAll("button, input, textarea")].filter((n) => !n.disabled);
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        return;
      }
      if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[1-4]$/.test(event.key) && !/^(INPUT|TEXTAREA)$/.test(event.target.tagName)) {
        const list = state.kind === "evaluation" ? EVALUATION_STATUS : ENTITY_STATUS;
        const pick = list[Number(event.key) - 1];
        if (pick) { event.preventDefault(); setStatus(pick.key); }
      }
    };
    const onResize = () => close(false);
    document.addEventListener("pointerdown", onDown, true);
    pop.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    window.addEventListener("hashchange", onResize);
    off = [
      () => document.removeEventListener("pointerdown", onDown, true),
      () => window.removeEventListener("resize", onResize),
      () => window.removeEventListener("hashchange", onResize),
    ];
    const target = opts.focus === "name" ? pop.querySelector('[data-field="name"]') : pop.querySelector('.eb-schip[aria-pressed="true"]');
    (target || pop.querySelector("button")).focus();
    if (opts.focus === "name") target?.select();
  }

  return { open, close, isOpen: () => Boolean(pop), refresh() { if (pop) { pop.querySelector(".eb-schips")?.replaceWith(statusChips()); } } };
}
