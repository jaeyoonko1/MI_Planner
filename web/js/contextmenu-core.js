// Pure logic for the context menu (V-010): placement inside the viewport, item normalisation and the keyboard model.
// No DOM here, so Node can test it (web/test/run_contextmenu.mjs).

export const MARGIN = 8;

/**
 * Where a menu of size w x h opens when the pointer is at (x, y) in a vw x vh viewport.
 * Flips to the left of / above the pointer when it does not fit, then clamps. A menu taller than the viewport
 * gets a maxHeight and scrolls.
 */
export function placeMenu({ x, y, w, h, vw, vh, margin = MARGIN }) {
  const maxHeight = Math.max(0, vh - margin * 2);
  const height = Math.min(h, maxHeight);
  let left = x;
  let flipX = false;
  if (left + w > vw - margin) { left = x - w; flipX = true; }
  left = Math.max(margin, Math.min(left, vw - margin - w));
  let top = y;
  let flipY = false;
  if (top + height > vh - margin) {
    if (y - height >= margin) { top = y - height; flipY = true; }
    else top = vh - margin - height;
  }
  top = Math.max(margin, top);
  return { left, top, maxHeight, flipX, flipY, scroll: h > maxHeight };
}

/**
 * Submenu next to its parent item: opens to the right (overlapping the parent edge a little), flips to the left,
 * aligns its first item with the parent item and shifts up when it would leave the viewport.
 */
export function placeSubmenu({ anchor, w, h, vw, vh, margin = MARGIN, overlap = 4, pad = 6 }) {
  const maxHeight = Math.max(0, vh - margin * 2);
  const height = Math.min(h, maxHeight);
  let left = anchor.right - overlap;
  let flipX = false;
  if (left + w > vw - margin) { left = anchor.left - w + overlap; flipX = true; }
  left = Math.max(margin, Math.min(left, vw - margin - w));
  let top = anchor.top - pad;
  if (top + height > vh - margin) top = vh - margin - height;
  top = Math.max(margin, top);
  return { left, top, maxHeight, flipX, scroll: h > maxHeight };
}

const isSep = (item) => item.type === "separator";
const isActionable = (item) => item.type === "item";

/**
 * Turns the provider output into one flat item list.
 * groups: array of groups (each an array of items) or flat items. Hidden items are dropped, an empty group
 * disappears with its separator, and separators never lead, trail or double up. `disabled: "reason"` becomes
 * disabled + hint text (state is never color alone). A danger item always has an icon.
 */
export function buildItems(groups) {
  const out = [];
  const list = (groups || []).map((g) => (Array.isArray(g) ? g : [g])).filter((g) => g.length);
  for (const group of list) {
    const items = [];
    for (const raw of group) {
      if (!raw || raw.hidden) continue;
      if (raw.separator) { if (items.length && !isSep(items.at(-1))) items.push({ type: "separator" }); continue; }
      if (raw.note) { items.push({ type: "note", label: String(raw.note) }); continue; }
      if (raw.header) { items.push({ type: "header", label: String(raw.header) }); continue; }
      const disabled = Boolean(raw.disabled);
      const sub = raw.items ? buildItems([raw.items]) : null;
      const role = raw.radio ? "menuitemradio" : raw.checked !== undefined ? "menuitemcheckbox" : "menuitem";
      items.push({
        type: "item",
        id: raw.id || "",
        label: String(raw.label ?? ""),
        icon: raw.icon || (raw.danger ? "alert" : ""),
        keys: raw.keys || "",
        swatch: raw.swatch || "",
        run: raw.run,
        role,
        checked: raw.checked === undefined ? undefined : Boolean(raw.checked),
        disabled: disabled || Boolean(sub && !sub.some(isActionable)),
        hint: typeof raw.disabled === "string" ? raw.disabled : raw.hint || "",
        danger: Boolean(raw.danger),
        items: sub && sub.some(isActionable) ? sub : null,
      });
    }
    while (items.length && !isActionable(items.at(-1)) && items.at(-1).type !== "note") items.pop(); // trailing header / separator
    if (!items.some((i) => isActionable(i) || i.type === "note")) continue;
    if (out.length) out.push({ type: "separator" });
    out.push(...items);
  }
  while (out.length && isSep(out.at(-1))) out.pop();
  return out;
}

/** Indexes the arrow keys can land on (every real item, disabled ones too: they stay discoverable). */
export const focusable = (items) => items.map((item, i) => (isActionable(item) ? i : -1)).filter((i) => i >= 0);

/** Next focus index for ArrowDown / ArrowUp / Home / End with wrap-around. `from` -1 means nothing focused yet. */
export function moveIndex(items, from, key) {
  const slots = focusable(items);
  if (!slots.length) return -1;
  if (key === "Home") return slots[0];
  if (key === "End") return slots.at(-1);
  const at = slots.indexOf(from);
  if (key === "ArrowDown") return slots[at < 0 ? 0 : (at + 1) % slots.length];
  if (key === "ArrowUp") return slots[at < 0 ? slots.length - 1 : (at - 1 + slots.length) % slots.length];
  return from;
}

/**
 * Typeahead: the next item (after `from`, wrapping) whose label starts with `buffer`.
 * Typing the same letter repeatedly cycles through the items that start with it.
 */
export function typeaheadIndex(items, from, buffer) {
  const slots = focusable(items);
  if (!slots.length || !buffer) return -1;
  const text = buffer.toLocaleLowerCase();
  const cycle = text.length > 1 && [...text].every((ch) => ch === text[0]);
  const needle = cycle ? text[0] : text;
  const at = slots.indexOf(from);
  const order = [...slots.slice(at + 1), ...slots.slice(0, at + 1)];
  if (!cycle && at >= 0 && items[from].label.toLocaleLowerCase().startsWith(needle)) return from;
  return order.find((i) => items[i].label.toLocaleLowerCase().startsWith(needle)) ?? -1;
}

/** Collects typed letters for 700 ms. */
export function createTypeBuffer(ms = 700) {
  let text = "";
  let last = 0;
  return {
    push(ch, now) {
      text = now - last > ms ? ch : text + ch;
      last = now;
      return text;
    },
    reset() { text = ""; last = 0; },
  };
}

/**
 * What a key does inside an open menu level.
 * Returns { act, index } where act is move | open | activate | back | close | none.
 */
export function keyStep(items, index, key, { level = 0 } = {}) {
  const item = items[index];
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return { act: "move", index: moveIndex(items, index, key) };
  if (key === "ArrowRight") return item?.items && !item.disabled ? { act: "open", index } : { act: "none", index };
  if (key === "ArrowLeft") return level > 0 ? { act: "back", index } : { act: "none", index };
  if (key === "Enter" || key === " ") {
    if (!item) return { act: "none", index };
    if (item.items) return item.disabled ? { act: "none", index } : { act: "open", index };
    return item.disabled ? { act: "none", index } : { act: "activate", index };
  }
  if (key === "Escape") return { act: level > 0 ? "back" : "close", index };
  if (key === "Tab") return { act: "close", index };
  return { act: "none", index };
}

/** Where a keyboard-opened menu appears: under the caret / focused element, left aligned. */
export function anchorPoint(rect, { dx = 4, dy = 2 } = {}) {
  return { x: rect.left + dx, y: rect.bottom + dy };
}
