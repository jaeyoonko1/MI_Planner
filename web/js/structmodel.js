// Structure worksheet model (P2B-08): turns tasks + view (+ free layout) into one row tree for both modes.
// Group node: { kind: "group", id, label, none, level, key, value, nodeId, assign, children, items, done, parent }
// Issue node: { kind: "issue", id, task, assign, parent }
// `assign` = the field values an issue gets by sitting under that node (null removes the value).

export const FOLDER = { key: null, icon: "folder", color: "blue", label: "그룹" };

function optionLabel(field, value) {
  if (value === undefined || value === null || value === "") return null;
  const o = field?.options?.find((x) => x.value === value);
  return o ? o.label : String(value);
}

function finish(group) {
  const issues = [];
  for (const c of group.children) {
    if (c.kind === "issue") issues.push(c.task);
    else issues.push(...c.items);
  }
  group.items = issues;
  group.done = issues.filter((t) => t.status === "done").length;
}

// Classification view: group level by level. A missing value goes to "미분류" (last).
export function buildFieldTree(tasks, levels, fields) {
  const walk = (list, depth, parent) => {
    if (depth === levels.length) return list.map((t) => ({ kind: "issue", id: `i${t.id}`, task: t, assign: parent?.assign ?? {}, parent }));
    const lv = levels[depth];
    const field = fields[lv.key];
    const buckets = new Map();
    for (const t of list) {
      const raw = t.props?.[lv.key];
      const v = raw === undefined || raw === "" ? null : raw;
      if (!buckets.has(v)) buckets.set(v, []);
      buckets.get(v).push(t);
    }
    const order = (field?.options ?? []).map((o) => o.value);
    const values = [...buckets.keys()].sort((a, b) => {
      if (a === null || b === null) return a === null ? 1 : -1;
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || String(a).localeCompare(String(b), "ko");
    });
    return values.map((v) => {
      const label = optionLabel(field, v);
      const g = {
        kind: "group", id: `${parent?.id ?? ""}/${lv.key}=${JSON.stringify(v)}`, label: label ?? "미분류", none: label === null,
        level: lv, key: lv.key, value: v, assign: { ...(parent?.assign ?? {}), [lv.key]: v }, parent, children: [],
      };
      g.children = walk(buckets.get(v), depth + 1, g);
      finish(g);
      return g;
    });
  };
  return walk(tasks, 0, null);
}

// Free layout: groups and issues exactly where the saved positions put them.
export function buildFreeTree(free, tasks, levelByKey) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kids = new Map();
  const push = (parent, rec) => {
    if (!kids.has(parent)) kids.set(parent, []);
    kids.get(parent).push(rec);
  };
  for (const n of free.nodes) push(n.parent_id, { pos: n.position, g: 0, id: n.id, node: n });
  for (const it of free.items) if (byId.has(it.task_id)) push(it.node_id, { pos: it.position, g: 1, id: it.task_id, task: byId.get(it.task_id) });
  const walk = (parentId, parent) => {
    const list = (kids.get(parentId) ?? []).sort((a, b) => a.pos - b.pos || a.g - b.g || a.id - b.id);
    return list.map((r) => {
      if (r.task) return { kind: "issue", id: `i${r.id}`, task: r.task, assign: parent?.assign ?? {}, parent };
      const n = r.node;
      const bound = Boolean(n.field_key);
      const g = {
        kind: "group", id: `g${n.id}`, nodeId: n.id, label: n.label, none: false,
        level: bound ? (levelByKey[n.field_key] ?? FOLDER) : FOLDER, key: n.field_key, value: n.field_value,
        assign: bound ? { ...(parent?.assign ?? {}), [n.field_key]: n.field_value } : { ...(parent?.assign ?? {}) },
        parent, children: [],
      };
      g.children = walk(n.id, g);
      finish(g);
      return g;
    });
  };
  return walk(null, null);
}

export function flatten(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    if (n.kind === "group") flatten(n.children, out);
  }
  return out;
}

// Visible rows given the folded ids. Each carries its depth.
export function visibleRows(nodes, folded, depth = 0, out = []) {
  for (const n of nodes) {
    out.push({ node: n, depth });
    if (n.kind === "group" && !folded.has(n.id)) visibleRows(n.children, folded, depth + 1, out);
  }
  return out;
}

export const isInside = (node, ancestor) => {
  for (let n = node; n; n = n.parent) if (n === ancestor) return true;
  return false;
};
