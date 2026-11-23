# WORKLOG

> 새 항목은 **맨 위**에 추가. 형식은 AGENTS.md 6장 참고.

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
