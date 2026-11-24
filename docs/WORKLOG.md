# WORKLOG

> 새 항목은 **맨 위**에 추가. 형식은 AGENTS.md 6장 참고.

## 2026-11-24 · Claude Code(Sonnet) · V-009
- 한 일: 노트 표를 한 번 만들면 지울 수 없던 버그(원인: 행 추가뿐이고 선택·삭제 수단이 전혀 없었음, D-43). `note-table-model.js`에 행·열 삽입/삭제, 머리글 켬/끔, 채운 칸 수(순수 함수), `note-table.js`에 아이콘 도구줄(aria-label·title+단축키, 탭으로 이동), 표 선택(칸에서 Esc, 표 블록 포커스) 후 Delete·Backspace로 표 삭제, 표 안 단축키 Alt+Shift+↑↓←→·Delete(행)·Backspace(열)·H(머리글), 범위 선택 시 여러 행·열 한 번에 처리, 채운 칸 3개 초과·마지막 행/열일 때만 인라인 확인 줄, 토스트 "되돌리기" + Ctrl+Z(V-008과 같은 stale 규칙, 편집기 캡처 단계에서 처리해 단 되돌리기와 충돌 없음). 단축키 안내는 표 도구줄의 키보드 버튼과 "단·표 단축키" 목록 양쪽에 둠.
- 바뀐 파일: web/js/(note-table-model, note-table, note-columns).js, web/css/note.css, web/test/run_note_tables.mjs, docs/(DECISIONS D-43, VOC, WORKLOG), project_flow.html
- 테스트: Node 표 모델 테스트(삽입·삭제·머리글 왕복·바이트 동일·마지막 행/열·채운 칸 수) + pytest test_note_table_cases/test_note_column_layout_cases 통과. 격리 vault·가짜 표로 앱 내 브라우저 확인: 행 삭제→Ctrl+Z, 표 선택→Delete→확인 줄→삭제→Ctrl+Z가 제자리 복원, 열·행 삽입·머리글 끄기 3단계 Ctrl+Z 후 파일이 원본과 바이트 동일, 다크 800/1280px·라이트 1024px, 콘솔 오류 없음.
- 다음에 할 것 / 막힌 것: 실제 Edge·IME 미확인(VERIFY). 열 정렬(:--- ---:) 변경 UI는 없음. V-001(엑셀 붙여넣기·셀 편집)은 같은 모델 위에서 진행. 전체 pytest의 test_lineeditor_core_cases는 V-003 보류 변경 때문일 수 있음.

## 2026-11-24 · Claude Code(Sonnet) · V-002
- 한 일: 노트·이슈 페이지에 PowerPoint 첨부(D-42). `app/ppt_attach.py` + `app/routers/ppt.py`(`/api/ppt`): 올리기(files/ 복사, 300MB·sha256) / 링크만(절대·UNC 검증, 복사 안 함) 사이드카 JSON, `missing`·`changed` 상태, 새로고침(해시 재읽기), 삭제는 .trash(링크 원본 불변), 슬라이드 개요·삽입 그림은 `pptx_read` 재사용(`data/ppt_cache`), 링크 덱 옆 PNG 폴더가 있으면 실제 슬라이드 그림으로 사용, `os.startfile` 열기는 루프백·Host·Origin·confirm·확장자 화이트리스트 가드. 화면: `ppt.js`(페이지 위 띠, 추가 창의 토글 칩 `파일 올리기|링크만` + 실시간 경로 검증, 풀윈도 뷰어: 썸네일 레일·←→·Home/End·F 전체 화면(막히면 창 안 집중 보기)·N 노트·E 편집·aria-live), `ppt-model.js`(순수 로직), `ppt.css`. 노트 쪽은 `note.js`에 두 줄(`host.before(mountPptPanel)`)만.
- 바뀐 파일: app/ppt_attach.py, app/routers/ppt.py, app/main.py, web/js/(ppt, ppt-model, note).js, web/css/ppt.css, web/index.html, web/test/run_ppt.mjs, tests/test_ppt_attach.py, docs/(SPEC, DECISIONS, VOC, WORKLOG), project_flow.html
- 테스트: pytest tests/test_ppt_attach.py 12 passed(업로드·링크 검증·변경/없음·개요·캐시·표지·.ppt·사전 렌더·열기 가드(원격·Host·Origin·확인·사이드카 변조)·삭제) + Node run_ppt.mjs. 격리 vault·가짜 덱으로 앱 내 브라우저 확인: 카드·추가 창(링크 검증 메시지)·뷰어(←→·E 확인 창·열기 호출)·집중 보기, 다크/라이트, 1024·1280px.
- 다음에 할 것 / 막힌 것: 실제 PowerPoint·UNC·대용량·실제 Edge 전체 화면은 미확인(VERIFY). 대체 보기는 도형·차트를 그리지 못함(PowerPoint PNG 내보내기 폴더로 보완). 업로드는 본문을 메모리에 올리므로 300MB 상한. 이슈 메모(페이지 없는 이슈)에는 띠가 없음 — 이슈 페이지를 만들면 보임. DOI 화면 연결은 후속. data/ppt_cache 정리 기능 없음.

## 2026-11-24 · Claude Code(Sonnet) · V-008
- 한 일: 노트 단 삭제 불가·아래 행 추가 불가 수정(D-41). 원인: 단 추가만 있고 삭제·행 개념이 없었다. 본문 표식 `<!-- row -->`로 행을 추가(`note-column-layout.js`: insertColumn·addRowBelow·deleteColumn·mergeTarget, 표식 종류에서 행 구조 계산), 레이아웃은 2행 이상일 때만 `note_layout.rows`. `note-columns.js`: 단별 hover/Tab 도구줄(아이콘 버튼 + aria-label), 삭제 확인 패널(토글 칩 앞 단에 합치기/내용까지 삭제, 빈 단은 즉시), 단·행 변경은 스냅샷 되돌리기(토스트 + Ctrl+Z, 그 뒤 입력하면 편집기 자체 실행 취소), 단축키 Alt+Shift+←·→·↓·Delete + "단 단축키" 목록. 다른 단 편집기는 유지(포커스·undo 이력 보존).
- 바뀐 파일: web/js/(note-column-layout, note-columns).js, web/css/note.css, app/routers/pages.py(`rows` 검증), web/test/run_note_columns.mjs, tests/test_pages.py, docs/(SPEC, DECISIONS, VOC, WORKLOG), project_flow.html
- 테스트: Node 왕복(원본==1차==2차, 표식 없는 파일 불변, 한도 초과 표식은 본문 유지)·삽입·삭제·병합·레이아웃 테스트 통과, pytest 신규 `test_note_layout_rows_round_trip_and_validation` 포함 test_pages 통과. 격리 vault·가짜 데이터로 앱 내 브라우저에서 확인: 삭제 확인 패널·합치기·되돌리기(Ctrl+Z)·행 추가·단축키 목록, 다크/라이트, 1024px, 콘솔 오류 없음(favicon 404만).
- 다음에 할 것 / 막힌 것: 실제 Edge·Whale 단축키·실제 노트 미확인(VERIFY). 단 합치기 시 앞 단의 접힘 상태는 제목 키 기준 유지. 이슈 메모(compact)는 `saveLayout`이 없어 도구줄을 숨김 — 필요하면 새 VOC. 전체 pytest의 test_lineeditor_core_cases 실패는 V-003 보류 중인 미커밋 수정 때문.

## 2026-11-24 · Claude Code(Sonnet) · V-004
- 한 일: 구조 화면에서 Delete 키·삭제 버튼으로 이슈·자유 배치 그룹을 삭제하고 Ctrl+Z(·되돌리기 버튼·토스트)로 복원, Ctrl+Shift+Z/Ctrl+Y로 다시 삭제(D-40). 서버 `app/repositories/structure_trash.py`: 한 트랜잭션 소프트 삭제 + `structure_trash` 스냅샷(마이그레이션 012), 그룹 삭제는 하위를 그 자리로 올리거나(기본) 하위까지 삭제, 이슈 페이지·이미지 폴더는 `vault/.trash`로(`Vault.restore_page`·`restore_issue_files`로 복원), 일지 연결은 풀었다가 줄이 그대로면 복원 시 다시 연결, 하위 할일 부모 연결·형제 순서 복원, 실패하면 DB·페이지 이동 전부 원복. 화면: 행 다중 선택(클릭·Shift·Ctrl·Shift+방향키·Ctrl+A, `structselect.js`), 순수 되돌리기 스택 `structundo.js`(다중 단계, 진행 중 중복 입력 무시), 영향 확인 창 `structdelete.js`(그룹·페이지·일지·하위 할일이 걸릴 때만, 하위 처리 칩), 삭제 뒤 이웃 행 선택·포커스, `aria-live` 안내. 입력창·열린 창·상세 패널 안에서는 키를 가로채지 않고 Z는 `e.code`로도 판별(한글 입력 상태 대응).
- 바뀐 파일: app/(repositories/structure_trash, routers/structure, vault).py, migrations/012_structure_trash.sql, web/js/(structure, structselect, structundo, structdelete, api).js, web/css/structure.css, web/index.html(undo 아이콘), web/test/run_structure_undo.mjs, tests/(test_structure_trash, test_lineeditor_js).py, docs/(SPEC, DECISIONS D-40, VOC, WORKLOG), project_flow.html
- 테스트: structure 신규 pytest 18(복원 정확도·중첩 그룹·순환 방지·다중 단계·사이 편집·페이지/일지/하위 할일·실패 원복·409·미배치) 전부 통과, Node 순수 테스트 통과. 격리 DB 가짜 데이터로 앱 내 브라우저에서 Delete→토스트→Ctrl+Z 위치·선택 복원, 그룹 삭제 확인 창(위로 올리기/함께 삭제), 다중 선택, 입력창 키 비가로채기, 라이트 테마 1024px, 콘솔 오류 없음. 전체 pytest 중 `test_flow_site`(tzdata 없음)·`test_lineeditor_core_cases`(V-003 작업 중)는 이번 변경과 무관.
- 다음에 할 것 / 막힌 것: 휴지통 목록·영구 비우기 화면은 없음(API `GET /api/structure/trash`만). 분류 기준 보기 그룹 삭제는 분류 관리 담당. 되돌리기 스택은 탭을 새로고침하면 비워짐(서버 기록은 남음). 1280px·실제 Edge IME는 VERIFY.

## 2026-11-24 · Claude Code(Sonnet) · V-005
- 한 일: 현황판에서 설비·Lot 상태 등을 화면 위에서 바로 수정(마이그레이션 011: `eval_equipment`·`eval_lots`에 `status`(wait/active/hold/done, 기본 active)·`note`). 헤더(설비 열·Lot 띠·Lot별 보기)에 아이콘+글자 상태 배지 → 누르면 팝오버(상태 칩 1~4키, 이름·설비사·메모, Enter 저장, Esc 닫기), 헤더 이름 더블클릭=이름 수정, 칸에서 `E`/`L` 키로 해당 설비·Lot 팝오버. 칸 패널에 설비·Lot 행(배지+편집), 다중 선택 패널에 설비·Lot 상태 일괄 칩, 칸 제외/포함 버튼, 요약의 평가 상태 배지도 편집. 모든 변경은 토스트 되돌리기. 새 API: `PATCH /api/evaluations/{id}`, `PATCH .../equipment/{eid}`, `PATCH .../lots/{lid}`, `POST .../status`(원자적 일괄), `POST .../cells/exclude`. 상태는 표시용 라벨이며 단계·대기 계산에 영향 없음(D-09). 제외했다가 포함하면 단계는 유지하고 이력에 같은 단계 재진입 1건을 남겨 대기 시간을 새로 시작. 엑셀 칸 목록에 `설비 상태`·`Lot 상태` 열, 요약 시트에 설비·Lot 상태 표.
- 바뀐 파일: migrations/011, app/(repositories/evaluations, routers/evaluations, eval_export).py, web/js/(eval-entity, eval-entity-model 신규; eval-board, eval-panel, api).js, web/css/evaluations.css, web/index.html(play·pause 아이콘), web/test/run_eval_entity.mjs, tests/(test_eval_entity 신규, test_eval_export, test_db·test_task_fields 마이그레이션 목록을 폴더 기준으로), docs/(SPEC, VOC, WORKLOG), project_flow.html
- 테스트: pytest 신규 API·검증·원자성·제외/포함 로그 + Node 모델 테스트. 격리 DB 가짜 데이터로 앱 내 브라우저에서 확인: 배지 클릭·상태 변경·되돌리기·이름 중복 오류·더블클릭 이름 수정·E/L 키·칸 제외/포함·평가 상태, 설비별/Lot별/단계별 보기, 다크 1280·라이트 1024, 콘솔 오류 없음(의도한 400 제외). 다른 세션 변경분(줄 편집기·구조) 때문에 test_lineeditor_core_cases는 이 세션과 무관하게 실패 중일 수 있음.
- 다음에 할 것 / 막힌 것: 실제 Edge·Whale·실제 규모(Lot 20×설비 10) 미확인(VERIFY). 남은 것만 필터는 칸 단계 기준 그대로(상태 완료 Lot·설비를 숨기지 않음) — 필요하면 새 VOC로.

