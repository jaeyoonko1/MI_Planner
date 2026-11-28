// Context menu component (V-010). One menu for the whole app: surfaces register what they offer, this file owns
// opening (right click, Shift+F10, the Menu key), placement, submenus, keyboard model, focus return and closing.
//
//   registerContext(element, (ctx) => groups | null)   groups: [[item, ...], ...]  item: see contextmenu-core.js buildItems
//
// Providers on every ancestor of the click are asked innermost first and their groups are joined (one separator
// between groups), so a table cell inside a note shows cell items, then text items, then column items.
// Ctrl+right click always gives the browser's own menu (spelling, translate, inspect).
import { icon } from "./icons.js";
import {
  anchorPoint, buildItems, createTypeBuffer, focusable, keyStep, placeMenu, placeSubmenu, typeaheadIndex,
} from "./contextmenu-core.js";
import { toast } from "./toast.js";

const registry = new WeakMap();
const POPOVER = typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
const SUB_DELAY = 140;
const EDITABLE = "input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=range]), textarea, [contenteditable=''], [contenteditable='true']";

let openState = null; // { menus: [menu], origin, restore, ctx }
let keyOpenedAt = 0;

export function registerContext(node, provider) {
  const list = registry.get(node) || [];
  list.push(provider);
  registry.set(node, list);
  return () => {
    const rest = (registry.get(node) || []).filter((p) => p !== provider);
    rest.length ? registry.set(node, rest) : registry.delete(node);
  };
}

export const isMenuOpen = () => Boolean(openState);
export const inMenu = (node) => Boolean(openState && node instanceof Node && openState.menus.some((m) => m.el.contains(node)));
export const editableOf = (node) => (node instanceof Element ? node.closest(EDITABLE) : null);

// ---- clipboard ----------------------------------------------------------------------------------------

/** Reads text / html / pictures from the system clipboard. null when the browser refuses (permission, focus). */
export async function readClipboard() {
  try {
    const out = { text: "", html: "", files: [] };
    for (const item of await navigator.clipboard.read()) {
      for (const type of item.types) {
        const blob = await item.getType(type);
        if (type === "text/plain") out.text = await blob.text();
        else if (type === "text/html") out.html = await blob.text();
        else if (type.startsWith("image/")) out.files.push(new File([blob], "clipboard." + type.slice(6).replace("jpeg", "jpg"), { type }));
      }
    }
    return out;
  } catch {
    try { return { text: await navigator.clipboard.readText(), html: "", files: [] }; } catch { return null; }
  }
}

/** Paste through the element's own paste handler (a synthetic event), so tables, notes and fields behave like Ctrl+V. */
export async function pasteClipboard(plain = false) {
  const clip = await readClipboard();
  if (!clip || (!clip.text && !clip.html && !clip.files.length)) {
    toast(clip ? "붙여넣을 내용이 없어요" : "클립보드를 읽지 못했어요 · Ctrl+V로 붙여넣어 주세요", { error: !clip });
    return false;
  }
  const field = document.activeElement || document.body;
  const data = new DataTransfer();
  if (clip.text) data.setData("text/plain", clip.text);
  if (!plain) {
    if (clip.html) data.setData("text/html", clip.html);
    clip.files.forEach((file) => data.items.add(file));
  }
  const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
  field.dispatchEvent(event);
  if (!event.defaultPrevented && clip.text) document.execCommand("insertText", false, clip.text);
  return true;
}

const hasSelection = (field) => {
  if (!field) return false;
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) return field.selectionStart !== field.selectionEnd;
  const sel = getSelection();
  return Boolean(sel && !sel.isCollapsed && field.contains(sel.anchorNode));
};

/**
 * Cut / copy / paste / select all for an editable element. `extra` adds items after "붙여넣기" (note: paste as text).
 * Used as the whole menu in plain fields and as one group inside richer menus.
 */
export function textGroup(field, { plain = true, readonly = false } = {}) {
  const selected = hasSelection(field);
  const locked = readonly || field.readOnly || field.disabled;
  return [
    { id: "cut", label: "잘라내기", icon: "cut", keys: "Ctrl+X", disabled: locked ? "읽기 전용" : !selected && "선택한 글이 없어요", run: () => document.execCommand("cut") },
    { id: "copy", label: "복사", icon: "copy", keys: "Ctrl+C", disabled: !selected && "선택한 글이 없어요", run: () => document.execCommand("copy") },
    { id: "paste", label: "붙여넣기", icon: "paste", keys: "Ctrl+V", disabled: locked && "읽기 전용", run: () => pasteClipboard(false) },
    plain ? { id: "paste-plain", label: "텍스트로 붙여넣기", icon: "paste-plain", keys: "Ctrl+Shift+V", disabled: locked && "읽기 전용", run: () => pasteClipboard(true) } : null,
    { id: "select-all", label: "모두 선택", icon: "select-all", keys: "Ctrl+A", run: () => (field.select ? field.select() : document.execCommand("selectAll")) },
  ].filter(Boolean);
}

