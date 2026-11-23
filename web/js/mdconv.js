// Markdown (+ allowed inline HTML) <-> editor HTML. Pure functions, no network.
//
// Stored format (D-15, decided in P3-01):
//   blocks : paragraph, # ## ### headings, "- " bullets, "1. " numbers, "- [ ]/[x]" checklist,
//            ![alt](files/name.png) images
//   inline : **bold** *italic* ~~strike~~ `code`, and ONLY these HTML tags:
//            <u>, <mark style="background:#rrggbb">, <span style="color:#rrggbb;font-size:NNpx">
// Anything else is dropped on save (serializer) or shown as plain text (reader).
// Known limits: nested lists are flattened; links are kept as plain text.

export const SIZES = [11, 13, 15, 18, 22, 28]; // px presets (6 steps)
export const BASE_PX = 15;
export const COLORS = ["#1f2430", "#d93025", "#e8710a", "#188038", "#1a73e8", "#7b1fa2", "#6b7280"];
export const HLS = ["#fff176", "#a5f3a5", "#a5d8ff", "#ffc9de", "#ffd8a8"];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s) => esc(s).replace(/"/g, "&quot;");

// ---------------------------------------------------------------- reader --
function inlineToHtml(text, fileUrl) {
  const hold = [];
  const put = (html) => {
    hold.push(html);
    return `\u0000${hold.length - 1}\u0000`;
  };
  let s = text.replace(/\u0000/g, "");
  s = s.replace(/\\([\\*`~<>[\]!#\-.+_)])/g, (_, c) => put(esc(c)));
  s = s.replace(/!\[([^\]]*)\]\((files\/[^)\s]+)\)/g, (_, alt, f) =>
    put(`<img src="${escAttr(fileUrl(f))}" data-file="${escAttr(f)}" alt="${escAttr(alt)}">`));
  s = s.replace(/`([^`]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`));
  s = s.replace(/<(\/?)u>/gi, (_, c) => put(`<${c}u>`));
  s = s.replace(/<mark style="background:(#[0-9a-fA-F]{6})">/gi, (_, c) => put(`<mark style="background:${c}">`));
  s = s.replace(/<\/mark>/gi, () => put("</mark>"));
  s = s.replace(/<span style="([^"]*)">/gi, (_, css) => {
    const color = /color:\s*(#[0-9a-fA-F]{6})/.exec(css);
    const size = /font-size:\s*(\d{1,2})px/.exec(css);
    const decl = [color && `color:${color[1]}`, size && `font-size:${size[1]}px`].filter(Boolean).join(";");
    return put(decl ? `<span style="${decl}">` : "<span>");
  });
  s = s.replace(/<\/span>/gi, () => put("</span>"));
  s = esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/~~(.+?)~~/g, "<s>$1</s>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]);
}

export function mdToHtml(md, fileUrl = (f) => f) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let para = [];
  let list = null; // {tag, cl, items: [{html, chk}]}
  const inl = (t) => inlineToHtml(t, fileUrl);
  const flushPara = () => {
    if (para.length) out.push(`<div>${para.map(inl).join("<br>")}</div>`);
    para = [];
  };
  const flushList = () => {
    if (list) {
      const cls = list.cl ? ' class="cl"' : "";
      const items = list.items.map((i) => `<li${list.cl ? ` data-chk="${i.chk}"` : ""}>${i.html}</li>`);
      out.push(`<${list.tag}${cls}>${items.join("")}</${list.tag}>`);
    }
    list = null;
  };
  const addItem = (tag, cl, html, chk = "0") => {
    if (!list || list.tag !== tag || list.cl !== cl) {
      flushPara();
      flushList();
      list = { tag, cl, items: [] };
    }
    list.items.push({ html, chk });
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    let m;
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      flushPara();
      flushList();
      out.push(`<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`);
    } else if ((m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s?(.*)$/))) {
      addItem("ul", true, inl(m[2]), m[1] === " " ? "0" : "1");
    } else if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      addItem("ul", false, inl(m[1]));
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      addItem("ol", false, inl(m[1]));
    } else {
      flushList();
      para.push(line.replace(/^\s+/, ""));
    }
  }
  flushPara();
  flushList();
  return out.join("") || "<div><br></div>";
}

// ------------------------------------------------------------ serializer --
function hex(c) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c || "");
  if (!m) return /^#[0-9a-f]{6}$/i.test(c || "") ? c.toLowerCase() : null;
  if (m[4] !== undefined && +m[4] === 0) return null;
  return "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("");
}