## 2026-11-24 · Claude Code(Sonnet) · V-006
- 한 일: 이슈 상세에서 에픽·유형(분류) 값이 안 보이고 선택지가 '없음'만 뜨던 버그. 원인: `inspector.js`가 분류 목록을 모듈 변수에 한 번만 읽어 캐시(`if (!fields)`; 첫 읽기 실패 시 `[]`까지 영구 캐시) — 이후 분류 관리·계층 편집으로 만든 '제품' 같은 분류·선택지가 반영되지 않았고, 현재 값이 선택지에서 빠진(보관·삭제) 경우도 값이 사라져 보였음. 수정: 열 때마다 서버에서 다시 읽고(실패 시 마지막 좋은 목록 유지), 분류 관리·계층 적용 시 `hub.emit({kind:"fields"})`로 열린 상세를 즉시 갱신. 순수 모델 `web/js/inspector-fields.js`(활성 choice/multi 분류 전부, 하위 선택지 들여쓰기, 보관 선택지 숨김 단 현재 값이면 표시, 사라진 값은 점선 칩, 선택지 0개는 '선택지가 없어요 + 선택지 추가' 링크, '없음'은 해제 칩으로만).
- 바뀐 파일: web/js/(inspector, inspector-fields, classes, leveldialog).js, web/css/screens.css, web/test/run_inspector_fields.mjs, tests/test_inspector_fields.py, docs/(VOC, WORKLOG), project_flow.html
- 테스트: pytest 359 passed(신규 3). 격리 DB 가짜 데이터로 앱 내 브라우저에서 확인: 에픽 현재 값 표시, 선택지 없는 분류 안내, 선택지 추가 후 즉시 칩 갱신·선택·저장. 라이트 테마는 VERIFY.
- 다음에 할 것 / 막힌 것: 주간·월간·할일·구조 화면은 모두 같은 `openInspector`를 쓰므로 같이 고쳐짐.

## 2026-11-24 · Claude Code(Sonnet) · P6-04
- 한 일: 스냅샷 이력 + diff + 다중 레시피 비교(D-39, 새 패키지·마이그레이션 없음). `app/rcp_compare.py`: `compare_values`(text는 앞뒤 공백 제외 비교, number는 ±tolerance 경계 포함·부동소수 오차 흡수, 한쪽만 숫자면 `type_changed`, nan/inf는 글자), `Rules`(매핑에서 조회 시점에 읽음), `diff_params`·`snapshot_diff`·`history`(스냅샷마다 직전 대비 추가/삭제/변경/허용 이내/파일 변경 개수)·`compare_recipes`(2~6개, 첫 열 기준, `d`/`m` 표시)·`build_compare_xlsx`(`app/xlsx.py`, 문자열만). API `GET /api/recipes/{id}/history`·`/diff`, `GET /api/recipe-compare`·`/export.xlsx`. 화면: 레시피 표 `담기` 칩 + `비교 담기` 막대 → 비교 창(열 카드, `다른 것만/전체`·그룹 칩, 찾기, TSV 복사, 엑셀 저장, 가상 스크롤 표 `web/js/rcp-vtable.js`, `≠`·`∅ 없음`·줄무늬로 색에만 의존 안 함), 레시피 상세 `변경 이력` 타임라인 + 두 버전 diff(`web/js/rcp-history.js`). 모델 `web/js/rcp-compare-model.js`.
- 바뀐 파일: app/(rcp_compare, routers/recipes).py, web/js/(rcp-compare, rcp-compare-model, rcp-history, rcp-vtable, rcp, rcp-detail, api).js, web/css/rcp.css, web/test/run_rcp_compare.mjs, tests/(test_rcp_compare, test_lineeditor_js).py, docs/(SPEC 4.6.4, DECISIONS D-39, WORKLOG), project_flow.html
- 테스트: pytest 359 passed(신규: 허용오차 경계·부동소수·음수·nan/inf·형식 바뀜, 추가/삭제/변경/허용 이내, 다른 파일 같은 경로, 매핑 허용오차 즉시 반영, 되돌림 이력, 이력 limit, 비교 마킹·기준 열·없는 항목·고정 스냅샷·검증, 5천 행 속도, API·xlsx(수식 주입 없음) + Node 모델). Edge 앱 내 브라우저(가짜 5천 파라미터)에서 비교 창·이력·diff를 1024px 다크·라이트로 확인, 가상 스크롤 5천 줄 필터 5ms.
- 다음에 할 것 / 막힌 것: 실제 회사 레시피 미확인(VERIFY). 1280px는 앱 내 브라우저 폭 한계로 눈으로 못 봄(비교 창 폭 min(1240px, 100vw-32px)). 설비 시계 등 매번 바뀌는 값은 매핑 `ignore`로 거른다(안내 문구 필요하면 후속). 레시피 표가 `비교` 열 때문에 1024px에서 가로 스크롤이 생김. 이력 diff·비교의 엑셀 저장은 비교 창만(이력 diff는 TSV 복사만). P6-05(쓰기)는 하지 않음.

## 2026-11-24 · Claude Code(Sonnet) · P6-03
- 한 일: 범용 파서 + 매핑 + 수집 연결(D-38, 새 패키지·마이그레이션 없음). `parsers/generic.py`: `xml`(DOCTYPE·ENTITY 전체 거부, 깊이·요소 수 한도, 루트 생략 경로·속성 `@`·반복 `[n]`·네임스페이스 제거, 옵션 `key_attr`)·`ini`(줄 번호 보존, 직접 읽기)·`txt`(kv/table/fixed 모드), 인코딩 UTF-16·UTF-8(BOM)·CP949·Latin-1, 바이너리 거부. `parsers/mapping.py`: `file_rule`·`apply`(ignore → 매핑 항목 먼저 매핑 순서 → 나머지, `show_unmapped`, 숫자 경고)·`available`·`find_for`(설비사·모델 자동 선택)·`options` 검증. `app/rcp_parse.py`: `parse_one`(절대 예외 없음, 한국어 오류)·`parse_files`(blob 읽기·경로 이탈/해시 검사)·`reparse_snapshot`/`reparse_source`(제자리 갱신, 새 버전 없음)·`parse_state`(낡음). 수집: 새 버전일 때만 파싱, 실패 파일은 `파싱 실패`로 목록에 남고 실행은 계속·`missing` 영향 없음. API `GET /api/recipe-mappings`, `POST …/reparse`(스냅샷·소스), 스냅샷 `parse`. 화면: 레시피 표 `파싱` 배지, 레시피 상세 창(`web/js/rcp-detail.js`: 매핑 한 줄·낡음 띠·파일별 결과·파일 칩·찾기·`이름 붙은 항목만` 토글 칩·그룹 표·`다시 파싱`), 소스 `다시 파싱` 버튼, 소스 편집 `설비사 매핑` 칩. 가짜 매핑 3개 + `scripts/make_sample_recipes.py`.
- 바뀐 파일: parsers/(generic, mapping, base, fake, __init__).py, parsers/mappings/example_{xml,ini,txt}_vendor.json, app/(rcp_parse, rcp_collect, repositories/recipes, routers/recipes).py, web/js/(rcp, rcp-detail, rcp-model, api).js, web/css/rcp.css, web/test/run_rcp.mjs, scripts/make_sample_recipes.py, tests/(test_rcp_parse, test_recipes).py, docs/(SPEC, DECISIONS, WORKLOG), project_flow.html
- 테스트: pytest 340 passed(신규 33: 파서 등록·XML 경로·key_attr·인코딩 5종·깨진 XML·엔티티 폭탄/XXE/대소문자·UTF-16·파일 뒤쪽 DOCTYPE·깊이 5000·요소 수·20MB·바이너리·INI/TXT 3모드·잘못된 옵션·긴 줄, 매핑 적용·선택·우선순위·깨진 매핑, `parse_one` 예외 비노출, 수집 연동(실패 파일 격리·partial/error/unparsed·매핑 없음 대체·재수집 새 버전 없음·다시 파싱 제자리·blob 없음/변조/경로 이탈·자동 선택·수집 중 409) + Node 모델). Edge 앱 내 브라우저(가짜 데이터)에서 레시피 표·상세 창(부분 실패/완료, 파일 칩)을 다크·라이트로 확인.
- 다음에 할 것 / 막힌 것: 실제 설비 파일 미확인(VERIFY) — 경로 표기·옵션으로 안 읽히는 형식은 코드 파서가 필요할 수 있음. 비교(P6-04)는 매핑의 `compare`·`tolerance`를 매핑 파일에서 다시 읽어야 함(DB에 저장 안 함). 파서 `can_write`는 모두 False(P6-05 전). 상세 창은 현재 스냅샷만(이력 선택은 P6-04). 수집 중 자동 다시 파싱 없음(`낡음` 안내만). 오래된 스냅샷의 다시 파싱 버튼 없음(현재 스냅샷만). XML 혼합 내용(본문+하위 요소)은 본문을 버림. 파라미터 5만 개 초과 파일은 통째로 실패 처리.

## 2026-11-24 · Claude Code(Sonnet) · P6-02
- 한 일: RCP 수집(D-37, 새 패키지·마이그레이션 없음). `app/config.py`(config/local.json 프로필·한도), `app/rcp_ftp.py`(쓰기 메서드 없는 `ReadOnlyFtp`: MLSD → LIST 대체, 고정 한국어 오류 문구), `app/rcp_collect.py`(목록 → 이름 필터 → 임시 `.part` → sha256 blob `os.replace` → `add_snapshot`, 한도·취소·시간 제한, 완전 성공에서만 missing, 시작 시 `running` 정리), API(소스 POST/PATCH/DELETE, 필터·목록 미리보기, 수집 202 + 폴링, 취소, 프로필 이름 목록). 화면 `#/rcp`: `수집 켜짐/꺼짐` 토글, 소스 목록·상세·상태 카드·오류·이전 실행·레시피 표, 소스 편집 창(프로필·단위 칩, 규칙 행, 즉시 필터 미리보기).
- 바뀐 파일: app/(config, rcp_ftp, rcp_collect, main, repositories/recipes, routers/recipes).py, web/js/(rcp, rcp-model, api, main).js, web/css/rcp.css, web/index.html, web/test/run_rcp.mjs, tests/(test_rcp_collect, test_lineeditor_js).py, docs/(SPEC 4.6.2, DECISIONS D-37, WORKLOG), project_flow.html
- 테스트: pytest 307 passed(신규 22+1: 가짜 FTP로 성공·캐시 blob·재실행 unchanged·변경 시 새 버전·missing(부분 실패·빈 목록 제외)·일부 실패·다운로드/접속 타임아웃·거부·로그인 실패 문구에 호스트/계정/비밀번호 없음·파일 수/크기/합계 한도·LIST 대체·파일 단위·안전하지 않은 이름·꺼짐 403(연결 0회)·가드·취소·미리보기(다운로드 0)·프로필 비노출·소스 CRUD·시작 시 정리·LIST 파서 + Node 모델). Edge 앱 내 브라우저(가짜 FTP 서버 모델을 꽂은 임시 앱)에서 1280 라이트/다크·1024 라이트/다크 목록·편집 창·수집·로그인 실패 표시 확인, 콘솔 오류 0.
- 다음에 할 것 / 막힌 것: 파서 없음 → 파라미터 0개(P6-03). 같은 크기·수정 시각이면 다운로드 생략하는 최적화 없음(항상 전부 받음 — 레시피 수백 개면 느릴 수 있음). 수집은 수동만(예약 없음). 소스 복제·가져오기·정렬 없음. 캐시 `.tmp` 정리는 실행 끝에만(크래시 시 남음), blob 정리 없음. 연결 시험 전용 버튼 없음(`목록 불러오기`가 대신함). 실제 회사 FTP 동작은 flow VERIFY P6-02. 설정 화면이 따로 없어 RCP 토글은 RCP 화면 머리글에 둠.

## 2026-11-24 · Claude Code(Opus) · P6-01
- 한 일: RCP 관리 설계(SPEC 4.6.1, D-36) — FTP 프로필(config/local.json만), 수집 흐름·한도, 이름 필터(정규식 없음), `data/recipes/` 내용 주소 캐시, 파서 플러그인 인터페이스, 버전 있는 설비사 매핑 JSON, 스냅샷·diff 의미, P6-05 쓰기 안전장치(두 열쇠·dry run·기준 해시·백업·diff·이름 확인·업로드 후 검증·감사 로그)와 위협 목록 T1~T16. migration 010(`recipe_sources/runs/recipes/snapshots/files/params`), `app/repositories/recipes.py`, 읽기 전용 API(`/api/recipe-sources`, `/api/recipes`, `/api/recipe-snapshots`, `/api/recipe-runs`), `parsers/`(base 레지스트리·`fake` 테스트 파서·`mapping.py` 검증·`mappings/example_vendor.json` 가짜 예시), 설정 `rcp_enabled`·`rcp_write_enabled`(기본 off, 쓰기는 RCP 켠 뒤에만, RCP 끄면 같이 꺼짐). FTP·쓰기 코드 없음, UI 없음.
- 바뀐 파일: migrations/010_recipes.sql, app/(main, repositories/recipes, routers/recipes, routers/settings).py, parsers/(__init__, base, fake, mapping).py, parsers/mappings/example_vendor.json, tests/(test_recipes, test_db, test_task_fields).py, .gitignore(data/recipes/, config/recipe_mappings/), docs/(SPEC, DECISIONS, WORKLOG), project_flow.html
- 테스트: pytest 284 passed(신규 10: 필터 규칙·검증, 소스 검증(계정 형태 거부·중복), 스냅샷 생성/무변경/되돌림, 해시 순서 무관, 중복 경로·parse_status, missing 해제, 읽기 전용 API·LIKE 이스케이프·405, RCP 플래그, 파서 레지스트리·fake 파서(cp949), 매핑 예시·검증·로컬 우선)
- 다음에 할 것 / 막힌 것: P6-02 = 읽기 전용 FTP 래퍼(쓰기 메서드 없음 테스트) + 소스 등록 API/화면 + 수집 실행(`upsert_recipe`/`add_snapshot` 사용) + missing 표시. P6-03 = xml/ini/txt 파서(경로 표기 확정) + 매핑 적용. 설정 화면에 RCP 토글 UI 없음(API만) — RCP 화면(P6-02/04)과 함께 DESIGN.md 따라 추가. 캐시 blob 정리(.trash) 기능 없음. 회사 FTP 특성은 flow VERIFY P6-01.

