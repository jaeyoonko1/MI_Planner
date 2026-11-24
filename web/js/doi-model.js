// Pure logic for the DOI library (P5-02): filtering, facets, sorting, keyboard moves, tags. No DOM, so Node can test it.

const norm = (s) => String(s ?? "").toLowerCase();

export const SORTS = {
  title: (a, b) => a.title.localeCompare(b.title, "ko"),
  product: (a, b) => a.product.localeCompare(b.product, "ko"),
  step: (a, b) => a.step.localeCompare(b.step, "ko", { numeric: true }),
  defect_type: (a, b) => a.defect_type.localeCompare(b.defect_type, "ko"),
  images: (a, b) => a.images.length - b.images.length,
  updated_at: (a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0),
};

export function haystack(item) {
  return norm([item.title, item.description, item.product, item.plan, item.step, item.defect_type, item.tool_condition,
    item.source_dept, item.source_author, item.tags.join(" "), item.images.map((i) => i.caption).join(" ")].join("\n"));
}

// state: { query, product, step, defect, tags: [], draftsOnly }. Every word of the query must appear (AND).
export function filterItems(items, state = {}) {
  const words = norm(state.query).split(/\s+/).filter(Boolean);
  const tags = (state.tags ?? []).map(norm);
  return items.filter((it) => {
    if (state.product && it.product !== state.product) return false;
    if (state.step && it.step !== state.step) return false;
    if (state.defect && it.defect_type !== state.defect) return false;
    if (state.draftsOnly && it.status !== "draft") return false;
    if (tags.length) {
      const have = it.tags.map(norm);
      if (!tags.every((t) => have.includes(t))) return false;
    }
    if (words.length) {
      const h = haystack(it);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

function count(values) {
  const map = new Map();
  for (const v of values) if (v) map.set(v, (map.get(v) ?? 0) + 1);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"));
}

// Facet counts are computed on the items that match every OTHER filter, so a chip never leads to an empty result.
export function facets(items, state = {}) {
  const without = (drop) => filterItems(items, { ...state, [drop]: drop === "tags" ? [] : "" });
  return {
    products: count(without("product").map((i) => i.product)),
    steps: count(without("step").filter((i) => !state.product || i.product === state.product).map((i) => i.step)),
    defects: count(without("defect").map((i) => i.defect_type)),
    tags: count(without("tags").flatMap((i) => i.tags)).slice(0, 40),
  };
}

export function sortItems(items, key, dir = "asc") {
  const cmp = SORTS[key];
  if (!cmp) return items.slice();
  const sign = dir === "desc" ? -1 : 1;
  return items.map((it, i) => [it, i]).sort((a, b) => sign * cmp(a[0], b[0]) || a[1] - b[1]).map((p) => p[0]);
}

// Arrow-key move inside a card grid. Returns the new index (stays put at the edges).
export function gridMove(index, key, cols, total) {
  if (total <= 0) return -1;
  const c = Math.max(1, cols);
  let next = index;
  if (key === "ArrowRight") next = index + 1;
  else if (key === "ArrowLeft") next = index - 1;
  else if (key === "ArrowDown") next = index + c;
  else if (key === "ArrowUp") next = index - c;
  else if (key === "Home") next = 0;
  else if (key === "End") next = total - 1;
  if (next < 0 || next >= total) return index;
  return next;
}

// Tags typed as "a, b #c" -> ["a", "b", "c"] (comma, # and full-width comma split; case-insensitive duplicates dropped).
export function parseTags(text, existing = []) {
  const out = [...existing];
  const seen = new Set(out.map(norm));
  for (const part of String(text ?? "").split(/[,，#\n]/)) {
    const t = part.trim().replace(/\s+/g, " ");
    if (t && !seen.has(norm(t))) { seen.add(norm(t)); out.push(t.slice(0, 40)); }
  }
  return out;
}

export function toggle(list, value) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function move(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list.slice();
  const next = list.slice();
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

// Long edge limited to `max`, never enlarged; always at least 1px.
export function thumbSize(w, h, max = 480) {
  if (!w || !h) return { w: max, h: max };
  const k = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export function metaLine(item) {
  return [item.product, item.plan, item.step].filter(Boolean).join(" · ");
}

export function originLabel(item) {
  if (item.origin !== "imported") return "";
  const from = [item.source_dept, item.source_author].filter(Boolean).join(" ");
  return from ? `가져옴 · ${from}` : "가져옴";
}

export function suggestions(values, typed, limit = 8) {
  const t = norm(typed).trim();
  return values.filter((v) => v && norm(v) !== t && (!t || norm(v).includes(t))).slice(0, limit);
}

// Which image is open in the detail panel after the list changed (keeps the same image, else the first).
export function pickImage(images, wantedId) {
  return images.find((i) => i.id === wantedId) ?? images[0] ?? null;
}
