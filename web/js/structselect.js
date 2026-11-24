// Pure multi-selection model for the structure rows (V-004). `vis` is the list of visible row ids in display order.
// A selection is { ids: Set, anchor, active }: `active` is the keyboard-focus row, `anchor` the end a Shift range grows from.
export const emptySelection = () => ({ ids: new Set(), anchor: "", active: "" });

const between = (vis, a, b) => {
  const i = vis.indexOf(a), j = vis.indexOf(b);
  if (i < 0 || j < 0) return [b].filter((x) => vis.includes(x));
  return vis.slice(Math.min(i, j), Math.max(i, j) + 1);
};

export function single(id) {
  return { ids: new Set(id ? [id] : []), anchor: id, active: id };
}

// Mouse: plain = just this row, Ctrl/Cmd = toggle, Shift = range from the anchor (Ctrl+Shift adds the range).
export function click(sel, id, { shift = false, ctrl = false } = {}, vis) {
  if (shift && sel.anchor && vis.includes(sel.anchor)) {
    const range = between(vis, sel.anchor, id);
    return { ids: new Set(ctrl ? [...sel.ids, ...range] : range), anchor: sel.anchor, active: id };
  }
  if (ctrl) {
    const ids = new Set(sel.ids);
    if (ids.has(id)) ids.delete(id); else ids.add(id);
    return { ids, anchor: id, active: ids.has(id) ? id : [...ids].pop() ?? "" };
  }
  return single(id);
}

// Keyboard: move the active row by `to` (an id already chosen by the caller); Shift grows the range from the anchor.
export function moveTo(sel, to, { shift = false } = {}, vis) {
  if (!to) return sel;
  if (shift) {
    const anchor = sel.anchor && vis.includes(sel.anchor) ? sel.anchor : sel.active || to;
    return { ids: new Set(between(vis, anchor, to)), anchor, active: to };
  }
  return single(to);
}

// Ctrl+Space toggles the active row without moving; Ctrl+A selects all visible rows.
export function toggleActive(sel) {
  if (!sel.active) return sel;
  const ids = new Set(sel.ids);
  if (ids.has(sel.active)) ids.delete(sel.active); else ids.add(sel.active);
  return { ids, anchor: sel.active, active: sel.active };
}

export function selectAll(sel, vis) {
  return { ids: new Set(vis), anchor: vis[0] ?? "", active: sel.active && vis.includes(sel.active) ? sel.active : vis[0] ?? "" };
}

// Keep only rows that still exist.
export function prune(sel, valid) {
  const ids = new Set([...sel.ids].filter((x) => valid.has(x)));
  const active = valid.has(sel.active) ? sel.active : [...ids].pop() ?? "";
  return { ids, anchor: valid.has(sel.anchor) ? sel.anchor : active, active };
}

// Where the selection should land after rows disappear: the next surviving visible row, else the previous one.
export function neighbourAfterRemoval(vis, removed) {
  const first = vis.findIndex((x) => removed.has(x));
  if (first < 0) return "";
  const after = vis.slice(first).find((x) => !removed.has(x));
  if (after) return after;
  return [...vis.slice(0, first)].reverse().find((x) => !removed.has(x)) ?? "";
}

// What to send to the delete API. In the classification view a group is a classification value (V-011): deleting it
// removes that value (the same value under other branches too); "미분류" is not a value and is skipped.
export function deleteItems(ids, index, { free }) {
  const items = [];
  const seen = new Set();
  let blockedGroups = 0;
  for (const id of ids) {
    const n = index.get(id);
    if (!n) continue;
    if (n.kind === "issue") items.push({ kind: "issue", id: n.task.id });
    else if (free && n.nodeId != null) items.push({ kind: "group", id: n.nodeId });
    else if (!free && n.key && !n.none && n.value != null) {
      const k = `${n.key}=${JSON.stringify(n.value)}`;
      if (!seen.has(k)) { seen.add(k); items.push({ kind: "value", key: n.key, value: n.value }); }
    } else blockedGroups++;
  }
  return { items, blockedGroups };
}

// Keys that must never trigger row shortcuts: typing targets and anything inside an open dialog.
export function isTypingTarget(el) {
  if (!el || el.nodeType !== 1) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes((el.type || "text").toLowerCase());
  return Boolean(el.closest?.('[contenteditable=""],[contenteditable="true"]'));
}
