// Pure logic for the DOI PPT import (P5-03): default selection, description building, badges, payload. No DOM.

export const fallbackTitle = (slide) => `슬라이드 ${slide.index}`;

// A picture is on by default unless it already exists in the library or repeats on most slides (a logo).
export const imageOn = (img) => !img.duplicate && !img.repeated;

export function usableImages(slide) {
  return slide.images.filter(imageOn);
}

// Slides worth importing by default: visible, not imported before, and with at least one new picture.
export function defaultSelected(slide) {
  return !slide.hidden && !slide.duplicate_slide && usableImages(slide).length > 0;
}

export function buildDescription(slide, { body = true, notes = true } = {}) {
  const parts = [];
  if (body && slide.body.trim()) parts.push(slide.body.trim());
  if (notes && slide.notes.trim()) parts.push(`[발표자 노트]\n${slide.notes.trim()}`);
  return parts.join("\n\n");
}

// Row state for every slide; `defaults` mirrors the description toggles.
export function initRows(slides, opts) {
  return slides.map((s) => ({
    index: s.index, sel: defaultSelected(s), title: s.title || "", defect_type: "",
    desc: buildDescription(s, opts), descEdited: false, open: false,
    images: Object.fromEntries(s.images.map((i) => [i.key, imageOn(i)])),
  }));
}

export function rebuildDescriptions(rows, slides, opts) {
  rows.forEach((r, i) => { if (!r.descEdited) r.desc = buildDescription(slides[i], opts); });
}

export function chosenKeys(row) {
  return Object.keys(row.images).filter((k) => row.images[k]);
}

// Reason badges shown on each slide: [kind, label]; kind drives colour (warn | info | bad).
export function slideBadges(slide) {
  const out = [];
  if (slide.duplicate_slide) out.push(["warn", slide.duplicate_slide.deleted ? "휴지통에 같은 슬라이드" : "이미 가져온 슬라이드"]);
  if (slide.hidden) out.push(["info", "숨긴 슬라이드"]);
  const dup = slide.images.filter((i) => i.duplicate).length;
  if (dup) out.push(["warn", `이미지 ${dup}장 이미 있음`]);
  const rep = slide.images.filter((i) => i.repeated).length;
  if (rep) out.push(["info", `반복 이미지 ${rep}장 제외`]);
  if (slide.skipped.length) out.push(["bad", `가져올 수 없는 그림 ${slide.skipped.length}장`]);
  if (!slide.images.length && !slide.skipped.length) out.push(["info", "이미지 없음"]);
  return out;
}

export function summarize(slides, rows) {
  let selected = 0;
  let images = 0;
  let noImage = 0;
  for (const r of rows) {
    if (!r.sel) continue;
    selected += 1;
    const n = chosenKeys(r).length;
    images += n;
    if (!n) noImage += 1;
  }
  return { total: slides.length, selected, images, noImage };
}

export const FILTERS = [["all", "전체"], ["on", "가져올 것"], ["off", "건너뜀"], ["issue", "확인 필요"]];

export function visible(slides, rows, filter) {
  return slides.filter((s, i) => {
    const r = rows[i];
    if (filter === "on") return r.sel;
    if (filter === "off") return !r.sel;
    if (filter === "issue") return s.duplicate_slide || s.skipped.length || s.images.some((x) => x.duplicate);
    return true;
  });
}

// Fields shared by every imported slide (blank = leave empty).
export function buildPayload(slides, rows, common) {
  const tags = common.tags ?? [];
  return rows.filter((r) => r.sel).map((r) => {
    const slide = slides[r.index - 1];
    const caps = {};
    for (const img of slide.images) if (img.caption) caps[img.key] = img.caption;
    return {
      index: r.index, title: r.title.trim() || slide.title || fallbackTitle(slide), description: r.desc.trim(),
      product: common.product ?? "", plan: common.plan ?? "", step: common.step ?? "", defect_type: r.defect_type.trim(),
      source_dept: common.source_dept ?? "", tags, images: chosenKeys(r), captions: caps,
    };
  });
}

// Merge `failed` rows back so the user can retry just those; returns the indexes that were created.
export function applyResult(rows, result) {
  const done = new Set(result.created.map((c) => c.index));
  for (const r of rows) if (done.has(r.index)) { r.sel = false; r.done = true; }
  return done;
}