## 2026-11-24 · Claude Code(Sonnet) · P5-04
- 한 일: DOI 공유 패키지 내보내기·가져오기(D-35, 새 패키지 없음). 내보내기: DOI 화면 헤더 `패키지 내보내기`(범위 칩 보이는/전체, 상세 패널 `패키지로 내보내기`)로 `manifest.json`(형식 버전·package_id·보낸 곳·DOI·이미지 sha256) + `README.txt` + `images/<DOI uid>/<이미지 uid>.<ext>`(+미리보기) zip 한 개 생성, 초안·휴지통 제외. 가져오기: `패키지 가져오기` 창 — 검증(경로 이탈·심볼릭 링크·암호·중복 이름·용량 한도·sha256·크기·이미지 형식·형식 버전, 하나라도 틀리면 전체 거부) → 미리보기(새 항목/이미 있음/충돌, 저장 없음) → 항목별 선택 칩(가져오기·건너뛰기·둘 다 두기·내 것 덮어쓰기) → 원자적 적용(`.part` 복사 → DB 트랜잭션 → 파일 교체, 실패 시 전부 되돌림). 가져온 DOI는 `imported`·읽기 전용·`가져온 곳` 표시. 덮어쓰기는 내가 만든 DOI만(이전 내용은 `.trash/overwritten_*.json` + 이미지 `.trash`로).
- 바뀐 파일: app/(doi_package, main, routers/doi_package).py, web/js/(doi-package, doi-package-model, doi, api).js, web/css/doi-package.css, web/index.html, web/test/run_doi_package.mjs, tests/test_doi_package.py, docs/(SPEC, DECISIONS, WORKLOG), project_flow.html
- 테스트: pytest 274 passed(신규 33: 내보내기 내용·초안/휴지통 제외·이미지 누락, 두 인스턴스 왕복·읽기 전용·재가져오기 identical·미리보기 무저장, 미리보기 썸네일, 충돌 덮어쓰기+스냅샷·둘 다 두기·건너뛰기·이미 가져온 DOI 덮어쓰기 거부·이미지 ID 충돌, 적용 중 실패 롤백(파일·DB), zip-slip 6종·심볼릭 링크·암호·중복 이름·매니페스트 경로 4종·sha256/크기 변조·파일 누락·SVG 위장·형식 버전·깨진 zip·한도·잘못된 uid + Node 모델). Edge 앱 내 브라우저(가짜 데이터)에서 1024px 가져오기 창 라이트/다크, 미리보기 3상태·선택 칩·적용 후 읽기 전용 패널 확인. 1280px는 창 크기만 DOM으로 확인(스크린샷 영역 한계).
- 다음에 할 것 / 막힌 것: 이미 가져온 DOI의 새 버전을 받는 "갱신" 선택 없음(읽기 전용 원칙으로 덮어쓰기 불가 — 사용해 보고 결정, D-35). 패키지는 메모리에 통째로 올려 검사(300MB 한도) — 더 큰 파일은 스트리밍 필요. 가져온 미리보기(thumb) 없는 DOI는 원본으로 대신 그림(성능 영향은 수천 장일 때 확인). 내보내기 범위에 "직접 고른 여러 개" 없음(필터 + 상세 한 개만). 실제 회사 PC 간 전달은 VERIFY 참고.

## 2026-11-24 · Claude Code(Sonnet) · P5-03
- 한 일: DOI PPT 가져오기. 표준 라이브러리 `.pptx` 읽기(`app/pptx_read.py`, D-34: python-pptx 미추가) — 슬라이드 순서·제목·본문(텍스트 상자·표·그룹·AlternateContent)·발표자 노트·삽입 그림(여러 장, 도형 채우기 그림), 번호·날짜·바닥글 제외, EMF/WMF/TIFF/SVG/알 수 없는 형식·외부 링크 그림·25MB 초과·40장 초과는 이유와 함께 건너뜀, 파일 300MB·슬라이드 500·이미지 1GB 한도, DTD 거부, `.ppt`·암호 파일·깨진 파일 한국어 안내. `routers/doi_import.py`: 미리보기(그림을 `data/doi/.import/<token>/`에 스테이징, sha256·source_ref 중복, 반복 그림 표시, 하루 지난 스테이징 정리) → 확인(슬라이드마다 `status='draft'` DOI + `add_image`, 실패 슬라이드는 휴지통 처리 후 보고) / 취소. 화면: DOI 헤더 `PPT에서 가져오기` → 가져오기 창(끌어놓기, 공통 항목, 설명에 넣기 토글 칩, 거르기 칩, 슬라이드별 선택·이미지 넣기/빼기·제목·결함 종류·설명, 상태 배지, 만든 뒤 브라우저 썸네일 진행률). 초안 확정: 상세 `초안 확정`, `초안만 보기`의 `보이는 초안 N개 모두 확정`, 상세에 `가져온 파일`(source_ref) 행. 가짜 .pptx 생성 `scripts/make_sample_pptx.py`.
- 바뀐 파일: app/(pptx_read, main, routers/doi_import).py, web/js/(doi-import, doi-import-model, doi-thumb, doi, api).js, web/css/doi-import.css, web/index.html, web/test/run_doi.mjs, scripts/make_sample_pptx.py, tests/test_doi_import.py, docs/(SPEC, DECISIONS, WORKLOG), project_flow.html. 마이그레이션 없음.
- 테스트: pytest 241 passed(리더: 텍스트·그룹·표·노트·숨김·EMF 건너뜀·중복 그림 1회·한도·깨진/암호/.ppt/DTD, API: 미리보기 무저장·반복 로고·스테이징 이미지·중복 감지·확인 초안 생성·부분 실패·정리 + Node 모델). Edge 앱 내 브라우저(가짜 PPT)에서 1024px 다크·1280px 라이트로 미리보기→확인→썸네일→초안 확정 패널, 재가져오기 중복 표시 확인, 잘못된 파일 오류 문구 확인.
- 다음에 할 것 / 막힌 것: 실제 회사 PPT 레이아웃 미확인(VERIFY) — 제목이 텍스트 상자인 슬라이드는 "첫 짧은 줄(120자 이하)"로 추측. 슬라이드 읽기 순서는 XML 순서(위치 정렬 안 함), 이미지 위에 얹은 글자·SmartArt·차트 텍스트는 읽지 않음, 그림 자르기(crop)는 적용 안 하고 원본 전체를 가져옴(표시만). 이미지 이름(설명)은 PPT 대체 텍스트(descr)를 쓰며 편집 UI 없음. 가져오기 창에서 미리보기 큰 이미지 보기·슬라이드 순서 바꾸기 없음. 초안을 한 개씩 편집하려면 기존 `편집`을 씀(초안 상태 유지). 창을 닫으면 미리보기 선택 내용은 사라짐(파일은 다시 골라야 함). 영구 삭제·`.import` 수동 정리 기능 없음(하루 뒤 자동 정리). 같은 슬라이드를 다른 파일명으로 가져오면 이미지 중복(sha256)만 알려 줌.

## 2026-11-24 · Claude Code(Sonnet) · P5-02
- 한 일: DOI 라이브러리 `#/doi`. migration 009(`doi`·`doi_images`, 안정 uid·상대 경로·sha256), `app/repositories/doi.py`·`routers/doi.py`(레코드 CRUD, 이미지 원본 바이트 업로드·순서·설명·삭제, 썸네일 PUT, 휴지통·되돌리기, 가져온 DOI 읽기 전용). 이미지 검증은 파일 앞부분으로(SVG 거부), 이미지 삭제는 `data/doi/.trash/`로 이동, 썸네일은 브라우저 캔버스(서버 이미지 라이브러리 없음). 화면: 카드/표 전환 칩, 찾기, 제품·Step·결함 종류 칩 + 태그 다중 칩(개수는 다른 필터 반영), 상세 패널(1240px 이상 옆, 미만 서랍), 이미지 뷰어·전체 화면 보기, 추가/편집 창(끌어놓기·붙여넣기·설명·순서·제안 칩·닫기 확인). 결정은 D-33, `data/doi/`는 .gitignore에 추가.
- 바뀐 파일: migrations/009_doi.sql, app/(main, repositories/doi, routers/doi).py, web/js/(doi, doi-model, api, main, sheet).js, web/css/doi.css, web/index.html(nav·아이콘 5개·css), web/test/run_doi.mjs, scripts/seed_doi_sample.py(가짜 DOI+생성 이미지를 실행 중인 앱에 추가), tests/(test_doi, test_db, test_task_fields, test_lineeditor_js).py, docs/(SPEC, DECISIONS, WORKLOG), project_flow.html, .gitignore. 부수 수정: `confirmSheet`의 `content` 기본값 `[]`(P5-01 Plan 지우기 확인 창이 content 없이 호출해 오류 나던 문제).
- 테스트: pytest 전체 통과(DOI API·검증·휴지통·읽기 전용·경로 이탈·썸네일 + Node 모델). Edge 앱 내 브라우저(가짜 이미지)에서 1280px 다크/라이트 옆 패널·표, 1024px 서랍, 추가(끌어놓기)·편집(설명·이미지 빼기)·닫기 확인·전체 화면 보기(←/→)·휴지통→되돌리기·빈 결과/빈 휴지통 확인. 콘솔 오류 0.
- 다음에 할 것 / 막힌 것: 영구 삭제(휴지통 비우기)·`data/doi/.trash` 정리 없음. 가져온 DOI를 "내 DOI로 복사"하는 기능 없음(P5-04에서 결정). 목록은 전부 한 번에 받아 브라우저에서 거름(수천 건이면 서버 쪽 거르기 필요). 이미지 확대는 전체 화면 보기만(확대·이동 없음), 이미지 드래그로 순서 바꾸기 없음(↑↓). 목록 키보드는 카드 방향키만(표는 Tab). P5-03은 `create(status='draft', source_ref=…)`+`add_image`, P5-04는 `uid`·`sha256`·`create(uid=…, origin='imported')`를 쓰면 됨(SPEC 참고). 실브라우저·회사 PC 확인은 flow VERIFY.

## 2026-11-24 · Claude Code(Sonnet) · P5-01
- 한 일: process plan 엑셀 가져오기 + Plan/Step 표. 표준 라이브러리 `.xlsx` 읽기(`app/xlsx_read.py`, D-32: openpyxl 미추가), 머리글 자동 탐지·한영 별칭 매핑·위 셀 값 이어받기·줄 오류(`app/plan_import.py`), 저장소/라우터(`plans`, migration 008, 설정 `plan_mapping`). 미리보기(dry run) → `N개 반영`(한 트랜잭션), 같은 파일 재가져오기는 키(제품·Plan·Step ID/이름)로 갱신하고 파일에 없는 Step은 `파일에 없음` 표시(삭제 안 함). 지정하지 않은 열은 `기타 열`로 보존. 화면 `#/plans`: 제품 칩 + Plan 목록 → Step 표(찾기, 파일에 없는 Step 토글 칩), 가져오기 창(끌어놓기, 시트 칩, 머리글 줄, 열 지정 칩, 개수·줄별 결과). 가짜 샘플 생성 `scripts/make_sample_plan_xlsx.py`(`--variant 2`로 개정판).
- 바뀐 파일: migrations/008_plans.sql, app/(xlsx_read, plan_import, main, repositories/plans, routers/(plans, settings)).py, web/js/(plans, plans-model, api, main).js, web/css/plans.css, web/index.html(nav·upload 아이콘·css), web/test/run_plans.mjs, scripts/make_sample_plan_xlsx.py, tests/(test_plans, test_lineeditor_js).py, docs/(SPEC, DECISIONS), project_flow.html.
- 테스트: pytest 전체 통과(리더 왕복·공유 문자열·날짜·숨김, 헤더 탐지·별칭, dry run 무저장, 재가져오기 중복 없음·갱신·파일에 없음·복원, 줄 오류, 열 지정 복구, 잘못된 요청, 삭제·설정 + Node 순수 로직). Edge 앱 내 브라우저(가짜 데이터)에서 1280px 라이트·1024px 라이트/다크로 가져오기→반영→재가져오기→`파일에 없음` 토글·찾기 빈 상태·잘못된 파일 오류 확인.
- 다음에 할 것 / 막힌 것: 실제 회사 엑셀 레이아웃 미확인(VERIFY) — 머리글 별칭·병합 셀·Step ID 유무에 따라 조정 필요. "process plan 정보 링크와 연동"(원본 파일/사내 링크 열기)은 경로를 기록만 하고 열지 않음. Plan/Step ↔ DOI 연결은 P5-02. Step 표는 읽기 전용(직접 편집·열 폭 조절·정렬 없음), 미리보기는 앞 300줄만 나열. 합쳐진 머리글(2줄 머리글)·여러 시트를 한 번에 가져오기는 미지원(시트 하나씩). 삭제한 Plan은 같은 파일을 다시 가져오면 돌아옴.

## 2026-11-24 · Claude Code(Sonnet) · P4-08
- 한 일: (1) MOS 붙여넣기 어댑터. 현황판 요약의 `MOS에서 붙여넣기` 창: 붙여넣기(클립보드 버튼 포함) → 열 매핑(머리글 이름 목록, 단계 값 대응, 못 찾은 열은 붙여넣은 머리글 칩으로 지정, `settings.mos_mapping`에 저장) → 미리보기(적용/이미 같음/확인 필요/건너뛴 줄 카드, 줄별 결과 배지, 없는 Lot·설비·단계 모음, 보기 칩) → `N칸 적용`(기존 원자적 일괄 API 한 번, 이력 기록) → 토스트 `되돌리기`. 단계 되돌림·MOS가 더 오래된 칸은 기본 건너뜀(토글 칩으로 명시 적용), 같은 칸 중복 줄은 더 늦은 MOS 시각이 이김. 단계 전환 `moves[].at`로 MOS 시각을 이력 시각으로 기록(미래·형식 오류 422). (2) 오늘 화면 `밀린 단계` 패널: `GET /api/dashboard/today`의 `evaluations`(상위 8, 심각 먼저·오래된 순)·`evaluations_stalled`, `GET /api/evaluations/stalled`. 행 클릭 → `#/page/<평가 페이지>?cell=<id>`로 현황판을 열고 칸 선택·스크롤.
- 바뀐 파일: app/(repositories/evaluations, routers/(dashboard, evaluations, settings)).py, web/js/(mos-paste-model, mos-paste, eval-board, today, main).js, web/css/evaluations.css, web/index.html(paste 아이콘), web/test/run_mos_paste.mjs, tests/(test_mos_stalled, test_p2_extras, test_lineeditor_js).py, docs/SPEC.md, project_flow.html. 마이그레이션·새 의존성 없음.
- 테스트: pytest 204 passed(MOS 시각 이력·미래/형식 오류 원자적 거부·되돌리기·밀린 칸 정렬/제한/종료된 평가 제외·설정 검증·Node 순수 로직: 표 형식 6종, 열 이름 변형, 시각 형식 12종, 웨이퍼 지정, 줄 오류, 되돌림/오래됨/제외/중복 규칙). Edge 앱 내 브라우저(가짜 데이터)에서 1280px 다크·1024px 라이트로 오늘 패널, 행 클릭 칸 선택, 붙여넣기→미리보기→적용→되돌리기, 열 못 찾음→머리글 칩 지정→매핑 저장 확인.
- 다음에 할 것 / 막힌 것: `lot_status` 테이블·Lot 행 MOS 배지·`POST /api/lot-status/paste`는 만들지 않음(MOS의 step/Hold/위치 열을 실제로 보고 결정, SPEC 4.4에 적음). 되돌리기는 이력을 되돌림 시각으로 추가하므로 그 칸의 대기 시계가 다시 시작됨. 일지 자동 표시(flow 설명의 "일지 자동 표시 연결")는 하지 않음. 미리보기는 앞 200줄만 나열(집계·적용은 전체). 실제 MOS 클립보드 형식은 회사 PC에서 확인(VERIFY). 오늘 화면은 열려 있는 동안 밀린 단계를 자동 갱신하지 않음(할일·일지 변경 때만 다시 읽음).