const escText = (t) =>
  t.replace(/\u00a0/g, " ").replace(/([\\*`~<])/g, "\\$1").replace(/!\[/g, "\\!\\[");

function inl(node) {
  let s = "";
  for (const n of node.childNodes) {
    if (n.nodeType === 3) {
      s += escText(n.textContent);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const t = n.tagName.toLowerCase();
    if (t === "br") {
      s += "\n";
      continue;
    }
    if (t === "img") {
      const f = n.getAttribute("data-file");
      if (f) s += `![${(n.getAttribute("alt") || "").replace(/[\]\n]/g, "")}](${f})`;
      continue;
    }
    if (t === "code") {
      const c = n.textContent;
      if (c && !c.includes("`")) s += `\`${c}\``;
      else s += escText(c);
      continue;
    }
    if (/^(ul|ol|div|p|h[1-6]|li)$/.test(t)) {
      s += inl(n); // stray nested block inside an inline run
      continue;
    }
    let inner = inl(n);
    if (!inner) continue;
    const st = n.style || {};
    const fw = st.fontWeight;
    if (t === "b" || t === "strong" || fw === "bold" || +fw >= 600) inner = `**${inner}**`;
    if (t === "i" || t === "em" || st.fontStyle === "italic") inner = `*${inner}*`;
    const deco = st.textDecorationLine || st.textDecoration || "";
    if (t === "s" || t === "strike" || t === "del" || deco.includes("line-through")) inner = `~~${inner}~~`;
    if (t === "u" || deco.includes("underline")) inner = `<u>${inner}</u>`;
    const bg = hex(st.backgroundColor);
    if (bg) inner = `<mark style="background:${bg}">${inner}</mark>`;
    const col = hex(st.color);
    const fs = parseFloat(st.fontSize);
    const css = [];
    if (col && COLORS.includes(col) && col !== COLORS[0]) css.push(`color:${col}`);
    if (fs && SIZES.includes(fs) && fs !== BASE_PX) css.push(`font-size:${fs}px`);
    if (css.length) inner = `<span style="${css.join(";")}">${inner}</span>`;
    s += inner;
  }
  return s;
}

// Line-start characters that would be read as block markers must be escaped.
function paragraphText(raw) {
  const lines = raw.split("\n").map((l) => l.replace(/^\s+|\s+$/g, ""));
  return lines
    .filter((l, i) => l || (i > 0 && i < lines.length - 1))
    .map((l) => l.replace(/^(#{1,3}\s|[-*+]\s|\d+[.)]\s)/, (m) => "\\" + m))
    .join("\n")
    .replace(/^\\(\d+)([.)])/gm, "$1\\$2");
}

function blocks(root, out) {
  let loose = [];
  const flushLoose = () => {
    const wrap = document.createElement("div");
    loose.forEach((n) => wrap.append(n.cloneNode(true)));
    loose = [];
    const t = paragraphText(inl(wrap));
    if (t.trim()) out.push({ text: t });
  };
  for (const n of root.childNodes) {
    const t = n.nodeType === 1 ? n.tagName.toLowerCase() : "";
    if (!t) {
      loose.push(n);
      continue;
    }
    if (!/^(div|p|h[1-6]|ul|ol|blockquote|pre|table)$/.test(t)) {
      loose.push(n);
      continue;
    }
    flushLoose();
    if (/^h[1-6]$/.test(t)) {
      const text = inl(n).replace(/\s*\n\s*/g, " ").trim();
      if (text) out.push({ text: "#".repeat(Math.min(+t[1], 3)) + " " + text });
    } else if (t === "ul" || t === "ol") {
      const cl = t === "ul" && n.classList.contains("cl");
      const items = [...n.children].filter((li) => li.tagName === "LI").map((li, i) => {
        const text = inl(li).replace(/\s*\n\s*/g, " ").trim();
        const mark = cl ? `- [${li.getAttribute("data-chk") === "1" ? "x" : " "}] ` : t === "ul" ? "- " : `${i + 1}. `;
        return mark + text;
      });
      if (items.length) out.push({ text: items.join("\n"), list: true });
    } else if ([...n.children].some((c) => /^(div|p|h[1-6]|ul|ol)$/i.test(c.tagName))) {
      blocks(n, out);
    } else {
      const text = paragraphText(inl(n));
      if (text.trim()) out.push({ text });
    }
  }
  flushLoose();
}

export function htmlToMd(root) {
  const out = [];
  blocks(root, out);
  return out.length ? out.map((b) => b.text).join("\n\n") + "\n" : "";
}
