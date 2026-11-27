# MI_Planner — 저장소 규약

Windows Chromium에서 쓰는 로컬 MI 업무 앱이다. 코드·데이터 작업 전 해당 `docs/SPEC.md`와 `docs/DECISIONS.md` 절, `docs/WORKLOG.md` 맨 위 1~2개 항목을 확인한다. 실행·기록·앱 CLI는 필요한 경우 `docs/AGENT_TASKS.md`를 참조한다.

## 작업 선택과 UI

- 다음 일은 `docs/VOC.md`의 대기 항목과 우선순위(1이 가장 높음)를 먼저 본다. P 시리즈는 재윤이 해제할 때까지 홀드다. 대기 VOC가 없으면 새 P 작업을 고르기 전에 확인한다.
- 작업마다 새 세션 또는 워커를 사용한다. 승인된 범위만 고치며 큰 리팩터링은 그 자체가 승인된 과제일 때만 수행한다.
- 모든 UI 변경은 `docs/DESIGN.md`와 `web/design/prototype_final.html`을 먼저 확인한다. 기존 기준과 달라지는 제품 구현은 재윤이 승인한다. 필터·보기·상태 전환은 버튼·토글 칩을 기본으로 하고 선택지가 10개를 넘으면 D-12를 확인한다.
- UI 문구는 한국어, 식별자·주석은 영어다. Chromium에서 필수 동작을 재현한다. Office·한글 IME 검증이 필요한 작업은 브리프에 조건을 적는다.

## 변경 계약

- Python 3.11+/FastAPI/표준 sqlite3와 빌드 없는 HTML/CSS/vanilla JS를 사용한다. 새 의존성과 아키텍처 변경은 승인된 결정을 확인하고 이유를 기록한다.
- 외부 API·CDN·웹폰트·텔레메트리를 사용하지 않는다. D-10의 사내 연동 관련 값은 Git 제외 `config/local.json`에서만 읽는다. 프론트 자산은 로컬에서 제공한다. 외부 개발과 테스트는 합성 자료만 쓴다.
- 노트·일지·HTML은 읽을 수 있는 `vault/` 파일, 정형 데이터는 `data/mi_planner.db`에 둔다. 페이지는 폴더와 `_page.json`/본문으로 구성한다. 삭제는 `vault/.trash/`로 이동한다. 데이터·마이그레이션 이력을 보존하고 새 마이그레이션만 추가한다.
- RCP는 기본 읽기 전용이다. D-11/D-36의 백업·diff·명시 확인·로그와 설정 조건을 충족한 경로만 사용한다.
- 시간은 Asia/Seoul 기준 ISO 8601, 대기시간은 평가 단계 이력에서 조회 시 산출한다. API는 `/api/…` JSON, 오류는 `{"error":"메시지"}`다. Windows 경로는 `pathlib`를 사용한다.

## 검증과 마감

- `py -3.11 -m pytest -q`를 실행한다. 필수 검사나 수용 조건이 미충족이면 완료 표시를 보류한다.
- VOC 변경은 실제 검증 뒤 `docs/VOC.md`와 `project_flow.html`의 해당 `FLOW` 기록을 동기화한다. 모든 작업은 `docs/WORKLOG.md` 위에 기록하고, 스키마·API 변경은 `docs/SPEC.md`에도 반영한다.
- 커밋은 `[V-xxx] 설명` 또는 승인된 P 작업 ID 형식으로 남긴다. VOC.md에는 ID와 상태만 쓰고 커밋 SHA는 리뷰 기록에만 남긴다. VOC당 커밋은 하나다.
