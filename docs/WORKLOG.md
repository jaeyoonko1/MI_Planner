# WORKLOG

> 새 항목은 **맨 위**에 추가. 형식은 AGENTS.md 6장 참고.

## 2026-11-24 · Claude Code(Sonnet) · P2-03
- 한 일: /api/todos CRUD + 필터(상태·우선순위 다중, 요청자, 납기 임박/지남, 하기로 한 날, 연결, 하위, 검색). 하위 할일 순환 방지. 검증 오류(422)도 {"error"} 형식으로 통일. 스키마 변경 없음(001의 tasks 사용)
- 바뀐 파일: app/repositories/tasks.py(+__init__), app/routers/tasks.py, app/main.py(라우터·오류 핸들러), tests/test_todos.py, docs/SPEC.md, project_flow.html
- 테스트: pytest 32 passed
- 다음에 할 것 / 막힌 것:
  - P2-04 화면은 `requesters` 목록으로 요청자 칩을 만들면 됨
  - eval_id는 평가 테이블(P4)이 생기기 전까지 FK 검증 없음
  - app/repositories/tasks.py의 open_conn은 미사용 (정리 가능)

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
