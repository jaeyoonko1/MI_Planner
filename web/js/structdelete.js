// Delete confirmation for the structure screen (V-004): says what will happen, then asks. Only shown when the
// deletion touches more than a plain issue (group with children, linked page, journal lines, sub-tasks).
import { button, openSheet } from "./sheet.js";
import { el } from "./ui.js";

const MODES = [
  ["move_up", "하위 항목은 위로 올리기", "그룹만 지우고 안에 있던 이슈·그룹은 한 단계 위로 올라가요."],
  ["delete", "하위 항목도 함께 삭제", "그룹 안의 이슈와 그룹까지 모두 지워요."],
];

export function impactLines(i) {
  const out = [];
  if (i.groups) {
    const names = i.group_labels.map((x) => `‘${x}’`).join(", ");
    out.push(`그룹 ${i.groups}개 · ${names}${i.groups > i.group_labels.length ? " 외" : ""}`);
  }
  if (i.issues) out.push(`이슈 ${i.issues}개${i.issue_titles.length && i.issues <= 3 ? ` · ${i.issue_titles.map((x) => `‘${x}’`).join(", ")}` : ""}`);
  if (i.children === "move_up" && i.moved_up) out.push(`안에 있던 항목 ${i.moved_up}개는 지우지 않고 한 단계 위로 올라가요${i.moved_groups ? ` (그룹 ${i.moved_groups}개 포함)` : ""}`);
  if (i.pages) out.push(`연결된 페이지 ${i.pages}개는 휴지통(vault/.trash)으로 옮겨요`);
  if (i.journal_lines) out.push(`일지 연결 ${i.journal_lines}줄은 연결만 풀려요. 줄 내용은 그대로 남아요`);
  if (i.subtasks) out.push(`하위 할일 ${i.subtasks}개는 상위 연결이 풀려요`);
  return out;
}

// fetchImpact(children) -> impact; resolves to the chosen children mode, or null when cancelled.
export function openDeleteSheet({ fetchImpact, hasGroups, initial = "move_up" }) {
  return new Promise((resolve) => {
    let answer = null;
    let mode = initial;
    let seq = 0;
    const s = openSheet({ title: "삭제할까요?", sub: "휴지통으로 보내요. 되돌리기(Ctrl+Z)로 그대로 복원할 수 있어요.", onClose: () => resolve(answer) });
    const list = el("ul", "dimpact");
    list.setAttribute("aria-live", "polite");
    const hint = el("p", "hint");
    const ok = button("삭제", "pri danger-fill", () => { answer = mode; s.close(); });
    const cancel = button("취소", "", () => s.close());

    const paint = async () => {
      const mine = ++seq;
      ok.disabled = true;
      try {
        const i = await fetchImpact(mode);
        if (mine !== seq) return;
        list.replaceChildren(...impactLines(i).map((t) => el("li", "", t)));
        ok.textContent = i.groups ? `${i.groups}개 그룹 삭제` : i.issues > 1 ? `이슈 ${i.issues}개 삭제` : "삭제";
        ok.disabled = false;
      } catch (e) {
        if (mine === seq) list.replaceChildren(el("li", "err", `영향을 확인하지 못했어요 · ${e.message}`));
      }
    };

    if (hasGroups) {
      const chips = el("div", "chips dmode");
      chips.setAttribute("role", "group");
      chips.setAttribute("aria-label", "하위 항목 처리");
      for (const [k, label, desc] of MODES) {
        const b = el("button", "chip", label);
        b.type = "button";
        b.setAttribute("aria-pressed", String(k === mode));
        b.addEventListener("click", () => {
          mode = k;
          chips.querySelectorAll(".chip").forEach((c, n) => c.setAttribute("aria-pressed", String(MODES[n][0] === k)));
          hint.textContent = desc;
          paint();
        });
        chips.append(b);
      }
      hint.textContent = MODES.find((m) => m[0] === mode)[2];
      s.body.append(chips);
    }
    s.body.append(list, hint);
    s.foot.append(cancel, ok);
    cancel.focus();
    paint();
  });
}
