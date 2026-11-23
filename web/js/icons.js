// Inline SVG icons: <symbol>s live in index.html, so there are no external assets (offline rule).
const NS = "http://www.w3.org/2000/svg";

export function icon(id, cls = "i") {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", "#" + id);
  svg.append(use);
  return svg;
}