const NATIVE_HINT = { note: "맞춤법·번역 등 브라우저 메뉴는 Ctrl+우클릭" };

// ---- opening ------------------------------------------------------------------------------------------

function collect(target, ctx) {
  const groups = [];
  const seen = new Set();
  for (let node = target; node; node = node.parentElement) {
    for (const provider of registry.get(node) || []) {
      if (seen.has(provider)) continue;
      seen.add(provider);
      let out;
      try { out = provider({ ...ctx, node }); } catch (error) { console.error(error); continue; }
      if (!out) continue;
      const list = (Array.isArray(out) ? out : [out]).filter(Boolean);
      if (list.length && list.every(Array.isArray)) groups.push(...list); else groups.push(list);
    }
  }
  if (!groups.length) {
    const field = editableOf(target);
    if (field) groups.push(textGroup(field));
  }
  const items = buildItems(groups);
  if (items.length && editableOf(target)) items.push({ type: "note", label: NATIVE_HINT.note });
  return items;
}

function pointFor(target) {
  const field = editableOf(target);
  if (field && field.isContentEditable) {
    const sel = getSelection();
    if (sel?.rangeCount && field.contains(sel.anchorNode)) {
      const rects = sel.getRangeAt(0).getClientRects();
      const r = rects[0] || sel.getRangeAt(0).getBoundingClientRect();
      if (r && (r.width || r.height)) return anchorPoint(r, { dx: 0, dy: 4 });
    }
  }
  const box = (target.closest?.("td, th, .srow, .trow, [role=treeitem], li") || target).getBoundingClientRect();
  const tall = box.height > 160;
  return { x: box.left + Math.min(28, Math.max(0, box.width / 2)), y: tall ? box.top + 28 : box.bottom - 2 };
}

/** Opens the menu for `target`. Returns true when something was shown. */
export function openFor(target, { x, y, keyboard = false, event = null } = {}) {
  if (!(target instanceof Element)) target = document.body;
  const ctx = { event, target, keyboard, x, y, origin: document.activeElement };
  const items = collect(target, ctx);
  if (!items.length) return false;
  const at = x === undefined ? pointFor(target) : { x, y };
  openMenu({ items, x: at.x, y: at.y, keyboard, label: "바로 가기 메뉴", host: target.closest("dialog[open]") });
  return true;
}

function snapshotSelection(origin) {
  const field = editableOf(origin) || (origin instanceof Element ? origin.closest("[contenteditable]") : null);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return () => {
      try { field.focus({ preventScroll: true }); field.setSelectionRange(field.selectionStart, field.selectionEnd, field.selectionDirection); } catch { /* detached */ }
    };
  }
  const sel = getSelection();
  const range = sel?.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  return () => {
    if (!origin?.isConnected) return;
    origin.focus?.({ preventScroll: true });
    if (range && range.startContainer.isConnected) { sel.removeAllRanges(); sel.addRange(range); }
  };
}

export function openMenu({ items, x, y, keyboard = false, label = "메뉴", host = null }) {
  closeMenu(false);
  const built = items[0]?.type ? items : buildItems(items);
  if (!built.some((i) => i.type === "item")) return null;
  const origin = document.activeElement;
  openState = { menus: [], origin, host, restore: snapshotSelection(origin), typing: createTypeBuffer(), timer: 0, at: performance.now() };
  const menu = mount(built, null, label);
  place(menu, (el) => placeMenu({ x, y, w: el.offsetWidth, h: el.offsetHeight, vw: innerWidth, vh: innerHeight }));
  listen();
  reveal(menu);
  if (keyboard) focusItem(menu, focusable(built)[0]); else menu.el.focus({ preventScroll: true });
  return menu;
}

export function closeMenu(restoreFocus = true) {
  const state = openState;
  if (!state) return;
  openState = null;
  clearTimeout(state.timer);
  unlisten();
  for (const menu of [...state.menus].reverse()) {
    try { menu.el.hidePopover?.(); } catch { /* not shown */ }
    menu.el.remove();
  }
  if (restoreFocus) state.restore();
}

// ---- building the DOM -----------------------------------------------------------------------------------

