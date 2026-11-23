# WORKLOG

> 새 항목은 **맨 위**에 추가. 형식은 AGENTS.md 6장 참고.

## 2026-11-24 · Claude Code(Sonnet) · P3-04
- 한 일: 노트 편집기에 서식 툴바 추가 — 글자 크기 6단계 칩, 글자색 7, 형광펜 5 + 없음, 서식 지우기. 단축키 Ctrl+Alt+H(형광펜 켜고 끄기), Ctrl+Shift+. / ,(크기 한 단계 키우기·줄이기), Ctrl+Space(서식 지우기). 기존 Ctrl+B/I/U, Ctrl+-, Ctrl+Alt+0~3 유지. 저장은 프리셋 값만, 그 밖은 제거(mdconv.js, P3-02에서 구현)
- 바뀐 파일: web/js/note.js, web/css/note.css, project_flow.html
- 테스트: pytest 44 passed. 브라우저에서 크기·글자색+굵게·형광펜 적용 → 파일에 `<span style=…>`/`<mark>`/`**` 로 저장, 다시 열어도 유지, Ctrl+Shift+> 크기 단계 이동, Ctrl+Space 서식 지우기 확인(키 이벤트는 합성). 실제 마우스 드래그 선택·실제 키 입력은 사람이 확인 필요
- 다음에 할 것 / 막힌 것:
  - 글자색 기본(첫 칩)은 저장 시 생략됨(기본색과 같음)
  - 다음: P3-03(단·열 너비, L 크기 — 쪼개서), P3-05, P3-06 등

## 2026-11-24 · Claude Code(Sonnet) · P3-01 + P3-02
- 한 일: **P3-01** 편집기 결정 = 직접 만든 contenteditable + 마크다운 변환기(D-20, 외부 라이브러리 없음). **P3-02** note 페이지 열기·편집·자동 저장(0.7초 지연, 포커스 이탈·페이지 이동·pagehide 시 즉시 저장, 실패 시 다음 입력에서 재시도), 본문/제목1~3/목록/번호/체크/B·I·U·S 버튼, 단축키(Ctrl+Alt+0~3, Ctrl+-), 체크박스 클릭 토글, 이미지 붙여넣기·드래그 → `files/img-날짜.png` 저장 후 `![](files/…)`로 기록
- 바뀐 파일: web/js/mdconv.js·note.js·main.js, web/css/note.css, web/test/mdconv.html(신규), app/vault.py·routers/pages.py(이미지 업로드·조회), tests/test_note_files.py, docs/DECISIONS.md(D-20), docs/SPEC.md, project_flow.html. (일부 파일은 다른 세션 커밋 3cd0372에 함께 들어감)
- 테스트: pytest 44 passed(+이미지 업로드 4). 브라우저: web/test/mdconv.html 왕복 11/11 PASS, 실제 노트에서 입력·체크 토글·이미지 붙여넣기(합성 이벤트)→파일 저장 확인, 입력 직후 페이지 이동해도 저장됨
- 다음에 할 것 / 막힌 것:
  - 실제 키보드·마우스(드래그 선택, 실제 Ctrl+V 스크린샷)는 사람이 한 번 확인 필요
  - 이미지가 커서 위치(문단 끝)에 인라인으로 들어감 — 별도 줄로 넣는 개선 여지
  - **P3-04**: 서식 툴바(크기·글자색·형광펜·프리셋·Ctrl+Alt+H 등)만 얹으면 됨. 저장·읽기(변환기)는 이미 크기/색/형광펜을 처리하고 프리셋 밖 값은 제거. 프로토타입은 prototypes/p3-04_toolbar.html
  - 중첩 목록·링크·서식 붙여넣기는 미지원(D-20 한계)

