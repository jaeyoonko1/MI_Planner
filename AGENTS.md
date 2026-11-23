# MI_Planner — 에이전트 공통 작업 규칙

> Claude Code, Codex, 사내 OpenCode가 **모두 이 파일을 기준**으로 일한다.
> `CLAUDE.md`는 이 파일을 불러오기만 한다. 규칙을 바꿀 때는 이 파일만 고친다.
## 0. UI UX 최우선
- **UI를 건드리는 모든 작업은 먼저 `docs/DESIGN.md`를 읽고, 기준 시안 `web/design/prototype_final.html`과 일치시킨다.** 시안과 다르게 구현하려면 사용자에게 먼저 묻는다.
- 디자인 이쁘고 수석 애플 엔지니어가 짠것 같은 모던하고 fancy 한 디자인 핋수 
- ux 도 더이상 수정할게 없을정도로 고민하고 설계 할것 

## 1. 프로젝트 한 줄 요약
반도체 검사·계측(MI) 엔지니어 1인용 **로컬 업무 워크스페이스**.
원노트식 계층 페이지(노트·interactive HTML) + 월간 일지 + 할일 + 설비 평가 현황판 + MI 정보·RCP 관리를 한 곳에서.
집 PC에서 개발 → 회사 Windows PC(보안망, 외부 인터넷 불가 가정)로 옮겨 쓴다.

## 2. 세션 시작 시 읽는 순서
1. `docs/SPEC.md` — 무엇을 만드는가 (데이터 모델, 화면, API)
2. `docs/DESIGN.md` — 각 작업의 새 세션과 하위 워커가 관련 절을 읽는다. UI 변경은 `web/design/prototype_final.html`까지 읽고 구현·검증한다.
2. `docs/DECISIONS.md` — 확정된 결정 / 아직 미결인 질문
3. `docs/WORKLOG.md` 맨 위 1~2개 항목 — 직전 세션이 어디서 멈췄는가
4. `project_flow.html` 상단의 `FLOW` 데이터 — 현재 단계와 다음 작업 ID

전부 다 읽지 말고 이번 작업에 필요한 부분만 읽는다.

## 3. 절대 규칙 (회사 이식 조건)
- **외부 네트워크 호출 금지**: CDN, 웹폰트, 텔레메트리, 외부 API 모두 금지.
  프론트 라이브러리는 `web/vendor/`에 파일로 넣는다.
- **저장은 두 곳뿐** (D-03): 노트·일지·HTML 페이지는 `vault/`의 일반 파일, 정형 데이터는 `data/mi_planner.db`. 클라우드 저장 금지.
  - 페이지 = 폴더 1개(`_page.json` + `index.md|index.html`), 하위 페이지 = 하위 폴더 (D-08).
  - vault 파일 형식은 사람과 LLM이 그대로 읽을 수 있게 유지한다(독자 바이너리·난독화 금지).
  - 삭제는 `vault/.trash/`로 이동. 파일을 바로 지우지 않는다.
- **레시피 쓰기 금지 (D-11)**: RCP 관리 기능은 설정에서 명시적으로 켜기 전까지 읽기 전용. 쓰기 코드는 백업·diff·확인·로그 없이 만들지 않는다.
- **UI는 드롭다운 대신 버튼·토글 칩** (D-12).
- **사외 반출 금지 (D-17)**: 회사 데이터는 집으로 오지 않는다. 집에서는 가짜 데이터로만 개발·테스트한다.
- **대상 브라우저는 Chromium 계열** (Edge·Chrome·웨일, D-16). 사내 LLM 주소·키·프록시는 `config/local.json`(git 제외)에서만 읽는다.
- **Windows 우선**: 경로는 `pathlib`, 실행 진입점은 `run.bat`. bash 전용 스크립트에만 의존하는 기능 금지.
- **의존성 최소화**: 새 패키지를 추가하면 `docs/DECISIONS.md`에 이유를 기록한다.
  순수 파이썬 패키지를 우선하고, 컴파일이 필요한 패키지는 피한다.
- **실제 회사 데이터 금지**: 코드·테스트·샘플에 실제 Lot ID, 설비명, 레시피명을 넣지 않는다.
  샘플은 `LOT-TEST-001`, `EQ-A01` 같은 가짜 값만 쓴다.

