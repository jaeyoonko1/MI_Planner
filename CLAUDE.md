@AGENTS.md

# Claude Code 전용 메모
- 공통 규칙은 위에서 불러온 AGENTS.md를 따른다. 이 파일에는 Claude 전용 사항만 둔다.
- 기본 모델은 **Sonnet**. `project_flow.html`에서 도구가 `Opus`로 표시된 작업만 `/model opus`로 바꾼다.
- 작업이 끝나면 `/clear`로 맥락을 비우고 다음 작업을 시작한다.
- 구현 전에 계획을 먼저 보여주고 확인받는다 (작업 크기가 S면 생략 가능).
