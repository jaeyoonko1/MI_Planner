// Level look: a shape and a name always travel together; the color only reinforces them (accessibility).
import { el, svg } from "./ui.js";

export const SHAPES = [["issue", "마름모"], ["layers", "겹층"], ["grid", "격자"], ["box", "상자"], ["person", "사람"], ["flag", "깃발"], ["ring", "원"]];
export const COLORS = [["violet", "보라"], ["mint", "민트"], ["blue", "파랑"], ["peach", "살구"], ["pink", "분홍"], ["yellow", "노랑"]];
export const shapeName = (id) => SHAPES.find(([k]) => k === id)?.[1] ?? id;
export const colorName = (id) => COLORS.find(([k]) => k === id)?.[1] ?? id;

export function levelIcon(level, cls = "i") {
  const s = svg("lv-" + level.icon, cls + " lv-ic");
  s.style.setProperty("--c", `var(--lv-${level.color})`);
  return s;
}

export function issueIcon(cls = "i") {
  return svg("lv-issue", cls + " lv-ic issue");
}

// Static (non-interactive) level label: shape + name.
export function levelTag(level) {
  const t = el("span", "lv");
  t.append(levelIcon(level), el("span", "", level.label));
  return t;
}