## 2026-11-24 · Claude Code(Sonnet) · P4-07
- 한 일: 평가 템플릿 편집 창(`#/evaluations`의 `템플릿 편집`)과 현황판 엑셀 내보내기. 편집은 P2B-07과 같은 초안·적용/취소 방식: 단계 추가·이름·순서(↑↓, Alt+↑↓)·삭제(사용 중이면 영향 확인), 단계별 경고 기본 시간(비우면 끔), 색 팔레트(색 이름·번호 병기), 값 항목 추가·이름·입력 방식 토글 칩·순서·삭제, 마스터 지정, 복사해서 새 템플릿, 템플릿 지우기(마스터 제외). 현황판 요약에 `새 마스터로 저장`(평가의 단계·값 항목을 템플릿으로 복사)과 `엑셀 내보내기`.
- 서버: `GET /api/eval-templates/{id}/usage`, `DELETE /api/eval-templates/{id}`, `POST /api/evaluations/{id}/save-as-template`, `GET /api/evaluations/{id}/export.xlsx`. 엑셀은 표준 라이브러리(`app/xlsx.py`, `app/eval_export.py`)로 요약·칸 목록·설비별 단계 3시트를 쓴다(새 의존성 없음, D-31). 마이그레이션 없음.
- 바뀐 파일: app/(xlsx, eval_export, repositories/eval_templates, routers/eval_templates, routers/evaluations).py, web/js/(eval-templates, eval-template-model, eval-board, evaluations, api).js, web/css/evaluations.css, web/index.html(download 아이콘), web/test/run_eval_template.mjs, tests/(test_eval_export, test_lineeditor_js).py, docs/(SPEC, DECISIONS), project_flow.html.
- 테스트: pytest 197 passed(xlsx를 zipfile+ElementTree로 다시 읽어 모든 파트 XML 파싱·시트·헤더·값·제외 칸 확인, 사용 현황·지우기·마스터 저장, Node 편집 모델). Edge 앱 내 브라우저(가짜 데이터)에서 다크/라이트, 경고 시간 적용, 사용 중 단계 삭제 확인 창, 이름 비움 검증·적용 막힘, Esc 취소 시 서버 불변, 새 마스터 저장, 내보내기 링크 응답(200·첨부·한글 파일명) 확인.
- 다음에 할 것 / 막힌 것: 실제 Excel에서 열기는 미확인(VERIFY). 단계를 지워도 기존 평가는 그대로이고 평가 안의 단계 편집(추가·삭제)은 없음. 템플릿 단계 전체를 이미 만든 평가에 반영하는 기능 없음. 값 항목 키는 이름을 바꿔도 유지. 편집 창에서 드래그 순서 변경은 없음(↑↓·Alt+↑↓만). 마스터 지정 해제는 다른 템플릿을 마스터로 지정해서만 가능(서버 규칙).

## 2026-11-24 · Claude Code(Sonnet) · P4-06
- 한 일: 단계별 대기 시간과 경고. `app/eval_wait.py`(순수 규칙: 대기=지금−최신 진입 이력, 달력 시간, 오프셋 없는 시각은 Asia/Seoul, 임계 초과 1단계·2배 초과 2단계)와 `web/js/eval-wait-model.js`(같은 규칙 + 표기·요약·이력 머문 시간). 보드 API에 `now`·칸별 `wait_h`·`warn`, `PUT /api/evaluations/{id}/warn-hours`(평가가 복사한 단계에 저장, 칸에는 저장 안 함 D-09). 마이그레이션 없음.
- UI: `대기 경고` 토글 칩 + `경고 기준` 편집 패널, 설비별 칸 배지·Lot별 개수 배지·단계별 정렬, 요약 블록, 칸 패널 대기 배지와 이력별 머문 시간. 경고는 색 외에 아이콘(시계/삼각)·점선/실선·시간 글자·aria 문장으로 구분.
- 바뀐 파일: app/(eval_wait, repositories/evaluations, routers/evaluations).py, web/js/(eval-wait-model, eval-board, eval-board-model, eval-select-model, eval-panel, api).js, web/css/evaluations.css, web/test/run_eval_wait.mjs, tests/(test_eval_wait, test_lineeditor_js).py, docs/SPEC.md, project_flow.html.
- 테스트: pytest 192 passed(고정 시각으로 임계·재진입·제외·로그 없음·불일치 이력·오프셋·미래 시각·검증, Node 순수 로직). Edge 앱 내 브라우저(가짜 데이터)에서 다크/라이트, 설비별·Lot별·단계별, 토글 끄기, 기준 저장·오류, 칸 패널 확인. 콘솔 오류 0.
- 다음에 할 것 / 막힌 것: 템플릿(마스터)의 `warn_hours` 편집은 P4-07(지금은 평가별 기준만). 열린 화면 자동 갱신 없음(새로고침 필요). 설비 열 폭이 좁아 긴 단계명이 배지에 가려 말줄임됨(툴팁·aria에는 전체). "오늘" 화면 Top N은 P4-08에서 `wait_h`를 쓴다. 영업일 기준 대기는 하지 않음(SPEC은 달력 시간). 실브라우저 확인 항목은 flow VERIFY 참고.

## 2026-11-24 · Claude Code(Sonnet) · P4-05
- 한 일: 현황판 칸 패널과 다중 선택 일괄 단계 전환. 선택이 패널을 결정(0 닫힘/1 상세/N 일괄). 클릭·Ctrl·Shift·드래그·머리글(열/행/Lot/전체)·방향키·Space·Enter·Ctrl+A·Esc 선택, 제외 칸은 선택에서 빼고 개수 안내. 단일 패널(단계 칩, 다음 단계, 값 입력, 메모, 단계 이력, 범위 넓히기 칩)과 일괄 패널(단계 분포, 옮길 단계 칩 + 옮기기, 각 칸 다음 단계로), 토스트 되돌리기, 오류·오래된 보드(404/409)는 새로고침 버튼. 드롭다운 없음(D-12).
- API: `POST /api/evaluations/{id}/cells/stage`(원자적, cell_ids 또는 moves, 바뀐 칸만 eval_stage_log 기록), `PATCH /api/eval-cells/{id}`(값 검증·병합, 메모), `GET /api/eval-cells/{id}/history`. 마이그레이션 없음.
- 바뀐 파일: app/(main.py, repositories/evaluations.py, routers/evaluations.py), web/js/(eval-board, eval-board-model, eval-select-model, eval-panel, api).js, web/css/evaluations.css, web/test/run_eval_select.mjs, tests/(test_evaluation_creation, test_lineeditor_js).py, docs/SPEC.md, project_flow.html.
- 테스트: pytest 통과(원자성·제외/없는 칸/다른 평가 칸 거부·로그·되돌리기·값 검증·5,000칸 일괄 + Node 선택 모델). 브라우저(앱 내 패널, 합성 데이터): 클릭·Shift·Ctrl·열 선택, 일괄 전환·되돌리기, 값·메모 저장과 칸 전환 시 미저장 값 자동 저장, 방향키·Shift+방향키·Ctrl+A·Esc·Enter, 800px(떠 있는 패널) 다크/라이트. 5,000칸: 전체 선택 약 170ms, 일괄 전환 약 1초(서버 5,000건 이력 포함).
- 다음에 할 것 / 막힌 것: 1280px 실화면 배치와 1024px은 창 크기 제약으로 800px 화면 + DOM 좌표로만 확인(VERIFY 참고). 일괄 값·메모 입력, 제외 해제(칸 복원), 다른 탭 동시 수정 충돌 감지는 범위 밖. 대기 시간 경고 색은 P4-06이 `at` 사용. 엑셀 내보내기는 P4-07.

