# MI_Planner 작업 참고

## 상황별 확인

- 작업 선택은 `docs/VOC.md`, 진행은 `project_flow.html`의 `FLOW`가 원천이다. UI 작업에서 열리는 브라우저 로컬 메모가 관련되면 파일의 FLOW와 구분해 실제 상태를 확인한다.
- 화면·회귀는 `docs/DESIGN.md`에서 해당 절을 연다. 저장 형식·API·아키텍처는 `docs/SPEC.md`와 참조된 D-ID를 읽는다. D-01은 확정이며 프로젝트 앱은 `run.bat`으로 시작한다.
- 팀 역할과 모델은 총괄의 승인된 브리프를 적용한다. 기존 기록의 Sonnet/Opus 표기는 변경 승인 전까지 남겨 둔다. Claude의 `/clear`는 과제 종료 후 인수인계를 남겼을 때 새 맥락을 여는 방법이다.
- `app/` 서버, `web/` 프론트, `parsers/` 레시피, `migrations/` 스키마, `tests/` 검증을 다룬다. 테스트는 임시 DB와 vault를 사용한다. 테스트 데이터·회사 설정은 Git에 추가하지 않는다.
- Python에는 타입 힌트를 사용하고 함수는 짧게 유지한다. 순수 Python 의존성을 우선한다. 노트 편집기와 표 변경은 D-20 및 최신 관련 VOC 결정으로 검증한다.
- UI 수용 조건은 실제 입력과 기대 결과를 포함한다. 붙여넣기·저장·재시작·복원까지 필요한 경우 실제 Chromium/Office에서 확인한다.

## WORKLOG 형식

```markdown
## YYYY-MM-DD · 담당 · TASK-ID
- 한 일:
- 바뀐 파일:
- 검증 명령과 결과 / 미실행:
- 남은 위험 / 다음 행동:
```

## 앱 CLI

기본 명령은 `python -m app.cli [--db data/mi_planner.db] [--vault vault] <명령>`이다. 출력은 JSON이고 오류는 `{"error": "..."}`와 종료 코드 1을 반환한다.

- 할일은 `task list [--open --overdue --due-within N --status todo --eval-id N --q 글자]`, `task show ID`, `task add "제목" [--priority 1..3 --due YYYY-MM-DD --planned … --requester … --eval-id N --note …]`, `task set ID --status doing --due none`, `task done ID`.
- 평가·MOS는 `eval list`, `eval show ID [--full]`, `eval stalled`, `eval set-stage ID --cells 1,2,3 --stage 단계키 [--at YYYY-MM-DDTHH:mm]`, `eval set-cell CELL --value 항목=값 --note 메모`, `eval history CELL`. 항목은 key나 label로 입력한다. 값은 필드 형식에 맞춰 변환한다.
- 검색은 `search 글자`. 노트·일지는 `vault/`의 일반 파일로 다룬다. `none`으로 값을 비운다. RCP 쓰기 명령은 없다(D-11).
