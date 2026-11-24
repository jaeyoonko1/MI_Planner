// Pure model for the issue inspector's classification rows (V-006). No DOM, so Node tests can run it.
// Every active choice/multi classification gets a row; the current value is always visible even when
// its option was archived, deleted or renamed; a classification with no options says so.

const PICKABLE = ["choice", "multi"];

// Options in tree order (parents first, children indented one level); archived options are left out
// unless the issue still uses them. Orphan values (no option any more) are appended last.
export function optionChips(field, current) {
  const used = new Set(Array.isArray(current) ? current : current == null ? [] : [current]);
  const all = (field.options || []).filter((o) => !o.archived || used.has(o.value));
  const ids = new Set(all.map((o) => o.value));
  const kids = new Map();
  for (const o of all) {
    const p = o.parent != null && ids.has(o.parent) ? o.parent : null;
    if (!kids.has(p)) kids.set(p, []);
    kids.get(p).push(o);
  }
  const out = [];
  const seen = new Set();
  const walk = (p, depth) => {
    for (const o of kids.get(p) || []) {
      if (seen.has(o.value)) continue;
      seen.add(o.value);
      out.push({ value: o.value, label: o.label ?? String(o.value), depth, color: o.color || null, archived: !!o.archived, orphan: false });
      walk(o.value, depth + 1);
    }
  };
  walk(null, 0);
  for (const v of used) {
    if (!out.some((c) => c.value === v)) out.push({ value: v, label: String(v), depth: 0, color: null, archived: false, orphan: true });
  }
  return out;
}

export function classRows(fields, props) {
  const rows = [];
  for (const f of fields || []) {
    if (f.builtin || f.archived || !PICKABLE.includes(f.type)) continue;
    const current = props?.[f.key] ?? (f.type === "multi" ? [] : null);
    const chips = optionChips(f, current);
    rows.push({ key: f.key, label: f.label, type: f.type, current, chips, empty: chips.length === 0 });
  }
  return rows;
}

export function toggleMulti(current, value) {
  const set = new Set(current || []);
  set.has(value) ? set.delete(value) : set.add(value);
  return [...set];
}