## 2026-11-24 · Claude Code(Sonnet) · P4-04
- 한 일: 평가 현황판 화면. `GET /api/evaluations/{id}/board`(설비·Lot·웨이퍼·칸 평면 목록, `at`는 단계 이력 최신 시각)와 `web/js/eval-board.js`. D-30에 따라 고정 폭 네이티브 표 + 이벤트 위임, 가상화 없음. 보기 토글 칩(설비별/Lot별/단계별, 남은 것만, 칸 표시=단계 또는 값 항목, D-12 드롭다운 없음), 요약 카드(큰 진행률·단계 분포 막대·범례·새로고침), 설비 열 머리글 진행 막대, Lot 띠, 제외 칸 빗금, 미배정 표시. 단계 색은 막대·틴트에만 쓰고 칸 텍스트에 단계 이름을 항상 표기. 빈 상태(남은 평가 없음 → 전체 보기)·오류 상태(다시 시도)·스켈레톤. 표는 role=grid, 방향키·Home/End·PageUp/Down·Ctrl+Home/End, roving tabindex, 칸별 aria-label, 보기 전환 시 live region 안내. 순수 로직은 `eval-board-model.js`(Node 시험).
- 성능(5,000칸, Edge, 앱 내 합성 데이터): 최초 표 생성 26ms, 보기 전환·칸 표시 전환 레이아웃 포함 약 50–160ms(1초 목표 이내). 회사 PC는 미측정.
- 바뀐 파일: app/(repositories, routers)/evaluations.py, web/js/(eval-board, eval-board-model, evaluations, api).js, web/css/evaluations.css, web/test/run_eval_board.mjs, tests/(test_evaluation_creation, test_lineeditor_js).py, docs/SPEC.md, project_flow.html.
- 테스트: pytest 179 passed(보드 API·5,000칸 응답·최신 이력 시각·Node 모델). Edge 1280/1024px, 다크/라이트, 키보드 이동, 오류→재시도, 남은 것만 빈 상태 확인, 앱 콘솔 오류 0.
- 다음에 할 것 / 막힌 것: 칸 선택(다중)·패널·단계 전환은 P4-05(현재 `board-cell` 이벤트만 발생). 대기 시간 경고 색은 P4-06이 `at`을 써서 추가. 단계 수가 많은 템플릿(10+)의 색 구분, 설비 10개 × 1024px 가로 스크롤은 사용하며 점검. 평가 메모(페이지 본문)는 읽기 전용 표시이며 편집기는 없음. 평가 목록 화면(#/evaluations)은 변경 없음.

## 2026-11-24 · Claude Code(Sonnet) · P3-07 (Final 디자인 재작업)
- 한 일: HTML 페이지를 Final 디자인·P2B 셸에 맞춤. 문서 위 툴바(격리 실행 상태 칩, 화면에 맞춤/길게 토글 칩(D-12, 선택은 localStorage), 새로고침 아이콘 버튼), 외부 요청 경고를 접이식 `details` 배지(건수 + 목록, 테마 경고 토큰)로 교체, 프레임 높이를 화면 기준으로 계산. 빈 페이지·오류는 공용 emptyState/errorState(다시 시도). 외부 요청 검사 실패는 경고 없이 계속 표시. 트리에 `HTML` 태그(코드 아이콘 유지), 아이콘 lock·refresh를 인라인 SVG 심볼로 추가. 포커스 링·aria 라벨·iframe title 지정.
- 샌드박스: 변경 없음(`allow-scripts`만, CSP `default-src 'none'`·`connect-src 'none'`, 상태 저장은 postMessage). 이슈 페이지 링크(task_id)·경로 breadcrumb·휴지통은 기존 공용 헤더/API 그대로.
- 바뀐 파일: web/js/(htmlpage, tree, main).js, web/css/(style, structure).css, web/index.html(심볼 2개), tests/test_html_page.py.
- 테스트: pytest 176 passed(트리 type, 휴지통 이동 시 상태 동반, 샌드박스·CSP 문자열 고정, 빈 HTML 검사 추가). 임시 vault에서 Edge 1280/1024px·다크/라이트, 상태 저장 후 새로고침 복원, 외부 요청 배지, 빈 페이지 상태 확인, 콘솔 오류 0.
- 다음에 할 것 / 막힌 것: 빈 페이지 "다시 확인"(hashchange 재진입)·오류 상태 화면은 브라우저로 클릭 검증 못 함. 이슈 페이지가 html 타입인 경우의 헤더 배치, 문서 안 다크 테마 연동(문서는 흰 배경 유지)은 범위 밖.

## 2026-11-24 · Claude Code(Sonnet) · P3-04 (Final 디자인 재작업)
- 한 일: 서식 툴바를 Final 디자인으로 재구성. 토큰(라이트/다크)·밀도(컴팩트 26/기본 30/여유 34px)·인라인 SVG 아이콘·포커스 링·aria 라벨, 드롭다운 없는 토글 칩(D-12). 캐럿 위치의 굵게·기울임·밑줄·취소선·블록·목록·크기·글자색·형광펜을 `aria-pressed`로 표시하고, 같은 크기·색·형광펜을 다시 누르면 해제. 기본색 칩은 테마 기본색으로 되돌림(프리셋 #1f2430을 어두운 배경에 쓰던 문제 제거). 표 셀·읽기 전용 블록에서는 인라인 서식 버튼을 비활성화. 툴바 방향키 이동(roving tabindex)·Esc로 본문 복귀. 툴바 끝에 단축키 켬/끔 스위치(P2B-02 설정 `mi.editorKeys` 공유), 꺼지면 Ctrl+Alt+0~3·Ctrl+Shift+./,·Ctrl+Space·Ctrl+-·접기 단축키도 멈춤(Tab·Enter·Backspace·Ctrl+B/I/U는 유지). 툴팁은 단축키 상태를 따름. Ctrl+Shift+N도 서식 지우기로 받음(브라우저가 선점하면 Ctrl+Space).
- 저장 형식: 변경 없음(프리셋 크기·색·형광펜만, 허용 목록 밖은 저장 때 제거). 툴바로 만든 서식이 편집→저장→열기→저장에서 동일함을 mdconv.html에 21건 추가.
- 바뀐 파일: web/js/(note-format, note-format-core, note).js, web/css/note.css, web/test/(run_note_format.mjs, mdconv.html), tests/test_lineeditor_js.py, WORKLOG.
- 테스트: pytest 172 passed(node 순수 로직 케이스 추가). mdconv.html 131/131. Edge 1024/1280px·라이트/다크·컴팩트 밀도·이슈 메모(compact) 확인, 앱 콘솔 오류 0(테스트 페이지의 404는 이미지 픽스처 경로).
- 다음에 할 것 / 막힌 것: 실제 키 입력으로 Ctrl+Shift+./, Ctrl+Space(한글 IME 전환과 겹칠 수 있음)는 회사 PC에서 확인. 자동 입력 도구가 마침표 키 코드를 보내지 못해 합성 키 이벤트로 검증함. 다단 편집에서 열 전환 시 상태 칩이 새 열 캐럿을 반영하는지 사용 중 점검. 모두 접기 버튼은 아직 방향키 이동 대상이 아님.

## 2026-11-24 · Codex · P3-06
- 한 일: 다단 노트와 이슈 메모의 GFM 표에 셀·머리글 편집, 저장되는 열 정렬, 행·표 추가, Excel TSV 복사와 붙여넣기를 연결했다. 기본 HTML 표를 사용한다. 표를 수정하지 않으면 원문을 내보내고 수정한 표의 인접 블록과 줄바꿈도 보존한다.
- 바뀐 파일: web/js/(note-table-model, note-table, mdblocks, mdconv, note).js, web/css/note.css, web/test/(run_note_tables.mjs, mdconv.html), tests/test_lineeditor_js.py, SPEC, DECISIONS, FLOW, WORKLOG.
- 테스트: pytest 158 passed. Edge 1024/1280px에서 마크다운 회귀 102건과 실제 입력·클립보드로 셀 편집, 숫자 정렬, TSV로 행과 열 확장, 선택 영역 복사, 표 추가 및 새로고침 복원을 확인했다. 서로 다른 줄바꿈을 포함한 인접 문장과 둘째 단의 원본 표가 유지됐다.
- 다음에 할 것 / 막힌 것: 회사 PC에서 Excel 실앱과 IME 조합을 확인한다. 표 셀 편집은 마크다운 원문 기준이며 정렬·범위 붙여넣기의 묶음 실행 취소는 범위 밖이다. P1-05는 별도 vendor 판단 및 샘플 검증 작업으로 남겼다.

## 2026-11-24 · Codex · P4-03
- 한 일: 평가 현황판 및 페이지 추가에서 4단계 평가 마법사를 연결했다. 템플릿 복사, 설비·Lot·웨이퍼 붙여넣기, 마우스·키보드 조합 제외, board 페이지 생성과 재열기를 구현했다. 새 칸은 단계 미배정으로 만들고 제외 칸도 보존한다.
- 한 일: 007에서 요청 ID를 저장해 응답 유실 후 재시도와 동시 제출의 중복 생성을 막는다. 정상 오류 경로에서 DB 변경을 되돌리고 신규 파일은 휴지통으로만 옮긴다. 페이지 이동과 휴지통 처리 시 평가의 페이지 링크도 갱신한다.
- 바뀐 파일: migrations/007_evaluation_requests.sql, app/(main, placement, vault).py, app/(repositories, routers)/evaluations.py, web/index.html, web/js/(api, main, evaluation-input, evaluations).js, web/css/evaluations.css, web/test/run_evaluation_input.mjs, tests/(test_evaluation_creation, test_db, test_task_fields).py, docs/SPEC.md, project_flow.html.
- 테스트: pytest 167 passed. Edge 1024/1280px에서 기본·다른 템플릿, 마법사 입력 검증, 엑셀 두 열·공백/쉼표 붙여넣기, 제외 클릭·방향키·Space, 저장·새로고침, 페이지 추가·Esc 취소를 임시 데이터로 확인했다. DB 연결 실패·페이지 파일 쓰기 실패를 주입해 생성된 것만 정리되는 것도 확인했다.
- 다음에 할 것 / 막힌 것: P4-04에서 `GET /api/evaluations/{id}/board`와 `renderEvaluationPage` 표·보기 버튼을 연결한다. P4-05에서 최초 단계 배정과 이력 추가를 함께 처리한다. OS 강제 종료 시점의 DB/파일 복구는 별도 운영 검증이 필요하다.

## 2026-11-24 · Codex · P1-05
- 한 일: 격리 vault에서 가짜 계층 페이지 시드를 실제 CLI로 검증했다. P3-06은 D-20에 따른 브라우저 기본 기능으로 구현하기로 했으므로 P1-05의 vendor 계획을 로컬 자산 검증으로 정리했다.
- 바뀐 파일: AGENTS, DECISIONS, README, FLOW, WORKLOG.
- 테스트: pytest 159 passed. 격리 vault의 첫 실행 15개, 재실행 0개, 기존 편집 파일 바이트 동일을 확인했다. 앱 정적 자산의 로컬 참조 검사도 통과했다.
- 다음에 할 것 / 막힌 것: P3-06에서 셀 편집·정렬·클립보드 동작을 검증한다. 회사 PC 오프라인 설치와 1주 실사용은 P2-07에 남아 있다.

## 2026-11-24 · Codex · P3-08
- 한 일: 로컬 페이지 제목·본문과 이슈 제목·메모 검색, 명령 팔레트(Ctrl+K·/), 페이지 링크 자동 완성과 백링크를 구현했다. 동명 제목은 경로로 구분한다. 링크 스타일은 본문 DOM 밖의 CSS 강조로 적용하며 위키링크와 줄바꿈 저장 형태를 유지한다.
- 바뀐 파일: app/search.py, app/routers/search.py, app/main.py, web/js/(search-palette,wikilinks,main,mdconv,note,api).js, web/css/search.css, web/index.html, tests/test_search.py, web/test/mdconv.html, SPEC, FLOW, WORKLOG.
- 테스트: pytest 146 passed. Edge에서 1024/1280px·라이트/다크, 검색·결과 이동·포커스 복귀, 백링크, 동명 자동 완성, 특수문자 링크 편집·혼합 줄바꿈 보존 확인. 마크다운 104/104.
- 다음에 할 것 / 막힌 것: 대규모 사내 vault 검색 성능 및 실제 한글 IME 조합은 회사 PC 검증에 포함한다. D-20에 따라 페이지 이름·경로 변경 시 기존 위키링크 본문은 그대로 유지한다.

## 2026-11-24 · Codex · P3-03
- 한 일: 노트 본문에 2~4단 편집기, 단 추가, 포인터 또는 방향키 너비 조절, 맞춤/고정 너비 가로 스크롤을 연결했다. 포맷 도구 모음은 활성 단을 편집한다. 페이지 배치 옵션은 기존 API로 저장하며 열 개수와 저장 비율이 다르면 균등 너비로 표시한다.
- 한 일: 최상위 단 경계를 분리하고 원문 구분자와 줄바꿈을 보존해 재조립한다. 코드 펜스·인용의 예시와 4단 한도를 넘는 표식은 원문에 남는다. 모든 단의 본문을 한 큐로 자동 저장하고, 이슈 메모는 같은 구역을 좁은 패널에 세로로 표시한다.
- 바뀐 파일: web/js/(note, inspector, note-columns, note-column-layout).js, web/css/note.css, web/test/run_note_columns.mjs, tests/test_lineeditor_js.py, project_flow.html, WORKLOG.
- 테스트: pytest 145 passed. 격리 vault/DB를 사용한 Edge 1024/1280px에서 단 추가·4단 제한, 원문/줄바꿈 보존, 실제 포인터·키보드 조절, 설정 저장 실패와 다시 저장, 표시 모드와 새로고침 복원, 이슈 페이지↔메모 편집 동기화를 확인했다.
- 다음에 할 것 / 막힌 것: P3-06 표 편집은 같은 공용 편집기에서 이어간다. 열린 코드 블록이나 주석을 먼저 닫으면 단을 추가할 수 있다. 회사 PC에서 실제 한글 IME와 브라우저 단축키 우선순위 확인은 남았다.

## 2026-11-24 · Codex · P4-02
- 한 일: 006 평가 스키마, 기본 마스터, 템플릿 조회·생성·수정 API를 추가했다. 마스터 교체를 한 트랜잭션에서 처리하고, 복합 FK가 서로 다른 평가의 설비·Lot·웨이퍼 혼합을 막는다. 단계 진입 시각은 이력으로만 읽는다.
- 바뀐 파일: migrations/006_evaluations.sql, app/main.py, app/(repositories, routers)/eval_templates.py, tests/(test_eval_templates, test_db, test_task_fields).py, docs/SPEC.md, project_flow.html.
- 테스트: pytest 156 passed. 기존 DB 업그레이드, 마스터 시드·교체·잘못된 입력, 템플릿 수정 후 평가 사본 보존, 교차 평가·중복 칸 거부 및 단계 이력 정리를 임시 DB에서 확인했다.
- 다음에 할 것 / 막힌 것: P4-03에서 템플릿 스냅샷으로 평가·셀과 board 페이지를 생성한다. P4-05에서 단계 변경과 이력을 함께 기록하고 P4-06에서 최근 이력으로 대기 시간을 계산한다. 기존 할일의 `eval_id`는 이미 저장된 값과 API 호환을 위해 유지했다.

## 2026-11-24 · Codex · P3-03 (저장 단계 완료)
- 한 일: D-20에 따라 최상위 `<!-- column -->`을 단 경계로 문서화했다. 노트 페이지의 `PUT /api/pages/layout`에서 표시 모드와 2~4개 열 너비를 검증해 `_page.json`의 `note_layout`에 저장한다. 단 설정 저장과 앱의 페이지 자동 저장·이동이 같은 메타데이터를 덮어쓰지 않도록 직렬화했다.
- 바뀐 파일: app/(vault.py, routers/pages.py), tests/test_pages.py, web/test/mdconv.html, docs/(SPEC, WORKLOG).
- 테스트: pytest 144 passed. 저장 후 본문 바이트 일치, 본문 자동 저장·페이지 이름 변경 후 설정 보존, 잘못된 비율·타입 거부. Edge 마크다운 100/100(펜스 안 같은 문자열과 실제 단 경계 보존 포함), 제목 접기 회귀 확인.
- 다음에 할 것 / 막힌 것:
  - P3-03 FLOW는 미완료. 다음 실행은 최상위 경계를 읽어 2~4개 편집 구역을 만들고 본문을 조립하는 작업부터. 코드 펜스·인용 안의 표식은 예시로 보존한다. 본문 분할이나 외부 파일 수정으로 열 개수와 저장 비율이 다르면 균등 비율로 표시한다.
  - 이어서 단 추가, 경계 드래그·키보드 조절, 맞춤/스크롤 토글, 새로고침 복원, 단 없는 기존 페이지 및 이슈 메모 동기화를 1024/1280px Edge에서 검증한다.
  - P3-06/P3-08은 이후, P4-02는 독립적으로 진행 가능. 실제 한글 IME와 P2-07/P3-09는 회사 PC 필요.

## 2026-11-24 · Codex · P3-02R
- 한 일: 앞선 미커밋 변환기 작업을 이어서 공용 노트·이슈 메모에 연결했다. 중첩 목록, 네 가지 표시 및 원문 블록을 왕복 보존한다. 파일 API도 혼합 줄바꿈을 유지하고, 줄바꿈만 다른 기존 이슈 메모는 중복 병합하지 않는다.
- 한 일: Tab/Shift+Tab(줄과 목록), Ctrl+. 불렛, Ctrl+1/Alt+1 표시 순환, Ctrl+Enter 완료, Alt+↑/↓ 하위 포함 이동을 연결했다. Ctrl+Alt+1은 제목 1로 유지한다.
- 바뀐 파일: app/(vault, memo).py, web/js/(mdblocks, mdconv, note-lines, note).js, web/css/note.css, web/test/(mdconv.html, run_mdblocks.mjs), tests/(test_pages, test_memo_unify).py, SPEC, DECISIONS, FLOW, WORKLOG.
- 테스트: pytest 136 passed. Node 블록 분할 28/28. Edge 변환기 99/99 및 실제 페이지 라우트에서 한글 제목 편집 → API 저장, 혼합 줄바꿈·원문 펜스 보존, 목록 표시·다중 선택·마우스·Enter, 이동·접기 회귀 확인.
- 다음에 할 것 / 막힌 것:
  - P3-03 단 배치부터. D-20의 `<!-- column -->` 경계와 `_page.json` 너비를 사용해 저장/로딩부터 분리해 진행한다. 이후 P3-06/P3-08, 독립 작업 P4-02.
  - 일반 줄/목록의 자식 접기와 실제 회사 키보드의 한글 IME·브라우저 키 우선순위는 후속 검증 항목이다. 서로 다른 종류의 중첩 목록을 내어쓸 때는 표시와 종류 보존을 위해 원위치 유지. P1-05 vendor는 P3-06 결정, P2-07/P3-09는 회사 PC에서 진행.

## 2026-11-24 · Codex · P3-02R (진행 중)
- 한 일: 공용 노트/메모 편집기의 keydown에 IME `keyCode === 229` 가드를 추가했다. 기존 변환기 변경 네 개는 작업 사본에 보존했다. FLOW 상태는 미완료.
- 바뀐 파일: web/js/note.js, docs/WORKLOG.md.
- 테스트: pytest 134 passed. Edge 합성 키보드 이벤트에서 `isComposing`, `keyCode: 229` 각각 단축키를 건너뛰고 정상 키는 접기를 실행한다. 실제 한글 IME는 회사 PC에서 확인한다.
- 다음에 할 것 / 막힌 것:
  - 현재 `mdconv.html`은 인라인 문자열의 리터럴 닫는 script 태그 때문에 멈춘다. Edge 임시 iframe에서 태그만 이스케이프해 실행한 결과 89/92 통과. 메타데이터를 강제로 제거하는 `rw` 시험에서 코드 펜스·미닫힌 펜스·HTML 주석 3건이 실패했다. 원본이 있는 읽기 전용 블록은 보존되므로, `rw`가 읽기 전용 블록의 원문까지 지우는 것이 실제 편집 경로를 올바르게 재현하는지 먼저 확인한다.
  - 작업 사본의 `loadInto`를 노트 초기 열기와 `setMd`에 연결하고, Tab/Shift+Tab · Ctrl+. · 표시 순환 · Alt+↑↓ 및 체크리스트 상호작용을 검증한다. 이후 P3-03/P3-06과 P3-08. P4-02는 편집기와 독립적으로 진행 가능.
  - P1-05 샘플 시드 완료, vendor 결정은 P3-06에 남음. P2-07/P3-09는 회사 PC에서 진행.

## 2026-11-24 · Codex · P4-01
- 한 일: 평가 테이블의 평가 간 참조 무결성, 템플릿 스냅샷의 키 안정성, 단계 변경과 이력의 원자성을 검토하고 D-30에 기록했다. 합성 5,000칸 시험으로 P4-04 초기 방식은 고정 폭 네이티브 표로 결정.
- 바뀐 파일: docs/DECISIONS.md, web/test/eval_board_benchmark.html, project_flow.html, docs/WORKLOG.md.
- 테스트: pytest 134 passed. Edge headless 1024/1280px 각 10회, 전체 48–167ms·250칸 갱신 16–20ms. 회사 PC와 실제 앱 현황판은 P4-04에서 확인.
- 다음에 할 것 / 막힌 것:
  - 최우선 P3-02R. 기존 변경 네 개는 그대로 두었다. `run_mdblocks.mjs` 27개 통과. Edge에서 `mdconv.html`의 상태가 `running…`에 멈춤. 인라인 JS의 공격성 테스트 문자열에 리터럴 닫는 script 태그가 있어 HTML 파서가 테스트 스크립트를 일찍 닫는다. 문자열을 이스케이프한 뒤 왕복 시험부터 실행할 것.
  - `note.js` 초기 열기와 외부 본문 새로고침이 여전히 `mdToHtml`을 직접 호출한다. P3-02R 작업 사본의 `loadInto`(원본 블록 서명 초기화)를 양쪽에 연결하고, D-20/D-21 키 동작·`keyCode === 229`를 검증할 것. 이후 P3-03/P3-06 및 편집기 연계 P3-08.
  - P4의 다음은 P4-02. D-30에 따라 마이그레이션·템플릿 API와 참조 무결성을 검증한다. P1-05는 샘플 시드 테스트를 통과했으며 vendor 여부는 P3-06 의존성 결정 필요. P2-07/P3-09 및 실제 IME 조합은 회사 PC가 필요하다.

## 2026-11-24 · Codex · P3-05
- 한 일: 노트와 이슈 메모에 공용 제목 더블클릭 접기·펼치기를 연결했다. 왼쪽 화살표와 기존 설정 저장 경로를 재사용한다.
- 바뀐 파일: web/js/note.js, project_flow.html, docs/WORKLOG.md.
- 테스트: pytest 134 passed. Windows Edge에서 제목 텍스트·굵은 제목 더블클릭, 왼쪽 화살표 단일·연속 클릭, 하위 블록 없는 제목, 새로고침 복원, 본문 불변을 임시 vault/DB로 확인.
- 다음에 할 것 / 막힌 것: P3-02R 변환기 미커밋 작업을 보존. 변환기와 공용 편집기의 통합이 끝난 뒤 P3-03/P3-06 및 편집기와 맞닿는 P3-08을 진행.

## 2026-11-24 · Codex · P0-05
- 한 일: 최초 커밋 `cf23e32`와 프로젝트의 `.venv`(Python 3.12.9, 3.11+ 조건 충족)를 확인하고 완료 표시.
- 바뀐 파일: project_flow.html, docs/WORKLOG.md.
- 테스트: pytest 134 passed.
- 다음에 할 것 / 막힌 것: P3-02R 변환기 작업 사본의 미커밋 변경을 보존하고, 독립 작업 P3-05의 제목 더블클릭 접기를 확인.

## 2026-11-24 · Claude Code(Opus) · P3-01 (재검토)
- 한 일: Final 디자인(DESIGN.md·prototype_final)과 P2B 편집기(lineeditor·note.js `mountEditor`·mdconv·D-29) 기준으로 D-20 재검토. **결론: 직접 만든 contenteditable + mdconv 유지**(라이브러리 교체로 해결되는 문제 없음, 오프라인·무의존 유지). 단 변환기가 블록 수준에서 원문을 바꾸는 결함 3개 확인 → D-20에 재검토 메모·후속 제약 8개 기록, 보강 작업 P3-02R 추가. 코드 변경 없음.
- 증거: `web/test/mdconv.html` 12/12 PASS, `run_memo.mjs`·`run_lineeditor.mjs` PASS. 브라우저 추가 왕복: 한글 서식·`[!]`·` → 할일 #12`·표·`[[링크]]`·인용·`####` 원문 보존 / 중첩 목록 평탄화, `- [*]`→`- [\*]`, 코드 펜스 이스케이프는 원문 변경(제목 한 단어 편집만으로 파일 전체에 반영). note.js는 Tab 차단·표시 순환 없음·IME `keyCode 229` 가드 없음.
- 바뀐 파일: docs/DECISIONS.md(D-20 재검토), project_flow.html(P3-01 메모, P3-02R 추가), docs/WORKLOG.md.
- 테스트: pytest 134 passed.
- 다음에 할 것 / 막힌 것:
  - P3-02R(변환기 무손실화 + 노트 편집기 줄 동작 정합)을 P3-03/P3-06보다 먼저. 그 전에는 LLM이 쓴 코드 펜스·중첩 목록이 있는 페이지를 앱에서 편집하면 형식이 바뀜.
  - P3-05 제목 접기는 D-29에서 이미 구현됨 — 확인 후 완료 처리만. P3-06 Tabulator는 vendor 안 되어 있음(자체 구현 우선 검토).
  - 실제 한글 IME 조합 중 단축키 충돌은 회사 Edge에서 확인(점검표 6장).

## 2026-11-24 · Claude Code(Sonnet) · P2B-06
- 한 일: **통합 검증**. 자동 시나리오 `tests/test_integration_e2e.py`(입력 줄→승격→분류 변경·자유 배치 이동·복사→페이지 확장(두 번째는 기존 페이지)→메모·이미지→앱 재시작 두 번→전부 유지), 001 DB(기존 데이터)에 마이그레이션 전부 적용 호환, `web/`(디자인·테스트 페이지 제외)에 외부 URL·`@import`·프로토콜 상대 링크 없음, `index.html`은 로컬 자산만, `run.bat` 127.0.0.1 전용. **브라우저 점검**(격리 DB·vault, 1024·1280px × 다크·라이트 × 컴팩트·기본·여유 × 오늘/할일/주간/구조/분류 관리): 가로 넘침 없음, 버튼·입력 이름 누락 없음, Tab 포커스 링 표시, 구조 모달 Esc 닫힘+열기 버튼으로 포커스 복귀·`aria-labelledby`. **수정**: 라이트 테마 보조 글자색(`--dim` 3.2~3.8:1→#5f6b82)·노랑(`--yellow` 4.05:1→#8a5800)을 4.5:1 이상으로, 할일 제목 Shift+Enter=상세(키보드만으로 상세를 열 수 없던 문제, 제목 `role=button`), **위치 규칙 탭 저장 안 한 변경 경고**(`leaveguard.js`: 화면 이동 확인 창·"취소"면 이전 주소 복원, 새로고침·닫기는 beforeunload), **이슈 삭제 시 `.issue-files/<id>`를 `.trash/`로 이동**(id 재사용 시 이전 이미지 상속 방지). 회사 PC 점검표 `docs/COMPANY_PC_CHECKLIST.md` 작성.
- 바뀐 파일: tests/test_integration_e2e.py(신규), web/(js/leaveguard.js 신규, main.js, rules.js, taskrow.js, todos.js, css/theme.css), app/(vault.py, routers/tasks.py), docs/(COMPANY_PC_CHECKLIST.md 신규, WORKLOG), project_flow.html.
- 테스트: pytest 134 passed(신규 6). 브라우저에서 규칙 초안→이동 시 확인 창·Esc로 복귀·"저장하지 않고 이동" 동작, Shift+Enter 상세 열림 확인. 대비는 스크립트로 계산(글자 대 배경 4.5:1 / 큰 글자 3:1, 수정 후 라이트·다크 전 화면 위반 0).
- 다음에 할 것 / 막힌 것:
  - **회사에서만 확인 가능**: 실제 Edge/웨일 단축키 가로채기·클립보드 붙여넣기·마우스 끌기·IME 조합·배율 125%·백신/프록시·오프라인 `pip install` (점검표 6장).
  - 이미지 삽입의 Ctrl+Z 한 번 되돌리기는 미해결(DOM 직접 삽입, 범위 밖으로 남김). 두 화면 동시 편집 충돌 감지, 이슈 삭제 시 페이지 고아(`task_id`만 남음), 규칙 순서 끌기, 자유 배치 이동 되돌리기, 이슈 제목 변경 시 페이지 제목 미갱신은 그대로.
  - 일지 줄 편집기의 작은 클릭 대상(체크 17px·접기 16px)은 밀도 설계상 유지. 스크린리더 실사용 확인 안 함. 미리보기 캡처가 모달을 크롭해 모달 확인은 DOM 상태(modal·focus)로 함.
  - 다음 flow 작업: P2-07(회사 PC 1주일 실사용, 사람이 직접)과 이후 P3/P4.

## 2026-11-24 · Claude Code(Sonnet) · P2B-10
- 한 일: **메모 = 페이지 본문 (D-29)** — 페이지가 있는 이슈는 `index.md`가 유일한 원본, `tasks.note`는 거울(`app/memo.py`: 읽기 `GET /api/todos/{id}`·쓰기 `PATCH note`·`PUT /api/pages`가 서로 맞춤, 앱 밖 파일 수정은 다음 읽기에서 반영). **기존 어긋난 메모/본문**은 서버 시작 시·첫 읽기·쓰기 직전에 한 번 병합(한쪽 비었거나 포함이면 그대로, 다르면 `## 통합 전 이슈 메모`로 이어 붙이고 원문은 `_page.json.memo_before_merge`; `memo_unified` 표시), 상세 패널을 열 때 토스트로 알림. **편집기 공용화**: `note.js`를 `mountEditor`(페이지·상세 메모 겸용)로 분리 — 상세 패널의 textarea를 같은 위지윅으로 교체(포커스 때만 서식 툴바가 펼쳐짐, 저장 상태·재시도 토스트, 열려 있는 두 화면은 한쪽 저장 후 다른 쪽이 바쁘지 않으면 자동 갱신). **이미지**: 붙여넣기/끌어놓기 → 자기 블록으로 삽입, 호버·클릭·키보드 선택 시 크기 바(자동·소형·480·720·원본 칩 + px 입력 + 원본 해상도 + 모서리 끌기 핸들), 저장은 `![](files/x.png){size=small|orig}` / `{width=480}`(자동은 접미사 없음, 본문 폭 초과 시 본문 폭으로 제한). 페이지 없는 이슈의 이미지는 `vault/.issue-files/<id>/`, 페이지가 생기면 `files/`로 이동(참조 불변). **접힘**: 제목 아래 섹션을 화살표·"모두 접기"·Ctrl+Shift+[ / ]로 접고, 상태는 `settings.memo_folds`(`t:<이슈id>`; 이슈 메모와 이슈 페이지가 같은 범위)에만 저장 — 파일·`_page.json`은 안 건드림. 이슈 복사 시 이미지도 복사.
- 바뀐 파일: app/(memo.py 신규, vault.py, placement.py, main.py, routers/tasks·task_pages·pages·structure·settings.py), web/(js/memocore.js·foldstore.js 신규, note.js 재작성, mdconv.js, inspector.js, api.js, css/note.css·screens.css), web/test/(run_memo.mjs 신규, mdconv.html), tests/(test_memo_unify.py 신규, test_lineeditor_js.py, test_issue_pages.py 기대값 1줄: 메모=본문), docs/(SPEC, DECISIONS D-29), project_flow.html.
- 테스트: pytest 128 passed(신규 17: 메모↔본문 양방향·삭제·거울 검색, 외부 파일 수정 우선, 어긋난 쌍 병합·재병합 없음·백업, 페이지 열기/PATCH 시 선병합, 시작 시 일괄 병합, 이미지 업로드·페이지 생성 후 이동·URL 유지·재시작 후 열기·복사본 이미지, 접힘은 설정에만 저장, node 순수 케이스 7개). `web/test/mdconv.html` 12/12 PASS(이미지 폭 왕복 포함). 브라우저(격리 DB·vault, 1024px, 다크·라이트, 콘솔 오류 없음)에서 이미지 크기 바 클릭→저장, 붙여넣기(합성 ClipboardEvent), 제목 접기→새로고침 후 유지, 상세 패널 입력↔페이지 편집기 양방향 갱신 확인.
- 다음에 할 것 / 막힌 것:
  - 이미지 모서리 끌기·실제 클립보드 붙여넣기·실제 마우스 호버 경로는 합성 이벤트/클릭으로만 확인(Edge에서 사람이 한 번 시험). 이미지 삽입은 DOM 직접 삽입이라 Ctrl+Z로 한 번에 안 되돌려질 수 있음.
  - 두 화면이 동시에 열려 있을 때 같은 순간 양쪽에서 타이핑하면 마지막 저장이 이김(충돌 감지 없음). 옛 평문 메모는 마크다운으로 읽히므로 `*`·`#`로 시작하는 줄이 서식으로 바뀔 수 있음(저장 시 정규화).
  - 페이지를 휴지통으로 보내면 이미지는 휴지통 폴더에 남고 메모 글만 이슈에 남음. 이슈 삭제 시 `.issue-files/<id>`는 남음(정리 기능 없음). 접힘 키는 제목 글자가 바뀌면 풀림.
  - 미리보기 캡처가 창을 크롭해 화면 이동 트릭으로 확인함. 1280px·밀도 변경은 확인 못 함. 일지 줄 편집기의 줄 접기(별개 기능)는 건드리지 않음.

## 2026-11-24 · Claude Code(Sonnet) · P2B-09
- 한 일: **선택적 이슈 페이지** — 이슈 추가는 레코드만, "페이지로 확장"은 같은 이슈 ID에 페이지 하나(`_page.json.task_id`)를 한 번만 연결(두 번째는 기존 페이지 열기, 메모·일지 연결 유지, 어긋난 `page_path`는 task_id로 복구). "할일 페이지 추가"(Alt+N/Ctrl+N, 할일 화면 버튼)는 이슈+페이지 동시 생성. **조건부 배치** — 첫 일치 AND 규칙 → 기본 위치(일지 아래/유형별/할일 폴더), 생성 전 경로 미리보기(새 폴더 표시)와 덮어쓰기(일지 아래·폴더 지정·직접 경로). 분류를 바꿔도 자동 이동 없음, 명시적 "위치 변경"만 이동. 실패 시 롤백(자동 폴더·페이지 제거, 이동은 원위치+meta 복원, 동시 생성은 이슈도 제거). **UI**: 페이지 시트(`pagedialog.js`), 구조 › 페이지 위치 규칙 탭(`rules.js`: 조건 칩·값 칩·변수 칩·순서·초안 미리계산·저장/되돌리기), 이슈 상세 '페이지' 행, 트리의 `#id`·`자동` 표시. D-28.
- 바뀐 파일: app/(placement.py·routers/task_pages.py 신규, vault.py, routers/pages.py·task_fields.py, main.py), web/(js/pagedialog.js·rules.js 신규, inspector·todos·main·structure·tree·api.js, css/structure.css), tests/test_issue_pages.py(신규), docs/(SPEC, DECISIONS D-28), project_flow.html.
- 테스트: pytest 110 passed(신규 20: 단독 이슈=페이지 없음, AND·첫 일치·계층 값·변수, 기본 위치·일지 월 페이지, 미리보기 무쓰기·덮어쓰기·잘못된 경로 400, 이름 정리·중복 `(2)`, 분류 변경 시 불이동·명시적 이동·맨 끝 순서, 트리 이동·휴지통과 링크, 어긋난 캐시 복구, 링크/쓰기 실패 롤백 후 재시도, 동시 생성 원자성, 이동 실패 복원, 개요·초안). 브라우저(격리 DB·vault, 800x600, 다크·라이트, 콘솔 오류 없음)에서 확장·동시 생성·폴더 지정 시트·위치 변경·규칙 편집(오류 안내·저장)·트리 표시 확인.
- 다음에 할 것 / 막힌 것:
  - 페이지 본문은 만들 때 메모를 복사할 뿐 이후 독립(상세 메모 ≠ 페이지 편집기). 통합은 P2B-10. 이슈 제목을 바꿔도 페이지 제목·폴더명은 안 바뀜. 이슈 삭제 시 페이지는 남음(task_id만 고아).
  - 규칙 순서는 ↑↓ 버튼만(끌기 없음), 저장 전 다른 화면으로 가면 초안이 사라짐(경고 없음). 트리에서 끌어 놓은 페이지의 '위치 고정'은 없음(수동 이동은 그냥 이동되고 규칙은 새 이슈에만 적용).
  - `{에픽위치}`는 에픽 이름과 같은 제목의 페이지를 찾는 `[가정]`. 같은 이름 페이지가 여럿이면 트리 순서상 첫 번째.
  - 미리보기 브라우저 캡처가 모달을 크롭해 `showModal`을 비모달로 바꿔 확인함(실제 모달 포커스 트랩·Esc는 Edge에서 사람이 확인). 1024/1280px·실제 마우스 클릭 경로는 일부만 확인(JS 클릭 병행).

## 2026-11-24 · Claude Code(Sonnet) · P2B-08
- 한 일: **컴팩트 구조 작업표** — 한 행에 계층 이름·상태/완료 수·제품·요청자·납기, 그룹 완료 수 = 고유 이슈 완료/전체(진행 막대 포함), 모두 펼치기·접기와 그룹별 접기, 행 선택·방향키·F2 제목 수정·더블클릭 상세, 좁은 폭에서 제품 열 자동 숨김(컨테이너 쿼리). **분류 기준**: 계층 칩 끌기·Alt+←/→로 단계 순서 변경(전체 관점이 바뀜, 되돌리기), 이슈를 그룹에 놓거나 '이동…' 창(버튼 목록)으로 옮기면 그 그룹의 분류 값이 바뀜(되돌리기). **자유 배치**(분류 기준/자유 배치 토글 칩): 그룹을 하위와 함께 끌어 이동(가운데=하위, 위쪽 가장자리=앞), Alt+↑↓←→ 키보드 이동, 순환은 드롭 불가 표시+서버 400, '그룹 추가'. 위치는 마이그레이션 005 테이블(`structure_nodes/items`)에만 저장, vault 페이지 트리와 분리. **복사**: 이슈/에픽(다른 유형 가지의 같은 에픽 이슈 포함)/자유 배치 그룹(선택 하위 트리만)을 새 ID로, 원본과 독립. D-27.
- 바뀐 파일: migrations/005_structure_free.sql, app/repositories/(structure_free.py, structure_copy.py), app/routers/structure.py, web/(index.html 아이콘, css/structure.css, js/structure·structmodel·structmove·api.js), tests/(test_structure_layout.py 신규, test_db·test_task_fields 마이그레이션 목록), docs/(SPEC, DECISIONS D-27), project_flow.html.
- 테스트: pytest 90 passed(신규 11: 시드·vault 분리, 이슈 이동 값 변경·ID 유지, 그룹 이동, 순환 거부·무변경, 순서, 그룹 추가, 이슈 복사 독립성·새 ID, 에픽 복사 범위, 유형 그룹 복사 검증, 자유 그룹 복사 하위 트리, ID 안정). 브라우저(격리 DB, 1024px, 다크·라이트, 콘솔 오류 없음)에서 접기/펼치기, 계층 칩 순서 변경, 이슈 그룹 이동+토스트, 에픽 복사(5개 이슈), 자유 배치 전환·그룹 이동·순환 거부 표시·Alt 키 이동·그룹 복사·이동 창·그룹 추가·제목 수정·이슈 복사 확인.
- 다음에 할 것 / 막힌 것:
  - 실제 마우스 드래그는 합성 DragEvent로만 확인(Edge에서 사람이 한 번 시험 필요). 1280px·컴팩트/여유 밀도 눈 확인 못 함(미리보기 창 캡처가 크롭됨).
  - 자유 배치 이동은 되돌리기 없음(분류 기준 이동·계층 순서만 있음). 그룹 이름 바꾸기·삭제, 자유 배치 그룹 위치 규칙은 범위 밖. 분류 기준의 '이동…'은 이미 있는 그룹만 목적지(빈 선택지 그룹은 안 보임).
  - 새 이슈가 자유 배치에서는 최상위 끝에 놓임(복사본은 원본 옆). 최상위로 옮기면 분류 값은 그대로(변경 없음). 복사 이름은 자동("· 복사본")이며 분류 관리에서 바꿈.
  - 사람(person) 분류와 미분류 그룹은 복사 불가(안내 표시). 복사 중 새 선택지 생성 후 실패하면 선택지가 남을 수 있음(드묾).

## 2026-11-24 · Claude Code(Sonnet) · P2B-07
- 한 일: **구조 화면 `#/structure`**(사이드바 '구조') — 계층 바(모양+이름 칩, 에픽 › 유형 › 이슈), 분류별 묶음 읽기 보기(접기·완료율), 규칙이 깨지면 자유 배치 + 사유 안내. **계층 편집 창**(네이티브 dialog): 분류 기준/자유 배치 칩, 끌기·↑↓·Alt+↑↓ 순서 변경, 기존 분류 추가, 새 분류 만들기, 모양 6종×색 6종 선택(모양·이름 병기), '보기에서 제외', 적용(원자적 PUT)/취소(서버 호출 없음). **분류 관리 `#/structure/classes`**: 영향 이슈 수·선택지별 건수·위치 규칙 참조, 이름 바꾸기, 선택지 추가/삭제(비우기·옮기기), 구조 보기에서만 제외, 보관·복원, 값까지 완전 삭제(확인 창, 규칙 참조·기본 항목은 차단). 서버: 마이그레이션 004(epic·type 시드), `app/repositories/structure.py`·`routers/structure.py`, 설정은 `settings.structure_view`(재시작 후 복원). D-26.
- 바뀐 파일: migrations/004, app/(repositories/structure.py, routers/structure.py, main.py), web/(index.html, css/structure.css·theme.css, js/structure·leveldialog·classes·sheet·levels·api·main·shell.js), tests/(test_structure.py 신규, test_db·test_task_fields 기대값), docs/(SPEC, DECISIONS D-26), project_flow.html.
- 테스트: pytest 79 passed(신규 6: 초기 보기, 적용·복원·새 분류, 잘못된 적용 무변경, 제외 vs 보관→자유 모드, 영향·규칙 참조, 자유 모드 저장). 브라우저(격리 DB, 다크·라이트, 콘솔 오류 없음)에서 추가·순서(버튼·Alt 키·드래그 이벤트)·새 분류·모양/색·취소(서버 불변)·적용, 선택지 옮기며 삭제, 보관 확인 → 자유 배치 전환 확인.
- 다음에 할 것 / 막힌 것:
  - 미리보기 브라우저가 모달 dialog를 스크린샷에서 확대·잘라 보여, 스크린샷은 showModal을 비모달로 대체해 찍음. 실제 모달 동작(Esc·배경 클릭·포커스 복귀)과 실제 마우스 드래그는 Edge에서 사람이 확인 필요. 1280px 확인 안 함(1024px만).
  - 구조 화면은 읽기 보기만(그룹 이동·재정렬·복사·자유 배치 편집·전체 접기 버튼은 P2B-08). 자유 배치의 부모·순서 저장은 아직 없음(모드와 사유만 저장).
  - 새 분류는 선택지 없이 생성되므로 이슈에 값을 주려면 분류 관리에서 선택지를 먼저 추가해야 함(빠른 추가·상세 패널은 선택지가 있어야 칩이 뜸). 계층에 `person` 분류(요청자 등)를 쓰는 경우 그룹명은 입력된 이름 그대로.
  - 분류 순서 변경(`PUT /fields/order`)·필터/행 노출 토글·위치 규칙 편집 화면은 범위 밖.

## 2026-11-24 · Claude Code(Sonnet) · P2B-05
- 한 일: **간헐 500 수정** — 원인은 SQLite 잠김이 아니라 FastAPI가 `yield` 의존성의 연결을 생성/종료 스레드가 다르게 처리해 `sqlite3.ProgrammingError`(스레드 검사)가 나던 것. `db.connect`에 `check_same_thread=False` + `busy_timeout` 추가, 재현 테스트 2개. **서버**: 마이그레이션 003(`tasks.mark`), 일지 줄↔할일 양방향 동기화(`app/journal_links.py`: 제목·완료·★!·계획일 이동·하위 줄 동반 이동·복제 줄 연결 해제·승격 중복 방지·같은 제목 재사용), 할일 목록 필터(`ids`·`planned_from/to`·`due_from/to`·`unplanned`·`marked`·`open_only`), 오늘 API 확장. **화면**: 오늘(납기 임박/★!/오늘 일지 탭), 주간 신규(`#/week[/날짜]`, 이전·이번·다음 주, 주말 토글, 계획/납기/날짜 없음 탭, 확대), 월간(트레이·드롭·주 헤더·주말/납기/단축키 칩), 할일(빠른 추가 상세 칩 + 마지막 선택 기본값·끄기·비우기, `@사람 ~날짜 ! 필드:값` 입력, 칩 필터, 행 한 번 클릭 이름 변경·더블클릭 상세), 우측 상세 패널(상태·우선순위·표시·계획일·납기·요청자·사용자 정의 칩, 메모 자동 저장, 삭제 확인), 토스트(되돌리기·다시 시도), 오류·빈·로딩 상태. 줄 편집기에 이슈 칩(#id·납기·요청자)·이동 손잡이·더블클릭=상세 추가. 공통 `hub.js`가 한 화면의 편집기·목록을 같은 응답으로 갱신.
- 바뀐 파일: app/(db.py, journal.py, journal_links.py, repositories/tasks.py, routers/tasks·journal·dashboard.py), migrations/003_task_mark.sql, web/(index.html, css/screens.css·style.css, js/hub·ui·toast·dayeditor·taskrow·inspector·quickadd·week·today·todos·journal·lineeditor·main·api.js), tests/(test_journal_links.py, test_db.py 외 기대값 갱신), docs/(SPEC, DECISIONS D-25), project_flow.html.
- 테스트: pytest 73 passed(신규 12: 동기화 10 + 연결 스레드 2). 브라우저(1024px, 격리된 임시 DB·vault 서버)에서 오늘·주간·월간·할일 확인: 체크/제목/메모/상태 변경이 일지 줄·목록에 즉시 반영, 일지 줄 타이핑 → 할일 제목 갱신, 주간 드롭·되돌리기, 월간 트레이 드롭, 승격, 빠른 추가 기본값 유지(새로고침 후에도), 오류 상태·재시도, 다크·라이트, 콘솔 오류 없음.
- 다음에 할 것 / 막힌 것:
  - 1280px 레이아웃(트레이·주간 목록이 오른쪽 열)은 미리보기 창이 1024px라 눈으로 확인하지 못함(CSS 미디어쿼리 1100px 기준). 회사 PC Edge에서 확인 필요.
  - 실제 마우스 드래그(HTML5 DnD)는 합성 이벤트로만 검증. 손잡이(⠿)·행 드래그는 사람이 한 번 시험.
  - 되돌리기는 줄을 원래 날짜의 **끝**에 붙임(원래 위치 복원 아님, D-25). 호버 메모 미리보기·단축키 J/K/X·검색 팔레트·상세 메모의 서식 편집(P2B-10)은 범위 밖.
  - 월간 이전/다음 달 이동 시 비어 있는 월 페이지가 vault에 생성됨(기존 동작). 주간이 달 경계를 넘을 때도 다음 달 페이지를 만든다.
  - 일지 줄 편집기의 ★(`[*]`)·`[!]` 줄은 이제 승격 가능. 하위 불렛→하위 할일(parent_task_id) 연결은 아직 안 함.

## 2026-11-24 · Claude Code(Sonnet) · P2B-04
- 한 일: 워크스페이스 셸을 Final 시안에 맞춤. `theme.css`에 다크/라이트 토큰(D-23)·밀도 3단계·셸 레이아웃, 모든 화면 색을 토큰으로 교체(하드코딩 제거, 기존 변수는 별칭 유지). `boot.js`가 첫 페인트 전에 테마·밀도 적용(깜박임 없음), `shell.js`가 시스템/라이트/다크 + 컴팩트/기본/여유 버튼 토글(D-12), 사이드바 접기(`[`), 브레드크럼, 저장 상태 표시. 설정은 `settings.theme`/`density`에 저장(+localStorage 캐시). 사이드바 트리는 여섯 최상위(일지/MI 공정업무/연구 개발/성과/업무 매뉴얼/스터디)를 항상 표시(없으면 흐린 줄, 클릭 시 생성), 인라인 SVG 아이콘(`index.html` 스프라이트, 외부 자산 없음), 화살표·Home/End 키 이동(roving tabindex), 드래그로 하위 이동·형제 순서 변경(PATCH). 포커스 링, 1024/1280px 확인.
- 바뀐 파일: web/index.html, web/css/(theme.css 신규, style.css, lineeditor.css, note.css), web/js/(boot.js·icons.js·shell.js 신규, tree.js, main.js, api.js), app/routers/settings.py, app/main.py(정적 파일 no-cache), tests/test_settings.py, docs/SPEC.md, project_flow.html.
- 테스트: pytest 61 passed. 브라우저 미리보기에서 1024·1280px, 다크·라이트, 컴팩트·여유, 사이드바 접기, 트리 드래그(자식 이동·순서 변경)·키보드 이동, 콘솔 오류 없음 확인(이동 후 원상 복구).
- 다음에 할 것 / 막힌 것:
  - 오늘·할일 외 바로가기(주간·월간·구조·평가 현황판)와 검색 팔레트(`/`, Ctrl+K), 단축키 켬/끔 설정은 해당 작업(P2B-05 이후)에서.
  - 트리의 '자동 폴더'·할일 페이지 노드·위치 고정 표시는 P2B-07/08 범위. 고스트(미생성) 루트는 사용자가 클릭해 직접 만든다.
  - 일지 월간 표는 좁은 폭에서 가로 스크롤(기존 동작, 미개선). 사이드바는 900px 미만에서 자동 접힘 없음(수동 토글만).
  - 동시에 여러 요청(설정 저장 + 할일 조회)을 보내면 드물게 `/api/todos`가 500(SQLite 잠김 추정)을 낸 적이 있음 — 재현 조건 확인 필요(WAL/busy_timeout 점검).
  - 실제 Edge·웨일에서의 `[` 키 및 시스템 테마 전환 연동은 미확인(미리보기 브라우저만).

## 2026-11-24 · Claude Code(Sonnet) · P2B-03
- 한 일: 사용자 정의 필드 저장·API. `002_task_fields.sql`: `task_fields` 테이블 + `tasks.props`(JSON) 추가, 기본 항목 4개(우선순위·요청자·납기·하기로 한 날) 시드, 기존 값을 props로 복사. 기존 4개 컬럼은 props와 함께 쓰는 미러로 유지(기존 쿼리·필터·일지·대시보드 무변경). `app/repositories/task_fields.py`(정의 CRUD, 선택지 추가·삭제·옮기기·계층, 보관/purge 삭제, 규칙 검증·참조 검사)와 `app/routers/task_fields.py`. 할일 API에 `props`·`?field_<key>=` 필터 추가.
- 바뀐 파일: migrations/002_task_fields.sql, app/repositories/task_fields.py, app/repositories/tasks.py, app/routers/task_fields.py, app/routers/tasks.py, app/main.py, tests/test_task_fields.py, tests/test_db.py, docs/SPEC.md, project_flow.html. UI는 건드리지 않음.
- 테스트: pytest 58 passed (구버전 DB 마이그레이션, 미러 동기화, 값 검증, 필터, 선택지 삭제·이동, 보관/purge, 규칙 참조 보호 포함).
- 다음에 할 것 / 막힌 것:
  - 항목 관리 UI(보관·purge 확인 창, 선택지 옮기기 선택)와 필터 줄·행 메타의 자동 생성은 프론트 작업(P2B-04 이후)에서. 현재 프론트는 아직 고정 우선순위·요청자 UI.
  - `tasks.has_page`·`page_pin`, 위치 규칙의 실제 적용(페이지 이동)은 미구현 — 규칙은 저장·검증만 한다. 선택지 이름 변경은 value 유지라 규칙에 영향 없음.
  - `GET /api/todos`의 `requesters` 제안은 requester 컬럼 기준(보관/삭제 시 비워짐). 일반 person 항목 제안 API는 필요 시 추가.
  - `text:값` 토큰 매핑(승격 시 `키:값`)은 journal 승격 작업에서 이 API를 사용.

## 2026-11-24 · Claude Code(Sonnet) · P2B-02
- 한 일: 공통 줄 편집기(`web/js/lineeditor.js`, 순수 로직 `lineeditor-core.js`, `web/css/lineeditor.css`)를 만들어 오늘 일지와 월간 일지 칸에 연결. 한 번 클릭 편집(클릭한 위치에 커서), 더블클릭 오른쪽 확대 시트, 형광펜(`<mark>`)·별표(`[*]`), 체크 아이콘 클릭 완료 전환, 하위 줄 접기(보기 상태, 파일엔 안 씀), D-21 불렛·Tab/Shift+Tab(윗줄+1 제한)·Ctrl+1 순환·Enter 이어받기/빈 불렛 해제·Backspace 단계 해제·Alt+↑↓ 블록 이동·Ctrl+Enter 완료. 단축키 켬/끔 토글(Tab/Enter는 항상), 브라우저 예약 키 대안(Alt+1, Ctrl+Alt+1, Alt+Shift+H/S)과 도움말의 '키 확인' 패널. 한글 IME 조합 중에는 키 처리를 건너뜀. 변경은 execCommand로 적용해 Ctrl+Z 유지.
- 바뀐 파일: web/js/lineeditor.js, lineeditor-core.js, today.js, journal.js, web/css/lineeditor.css, web/index.html, web/test/(lineeditor_cases.js, run_lineeditor.mjs, lineeditor.html), tests/test_lineeditor_js.py, docs/DECISIONS.md, project_flow.html. API·스키마 변경 없음.
- 테스트: pytest 45 passed (node 줄 편집 케이스 25개 포함). 브라우저 미리보기에서 실제 키 입력으로 오늘·월간 칸 편집, Tab, Ctrl+1/Alt+1 순환, 형광펜, Alt+↑ 이동, 체크 클릭, 접기, 더블클릭 시트·Esc 반영·저장 확인.
- 다음에 할 것 / 막힌 것:
  - 주간·메모 화면은 아직 앱에 없음(P2B-05 주간, 할일 메모/상세는 이후). 모듈은 `mountLineEditor(host, opts)`로 그대로 재사용 가능.
  - 실제 Edge/Chrome/웨일 일반 탭에서 Ctrl+1이 탭 전환으로 가로채이는지는 미확인(미리보기 브라우저는 통과). 도움말 '키 확인'으로 사용자가 확인 후 DECISIONS에 기록.
  - 승격은 아직 `- [ ]`만 가능(`[*]`·`[!]` 승격, 하위 불렛→하위 할일은 백엔드 작업). 제목(#)·이미지 줄·취소선·날짜 입력 단축키는 미구현. 다크 테마 토큰은 P2B-04에서 연결(CSS 변수만 사용).
  - 편집 중 텍스트 영역은 마크다운 원문(`- [ ]`, `<mark>`)을 그대로 보여준다(WYSIWYG 아님).

## 2026-11-24 · Codex · P2B-01 최종 시안 반영
- 오늘·주간·월간의 v4 줄 편집기와 Astra 구조 표를 같은 이슈 데이터에 연결했다. 한 번 클릭으로 바로 수정하고 더블클릭으로 오른쪽 상세 또는 날짜 확대 창을 연다.
- 기준 파일은 web/design/prototype_final.html, docs/DESIGN.md, project_flow.html이다. P2B-01은 완료 상태이며 저장·API·vault 연결은 후속 단계다.
- Edge에서 주간 별표 줄의 월간 연결, 날짜 이동과 되돌리기, 제목 직접 수정과 확대, 구조 접기·복사·사용자 분류·자유 배치를 확인했다.

## 2026-11-24 · Codex · P2B-01 완료
- 한 일: 사용자 확정에 따라 Astra를 기준 시안으로 채택. 일반 이슈 생성과 기존 이슈의 페이지 확장을 분리했다. 전용 계층 편집 창에서 기본·사용자 정의 단계, 순서, 모양·색을 편집하고 적용하거나 취소한다.
- 바뀐 파일: web/design/prototype_astra.html, docs/DESIGN.md, docs/WORKLOG.md, project_flow.html.
- 테스트: pytest 44 passed. Headless Edge 상호작용 12개 통과(새 분류 적용·취소, 이슈 단독 생성과 동일 ID 페이지 확장 포함).
- 다음: P2B-02 공통 줄 편집기. 저장·마이그레이션·실제 vault 연동·테마·접근성 검증은 flow의 후속 구현 항목.

## 2026-11-24 · Codex · P2B-01 (Astra 구조 작업표)
- 한 일: Tempo Structure의 사용자 정의 계층과 스프레드시트형 보기를 참고해 독립 시안 제작. 계층 핸들 순서 변경, 임의 단계 추가, 전체 접기·펼치기, 자유 트리의 하위 그룹 이동, 이슈·에픽 복사와 그룹 완료 집계.
- 바뀐 파일: web/design/prototype_astra.html, docs/WORKLOG.md.
- 테스트: pytest 44 passed. Edge에서 전체 펼침·접힘, 유형을 에픽 위로 이동, 새 ID로 이슈 복사, 여러 유형에 걸친 에픽 복사, 세 번째 분류 추가, 하위 트리 이동, 순환 거부 확인.
- 다음: 실제 사용자가 구조 편집을 검토한 뒤 본 앱의 뷰 저장 형식 결정. 시안은 탭 메모리에서 작동.

## 2026-11-24 · Codex · P2B-01 (_solhigh 구조·일지·편집)
- 한 일: 구조 관리에서 분류와 선택지를 편집하고 할일을 그룹 간 이동. 페이지·폴더 트리 이동과 순서 변경, 조건부 노트 경로와 생성 전 미리보기, 그룹·날짜별 할일 페이지 생성. 일지·오늘·할일의 ID 연결과 완료/제목 반영. Tab/Shift+Tab, Ctrl+N·Alt+N, 본문 접기, 이미지 붙여넣기와 너비 제어.
- 바뀐 파일: web/design/prototype_solhigh.html, docs/DESIGN_solhigh.md, docs/SPEC.md, docs/WORKLOG.md.
- 테스트: pytest 44 passed. Headless Edge에서 합성 드래그·키·클립보드 이벤트로 필드 이동, 경로 규칙, 메모·이미지, 일지 연결 등 16개 확인. 실제 OS 예약 키와 시스템 클립보드는 별도.
- 범위: 오프라인 단일 HTML, 탭 메모리의 모의 페이지 트리. vault·DB 연동은 앱 적용 단계에서 진행.

## 2026-11-24 · Codex · P2B-01 (_solhigh 사용자 피드백)
- 한 일: 오늘 할일 행에 메모 미리보기, 메모 단축키·목록 연속 입력, 설정의 단축키 토글과 컴팩트 모드를 추가했다. 할일 상세 입력에서 납기·요청자·제품·유형·에픽·태그를 고르고 다음 입력에서 재사용한다. 할일과 연결된 페이지의 메모를 상세 패널과 공유한다.
- 바뀐 파일: web/design/prototype_solhigh.html, docs/DESIGN_solhigh.md, docs/WORKLOG.md
- 테스트: pytest 44 passed. 브라우저에서 제품 B·이슈·내일 선택 후 다음 입력의 기본값, Ctrl+. 불릿, 단축키 끄기, 할일에서 페이지 생성 및 메모 연결을 확인했다.
- 다음에 할 것: 실제 앱에 적용할 때 사용자 정의 필드와 페이지 연결의 저장 형식을 결정한다. 이 시안은 탭 메모리에서 동작한다.

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
