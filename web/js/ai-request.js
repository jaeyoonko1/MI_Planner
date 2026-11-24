// "AI에게 요청" popover (P7-03): choose skill chips (D-12), add a request, preview and copy the request text.
import { api } from "./api.js";
import { buildRequest, toggleSkill } from "./ai-request-model.js";
import { toast } from "./toast.js";
import { el } from "./ui.js";

export function mountAiRequest() {
  const trigger = document.getElementById("btn-ai");
  if (!trigger) return;
  let pop = null;
  let selection = "";
  let chosen = [];
  let skills = null; // null = not loaded yet

  const close = (focus = true) => {
    if (!pop) return;
    pop.remove();
    pop = null;
    trigger.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (focus) trigger.focus();
  };
  const outside = (e) => { if (pop && !pop.contains(e.target) && !trigger.contains(e.target)) close(false); };

  // The text the user highlighted before pressing the button (focus change must not lose it).
  const grabSelection = () => { selection = String(getSelection() || "").trim(); };
  trigger.addEventListener("pointerdown", grabSelection);
  trigger.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") grabSelection(); });

  async function open() {
    const area = el("textarea", "ai-ask");
    area.rows = 3;
    area.placeholder = "예: 이 설비 지금 뭐 해야 돼? / 이 표 채워줘";
    area.setAttribute("aria-label", "요청 내용");
    const preview = el("textarea", "ai-preview");
    preview.readOnly = true;
    preview.rows = 9;
    preview.setAttribute("aria-label", "복사될 요청문 미리보기");
    const chipsHost = el("div", "chips");
    chipsHost.setAttribute("role", "group");
    chipsHost.setAttribute("aria-label", "사용할 스킬");

    const refresh = () => {
      preview.value = buildRequest({ hash: location.hash, selection, skills: chosen, request: area.value });
      for (const b of chipsHost.querySelectorAll("button.chip")) b.setAttribute("aria-pressed", String(chosen.includes(b.dataset.value)));
    };
    const paintChips = () => {
      chipsHost.replaceChildren();
      if (!skills?.length) { chipsHost.append(el("span", "ai-note", skills ? "등록된 스킬이 없어요 (skills/ 폴더)" : "스킬 목록을 불러오는 중…")); return; }
      for (const s of skills) {
        const b = el("button", "chip", s.name);
        b.type = "button";
        b.dataset.value = s.name;
        b.title = s.description;
        b.addEventListener("click", () => { chosen = toggleSkill(chosen, s.name); refresh(); });
        chipsHost.append(b);
      }
    };

    const copy = el("button", "ai-copy", "요청문 복사");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(preview.value);
      } catch {
        preview.readOnly = false; preview.focus(); preview.select(); // fallback: user presses Ctrl+C
        toast("자동 복사가 막혔어요. 선택된 글을 Ctrl+C 로 복사하세요.", { error: true });
        return;
      }
      toast("요청문을 복사했어요. AI 창에 붙여넣으세요.");
      close();
    });
    const x = el("button", "ai-x", "닫기");
    x.type = "button";
    x.addEventListener("click", () => close());

    const head = el("div", "ai-head");
    head.append(el("b", "", "AI에게 요청"), x);
    const where = el("div", "ai-where");
    pop = el("div", "ai-pop");
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "AI에게 요청");
    pop.append(head, where, el("div", "ai-k", "스킬 (선택)"), chipsHost, el("div", "ai-k", "요청"), area, el("div", "ai-k", "미리보기"), preview, copy);
    pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    document.body.append(pop);
    trigger.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", outside, true);
    where.textContent = selection ? `선택한 글 ${selection.length}자 포함` : "선택한 글 없음 — 화면의 글을 드래그한 뒤 누르면 함께 담겨요";
    area.addEventListener("input", refresh);
    paintChips();
    refresh();
    area.focus();
    if (skills === null) {
      try { skills = await api.skills(); } catch { skills = []; }
      if (pop) { paintChips(); refresh(); }
    }
  }

  trigger.addEventListener("click", () => (pop ? close() : open()));
}
