// Sheets for the structure worksheet: "이동…" (destination buttons, no dropdown) and "그룹 추가".
import { levelIcon } from "./levels.js";
import { flatten, isInside } from "./structmodel.js";
import { button, openSheet } from "./sheet.js";
import { el } from "./ui.js";

// Destinations for `node`. Free mode may also drop at the top level; groups cannot enter their own subtree.
export function openMoveSheet({ node, tree, free, onPick }) {
  const issue = node.kind === "issue";
  const s = openSheet({
    title: issue ? `#${node.task.id} 이슈 이동` : `‘${node.label}’ 그룹 이동`,
    sub: free ? "옮길 위치를 고르세요. 그룹은 하위 이슈와 함께 이동해요." : "고른 그룹의 분류 값이 이 이슈에 적용돼요. 이슈 번호는 그대로예요.",
  });
  const list = el("div", "dest");
  list.setAttribute("role", "group");
  list.setAttribute("aria-label", "이동할 위치");
  const add = (label, depth, target, icon, here) => {
    const b = el("button", "dest-btn");
    b.type = "button";
    b.style.setProperty("--d", depth);
    if (icon) b.append(icon);
    b.append(el("span", "dest-name", label));
    if (here) { b.append(el("span", "badge", "현재 위치")); b.disabled = true; }
    b.addEventListener("click", () => { s.close(); onPick(target); });
    list.append(b);
    return b;
  };
  const currentParent = node.parent ?? null;
  if (free) add("최상위", 0, null, null, currentParent === null);
  const depthOf = (g) => { let d = 0; for (let p = g.parent; p; p = p.parent) d++; return d + (free ? 1 : 0); };
  for (const g of flatten(tree).filter((n) => n.kind === "group")) {
    if (!issue && isInside(g, node)) continue;
    add(g.label, depthOf(g), g, levelIcon(g.level), currentParent === g);
  }
  if (!list.children.length) list.append(el("p", "hint", "옮길 수 있는 그룹이 없어요."));
  s.body.append(list);
  s.foot.append(button("취소", "", () => s.close()));
  list.querySelector("button:not(:disabled)")?.focus();
}

export function openAddGroupSheet({ parentLabel, onCreate }) {
  const s = openSheet({ title: "그룹 추가", sub: parentLabel ? `‘${parentLabel}’ 아래에 만들어요.` : "최상위에 만들어요. 만든 뒤 끌어서 옮길 수 있어요." });
  const wrap = el("div", "newopt big");
  const input = el("input");
  input.type = "text";
  input.maxLength = 50;
  input.placeholder = "그룹 이름";
  input.setAttribute("aria-label", "그룹 이름");
  wrap.append(input);
  const err = el("div", "ferr");
  err.setAttribute("role", "alert");
  s.body.append(wrap, err, el("p", "hint", "이 그룹은 분류 값을 바꾸지 않아요. 이슈를 묶어 두는 자리예요."));
  const ok = button("추가", "pri", async () => {
    const label = input.value.trim();
    if (!label) { err.textContent = "그룹 이름을 입력하세요."; input.focus(); return; }
    ok.disabled = true;
    try { await onCreate(label); s.close(); } catch (e) { err.textContent = e.message; ok.disabled = false; }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); ok.click(); } });
  s.foot.append(button("취소", "", () => s.close()), ok);
  input.focus();
}