## 2026-11-24 · Claude Code(Sonnet) · P2B-01 (설계, 승인 대기)
- 한 일: flow에 P2B(UI 리디자인) 단계 추가. 디자인 원칙·토큰·컴포넌트·화면 명세 `docs/DESIGN.md`, 오늘·할일·월간 일지 정적 프로토타입 `web/design/prototype.html`
- 바뀐 파일: project_flow.html, docs/DESIGN.md, web/design/prototype.html (app/·web/js 변경 없음)
- 테스트: pytest 44 passed (코드 변경 없음). 프로토타입은 브라우저로 3개 화면 확인
- 다음에 할 것 / 막힌 것: **사용자가 프로토타입 승인 → P2B-01 done 처리 → P2B-02 시작**. DESIGN.md 8장 열린 질문 3개 확정 필요. 작업 트리의 web/js/main.js 수정·web/test/는 이번 작업과 무관(손대지 않음)

## 2026-11-24 · Claude Code(Sonnet) · P2-04 + P2-05 + P2-06
- 한 일: 할일 화면(#/todos: 상태·우선순위·납기·요청자 토글 칩, 검색, 빠른 추가, 상태/우선순위 클릭 순환, 제목·납기·요청자 인라인 수정, 삭제, 단축키 N). 일지 자동 표시(설정 `journal_auto_show`, 칸 아래 납기 할일 읽기 전용, 켬/끔 칩) + 체크박스 줄 → 할일 승격(`POST /api/todos/from-line`, 줄에 `→ 할일 #id` 링크). '오늘' 화면(#/today: 오늘 일지, 오늘 하기로 한 일, 납기 임박 3일, 지남, 평가 자리만)
- 바뀐 파일: app/routers/settings.py·dashboard.py(신규), routers/journal.py·tasks.py, app/journal.py, app/main.py, web/js/todos.js·today.js(신규), main.js, journal.js, api.js, web/index.html, css/style.css, tests/test_p2_extras.py, docs/SPEC.md, project_flow.html
- 테스트: pytest 44 passed. 브라우저에서 #/todos·#/today·월간 일지 로드와 콘솔 오류 없음 확인. 승격 버튼 클릭·인라인 수정 클릭은 사람이 확인 필요
- 다음에 할 것 / 막힌 것:
  - **P2-07(회사 PC 시험 설치 + 1주일 실사용)은 직접 해야 함** → P2 완료 조건
  - 승격은 `- [ ]` 줄만, 한 번만 가능. 할일 완료 시 일지 줄 체크는 자동 반영 안 됨
  - 평가 진행 칸·밀린 단계 요약은 P4-08/P4에서 채움
  - app/repositories/tasks.py의 open_conn 미사용(정리 가능)

## 2026-11-24 · Claude Code(Sonnet) · P2-03
- 한 일: /api/todos CRUD + 필터(상태·우선순위 다중, 요청자, 납기 임박/지남, 하기로 한 날, 연결, 하위, 검색). 하위 할일 순환 방지. 검증 오류(422)도 {"error"} 형식으로 통일. 스키마 변경 없음(001의 tasks 사용)
- 바뀐 파일: app/repositories/tasks.py(+__init__), app/routers/tasks.py, app/main.py(라우터·오류 핸들러), tests/test_todos.py, docs/SPEC.md, project_flow.html
- 테스트: pytest 32 passed
- 다음에 할 것 / 막힌 것:
  - P2-04 화면은 `requesters` 목록으로 요청자 칩을 만들면 됨
  - eval_id는 평가 테이블(P4)이 생기기 전까지 FK 검증 없음
  - app/repositories/tasks.py의 open_conn은 미사용 (정리 가능)

## 2026-11-24 · Claude Code(Sonnet) · P3-07
- 한 일: html 페이지를 sandbox iframe(+CSP 주입)으로 표시, 외부 요청 감지 시 경고 배지, 페이지별 상태 API(`_state.json`) + iframe↔부모 postMessage 브리지
- 바뀐 파일: app/html_page.py, app/routers/html_pages.py, app/main.py(라우터 등록), web/js/htmlpage.js, api.js, main.js, css/style.css, tests/test_html_page.py, docs/SPEC.md, project_flow.html
- 테스트: pytest 29 passed. 브라우저 화면 확인은 안 함(사람이 HTML 페이지 하나 열어 배지·상태 저장 확인 필요)
- 다음에 할 것 / 막힌 것:
  - 상태 API는 id가 아닌 `?path=` 방식(기존 pages API와 동일)
  - 외부 요청 감지는 정규식 기반이라 동적으로 조립된 URL은 못 잡음(CSP가 실제 차단)
  - `_state.json`을 페이지 이동/삭제 시 함께 가는지(폴더째 이동이라 문제 없을 것) 확인 필요

## 2026-11-24 · Claude Code(Sonnet) · P3-04 (프로토타입만)
- 한 일: 서식 툴바 단독 프로토타입. 크기 6단계·굵게/기울임/밑줄/취소선·글자색 7·형광펜 5·서식 지우기 버튼, 단축키(Ctrl+B/I/U, Ctrl+-, Ctrl+Alt+H, Ctrl+Shift+./,, Ctrl+Space). 저장 형식(마크다운+허용 HTML) 실시간 표시, 저장→다시 열기 왕복 확인. 프리셋 밖 크기·색은 저장 시 제거
- 바뀐 파일: prototypes/p3-04_toolbar.html(신규, 앱과 무관한 단독 파일), docs/WORKLOG.md
- 테스트: pytest 36 passed. 브라우저에서 로드·저장 출력 확인, 버튼/단축키 실제 클릭은 사람이 확인 필요
- 다음에 할 것 / 막힌 것:
  - P3-04는 **done 처리 안 함**: 앱 연동은 P3-01(편집기 결정)·P3-02(노트 편집) 이후
  - 프로토타입은 execCommand 기반. P3-01에서 편집기를 고르면 툴바 UI·저장 규칙만 재사용

## 2026-11-24 · Claude Code(Sonnet) · P2-02b (편집)
- 한 일: 월 안의 칸 클릭 → textarea 편집, 입력 후 0.7초 뒤 자동 저장(PUT), 포커스를 잃으면 즉시 저장 후 보기로 복귀(Esc도 동일). 저장은 순서대로 한 줄로 실행, 상태 표시(저장 중/저장됨/실패). 내용을 비우면 서버가 섹션을 지움
- 바뀐 파일: web/js/journal.js, web/js/api.js, web/css/style.css, project_flow.html(P2-02 done)
- 테스트: pytest 25 passed. 브라우저에서 편집→저장→비우기 확인(API 응답으로 검증). 단 자동화 환경에서는 창 포커스가 없어 blur를 이벤트로 흉내 냈음 — 실제 클릭 이동은 사람이 한 번 확인 필요
- 다음에 할 것 / 막힌 것:
  - 서식 편집기(체크박스 클릭 토글 등)는 P3-01 결정 후. 지금은 `- [ ]` 텍스트를 직접 입력
  - 편집 중 월 이동 시 마지막 입력은 blur로 저장되지만 실패 표시는 못 볼 수 있음
  - 외부에서 파일을 고쳐도 화면은 다시 열기 전까지 갱신 안 됨

## 2026-11-24 · Claude Code(Sonnet) · P2-02 (보기 전용)
- 한 일: 월간 일지 그리드(열=주, 행=요일, 오늘 강조, 월 밖 날짜 흐리게, 주말 접기/펼치기 칩, 이전달/다음달/오늘). 체크박스 줄은 ☐/☑ 모양으로만 표시. journal 타입 페이지에서 자동으로 그리드 표시
- 바뀐 파일: web/js/journal.js(신규), web/js/api.js, web/js/main.js, web/css/style.css, project_flow.html, .claude/launch.json(미리보기용)
- 테스트: pytest 25 passed. 시드 데이터로 브라우저 확인(30칸, 오늘 강조, 주말 펼치면 42칸)
- 다음에 할 것 / 막힌 것:
  - **P2-02b 편집**: 칸 편집·자동 저장(PUT /api/journal/{yyyy-mm}/{dd}), 서식 편집기 여부 결정
  - 이전달/다음달 이동은 URL 해시를 바꾸지 않고 제자리 렌더링 (GET이 월 페이지를 자동 생성하므로 트리는 새로고침 전까지 안 갱신됨)
  - 서버 없이 돌리는 프론트 자동 테스트 없음

## 2026-11-24 · Claude Code(Sonnet) · P2-01
- 한 일: app/journal.py(## YYYY-MM-DD 파서·렌더러·set_day, 월 페이지 자동 생성), /api/journal/{yyyy-mm} GET, /{dd} PUT, Vault.exists와 create(folder_name) 추가. 시드의 일지 위치를 일지/2026/2026-11로 변경
- 바뀐 파일: app/journal.py, app/routers/journal.py, app/vault.py, app/main.py, scripts/seed_sample.py, tests/test_journal.py, docs/SPEC.md(4.2 확정 사항), project_flow.html
- 테스트: pytest 25 passed
- 다음에 할 것 / 막힌 것:
  - GET이 월 페이지를 자동 생성하는 부작용이 있음 (SPEC의 "월이 바뀌면 자동 생성" 구현). 미래 월을 조회해도 빈 페이지가 생김
  - 같은 날짜 섹션이 파일에 두 번 있으면 파서가 하나로 합침 (사람이 직접 고친 경우 대비)
  - /api/journal/{yyyy-mm}/auto (자동 표시)는 P2-05
  - P2-02 월간 일지 그리드 화면 (L 크기 — 보기/편집 두 세션으로 쪼개기 권장)

## 2026-11-24 · Claude Code(Sonnet) · P1-05 (일부)
- 한 일: scripts/seed_sample.py — 가짜 데이터 샘플 vault 시드(멱등). SPEC의 초기 트리(일지, MI 공정업무 등) 재현
- 바뀐 파일: scripts/seed_sample.py, scripts/__init__.py, tests/test_seed.py
- 테스트: pytest 17 passed
- 다음에 할 것 / 막힌 것:
  - **web/vendor/ 배치는 미완료**: Tabulator 파일(JS/CSS)을 외부에서 내려받아야 해서 사용자 승인 필요. 표를 처음 쓰는 P2-04 전에 하면 됨. 그래서 P1-05는 done 처리하지 않음
  - 시드 실행: .venv\Scripts\python scripts\seed_sample.py

## 2026-11-24 · Claude Code(Sonnet) · P1-04
- 한 일: web/ 프론트 셸 — 사이드바 페이지 트리(접기 상태 localStorage 저장), 해시 라우팅(#/page/<경로>), 칩 버튼 컴포넌트(chips.js), 페이지 추가 폼, 페이지 보기(읽기 전용)
- 바뀐 파일: web/index.html, web/css/style.css, web/js/{main,api,tree,chips}.js, project_flow.html
- 테스트: pytest 16 passed(백엔드). 프론트는 자동 테스트 없이 브라우저에서 직접 확인(트리 표시·페이지 이동·하위 추가·칩 선택·접기/펼치기)
- 다음에 할 것 / 막힌 것:
  - 트리에서 이름 변경·이동·삭제·드래그 순서 변경 UI는 아직 없음 (API는 있음)
  - 제목에 금지문자(예: ':')가 있으면 폴더명에서만 빠지고 표시 제목은 그대로 유지됨
  - P1-05 vendor 배치 + 샘플 vault 시드 (Codex 권장 작업)

## 2026-11-24 · Claude Code(Sonnet) · P1-03
- 한 일: app/vault.py(트리·생성·읽기/쓰기·이름변경/이동/순서·휴지통 삭제, 경로 탈출 차단), /api/pages 라우터, VaultError → {"error"} 응답
- 바뀐 파일: app/vault.py, app/routers/pages.py, app/main.py, tests/test_pages.py, tests/test_health.py, project_flow.html
- 테스트: pytest 16 passed
- 다음에 할 것 / 막힌 것:
  - GET /api/pages/tree 응답은 {"tree": [...]} 형태 (SPEC에는 형태 미명시)
  - 폴더명 = 제목에서 금지문자 제거한 값. 같은 이름이면 " (2)" 붙임
  - P1-04 프론트 셸 (사이드바 트리 + 라우팅 + 칩 버튼)

## 2026-11-24 · Claude Code(Sonnet) · P1-02
- 한 일: app/db.py(connect, 마이그레이션 러너, init_db), migrations/001_init.sql(tasks, settings), 앱 시작 시 자동 마이그레이션(lifespan)
- 바뀐 파일: app/db.py, app/main.py, migrations/001_init.sql, tests/test_db.py, tests/test_health.py, project_flow.html
- 테스트: pytest 4 passed (멱등 적용, 신규 파일만 적용, 실패 시 롤백)
- 다음에 할 것 / 막힌 것:
  - tasks.eval_id의 FK는 evaluations 테이블이 생기는 P4에서 추가 (SQLite는 컬럼 FK 추가가 번거로워 그때 테이블 재생성 필요)
  - P1-03 vault 모듈 + 페이지 트리 API

## 2026-11-24 · Claude Code(Sonnet) · P1-01
- 한 일: .venv 생성(Python 3.12), FastAPI 골격 + /api/health, 정적 web/ 마운트, run.bat, pytest 세팅
- 바뀐 파일: app/main.py, app/__init__.py, web/index.html, tests/test_health.py, pytest.ini, run.bat, requirements.txt, requirements-dev.txt, project_flow.html
- 테스트: pytest 1 passed; uvicorn 기동 후 /api/health·/ 응답 확인 (run.bat 자체는 미실행)
- 다음에 할 것 / 막힌 것:
  - P0-05 첫 커밋은 아직 없음(스테이징만 됨)
  - TestClient가 httpx 사용 deprecation 경고를 냄 (동작엔 문제 없음)
  - P1-02 SQLite + 마이그레이션 러너

## 2026-11-24 · Claude(채팅, Opus) · P0-03, P0-04
- 한 일: 2차 질의응답 반영 + 설계 리뷰 → SPEC v1.0. 서식(D-15), Chromium 대상(D-16), 사외 반출 금지(D-17), DOI 이미지 라이브러리·공유 패키지(D-18), 레시피 범용 파서(D-19). D-01/02/10 확정.
- 바뀐 파일: docs/SPEC.md, docs/DECISIONS.md, AGENTS.md, project_flow.html(P3 서식 툴바·원노트 이관 시험, P5 DOI 세분화), .gitignore
- 테스트: 해당 없음 (코드 없음)
- 다음에 할 것 / 막힌 것:
  - P0-05 git init + venv (사용자 직접, pip은 사내 프록시 필요 시 `--proxy`)
  - P1-01부터 Claude Code(Sonnet)로 구현 시작

## 2026-11-24 · Claude(채팅, Opus) · P0-02, P0-03(일부)
- 한 일: 사용자 목표 갱신 + 1차 질의응답 반영 → SPEC v0.2. 범위가 "대기 관리 툴"에서 "계층 페이지 기반 업무 워크스페이스"로 바뀜. 우선순위 일지·할일 → 노트 → 평가 현황판.
- 바뀐 파일: docs/SPEC.md(v0.2), docs/DECISIONS.md(D-03 변경, D-08~D-14 추가, Q-07~Q-12 추가), AGENTS.md(저장 규칙·폴더 구조), project_flow.html(단계 P0~P8로 재편, 저장 키 v2)
- 테스트: 해당 없음 (코드 없음)
- 다음에 할 것 / 막힌 것:
  - 사용자: DECISIONS 미결 질문 Q-01(pip·브라우저), Q-07~Q-12 답하기
  - P0-04 Opus 설계 리뷰 → SPEC v1.0
  - P0-05 git init + venv (사용자 직접)

## 2026-11-23 · Claude(채팅, Opus) · P0-01
- 한 일: 프로젝트 폴더와 기본 문서 생성 (AGENTS.md, CLAUDE.md, README.md, docs/SPEC.md, docs/DECISIONS.md, project_flow.html)
- 바뀐 파일: 위 파일 전부 신규
- 테스트: 해당 없음 (코드 없음)
- 다음에 할 것 / 막힌 것:
  - P0-02 SPEC 검토 (사용자)
  - P0-03 DECISIONS.md의 미결 질문 답하기