## 4. 기술 스택 (D-01, 잠정 — DECISIONS.md 참고)
- Backend: Python 3.11+, FastAPI, uvicorn, 표준 `sqlite3` (ORM 없이 얇은 repository 계층)
- Frontend: 빌드 도구 없는 vanilla JS(ES modules) + HTML/CSS
  - 표: Tabulator (`web/vendor/`에 로컬 파일로). 노트 편집기는 P3-01에서 결정.
- 테스트: pytest
- 실행: `run.bat` → `http://127.0.0.1:8765` 자동으로 브라우저 열기

## 5. 폴더 구조 (목표)
```
MI_Planner/
├─ AGENTS.md  CLAUDE.md  README.md  project_flow.html  run.bat
├─ app/            # FastAPI: main.py, db.py, vault.py, cli.py, repositories/, routers/
├─ parsers/        # 레시피 파서 플러그인 (P6)
├─ migrations/     # 001_init.sql, 002_xxx.sql … (추가만, 기존 파일 수정 금지)
├─ web/            # index.html, js/, css/, vendor/
├─ skills/         # 에이전트용 스킬 (SKILL.md) — P7
├─ scripts/        # seed_sample.py, backup.py, dcoll 수집 등
├─ tests/          # 테스트는 tmp 폴더에 가짜 vault/DB를 만들어 쓴다
├─ vault/          # 사용자 페이지 (git 제외, 샘플은 scripts/seed로 생성)
├─ data/           # mi_planner.db (git 제외)
└─ docs/           # SPEC.md, DECISIONS.md, WORKLOG.md
```

## 6. 작업 방식
- **한 세션 = flow의 작업 1개.** 작업 ID(예: `P2-03`)를 먼저 말하고 시작한다. 다음 항목은 새 워커·새 세션 또는 `/clear` 후 시작하고, 위 읽기 순서대로 `docs/DESIGN.md`를 확인한다.
- 시작 전: 3~7줄짜리 계획을 먼저 제시 → 구현 → 테스트 실행 → 결과 보고.
- 작업 범위 밖은 고치지 않는다. 발견한 문제는 WORKLOG의 "다음에 할 것"에 적는다.
- 큰 리팩터링은 그 자체가 flow의 작업일 때만 한다.

### 세션 종료 체크리스트 (필수)
1. `pytest` 통과 확인 — 실패하면 완료 처리하지 않는다.
2. `project_flow.html`의 `FLOW` 데이터에서 해당 작업의 `done: false` → `done: true`.
3. `docs/WORKLOG.md` **맨 위**에 아래 형식으로 기록.
4. DB 스키마나 API가 바뀌었으면 `docs/SPEC.md`도 갱신.
5. 커밋 메시지 형식: `[P2-03] 대기열 API + 대기시간 계산`

### WORKLOG 형식
```
## 2026-11-24 · Claude Code(Sonnet) · P1-02
- 한 일:
- 바뀐 파일:
- 테스트: pytest 12 passed
- 다음에 할 것 / 막힌 것:
```

## 7. 코딩 규칙
- 식별자·주석은 영어, **UI 문구는 한국어**.
- 타입 힌트 사용, 함수는 짧게.
- 날짜·시간은 ISO 8601 문자열로 저장(로컬 시간 Asia/Seoul).
- **대기시간은 DB에 저장하지 않고** 단계 이력(`eval_stage_log`)으로 조회할 때 계산한다 (D-09).
- DB 변경은 `migrations/NNN_설명.sql`을 새로 추가하는 방식으로만 한다.
- API는 `/api/...` 아래 JSON. 에러는 `{"error": "메시지"}` 형식.

## 8. 사용량 절약
- 필요한 파일만, 필요한 부분만 읽는다. 같은 파일을 반복해서 통째로 읽지 않는다.
- 응답은 짧게: 변경 요약 + 테스트 결과 + 다음 할 일.
- 이미 설계가 끝난 내용(SPEC)을 다시 논의하지 않는다. 바꿔야 하면 사용자에게 먼저 묻는다.
