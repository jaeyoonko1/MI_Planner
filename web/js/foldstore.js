// Where memo/note fold state lives: `settings.memo_folds` (JSON {scope: [heading keys]}), never in the text file.
// scope = "t:<issue id>" for an issue memo / issue page (same scope, so both views fold alike), else "p:<page path>".
import { api } from "./api.js";

let cache = null;
let loading = null;
let timer = null;

async function load() {
  if (cache) return cache;
  loading ||= api.settings().then((s) => {
    try { const v = JSON.parse(s.memo_folds || "{}"); cache = v && typeof v === "object" && !Array.isArray(v) ? v : {}; }
    catch { cache = {}; }
    return cache;
  }).catch(() => (cache = {}));
  return loading;
}

export async function getFolds(scope) {
  const all = await load();
  return new Set(Array.isArray(all[scope]) ? all[scope] : []);
}

export async function setFolds(scope, set) {
  const all = await load();
  if (set.size) all[scope] = [...set]; else delete all[scope];
  clearTimeout(timer);
  timer = setTimeout(() => api.putSetting("memo_folds", JSON.stringify(all)).catch(() => {}), 400);
}