function mount(items, parent, label) {
  const el = document.createElement("div");
  el.className = "cx";
  el.setAttribute("role", "menu");
  el.setAttribute("aria-label", label);
  el.tabIndex = -1;
  if (POPOVER) el.setAttribute("popover", "manual");
  const menu = { el, items, parent, level: parent ? parent.level + 1 : 0, index: -1, sub: null, buttons: [] };
  items.forEach((item, i) => {
    if (item.type === "separator") { const s = document.createElement("div"); s.className = "cx-sep"; s.setAttribute("role", "separator"); el.append(s); return; }
    if (item.type === "header" || item.type === "note") {
      const n = document.createElement("div");
      n.className = item.type === "header" ? "cx-hd" : "cx-note";
      n.setAttribute("role", "presentation");
      n.textContent = item.label;
      el.append(n);
      return;
    }
    el.append(itemButton(menu, item, i));
  });
  el.addEventListener("pointerdown", (e) => e.stopPropagation());
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  (openState.host || document.body).append(el);
  openState.menus.push(menu);
  return menu;
}

function itemButton(menu, item, i) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "cx-i" + (item.danger ? " cx-danger" : "");
  b.tabIndex = -1;
  b.setAttribute("role", item.role);
  if (item.checked !== undefined) b.setAttribute("aria-checked", String(item.checked));
  if (item.disabled) b.setAttribute("aria-disabled", "true");
  if (item.items) { b.setAttribute("aria-haspopup", "menu"); b.setAttribute("aria-expanded", "false"); }
  if (item.keys) b.setAttribute("aria-keyshortcuts", item.keys);
  const lead = document.createElement("span");
  lead.className = "cx-ic";
  if (item.swatch) {
    const dot = document.createElement("i");
    dot.className = "cx-sw" + (item.swatch === "auto" ? " auto" : "");
    if (item.swatch !== "auto") dot.style.setProperty("--sw", item.swatch);
    lead.append(dot);
  } else if (item.checked !== undefined) { lead.classList.add("cx-chk"); if (item.checked) lead.append(icon("check", "i")); }
  else if (item.icon) lead.append(icon(item.icon, "i"));
  const text = document.createElement("span");
  text.className = "cx-l";
  text.textContent = item.label;
  const tail = document.createElement("span");
  tail.className = "cx-r";
  if (item.disabled && item.hint) { tail.classList.add("cx-h"); tail.textContent = item.hint; }
  else if (item.items) tail.append(icon("chev", "i s"));
  else if (item.swatch && item.checked) tail.append(icon("check", "i s ck"));
  else if (item.keys) { tail.classList.add("cx-k"); tail.textContent = item.keys; }
  if (item.hint && !item.disabled) b.title = item.hint;
  b.append(lead, text, tail);
  b.addEventListener("pointermove", () => hover(menu, i, b));
  b.addEventListener("click", (e) => { e.preventDefault(); activate(menu, i); });
  menu.buttons[i] = b;
  return b;
}

function place(menu, compute) {
  const el = menu.el;
  el.style.visibility = "hidden";
  el.style.left = "0px";
  el.style.top = "0px";
  if (POPOVER) { try { el.showPopover(); } catch { /* already open */ } }
  const spot = compute(el);
  el.style.left = spot.left + "px";
  el.style.top = spot.top + "px";
  if (spot.scroll) el.style.maxHeight = spot.maxHeight + "px";
  el.style.setProperty("--cx-ox", spot.flipX ? "100%" : "0%");
  el.style.setProperty("--cx-oy", spot.flipY ? "100%" : "0%");
  el.style.visibility = "";
}

function reveal(menu) {
  requestAnimationFrame(() => menu.el.setAttribute("data-open", ""));
}

// ---- interaction ----------------------------------------------------------------------------------------

function focusItem(menu, index) {
  if (index === undefined || index < 0) return;
  menu.index = index;
  menu.buttons[index]?.focus({ preventScroll: false });
  menu.buttons[index]?.scrollIntoView({ block: "nearest" });
}

function hover(menu, index, button) {
  const state = openState;
  if (!state || menu.index === index && document.activeElement === button) return;
  clearTimeout(state.timer);
  menu.index = index;
  button.focus({ preventScroll: true });
  const item = menu.items[index];
  if (menu.sub && menu.sub.parentIndex !== index) closeSub(menu);
  if (item.items && !item.disabled && !menu.sub) state.timer = setTimeout(() => openSub(menu, index, false), SUB_DELAY);
}

function closeSub(menu) {
  const sub = menu.sub;
  if (!sub || !openState) return;
  closeSub(sub);
  try { sub.el.hidePopover?.(); } catch { /* gone */ }
  sub.el.remove();
  openState.menus = openState.menus.filter((m) => m !== sub);
  menu.buttons[sub.parentIndex]?.setAttribute("aria-expanded", "false");
  menu.sub = null;
}

