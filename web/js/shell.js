// Workspace shell: theme (D-23), density, sidebar toggle, breadcrumb. Preferences are cached in
// localStorage for flash-free boot (boot.js) and persisted server-side in `settings` (theme, density).
import { api } from "./api.js";
import { icon } from "./icons.js";

const THEMES = [["system", "sys", "시스템 설정 따름"], ["light", "sun", "라이트"], ["dark", "moon", "다크"]];
const DENSITIES = [["compact", "d-compact", "컴팩트"], ["normal", "d-normal", "기본"], ["cozy", "d-cozy", "여유"]];
const root = document.documentElement;
const state = { theme: "system", density: "normal" };
const dark = matchMedia("(prefers-color-scheme: dark)");

const cache = (k, v) => { try { localStorage.setItem("mi." + k, v); } catch { /* cache only */ } };

function paintTheme() {
  root.dataset.mode = state.theme === "system" ? (dark.matches ? "dark" : "light") : state.theme;
}

function segment(host, items, key, label) {
  host.replaceChildren(...items.map(([value, sym, name]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.value = value;
    b.title = `${label}: ${name}`;
    b.setAttribute("aria-label", `${label} ${name}`);
    b.setAttribute("aria-pressed", String(state[key] === value));
    b.append(icon(sym, "i"));
    b.addEventListener("click", () => choose(key, value));
    return b;
  }));
}

function paintSegments() {
  for (const [id, key] of [["seg-theme", "theme"], ["seg-density", "density"]]) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === state[key])));
  }
}

let saveTimer;
export function flash(ok, text) {
  const s = document.getElementById("save");
  s.classList.toggle("err", !ok);
  s.classList.add("show");
  s.lastElementChild.textContent = text;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => s.classList.remove("show"), ok ? 1600 : 6000);
}

async function choose(key, value) {
  if (state[key] === value) return;
  state[key] = value;
  cache(key, value);
  if (key === "theme") paintTheme(); else root.dataset.density = value;
  paintSegments();
  try {
    await api.putSetting(key, value);
    flash(true, "저장됨");
  } catch (e) {
    flash(false, "설정을 저장하지 못했어요 · 이 브라우저에는 적용됨");
  }
}

function setRail(off) {
  if (off) root.dataset.rail = "off"; else delete root.dataset.rail;
  const b = document.getElementById("btn-rail");
  b.setAttribute("aria-expanded", String(!off));
  cache("rail", off ? "off" : "on");
}
const toggleRail = () => setRail(root.dataset.rail !== "off");

export async function initShell() {
  segment(document.getElementById("seg-theme"), THEMES, "theme", "테마");
  segment(document.getElementById("seg-density"), DENSITIES, "density", "밀도");
  // adopt what boot.js applied from the cache, then reconcile with the server
  try { state.theme = localStorage.getItem("mi.theme") || state.theme; state.density = localStorage.getItem("mi.density") || state.density; } catch { /* defaults */ }
  paintSegments();
  setRail(root.dataset.rail === "off");
  dark.addEventListener("change", paintTheme);
  document.getElementById("btn-rail").addEventListener("click", toggleRail);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "[" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    e.preventDefault();
    toggleRail();
  });
  try {
    const s = await api.settings();
    for (const key of ["theme", "density"]) {
      if (s[key] && s[key] !== state[key]) { state[key] = s[key]; cache(key, s[key]); }
    }
    paintTheme();
    root.dataset.density = state.density;
    paintSegments();
  } catch { /* offline server: keep cached values */ }
}

// Breadcrumb: array of strings, last one is the current location.
export function setCrumb(parts) {
  const host = document.getElementById("crumb");
  host.replaceChildren();
  parts.forEach((t, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "/";
      host.append(sep);
    }
    const s = document.createElement("span");
    s.textContent = t;
    if (i === parts.length - 1) { s.className = "cur"; s.setAttribute("aria-current", "page"); }
    host.append(s);
  });
  document.title = `${parts.at(-1)} · MI_Planner`;
}
