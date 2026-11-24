# skills/ — 에이전트용 스킬

사내 OpenCode · Claude Code · Codex가 **같은 파일**을 읽는다. 스킬 하나 = 폴더 하나.

```
skills/<이름>/
├─ SKILL.md        # 필수. 맨 위 frontmatter(name, description) + 본문
├─ examples/       # 선택. 가짜 데이터 예시
└─ scripts/        # 선택. 표준 라이브러리만 쓰는 파이썬 (Windows 우선)
```

## SKILL.md 형식
```
---
name: status-brief            # 폴더 이름과 같게. 소문자·숫자·하이픈, 40자 이하
description: 한두 문장. 무엇을 하고, 언제 쓰는지(사용자가 할 법한 말 포함)
---
# 제목
## 언제 쓰나 / ## 입력 / ## 절차 (번호 단계) / ## 출력 / ## 하지 말 것
```

## 공통 규칙 (AGENTS.md 3장과 같다)
- 외부 네트워크·CDN·외부 API 금지. 산출물 HTML은 단일 파일, 라이브러리는 `web/vendor/`.
- 정형 데이터는 `python -m app.cli ...`(AGENTS.md 9장)로만 읽고 쓴다. DB 파일을 직접 고치지 않는다.
- 노트·일지는 `vault/`의 일반 파일. 삭제는 `vault/.trash/`로 옮긴다.
- RCP 쓰기 금지(D-11). 실제 Lot·설비·레시피 이름을 스킬 예시에 넣지 않는다(`LOT-TEST-001`, `EQ-A01`).
- 스킬 본문은 짧게. 절차는 번호, 판단 기준은 구체적으로.

## 검사
`python scripts/check_skills.py` — 모든 SKILL.md의 형식을 검사한다(종료 코드 0 = 통과).
새 스킬을 만든 뒤 반드시 실행한다.

## 스킬 목록
| 스킬 | 상태 |
|---|---|
| `skill-maker` | 완료 (P7-02) — 대화하면서 새 스킬 만들기 |
| `status-brief` | 완료 (P7-04) — 설비·평가의 남은 일 브리핑(읽기 전용, `scripts/brief.py`) |
| `fill-table` | 완료 (P7-04) — raw data로 노트 표·현황판 값 채우기(미리보기 → `--apply`, `scripts/fill_table.py`) |
| `pptx-company` | P7-05 |
| `paper-patent` | 완료 (P7-06) — 참고 자료 → 논문·특허·기술자산화 초안 페이지(`scripts/paper_patent.py` refs·outline·check) |
| `lecture-html` | 완료 (P7-07) — 오프라인 interactive 강의·스터디 로드맵 html 페이지(`scripts/lecture_html.py` new·check·sync·modules, 템플릿 `templates/`, 예시 `examples/optics_resolution.html`) |
| `recipe-parser-maker` | P7-08 |
