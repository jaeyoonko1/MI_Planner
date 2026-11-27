# MI_Planner

**검사·계측(MI) 업무를 위한 Windows 로컬 워크스페이스.** 설비별 검사·리뷰 대기와 Lot별 평가 진행을 추적하고, 관련 할일과 기록을 한곳에서 관리합니다.

[빠른 시작](#빠른-시작) · [주요 기능](#주요-기능) · [프로젝트 문서](#프로젝트-문서)

## 주요 기능

| 화면 | 할 수 있는 일 |
| --- | --- |
| **평가 현황판** | 설비 × Lot·웨이퍼별 검사·리뷰 단계를 관리합니다. 단계 이력에서 대기 시간을 계산하고, 여러 칸의 단계를 한 번에 바꾸거나 현황을 Excel로 내보냅니다. |
| **오늘 · 주간/월간 일지** | 오늘 할일과 오래 대기 중인 평가를 확인합니다. 일지에서 할일을 기록하고 계획일에 맞춰 일정을 정리합니다. |
| **구조** | 이슈를 상위·하위 계층으로 묶고 사용자 정의 필드로 관리합니다. 이슈를 페이지로 확장해 관련 기록을 남길 수 있습니다. |
| **페이지 트리 · 노트** | 서식 있는 노트, 첨부파일, HTML 페이지를 폴더 기반 트리에 정리합니다. |
| **Plan · Step / DOI 라이브러리** | Excel에서 Plan·Step 정보를 가져오고, 결함 이미지와 태그를 모아 검색합니다. PowerPoint에서 DOI 초안을 만들 수 있습니다. |
| **RCP 관리** | 읽기 전용을 기본으로 레시피 파라미터를 수집·비교하고 스냅샷 이력을 확인합니다. |

## 빠른 시작

Windows에서 **Python 3.11 이상**과 **Chromium 계열 브라우저**(Edge, Chrome, 웨일)를 사용합니다. 최초 설치는 이 비공개 저장소와 Python 패키지 저장소에 접근할 수 있는 환경에서 아래 명령을 PowerShell로 실행합니다.

```powershell
git clone https://github.com/jaeyoonko1/MI_Planner.git
cd MI_Planner
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\run.bat
```

위 명령은 Python 3.11을 선택합니다. 더 높은 버전만 설치했다면 `-3.11`을 설치된 버전에 맞춰 바꾸세요. 다음부터는 [`run.bat`](run.bat)을 더블클릭하면 됩니다. 브라우저가 열리지 않으면 주소창에 `http://127.0.0.1:8765`를 입력하세요.

다른 프로그램이 기본 포트 `8765`를 사용 중이라면, 아래 명령으로 실행하고 `http://127.0.0.1:8875`를 여세요.

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8875
```

### 합성 샘플로 둘러보기

새로 복제한 작업 폴더에서 아래 명령을 실행한 뒤 앱을 열면 페이지 트리에 예제 일지와 노트가 나타납니다. 같은 명령을 다시 실행하면 기존 페이지를 유지하고 누락된 샘플 페이지만 추가합니다.

```powershell
.\.venv\Scripts\python.exe scripts/seed_sample.py
```

다른 폴더에 샘플 파일만 만들려면 위 명령에 `--vault "C:\Temp\MI_Planner_sample"`을 추가하세요. 앱은 기본으로 저장소의 `vault/`를 사용합니다. 설비 × 웨이퍼 현황판을 체험하려면 **평가 현황판 → 평가 만들기**에서 테스트 설비와 Lot을 추가하세요.

## 로컬 데이터

앱은 `127.0.0.1`에서 실행되며, Python/FastAPI와 Python 내장 `sqlite3`, 빌드 없이 제공하는 HTML·CSS·JavaScript를 사용합니다. 패키지 설치가 끝나면 핵심 기능은 인터넷 연결 없이 사용할 수 있습니다.

| 위치 | 내용 |
| --- | --- |
| `vault/` | 폴더별 페이지 메타데이터, Markdown 노트·일지, HTML 및 첨부파일 |
| `data/mi_planner.db` | 할일·평가·레시피 등 정형 데이터 |
| `data/doi/` | DOI 이미지 파일 |
| `config/local.json` | 로컬 연동 설정 |

위 경로는 Git 추적에서 제외됩니다. 개발과 테스트에는 합성 자료를 사용하세요.

## 프로젝트 문서

| 문서 | 내용 |
| --- | --- |
| [진행 현황](docs/PROJECT_FLOW_STATUS.md) · [로드맵 원본](project_flow.html) | GitHub에서는 진행 현황을 읽고, 검색·필터가 있는 로드맵은 내려받아 브라우저에서 엽니다. |
| [기능 명세](docs/SPEC.md) · [설계 결정](docs/DECISIONS.md) · [UI 설계](docs/DESIGN.md) | 화면, 데이터 모델, API와 설계 근거 |
| [사내 PC 체크리스트](docs/COMPANY_PC_CHECKLIST.md) | 사내 환경에서 확인할 항목 |
| [사용자 피드백](docs/VOC.md) · [작업 기록](docs/WORKLOG.md) | 개선 요청과 작업 이력 |
| [에이전트 규칙](AGENTS.md) · [Claude Code 안내](CLAUDE.md) · [작업 참고](docs/AGENT_TASKS.md) | 에이전트 작업 규약과 앱 CLI 사용법 |

에이전트에 작업을 맡길 때는 `AGENTS.md`와 `docs/VOC.md`를 확인하도록 하고, 진행할 VOC ID를 지정하세요.