function openSub(menu, index, byKey) {
  const item = menu.items[index];
  if (!item?.items || item.disabled || !openState) return;
  if (menu.sub && menu.sub.parentIndex === index) { if (byKey) focusItem(menu.sub, focusable(menu.sub.items)[0]); return; }
  closeSub(menu);
  const button = menu.buttons[index];
  const sub = mount(item.items, menu, item.label);
  sub.parentIndex = index;
  menu.sub = sub;
  button.setAttribute("aria-expanded", "true");
  const anchor = button.getBoundingClientRect();
  place(sub, (el) => placeSubmenu({ anchor, w: el.offsetWidth, h: el.offsetHeight, vw: innerWidth, vh: innerHeight }));
  reveal(sub);
  if (byKey) focusItem(sub, focusable(sub.items)[0]);
}

async function activate(menu, index) {
  const item = menu.items[index];
  if (!item || item.disabled) return;
  if (item.items) { openSub(menu, index, true); return; }
  closeMenu(true);
  try {
    await item.run?.();
  } catch (error) {
    toast(error?.message || "실행하지 못했어요", { error: true });
  }
}

const activeMenu = () => {
  const el = document.activeElement;
  return openState?.menus.find((m) => m.el.contains(el)) || openState?.menus.at(-1);
};

function onKey(e) {
  if (!openState || e.isComposing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) { closeMenu(false); return; }
  const menu = activeMenu();
  if (!menu) return;
  const step = keyStep(menu.items, menu.index, e.key, { level: menu.level });
  if (step.act === "none") {
    if (e.key.length === 1 && e.key !== " ") {
      const buffer = openState.typing.push(e.key, performance.now());
      const hit = typeaheadIndex(menu.items, menu.index, buffer);
      if (hit >= 0) focusItem(menu, hit);
      e.preventDefault();
      e.stopPropagation();
    }
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (step.act === "move") focusItem(menu, step.index);
  else if (step.act === "open") openSub(menu, step.index, true);
  else if (step.act === "activate") activate(menu, step.index);
  else if (step.act === "back") { const parent = menu.parent; closeSub(parent); focusItem(parent, parent.index); }
  else if (step.act === "close") closeMenu(true);
}

const onPointerDown = (e) => { if (!inMenu(e.target)) closeMenu(false); };
// Scrolls in the first moments come from the surface reacting to the click (a side panel opening): not the user's.
const onScroll = (e) => { if (!inMenu(e.target) && performance.now() - openState.at > 400) closeMenu(false); };
const onFocusIn = (e) => { if (openState && !inMenu(e.target) && e.target !== openState.origin) closeMenu(false); };
const onBlur = () => closeMenu(false);
const onHidden = () => { if (document.hidden) closeMenu(false); };

function listen() {
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("scroll", onScroll, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("visibilitychange", onHidden);
  window.addEventListener("resize", onBlur);
  window.addEventListener("blur", onBlur);
}

function unlisten() {
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("scroll", onScroll, true);
  document.removeEventListener("focusin", onFocusIn, true);
  document.removeEventListener("visibilitychange", onHidden);
  window.removeEventListener("resize", onBlur);
  window.removeEventListener("blur", onBlur);
}

// ---- global triggers -----------------------------------------------------------------------------------------

function onContextMenu(e) {
  if (e.defaultPrevented) return;
  if (inMenu(e.target)) { e.preventDefault(); return; }
  if (e.ctrlKey) { closeMenu(false); return; } // Ctrl + right click: the browser's own menu
  if (e.target instanceof Element && e.target.closest("[data-native-menu]")) return;
  const fromKey = e.button !== 2 && !e.clientX && !e.clientY;
  if (fromKey && performance.now() - keyOpenedAt < 700) { e.preventDefault(); return; }
  const shown = openFor(e.target, fromKey ? {} : { x: e.clientX, y: e.clientY, event: e });
  if (shown) e.preventDefault(); else closeMenu(false);
}

function onGlobalKey(e) {
  if (openState || e.isComposing) return;
  const menuKey = e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey);
  if (!menuKey || e.ctrlKey || e.metaKey || (e.altKey && e.key !== "ContextMenu")) return;
  if (document.querySelector("dialog[open]") && !e.target.closest?.("dialog[open]")) return;
  const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  if (!target || (target.closest?.("[data-native-menu]"))) return;
  if (openFor(target, { keyboard: true })) { keyOpenedAt = performance.now(); e.preventDefault(); e.stopPropagation(); }
}

let installed = false;
export function installContextMenu() {
  if (installed) return;
  installed = true;
  document.addEventListener("contextmenu", onContextMenu);
  document.addEventListener("keydown", onGlobalKey, true);
}
