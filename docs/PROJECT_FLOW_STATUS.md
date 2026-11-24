# 🗂️ MI Planner — 비공개 개발 현황

> 🔒 **이 문서는 비공개 GitHub 저장소 안에서만 볼 수 있습니다.** GitHub Pages에 공개하지 않습니다.

**최종 갱신:** 2026. 11. 24. 13:53 (KST)　·　**원본 FLOW:** 2026-11-24　·　**커밋:** [4851d29](https://github.com/jaeyoonko1/MI_Planner/commit/4851d290ebb9861475a3a1ccbc85a8c65d380f09)

**최신 작업:** [P8-06] Polish private dashboard commit summary (tests/test_private_flow.mjs)

## 전체 진행률

### 71% · 49/69개 작업 완료

🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦🟦⬜⬜⬜⬜⬜⬜

## 다음 작업

- **P2-07** 회사 PC 시험 설치 + 1주일 실사용 · 직접
- **P3-09** 원노트 이관 가능성 시험 (회사 PC) · 사내LLM
- **P6-03** 범용 XML/INI/TXT 파서 + 설비사 매핑 파일 · Sonnet
- **P6-04** 파라미터 비교 표 + 스냅샷 이력 · Codex
- **P6-05** 레시피 수정·업로드 (선택) · Opus

## 단계별 현황

| 단계 | 완료 | 진행률 |
|:--|--:|--:|
| **P0 · 준비 · 설계** | 5/5 | 100% |
| **P1 · 뼈대** | 5/5 | 100% |
| **P2 · 일지 · 할일 (1순위)** | 6/7 | 86% |
| **P2B · MI 업무 워크스페이스** | 10/10 | 100% |
| **P3 · 노트 (2순위)** | 9/10 | 90% |
| **P4 · 평가 현황판 (3순위)** | 8/8 | 100% |
| **P5 · MI 정보** | 4/4 | 100% |
| **P6 · RCP 관리** | 2/5 | 40% |
| **P7 · LLM 연동** | 0/10 | 0% |
| **P8 · 이식 · 운영** | 0/5 | 0% |

## 전체 작업 목록

<details><summary><strong>P0 · 준비 · 설계</strong> — 5/5 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P0-01 | 프로젝트 폴더·기본 문서 생성 | Opus |
| ✅ | P0-02 | 목표 갱신 + 1차 질의응답 → SPEC v0.2 | Opus |
| ✅ | P0-03 | 남은 미결 질문 답하기 (Q-01, Q-07~Q-12) | 직접 |
| ✅ | P0-04 | 설계 확정 리뷰 → SPEC v1.0 | Opus |
| ✅ | P0-05 | git init + 첫 커밋, Python 가상환경 | 직접 |

</details>

<details><summary><strong>P1 · 뼈대</strong> — 5/5 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P1-01 | FastAPI 골격 + requirements + run.bat + /api/health | Sonnet |
| ✅ | P1-02 | SQLite 연결 + 마이그레이션 러너 + 001_init.sql | Sonnet |
| ✅ | P1-03 | vault 모듈 + 페이지 트리 API | Sonnet |
| ✅ | P1-04 | 프론트 셸: 사이드바 트리 + 라우팅 + 칩 버튼 컴포넌트 | Sonnet |
| ✅ | P1-05 | 로컬 자산 검증 + 샘플 vault 시드 | Codex |

</details>

<details><summary><strong>P2 · 일지 · 할일 (1순위)</strong> — 6/7 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P2-01 | 일지 파일 형식 + 파서/저장 | Sonnet |
| ✅ | P2-02 | 월간 일지 그리드 화면 | Sonnet |
| ✅ | P2-03 | 할일 API (CRUD + 필터) | Sonnet |
| ✅ | P2-04 | 할일 화면 (버튼 필터 + 인라인 편집) | Codex |
| ✅ | P2-05 | 일지 자동 표시 옵션 + 줄→할일 승격 | Sonnet |
| ✅ | P2-06 | '오늘' 화면 | Sonnet |
| ⬜ | P2-07 | 회사 PC 시험 설치 + 1주일 실사용 | 직접 |

</details>

<details><summary><strong>P2B · MI 업무 워크스페이스</strong> — 10/10 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P2B-01 | Final UX 설계 확정 | Codex |
| ✅ | P2B-02 | 공통 줄 편집기와 단축키 | Sonnet |
| ✅ | P2B-03 | 사용자 정의 필드 저장·호환 API | Sonnet |
| ✅ | P2B-04 | 워크스페이스 셸·테마·페이지 트리 | Sonnet |
| ✅ | P2B-05 | 오늘·주간·월간·할일 연결 | Sonnet |
| ✅ | P2B-07 | 계층 편집·분류 정의 관리 | Sonnet |
| ✅ | P2B-08 | 컴팩트 구조 작업표·자유 배치·복사 | Sonnet |
| ✅ | P2B-09 | 선택적 이슈 페이지·조건부 배치 | Sonnet |
| ✅ | P2B-10 | 메모·이미지 편집 통합 | Sonnet |
| ✅ | P2B-06 | 통합 검증·접근성·회사 PC 점검 | Sonnet |

</details>

<details><summary><strong>P3 · 노트 (2순위)</strong> — 9/10 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P3-01 | 노트 편집기 방식 결정 (spike) | Opus |
| ✅ | P3-02 | 마크다운 노트 보기·편집 기본 | Sonnet |
| ✅ | P3-02R | 노트 편집기 줄 모델 정합 (P3-01 재검토 후속) | Sonnet |
| ✅ | P3-03 | 단 추가 + 열 너비 조절 + 스크롤/맞춤 모드 | Sonnet |
| ✅ | P3-04 | 서식 툴바 + 단축키 (원노트 수준) | Sonnet |
| ✅ | P3-05 | 제목 더블클릭 접기 | Codex |
| ✅ | P3-06 | 표 블록 (엑셀형 편집) | Sonnet |
| ✅ | P3-07 | HTML 페이지 타입 | Sonnet |
| ✅ | P3-08 | 전체 검색 + [[링크]]·백링크 | Codex |
| ⬜ | P3-09 | 원노트 이관 가능성 시험 (회사 PC) | 사내LLM |

</details>

<details><summary><strong>P4 · 평가 현황판 (3순위)</strong> — 8/8 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P4-01 | 평가 데이터 모델 리뷰 + 5,000칸 렌더 시험 | Opus |
| ✅ | P4-02 | 평가 테이블 마이그레이션 + 템플릿 API + 마스터 템플릿 | Sonnet |
| ✅ | P4-03 | 평가 만들기 마법사 | Sonnet |
| ✅ | P4-04 | 현황판 화면 + 보기 버튼 | Sonnet |
| ✅ | P4-05 | 칸 패널 + 다중 선택 일괄 단계 전환 | Sonnet |
| ✅ | P4-06 | 단계별 대기 시간 + 경고 색 | Codex |
| ✅ | P4-07 | 템플릿 편집 화면 + 엑셀 내보내기 | Codex |
| ✅ | P4-08 | MOS 붙여넣기 어댑터 + '오늘'에 밀린 단계 | Sonnet |

</details>

<details><summary><strong>P5 · MI 정보</strong> — 4/4 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P5-01 | Plan / Step: process plan 엑셀 가져오기 + 표 | Sonnet |
| ✅ | P5-02 | DOI 라이브러리 (이미지 카드 + 표) | Sonnet |
| ✅ | P5-03 | DOI PPT 가져오기 | Sonnet |
| ✅ | P5-04 | DOI 공유 패키지 내보내기·가져오기 | Codex |

</details>

<details><summary><strong>P6 · RCP 관리</strong> — 2/5 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ✅ | P6-01 | RCP 관리 설계 (FTP·필터·파서·안전장치) | Opus |
| ✅ | P6-02 | FTP 수집 + 이름 필터 + 로컬 캐시 | Sonnet |
| ⬜ | P6-03 | 범용 XML/INI/TXT 파서 + 설비사 매핑 파일 | Sonnet |
| ⬜ | P6-04 | 파라미터 비교 표 + 스냅샷 이력 | Codex |
| ⬜ | P6-05 | 레시피 수정·업로드 (선택) | Opus |

</details>

<details><summary><strong>P7 · LLM 연동</strong> — 0/10 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ⬜ | P7-01 | 에이전트용 CLI (app/cli.py) | Sonnet |
| ⬜ | P7-02 | skills/ 구조 + skill-maker 스킬 | Opus |
| ⬜ | P7-03 | 'AI에게 요청' 복사 버튼 | Sonnet |
| ⬜ | P7-04 | status-brief · fill-table 스킬 | Opus |
| ⬜ | P7-05 | pptx-company 스킬 | 사내LLM |
| ⬜ | P7-06 | paper-patent 스킬 | Opus |
| ⬜ | P7-07 | lecture-html 스킬 + 스터디 로드맵 | Opus |
| ⬜ | P7-08 | recipe-parser-maker 스킬 | 사내LLM |
| ⬜ | P7-09 | 사내 LLM API 직접 연동 (채팅 패널) | 사내LLM |
| ⬜ | P7-10 | MOS dcoll 수집 스크립트 | 사내LLM |

</details>

<details><summary><strong>P8 · 이식 · 운영</strong> — 0/5 완료</summary>

| 상태 | 작업 ID | 제목 | 담당 |
|:--:|:--|:--|:--|
| ⬜ | P8-01 | 오프라인 설치 패키지 (wheels + install.bat) | Codex |
| ⬜ | P8-02 | 자동 백업 (data + vault zip) + 설정 화면 | Codex |
| ⬜ | P8-03 | 사내 OpenCode가 AGENTS.md로 작업 가능한지 확인 | 사내LLM |
| ⬜ | P8-04 | 원노트 통째 이관 | 사내LLM |
| ⬜ | P8-05 | KLARF 뷰어 연결 | Sonnet |

</details>

---

### HTML 원본 보기

- [원본 `project_flow.html`](../project_flow.html) · GitHub는 HTML 소스를 보여주며 직접 실행하지 않습니다.
- [최신 실행 결과 및 HTML 다운로드](https://github.com/jaeyoonko1/MI_Planner/actions/workflows/update-private-flow.yml) · `MI-Planner-Flow-HTML` 아티팩트를 다운로드해 `index.html`을 열면 필터·체크 등의 인터랙티브 화면이 표시됩니다.

> **진행률의 원본**은 `project_flow.html`의 `FLOW` 데이터입니다. HTML에서 누른 체크·메모는 브라우저에만 저장되며 GitHub에 동기화되지 않습니다.
