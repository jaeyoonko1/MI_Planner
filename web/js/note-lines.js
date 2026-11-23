import { MARK_ORDER } from "./lineeditor-core.js";

const LIST = "ul,ol";
const LINE = "li,div,p,h1,h2,h3";

function lineAt(root, node, offset, end) {
  if (node === root) {
    const child = root.childNodes[end ? offset - 1 : offset];
    return child?.nodeType === 1
      ? child.matches(LIST) ? (end ? [...child.querySelectorAll("li")].at(-1) : child.querySelector("li")) : child
      : null;
  }
  const el = node.nodeType === 1 ? node : node.parentElement;
  return el.closest("li") || [...root.children].find(child => child.contains(el));
}

function selectedLines(root) {
  const selection = getSelection();
  if (!selection?.rangeCount) return [];
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return [];
  if ([...root.querySelectorAll("[data-raw],.fold-hid")].some(node => range.intersectsNode(node))) return [];
  const first = lineAt(root, range.startContainer, range.startOffset, false);
  const last = lineAt(root, range.endContainer, range.endOffset, true);
  const lines = [...root.querySelectorAll(LINE)].filter(line =>
    (line.parentElement === root || line.matches("li")) && !line.closest("[data-raw],.fold-hid")
  );
  const a = lines.indexOf(first);
  const b = lines.indexOf(last);
  if (a < 0 || b < a) return [];
  const end = b > a && range.endContainer !== root && range.endOffset === 0 ? b : b + 1;
  return lines.slice(a, end);
}

const mark = line => line.dataset.m || "";
const setMark = (line, value) => {
  if (value) line.dataset.m = value;
  else delete line.dataset.m;
};

function markedItems(root) {
  let lines = selectedLines(root);
  if (!lines.length) return lines;
  if (lines.some(line => line.parentElement.tagName !== "UL")) {
    document.execCommand("insertUnorderedList");
    lines = selectedLines(root);
  }
  return lines.filter(line => line.parentElement.tagName === "UL");
}

function listGroups(lines) {
  const selected = new Set(lines);
  const groups = new Map();
  for (const line of lines) {
    const list = line.parentElement;
    if (!line.matches("li") || !list.matches(LIST)) continue;
    let owner = list.parentElement.closest("li");
    while (owner && !selected.has(owner)) owner = owner.parentElement.closest("li");
    if (owner) continue;
    if (!groups.has(list)) groups.set(list, []);
    groups.get(list).push(line);
  }
  return groups;
}

function sublist(owner, tagName) {
  let list = [...owner.children].at(-1);
  if (list?.tagName !== tagName) {
    list = document.createElement(tagName);
    owner.append(list);
  }
  return list;
}

function shiftDepth(list, items, deeper) {
  const first = items[0];
  if (deeper) {
    const prev = first.previousElementSibling;
    if (!prev?.matches("li")) return false;
    sublist(prev, list.tagName).append(...items);
  } else {
    const parent = list.parentElement;
    if (!parent.matches("li")) return false;
    if (parent.parentElement.tagName !== list.tagName) return false;
    const following = [];
    for (let n = items.at(-1).nextElementSibling; n; n = n.nextElementSibling) following.push(n);
    if (following.length) sublist(items.at(-1), list.tagName).append(...following);
    parent.after(...items);
    if (!list.children.length) list.remove();
  }
  return true;
}

function moveItems(items, up) {
  const adjacent = up ? items[0].previousElementSibling : items.at(-1).nextElementSibling;
  if (!adjacent?.matches("li")) return false;
  if (up) adjacent.before(...items);
  else adjacent.after(...items);
  return true;
}

const paragraphDepth = line => Number(line?.dataset.indent) || 0;

function shiftParagraphs(root, lines, deeper) {
  let changed = false;
  for (const line of lines) {
    if (line.parentElement !== root || !line.matches("div,p") || !line.textContent.trim()) continue;
    const depth = paragraphDepth(line);
    const previous = line.previousElementSibling;
    const next = deeper
      ? Math.max(depth, Math.min(depth + 1, previous ? paragraphDepth(previous) + 1 : 0))
      : Math.max(0, depth - 1);
    if (next === depth) continue;
    if (next) {
      line.dataset.indent = next;
      line.style.setProperty("--note-depth", Math.min(next, 10));
    } else {
      delete line.dataset.indent;
      line.style.removeProperty("--note-depth");
    }
    changed = true;
  }
  return changed;
}

const plainLine = node => node?.matches("div:not([data-raw]),p");

