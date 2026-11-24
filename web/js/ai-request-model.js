// "AI에게 요청" (P7-03): pure builder of the request text copied to the clipboard. No DOM, no network.
// The text tells an agent (company OpenCode / Claude Code) where the user is, what is selected, and which skill to read.

export const SELECTION_LIMIT = 4000;

const SCREENS = {
  today: ["오늘 화면", "할일·일지: python -m app.cli task list --open"],
  todos: ["할일 화면", "python -m app.cli task list --open"],
  evaluations: ["평가 현황판", "python -m app.cli eval list / eval show ID / eval stalled"],
  week: ["주간 일지", "일지 파일은 vault/ 의 월 페이지(index.md)"],
  structure: ["구조 화면", "python -m app.cli task list"],
  plans: ["MI 정보 · Plan/Step", "앱 화면의 데이터(정형)"],
  rcp: ["MI 정보 · RCP 관리", "읽기 전용 (레시피 쓰기 금지, D-11)"],
  doi: ["MI 정보 · DOI 라이브러리", "앱 화면의 데이터(정형)"],
};

/** Where the user is: `{kind, label, file, hint}` from a location hash such as "#/today" or "#/MI/셋업/EQ-A01". */
export function describeLocation(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const first = raw.split("/")[0];
  if (SCREENS[first]) return { kind: first, label: SCREENS[first][0], file: "", hint: SCREENS[first][1] };
  if (!raw) return { kind: "home", label: "홈", file: "", hint: "" };
  let path = raw;
  try { path = decodeURIComponent(raw); } catch { /* keep raw */ }
  path = path.replace(/^\/+|\/+$/g, "");
  return { kind: "page", label: "페이지 " + path, file: "vault/" + path + "/", hint: "페이지 = 폴더 1개(_page.json + index.md 또는 index.html)" };
}

export function clipSelection(text, limit = SELECTION_LIMIT) {
  const t = String(text || "").replace(/\r\n?/g, "\n").trim();
  if (t.length <= limit) return { text: t, cut: 0 };
  return { text: t.slice(0, limit), cut: t.length - limit };
}

/** Toggle one skill name in the chosen list (keeps order of selection). */
export function toggleSkill(chosen, name) {
  return chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
}

/** opts: { hash, selection, skills: [name], request } -> request text (Korean, plain text). */
export function buildRequest({ hash = "", selection = "", skills = [], request = "" } = {}) {
  const loc = describeLocation(hash);
  const sel = clipSelection(selection);
  const lines = ["[MI_Planner 요청]", `현재 위치: ${loc.label}`];
  if (loc.file) lines.push(`파일 위치: ${loc.file}`);
  if (loc.hint) lines.push(`참고: ${loc.hint}`);
  if (sel.text) {
    lines.push("", "선택한 내용:", '"""', sel.text, '"""');
    if (sel.cut) lines.push(`(길어서 ${sel.cut}자는 잘렸습니다. 필요하면 위 위치의 파일을 직접 읽으세요.)`);
  }
  if (skills.length) {
    lines.push("", "사용할 스킬 (먼저 읽고 절차를 따를 것):");
    for (const s of skills) lines.push(`- skills/${s}/SKILL.md`);
  }
  lines.push("", "요청:", String(request).trim() || "(여기에 요청을 적어 주세요)");
  lines.push(
    "", "규칙:",
    "- 정형 데이터는 `python -m app.cli ...`(AGENTS.md 9장)로만 읽고 쓴다. DB 파일을 직접 고치지 않는다.",
    "- 노트·일지는 vault/ 의 일반 파일. 삭제는 vault/.trash/ 로 옮긴다.",
    "- 외부 네트워크 금지. RCP(레시피) 쓰기 금지.",
  );
  return lines.join("\n");
}
