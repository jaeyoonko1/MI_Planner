// PowerPoint attachments (V-002): pure helpers shared by the panel, the dialog and the viewer (tested in Node).
export const EXTS = [".ppt", ".pptx", ".pptm"];
export const MAX_UPLOAD = 300 * 1024 * 1024;

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n}B`;
  return n < 1048576 ? `${Math.round(n / 1024)}KB` : `${(n / 1048576).toFixed(1)}MB`;
}

export const extOf = (name) => { const m = /\.[^.\\/]+$/.exec(String(name || "")); return m ? m[0].toLowerCase() : ""; };

// Same rules as the server (app/ppt_attach.check_link); the server stays the judge, this only gives instant feedback.
// Returns "" when the text looks usable, else a Korean message.
export function linkProblem(raw) {
  const t = String(raw || "").trim().replace(/^"(.*)"$/, "$1").trim();
  if (!t) return "";
  if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(t)) return "전체 경로로 적어 주세요. 예: D:\\보고\\주간.pptx 또는 \\\\서버\\공유\\주간.pptx";
  if (/(^|[\\/])\.\.([\\/]|$)/.test(t)) return "경로에 ‘..’ 는 쓸 수 없어요.";
  if (!EXTS.includes(extOf(t))) return "PowerPoint 파일(.pptx · .pptm · .ppt)만 연결할 수 있어요.";
  return "";
}

export function uploadProblem(file) {
  if (!file) return "";
  if (!EXTS.includes(extOf(file.name))) return "PowerPoint 파일(.pptx · .pptm · .ppt)만 올릴 수 있어요.";
  if (file.size > MAX_UPLOAD) return `파일이 너무 커요 (${MAX_UPLOAD / 1048576}MB까지). 큰 파일은 ‘링크만’으로 연결하세요.`;
  if (file.size === 0) return "빈 파일이에요.";
  return "";
}

// One word for the state chip on a card: { tone, label, hint }.
export function itemState(item) {
  if (item.missing) return { tone: "bad", label: "찾을 수 없음", hint: item.mode === "link" ? "경로가 바뀌었거나 공유 폴더에 연결되지 않았어요." : "보관함에서 파일이 사라졌어요." };
  if (item.changed) return { tone: "warn", label: "바뀜 · 새로고침 필요", hint: "파일이 수정됐어요. 새로고침하면 미리보기가 따라와요." };
  return { tone: "ok", label: item.mode === "upload" ? "보관함에 복사됨" : "링크", hint: "" };
}

// Slide navigation for the viewer. Never wraps: the first/last slide stop the arrows.
export function stepSlide(index, key, count) {
  const last = Math.max(0, count - 1);
  switch (key) {
    case "ArrowRight": case "ArrowDown": case "PageDown": case " ": return Math.min(last, index + 1);
    case "ArrowLeft": case "ArrowUp": case "PageUp": return Math.max(0, index - 1);
    case "Home": return 0;
    case "End": return last;
    default: return index;
  }
}

// Which representation the stage shows for a slide: a pre-rendered picture wins, then embedded pictures, then text.
export function stageKind(slide) {
  if (slide?.rendered) return "rendered";
  if (slide?.images?.length) return "images";
  return "text";
}

export function slideLabel(slide, n) {
  const t = (slide?.title || "").trim();
  return t ? `${n}. ${t}` : `${n}. (제목 없음)`;
}

export const mediaUrl = (page, id, img) => `/api/ppt/${id}/media/${img.key}.${img.ext}?path=${encodeURIComponent(page)}`;
export const slideUrl = (page, id, n, stamp = "") => `/api/ppt/${id}/slide/${n}?path=${encodeURIComponent(page)}${stamp ? `&v=${stamp}` : ""}`;