function movePlainTree(root, blocks, first, up) {
  const depth = paragraphDepth(blocks[first]);
  const endOfTree = (start) => {
    let end = start + 1;
    while (plainLine(blocks[end]) && paragraphDepth(blocks[end]) > depth) end++;
    return end;
  };
  const end = endOfTree(first);
  if (up) {
    let prev = first - 1;
    while (plainLine(blocks[prev]) && paragraphDepth(blocks[prev]) > depth) prev--;
    if (plainLine(blocks[prev]) && paragraphDepth(blocks[prev]) === depth) {
      blocks[prev].before(...blocks.slice(first, end));
      return true;
    }
    return depth || end > first + 1 ? false : null;
  }
  if (!plainLine(blocks[end])) return depth || end > first + 1 ? false : null;
  if (paragraphDepth(blocks[end]) !== depth) return false;
  const anchor = blocks[endOfTree(end)] || null;
  for (const line of blocks.slice(first, end)) root.insertBefore(line, anchor);
  return true;
}

const headingLevel = node => /^H[1-3]$/.test(node.tagName) ? Number(node.tagName[1]) : 0;

function moveTopBlocks(root, lines, up) {
  if (!lines.length || lines.some(line => line.parentElement !== root)) return false;
  const blocks = [...root.children];
  const first = blocks.indexOf(lines[0]);
  const last = blocks.indexOf(lines.at(-1));
  const level = headingLevel(lines[0]);
  if (lines.length === 1 && plainLine(lines[0])) {
    const moved = movePlainTree(root, blocks, first, up);
    if (moved !== null) return moved;
  }
  if (lines.length === 1 && level) {
    const endOfSection = (start) => {
      let end = start + 1;
      while (end < blocks.length && (!headingLevel(blocks[end]) || headingLevel(blocks[end]) > level)) end++;
      return end;
    };
    const end = endOfSection(first);
    if (up) {
      let prev = first - 1;
      while (prev >= 0 && (!headingLevel(blocks[prev]) || headingLevel(blocks[prev]) > level)) prev--;
      if (prev < 0 || headingLevel(blocks[prev]) !== level) return false;
      blocks[prev].before(...blocks.slice(first, end));
    } else {
      if (end >= blocks.length || headingLevel(blocks[end]) !== level) return false;
      const anchor = blocks[endOfSection(end)] || null;
      for (const block of blocks.slice(first, end)) root.insertBefore(block, anchor);
    }
    return true;
  }
  const adjacent = blocks[up ? first - 1 : last + 1];
  if (!adjacent || headingLevel(adjacent) || lines.some(headingLevel) || last - first + 1 !== lines.length) return false;
  if (up) adjacent.before(...lines);
  else adjacent.after(...lines);
  return true;
}

function preserveSelection(edit) {
  const selection = getSelection();
  const { anchorNode, anchorOffset, focusNode, focusOffset } = selection;
  const changed = edit();
  if (changed && anchorNode?.isConnected && focusNode?.isConnected) {
    selection.setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset);
  }
  return changed;
}

export function runNoteLineAction(root, action) {
  const lines = selectedLines(root);
  if (action === "bullet") {
    if (!lines.length) return false;
    return document.execCommand("insertUnorderedList");
  }
  if (["cycle", "done", "star", "check"].includes(action)) {
    const items = markedItems(root);
    const allChecked = items.every(item => item.hasAttribute("data-m"));
    const allStarred = items.every(item => mark(item) === "*");
    for (const item of items) {
      const current = mark(item);
      if (action === "cycle") setMark(item, MARK_ORDER[(MARK_ORDER.indexOf(current) + 1) % MARK_ORDER.length]);
      if (action === "done") setMark(item, current === "x" ? " " : "x");
      if (action === "star") setMark(item, allStarred ? "" : "*");
      if (action === "check") setMark(item, allChecked ? "" : current || " ");
    }
    return items.length > 0;
  }
  if (["indent", "outdent"].includes(action)) {
    return preserveSelection(() => {
      let changed = shiftParagraphs(root, lines, action === "indent");
      for (const [list, items] of listGroups(lines)) {
        changed = shiftDepth(list, items, action === "indent") || changed;
      }
      return changed;
    });
  }
  if (["up", "down"].includes(action)) {
    const groups = listGroups(lines);
    if (!groups.size) return preserveSelection(() => moveTopBlocks(root, lines, action === "up"));
    if (groups.size !== 1 || lines.some(line => !line.matches("li"))) return false;
    const [items] = groups.values();
    return preserveSelection(() => moveItems(items, action === "up"));
  }
  return false;
}
