// Pure logic for the DOI share package screens (P5-04). No DOM, so Node can test it.

export const STATE_LABEL = { new: "새 항목", identical: "이미 있음", conflict: "충돌" };
export const CHOICE_LABEL = { import: "가져오기", skip: "건너뛰기", both: "둘 다 두기", overwrite: "내 것 덮어쓰기" };
export const REASON_TEXT = {
  differs: "같은 DOI가 이미 있는데 내용이 달라요.",
  existing_imported: "이미 가져온 DOI라 읽기 전용이에요. 덮어쓸 수 없어요.",
  image_id_clash: "이미지 ID가 다른 DOI와 겹쳐요. 둘 다 두면 새 ID로 가져와요.",
};

// What a click on "scope" means for export: drafts and trashed items never leave the PC.
export function exportable(items) {
  return items.filter((i) => i.status !== "draft" && !i.deleted);
}

export function exportSummary(items) {
  const rows = exportable(items);
  const images = rows.reduce((n, i) => n + i.images.length, 0);
  const bytes = rows.reduce((n, i) => n + i.images.reduce((m, im) => m + (im.size || 0), 0), 0);
  return { count: rows.length, images, bytes, skippedDrafts: items.filter((i) => i.status === "draft").length };
}

export function defaultChoices(items) {
  return Object.fromEntries(items.map((i) => [i.uid, i.default]));
}

// Counts of what pressing the apply button would do.
export function summarize(items, choices) {
  const out = { import: 0, both: 0, overwrite: 0, skip: 0 };
  for (const i of items) out[choices[i.uid] ?? i.default] += 1;
  return out;
}

export function applyLabel(sum) {
  const n = sum.import + sum.both + sum.overwrite;
  if (!n) return "가져올 항목 없음";
  return `${n}개 가져오기`;
}

// kind: "new" -> all new items import, "skip" -> every conflict skipped, "both" -> every conflict keeps both.
export function bulk(items, choices, kind, on = true) {
  const next = { ...choices };
  for (const i of items) {
    if (kind === "new" && i.state === "new") next[i.uid] = on ? "import" : "skip";
    if (kind === "skip" && i.state === "conflict") next[i.uid] = "skip";
    if (kind === "both" && i.state === "conflict" && i.allowed.includes("both")) next[i.uid] = "both";
  }
  return next;
}

export function choiceOptions(item) {
  return item.allowed.map((a) => [a, CHOICE_LABEL[a]]);
}

export function existingLine(item) {
  const e = item.existing;
  if (!e) return "";
  const who = e.origin === "imported" ? "가져온 DOI" : "내 DOI";
  return `${who} ‘${e.title}’${e.deleted ? " (휴지통)" : ""} · 수정 ${String(e.updated_at).slice(0, 10)}`;
}

export function metaLine(item) {
  return [item.product, item.plan, item.step, item.defect_type].filter(Boolean).join(" · ");
}
