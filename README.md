# MI_Planner

검사·계측(MI) 업무용 로컬 플래너 — 검사 대기, Review 대기, Lot, 할일, 일정을 한 곳에서 관리.

## 지금 상태
설계 단계(P0). 진행 상황은 `project_flow.html`을 브라우저로 열어서 확인.

## 파일 안내
| 파일 | 용도 |
|---|---|
| `project_flow.html` | 단계별 작업 목록 + 진행 체크 (브라우저로 열기) |
| `AGENTS.md` | 모든 AI 에이전트 공통 규칙 (Codex, 사내 OpenCode가 읽음) |
| `CLAUDE.md` | Claude Code용 — AGENTS.md를 불러옴 |
| `docs/SPEC.md` | 기능·데이터 모델·화면·API 명세 |
| `docs/DECISIONS.md` | 결정 기록 + 미결 질문 |
| `docs/WORKLOG.md` | 세션별 작업 기록 (Claude ↔ Codex 인수인계용) |

## AI에게 일 시키는 법
```
project_flow.html에서 다음 작업 P1-01 진행해줘. AGENTS.md 규칙 따라서.
```

## 실행 (P1 이후)
`run.bat` 더블클릭 → 브라우저에서 `http://127.0.0.1:8765`
