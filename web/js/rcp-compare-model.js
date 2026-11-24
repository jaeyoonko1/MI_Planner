// Pure helpers for the recipe comparison / history / diff views (P6-04). Node-testable, no DOM.

export const MAX_COLUMNS = 6;
export const MIN_COLUMNS = 2;

/** Rows kept by the "다른 것만 / 전체" chip, the group chip (undefined = all groups) and the search text. */
export function filterCompareRows(rows, { onlyDiff = true, group = null, query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!onlyDiff || r.diff) && (group === null || r.group === group)
    && (!q || [r.path, r.label, r.file, r.group, ...r.values].some((t) => t != null && String(t).toLowerCase().includes(q))));
}

/** Flat list for a virtual table: a group header item before each group's rows (rows without a group last, "기타"). */
export function withGroupHeaders(rows) {
  const order = [];
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.group)) { map.set(r.group, []); order.push(r.group); }
    map.get(r.group).push(r);
  }
  const named = order.filter((g) => g);
  const names = map.has("") ? [...named, ""] : named;
  const out = [];
  for (const g of names) {
    const list = map.get(g);
    out.push({ kind: "group", text: g || "기타", count: list.length, diffs: list.filter((r) => r.diff).length });
    for (const r of list) out.push({ kind: "row", row: r });
  }
  return out;
}

export const MISSING = "없음";

/** What a cell shows: the value, "없음" when the recipe lacks the parameter. A marked cell is also prefixed (not color only). */
export function cellText(row, i) {
  const v = row.values[i];
  if (v === null || v === undefined) return MISSING;
  return v === "" ? "(빈 값)" : v;
}

export function cellMarker(row, i) {
  const m = row.marks[i];
  return m === "d" ? "≠" : m === "m" ? "∅" : "";
}

/** Screen-reader / tooltip sentence for a marked cell. */
export function cellTitle(row, i, columns) {
  const m = row.marks[i];
  if (!m) return "";
  const name = columns[i]?.name ?? `${i + 1}열`;
  if (m === "m") return `${name}에는 이 항목이 없어요`;
  const ref = row.values.find((v) => v != null);
  const a = Number(String(ref).replace(/,/g, "")), b = Number(String(row.values[i]).replace(/,/g, ""));
  const tol = row.compare === "number" && row.tolerance ? ` (허용 ±${fmt(row.tolerance)})` : "";
  if (row.compare === "number" && Number.isFinite(a) && Number.isFinite(b)) return `${name}: 기준과 ${fmt(b - a, true)} 차이${tol}`;
  return `${name}: 기준 값과 달라요`;
}

export function fmt(n, signed = false) {
  const t = Number.parseFloat(Number(n).toPrecision(8)).toString();
  return signed && n > 0 ? `+${t}` : t;
}

/** Text for one-click copy: header + one line per row, tab separated, newlines inside values flattened. */
export function compareTSV(columns, rows) {
  const clean = (t) => String(t ?? "").replace(/[\t\r\n]+/g, " ");
  const head = ["그룹", "파일", "이름", "경로", "단위", "판정", ...columns.map((c) => c.name)];
  const lines = [head.map(clean).join("\t")];
  for (const r of rows) {
    lines.push([r.group, r.file, r.label, r.path, r.unit, r.diff ? "다름" : "같음",
      ...r.values.map((v, i) => (v === null ? MISSING : v))].map(clean).join("\t"));
  }
  return lines.join("\n");
}

export const DIFF_STATUS = {
  added: ["추가", "＋"], removed: ["삭제", "－"], changed: ["변경", "≠"], same: ["같음", ""],
};

/** Diff rows kept by the status chip ("" = all changes), plus search. */
export function filterDiffRows(rows, { status = "", query = "" } = {}) {
  const q = query.trim().toLowerCase();
  return rows.filter((r) => (!status || r.status === status) && (!q
    || [r.path, r.label, r.file, r.group, r.old, r.new].some((t) => t != null && String(t).toLowerCase().includes(q))));
}

export function diffTSV(rows) {
  const clean = (t) => String(t ?? "").replace(/[\t\r\n]+/g, " ");
  const lines = [["상태", "그룹", "파일", "이름", "경로", "이전 값", "새 값", "단위"].join("\t")];
  for (const r of rows) {
    lines.push([DIFF_STATUS[r.status][0], r.group, r.file, r.label, r.path, r.old ?? "", r.new ?? "", r.unit].map(clean).join("\t"));
  }
  return lines.join("\n");
}

/** "추가 2 · 삭제 1 · 변경 3" (zero parts dropped); "변경 없음" when nothing changed; "최초 수집" for no summary. */
export function summaryText(s) {
  if (!s) return "최초 수집";
  const parts = [];
  if (s.added) parts.push(`추가 ${s.added}`);
  if (s.removed) parts.push(`삭제 ${s.removed}`);
  if (s.changed) parts.push(`변경 ${s.changed}`);
  if (!parts.length && (s.files_changed || s.files_added || s.files_removed)) return "파라미터는 같고 파일만 달라요";
  return parts.length ? parts.join(" · ") : "변경 없음";
}

/** Basket of recipes picked for comparison: keeps insertion order, caps at MAX_COLUMNS, toggles by id. */
export function toggleBasket(basket, item) {
  const has = basket.some((b) => b.id === item.id);
  if (has) return { basket: basket.filter((b) => b.id !== item.id), full: false };
  if (basket.length >= MAX_COLUMNS) return { basket, full: true };
  return { basket: [...basket, item], full: false };
}

export const compareIds = (basket) => basket.map((b) => b.id).join(",");
