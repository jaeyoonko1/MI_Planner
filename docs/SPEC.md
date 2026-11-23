# MI_Planner 명세 (SPEC)

> 상태: **v1.0 (2026-11-24)** — 1·2차 질의응답 + P0-04 설계 리뷰 반영. 이후 변경은 DECISIONS.md에 먼저 기록하고 여기를 고친다.
> `[가정]` 표시는 확인되지 않은 추정이다. 틀리면 고치고 DECISIONS.md에 기록한다.
> v0.1 → v0.2 핵심 변경: "대기 관리 툴" → **계층 페이지 기반 업무 워크스페이스**. 대기 관리는 평가 현황판의 단계 이력으로 흡수.

---

## 1. 목표

### 해결하려는 문제
- 검사 대기·Review 대기 현황이 사내 시스템, 메모, 머릿속에 흩어져 있어 **"지금 뭐가 제일 오래 기다리고 있나"**를 바로 알기 어렵다.
- 원노트는 표가 약하고, 옵시디언은 회사 PC에서 고치기 어려웠고, Jira는 개인 할일·Lot 단위 관리에 무겁다.
- 기존의 원노트의 계층 구조식 노트 (컨플루언스와 유사) 가 굉장히 마음에 들었었다. 옵시디언을 도입해보려 했으나, 폴더 내 노트가 위치하는 방식이다 보니 폴더에 노트를 추가 못하는게 굉장히 아쉬웠다
- 원노트의 가장 큰 이점은 더블클릭으로 접기 가능, 표 마음대로 놓기 가능, 텍스트를 원하는 위치에 바로바로 쓸수 있어서 옵시디언과 같이 수직으로 쭉 내려오는게 아닌 수평으로 배치도 가능했다. 하지만 아무렇게나 배치가 되다보니 정리가 어려운 문제점이 있었다.
- 예를들어 월단위 일지를 한 노트에, 주마다 1열씩 해서 행이 요일이 되도록 해서 한눈에 한달동안한일이 정리됐다.
- 이를 api 로 사내 llm 모델과 엮어서 하고 싶었지만 one note 호환성이 구려 어려웠다. 
- 원노트는 너무 커지면 따로 백업을 해두고 또 다른 파일에서 처음부터 가능하다. 
- 기존 원노트 구조는 일지 / MI 공정업무 / 연구 개발 / 업무 메뉴얼 / 스터디 이런식으로 되어있다. 
1) 일지 월별 노트/ 주간 열 / 일 행으로 해야할일들 아침에 쭉 쓰고 
   - 여기서 문제는 지라처럼 에픽/스토리로 관리하거나 우선순위를 쓰거나 요청자난 납기등이 없어서 한눈에 안들어와서 놓치는 경우도 많았다.
   - 이번에 한 설비사 3사별 평가 같은 경우엔 랏별로 검사/리뷰/반복도 데이터 확인/scan time 계산/ 디펙 분류 / 디펙 모수 정리 / 이슈 확인 등 챙길게 엄청 많은데 이게 한달에 거쳐 하는 일이다 보니 일지에서만 관리가 사실상 불가능함. 링크를 mi 공정업무로 엮어서 지라처럼 관리했어야함
   - 지라처럼 관리 못한 이유는 설비 5개 X 랏 10개 X 웨이퍼 3개 X 챙겨야할것 X 3개로 대시보드처럼 안보인다. 대시보드 만들려면 만들겠지만, 그걸 매 평가마다 매번 만드는게 비효율적이다. 
   - MOS (lot 전산 상태) 가 모니터링이 안되니 어떤 상황인지 모름. python 으로 dcoll 가능하나 나중에 확장성 고려하고 싶음. 지금은 방법을 모름 
2) MI 공정업무
   - RCP 개발
   - RCP 관리: 설비별 라인별 파라미터 관리 하고 싶음. 지금은 설비마다 파라미터 보는 방식이나 텍스트로 표현 안되는게 많음. 목표는 ftp 로 레시피 경로 걸어두면 원하는 filter 걸린 레시피만 관리하고 싶음. 예를들어 내가 관리하는 플랜이 aabb_bb100000 이면 aabb 포함한 레시피에서 필요한 파라미터 파일 읽어와서 관리할수 있게. 가능하면 수정도 되게 하고 싶지만 이건 아무래도 좋은 방향은 아니지만 가능하게는 하고 싶어. 설비마다 파라미터 관리가 다를테니 skill 만드는 것도 좀 편리하게 툴 llm 연동되도록 해서 대화 방식으로 skill 만들게
   - 설비사 평가: 목적/랏/검증 방식 / 평가 항목 등등 정리되게. 이것도 설비사간 평가 하는 경우가 많아서 일반적인 대시보드가 만들어졌으면 좋겠어
   - 각종 정보: 제품별 plan 정보 / step 정보 (process plan 정보 링크와 연동되면 좋겠어)
   - DOI List; 위 정보와 매칭됐으면 좋겠어
3) 연구 개발 
   - 이론/시뮬/실험
4) 성과: 사내 논문/특허/ 기술자산화 문서 작성
   - LLM 기반으로 위 링크 넣으면 알아서 써주는 식으로 구현 됐으면 좋겠어. 레퍼런스 몇개 넣고
   - ex1) 초음파 기반 HBM Stack void 위치 구분: 이론 / 시뮬 / 실험 / 데이터 / 시각화 / 글 / 논리 / 작성 및 ppt 만들기 (ppt skill 도 있으면 좋겠지)
5) 스터디: 이론 (물리/광학/고체물리/light matter interaction,선형대수, AI, Image processing) 등
   - 대학원 전공과정 수준의 강의를 interactive-html 로 했으면 좋겠어
   - Study Loadmap interactive html 로 


### 1차 질의응답 요약 (2026-11-24)
| 주제 | 답 | 반영 |
|---|---|---|
| 우선순위 | 일지·할일 → 노트 → 평가 현황판 | 8장 단계 순서 |
| 평가 매트릭스 | Lot마다 매수는 다르지만 설비×Lot×웨이퍼 조합은 거의 다 존재. 칸에 **값도** 입력 | 4.3 |
| 평가 상태 | 단계는 **편집 가능**. 지난 평가 예: 검사대기 → 검사완료 → 리뷰대기 → 리뷰완료&분류대기 → 분류완료 → 정리완료 | 4.3, D-09 |
| 챙길 항목 | 평가마다 다름. 지난 평가 항목을 **마스터 템플릿**으로 | 4.3 |
| 보기 | 설비별·Lot별·남은 것 전부 필요. **드롭다운 말고 버튼** | D-12 |
| 일지 자동 표시 | 자동으로 하되 **옵션**으로 끄고 켤 수 있게 | 4.2, D-13 |
| 할일 구조 | 미정 → 잠정안으로 시작 | Q-04 |
| 노트 배치 | 컨플루언스식 **단 추가** + 열 너비 조절 + **스크롤 / 맞춤(fit) 모드** 선택 | 4.1 |
| 계층 | 페이지 아래 하위 페이지 (컨플루언스식). **interactive HTML 페이지도** 트리에 | 4.1, D-08 |
| 저장 | 노트는 일반 파일(.md/.html), 정형 데이터는 SQLite | D-03 |
| MOS | 지금은 화면 조회 → 붙여넣기 어댑터부터, dcoll은 회사 PC에서 나중에 | 4.4 |
| 사내 LLM 용도 | "지금 이 설비 뭐 해야 돼?", "이걸로 저 PPT 형식으로 만들어줘", "이 표 채워줘, raw data는 여기" | 4.7, D-10 |
| 회사 PC Python | 있음 (pip 가능 여부·브라우저는 Q-01) | D-01 |

### 2차 질의응답 요약 (2026-11-24)
| 주제 | 답 | 반영 |
|---|---|---|
| pip | 사내 프록시 경유로 대부분 가능 | D-01, 9장 |
| 브라우저 | Edge 메인, Chrome도. 개인은 네이버 웨일 | D-16 (Chromium 계열 대상) |
| 레시피 | xml / .ini / .txt 등 다양, 설비 FTP 직접 접속 허용 | 4.6 |
| DOI | Defect of Interest. 이미지와 같이 봐야 해서 PPT(또는 엑셀)로 관리, 사내 드라이브에 흩어져 다른 제품·부서 DOI 공유가 안 됨 | 4.5, D-18 |
| 사내 LLM | Python에서 API 호출 확인. 프록시가 인증을 처리(임의 Bearer 값 가능), OpenCode는 PowerShell 스크립트로 프록시 경유 | 4.7, D-10 |
| 원노트 이관 | 통째로 옮기고 싶음 (안 되면 포기) | P3-09, P8-04 |
| 반출 | **모든 자료 사외 반출 불가** 가정. process plan은 엑셀 표로 확인 가능 | D-17, 4.5 |
| 서식 | 원노트 수준의 글자 크기·굵게·기울임·밑줄·취소선·형광펜·글자색 필요 | 4.1, D-15 |

### 성공 기준
1. 아침에 앱을 열면 **10초 안에** 이번 달 일지(오늘 칸), 오늘·납기 임박 할일, 진행 중 평가의 밀린 단계가 보인다.
2. 새 설비 평가를 시작할 때 **설비·Lot·웨이퍼 목록 붙여넣기 + 템플릿 선택만으로** 현황판이 생긴다 (대시보드를 새로 만들지 않는다).
3. 노트는 원노트처럼 **계층 + 수평 배치(단)** 가 되지만, 단 구조 덕에 정리가 무너지지 않는다.
4. 사내 LLM 에이전트가 **앱 없이도** 노트·일지·평가 데이터를 읽고 채울 수 있다.
5. 인터넷이 끊긴 회사 PC에서 `run.bat` 하나로 돌아간다.

### 하지 않는 것 (v1 범위 밖)
- 다중 사용자, 로그인, 권한 관리 (1인용)
- 원노트식 **완전 자유 배치**(아무 좌표에 글상자) — 정리 문제의 원인이라 "단" 구조로 대체
- 모바일 화면
- 실시간 공동 편집
- 레시피 **수정·업로드**는 v1에서 제외 (P6 마지막에 안전장치와 함께, D-11)

## 2. 사용 규모 `[가정]`
| 항목 | 규모 |
|---|---|
| 사용자 | 1명 |
| 페이지(노트·HTML) | 연 수백~수천 개 |
| 진행 중 평가 | 동시 1~5개, 평가당 설비 ≤ 10 × Lot ≤ 20 × 웨이퍼 ≤ 25 → 칸 최대 ~5,000 |
| 할일 | 동시 30~100개 |
| 레시피 | 필터 통과 기준 수백 개 |

→ SQLite + 화면 단위 전체 로드로 충분. 평가 현황판만 칸 수가 많으므로 렌더링 성능을 P4-01에서 확인.

## 3. 핵심 개념

```
워크스페이스(vault/) ─ 페이지 트리
  └─ 페이지 = 폴더 1개 (하위 페이지 = 하위 폴더)
       종류: note(.md) | html(interactive) | journal(월간 일지) | board(평가 현황판) | table(정보 표)

SQLite (data/mi_planner.db) ─ 정형 데이터
  Task ── 페이지·평가에 연결 가능
  Evaluation ──< Equipment, Lot ──< Wafer
       └──< Cell (설비×웨이퍼) ──< StageLog (단계 전환 이력 → 대기 시간)
  EvalTemplate (단계 목록 + 값 항목) ── 평가 생성 시 복사
  LotStatus (MOS 붙여넣기 / 나중에 dcoll)
  Plan, Step, DOI (MI 정보)   Recipe, RecipeParam, RecipeSnapshot (RCP 관리)
```

- **페이지(Page)**: 트리의 한 노드. 폴더이면서 동시에 노트다 → 옵시디언의 "폴더에 노트를 못 단다" 문제를 없앤다.
- **원노트 구조 매핑** (초기 트리, D-24 확정): `일지/`, `MI 공정업무/`(RCP 개발, RCP 관리, 설비사 평가, 각종 정보, DOI List), `연구 개발/`, `성과/`, `업무 매뉴얼/`, `스터디/`. 이 트리가 앱의 **주 내비게이션**이다 — 오늘·할일·월간 일지는 트리 위에 얹힌 보기이지 트리를 대신하지 않는다.
- **사용자 정의 항목(Field)**: 할일에 붙는 속성(요청자·제품·우선순위 등)의 정의. 고정 컬럼이 아니라 사용자가 언제든 추가·이름 변경·삭제한다 (4.2.2, D-22).
- **평가(Evaluation)**: 설비사 평가 1건. 페이지(board 타입)와 1:1. 페이지 본문엔 목적·검증 방식 같은 서술, 현황판은 DB.
- **단계(Stage)**: 평가 칸이 거쳐 가는 상태. 평가마다 편집 가능. 단계에 머문 시간 = 대기 시간.

## 4. 기능 상세

### 4.1 페이지 트리 · 노트 (P1, P3)

**저장 형식 (D-08)**
```
vault/
├─ 일지/
│  ├─ _page.json            {"type":"note","title":"일지","order":0}
│  ├─ index.md
│  └─ 2026-11/
│     ├─ _page.json         {"type":"journal","title":"2026년 11월"}
│     └─ index.md
├─ MI 공정업무/설비사 평가/2026 3사 평가/
│  ├─ _page.json            {"type":"board","eval_id":3}
│  └─ index.md              ← 목적·Lot·검증 방식·평가 항목 서술
└─ 스터디/광학/
   ├─ _page.json            {"type":"html"}
   └─ index.html            ← interactive 강의
```
- `_page.json`: type, title, order, icon(선택), created/updated. 폴더 이름은 사람이 읽을 수 있게(제목 기반), 이동·이름 변경은 앱이 폴더째 옮긴다.
- 첨부파일(이미지·엑셀)은 같은 폴더의 `files/`에.

**노트 편집 (note 타입)**
- 마크다운 기반. 단 블록은 사람도 LLM도 읽을 수 있는 문법으로 저장 `[단 문법은 P3-03에서 확정]`. 기본 블록(P3-01·02 확정): 문단, `#`~`###` 제목, `-`/`1.` 목록, `- [ ]`/`- [x]` 체크리스트, `![](files/이름.png)` 이미지, 인라인 `**굵게** *기울임* ~~취소~~ `코드``. 편집기 결정은 D-20. API 추가: `POST /api/pages/files?path=&name=`(본문=이미지 바이트, 페이지 `files/`에 저장하고 `{file}` 반환, png/jpg/gif/webp/bmp·20MB), `GET /api/pages/file?path=&name=`.
  ```
  ::: columns 30,70
  왼쪽 내용
  ::: col
  오른쪽 내용 (표 포함 가능)
  :::
  ```
- **단 추가**(2~4단), 경계 드래그로 **열 너비 조절**(비율 저장).
- 페이지별 표시 모드 버튼: **스크롤**(단이 고정 너비, 가로 스크롤) / **맞춤**(화면 너비에 맞춰 축소).
- 제목 **더블클릭으로 접기**(접힘 상태는 보기 설정으로 저장, 파일 내용은 안 바꿈).
- **서식 (D-15)**: 글자 크기, **굵게**, *기울임*, 밑줄, ~~취소선~~, 형광펜(배경색), 글자색. 위지윅 편집(보이는 그대로 편집) + 툴바 + 원노트와 같은 단축키(Ctrl+B/I/U, Ctrl+Alt+H 형광펜 등).
  - 저장 형식: 마크다운 + **허용된 인라인 HTML만** — `<u>`, `<mark style="background:…">`, `<span style="color:…; font-size:…">`. 그 외 태그·스타일은 저장 시 제거.
  - 크기·색은 프리셋(크기 6단계, 색 10개 정도)으로 제한 → 파일이 지저분해지지 않고 LLM도 읽기 쉽다.
  - P3-01 spike에서 "편집 → 저장 → 다시 열기" 왕복 시 서식이 유지되는지 먼저 검증. 실패하면 대안: note 본문을 정제된 HTML로 저장.
- **표 블록**: 엑셀형 편집(정렬, 셀 편집, 엑셀에서 복사·붙여넣기). 저장은 마크다운 표.
- 페이지 링크 `[[페이지 제목]]` + 백링크, 전체 텍스트 검색.

**HTML 페이지 (html 타입)**
- `index.html`을 앱 안 iframe(sandbox)으로 표시. 강의·로드맵·계산기 등.
- 오프라인 규칙: 외부 CDN을 쓰는 HTML은 경고 표시 (LLM 스킬에도 같은 규칙).
- 상태 저장이 필요한 HTML(체크리스트 등)은 앱이 제공하는 작은 저장 API를 쓴다 (P3-07 확정).
  - `GET/PUT /api/pages/state?path=` — 페이지 폴더의 `_state.json`(JSON 객체, 최대 1MB). html 타입만 허용.
  - `GET /api/pages/external-refs?path=` — index.html의 외부 URL(src/href/url()/@import/fetch 등) 목록 → 프론트가 경고 배지 표시.
  - 표시: `<iframe sandbox="allow-scripts">`(same-origin 없음) + srcdoc에 CSP(`connect-src 'none'` 등)를 주입해 외부 요청을 차단. iframe 안에서는 `parent.postMessage({miPlanner:"state-get"|"state-set", id, state}, "*")`로 요청하고 `{miPlanner:"reply", id, state|error}` 응답을 받는다.

### 4.2 월간 일지 · 할일 (P2)

**월간 일지 (journal 타입)**
- 화면: **열 = 주(週), 행 = 요일**(월~금, 주말 접기). 오늘 칸 강조.
- 칸 = 그날의 자유 텍스트(노트와 같은 서식 편집기, 체크박스 줄 가능).
- 파일 형식: 날짜 제목 아래 내용 — LLM이 그대로 읽고 쓸 수 있다.
  ```
  ## 2026-11-24
  - [ ] 3사 평가 Lot2 리뷰 요청
  - 설비 A 레시피 문의 회신
  ```
- **자동 표시 (옵션, D-13)**: 켜면 칸에 그날 납기인 할일, 진행 중 평가의 밀린 단계 요약을 읽기 전용으로 함께 보여준다. 파일에는 쓰지 않는다.
- 체크박스 줄 → **할일로 승격** 버튼 (원래 줄에 할일 링크 남김).
- 월이 바뀌면 새 월 페이지 자동 생성. 연 단위로 `일지/2026/`처럼 묶어 보관(원노트식 "파일 분리" 대체).
- **확정(P2-01)**: 월 페이지 경로는 `일지/<yyyy>/<yyyy-mm>` (폴더명 고정, 표시 제목은 "2026년 11월"). 날짜가 아닌 `##` 제목과 코드펜스 안의 내용은 본문으로 취급. 내용이 빈 날은 섹션을 지운다. 섹션은 저장 시 날짜순으로 정렬.
- API 응답: `GET /api/journal/{yyyy-mm}` → `{month, path, days: {"YYYY-MM-DD": 본문}}` (없는 월 페이지는 이때 자동 생성). `PUT /api/journal/{yyyy-mm}/{dd}` body `{content}` → 같은 형태.

### 4.2.1 줄 편집 — 원노트식 빠른 입력 (D-21, 신규)

- **Tab / Shift+Tab의 경계 (버그 보고 2026-11-24 반영)**: 여러 줄 본문(오늘 기록·날짜 일지·할일 메모·할일 페이지·노트)을 편집 중이면 Tab은 현재 줄 또는 선택한 모든 줄을 한 단계 들여쓰고 Shift+Tab은 한 단계 내어쓴다. **편집기 안에서는 웹 단축키 설정과 관계없이 항상** 이렇게 동작하고 포커스가 다음 요소로 넘어가면 안 된다(사용자 보고: "탭을 누르면 아예 넘어간다"). 편집기를 키보드로 빠져나갈 때는 `Esc` 후 `Tab`. 본문 밖에서는 기본 포커스 이동. 한 단계는 공백 두 칸, 들여쓰기는 바로 윗줄보다 한 단계 넘게 깊어지지 않는다.
- 제목이나 들여쓴 부모 줄의 접기 상태는 본문과 분리한다. 더블클릭으로 자식 범위를 접었다가 다시 펼쳐도 내용은 보존한다.
- 붙여넣은 이미지는 원본 비율을 유지해 본문 너비 안에 표시한다. 호버 또는 키보드 포커스로 자동 너비, 소형, 명시적 픽셀 너비를 선택한다.
> 사용자의 실제 습관: 아침에 오늘 할 일을 일지 칸에 **불렛으로 쭉 쓰고, 탭으로 구조화하고, Ctrl+1로 표시를 바꿔가며** 관리한다. 이 흐름이 앱의 1순위 입력 경로이고, 할일 화면·승격은 그 위에 얹힌다. **마우스 없이 키보드만으로 끝나야 한다.**

| 동작 | 키 | 비고 |
|---|---|---|
| 불렛 줄 켜기/끄기 | `Ctrl+.` | 줄 앞에 `- ` |
| 한 단계 들여쓰기 / 내어쓰기 | `Tab` / `Shift+Tab` | 2칸 단위. 여러 줄 선택 시 일괄. 하위 불렛 = 구조화 |
| **줄 표시 순환** | `Ctrl+1` | `없음 → ☐ → ☑ → ★ → ! → 없음` 순으로 한 번에 한 칸 (**순서 `[가정]`**). 불렛 없는 줄이면 불렛을 먼저 붙인다 |
| 줄 이동 | `Alt+↑/↓` | 하위 줄 포함 `[가정]` |
| Enter | | 현재 줄의 불렛·들여쓰기 유지, 빈 불렛에서 Enter = 내어쓰기/불렛 해제. 표시(☐ 등)는 이어받지 않고 빈 불렛 |

- **저장 형식**(사람·LLM이 그대로 읽음, 기존 `- [ ]` 호환):
  ```
  - [ ] 3사 평가 Lot2 리뷰 요청        ☐ 할일
    - [x] 데이터 수집                   ☑ 완료
    - [*] 반복성 그래프 정리            ★ 중요
  - [!] 장비 알람 원인 확인             ! 긴급
  - 설비 A 레시피 문의 회신             표시 없는 불렛
  ```
  `[*]`·`[!]`는 마크다운 확장 관례(옵시디언 커스텀 상태)를 따른 것. 목록 들여쓰기는 스페이스 2칸.
- **의미**: ☐=해야 함 / ☑=완료 / ★=중요(오늘 반드시) / !=긴급·막힘. ★·!는 "완료 전" 상태라 오늘 화면·자동 표시에 별도 강조로 모은다.
- **승격 확장**: 지금은 `- [ ]`만 승격 가능 → `[ ]`·`[*]`·`[!]` 모두 가능하게. `!`로 승격하면 우선순위 높음을 미리 채운다 `[가정]`. 하위 불렛은 하위 할일(`parent_task_id`)로 승격 `[가정]`.
- **글자 입력으로도 항목 지정**(마우스 대신 텍스트): 승격 시 줄 안의 `키:값` 토큰을 사용자 정의 항목에 매핑한다. 예) `보고서 작성 요청자:김대리 납기:11-27 제품:A` → 항목 3개 채움. 단축 `@이름`(사람 타입 항목), `~11-27`(납기) `[가정]`. 정의되지 않은 키는 새 항목으로 만들지 묻는다(4.2.2).
- **구현 위험**: `Ctrl+1`은 Edge·Chrome·웨일에서 "N번째 탭으로 이동" 단축키와 겹쳐 페이지가 가로채지 못할 수 있다 → 구현 전 3개 브라우저에서 실측(P2B-01 프로토타입), 안 되면 `Ctrl+Alt+1` 또는 `Alt+1`로 대체하고 DECISIONS에 기록.
- 현재 칸 편집기는 일반 `textarea`다 → 줄 단위 텍스트 변환으로 구현 가능(서식 편집기 P3와 독립). 노트 페이지의 편집기(D-20)에도 같은 키를 나중에 이식.

### 4.2.2 사용자 정의 항목 (D-22, 신규)
> 요청자·우선순위·제품처럼 **그때그때 보고 싶은 항목이 바뀐다.** 현재 `tasks`의 `priority`·`requester` 고정 컬럼 구조로는 불가능 → 항목 정의를 데이터로 만든다.

- **항목(Field)** = `{key, label, type, options?, order}`. type: `choice`(선택지 버튼) / `multi`(복수 선택) / `text` / `person`(이전 입력값 자동 제안) / `date` / `number` / `check`.
- **기본 제공**(삭제·이름 변경 가능): 우선순위(choice 높음·보통·낮음), 요청자(person), 납기(date), 하기로 한 날(date). **제품**은 사용자가 만드는 예시로 제공하지 않고 "항목 추가"로 만든다.
- **선택지는 입력하다가 추가**: 칩 옆 `＋`로 새 선택지를 즉시 추가(D-12 — 드롭다운이 아니라 버튼). 선택지 순서·색·보관(숨김) 편집.
- **항목 관리 화면**(설정 안): 추가·이름·타입·선택지·순서·보관. 값이 있는 항목을 지우면 보관 처리(데이터 보존), 완전 삭제는 확인 후.
- **보기 연동**: 할일 화면의 필터 칩 줄과 행의 메타 칸은 **정의된 항목에서 자동 생성**된다(항목을 추가하면 필터가 생긴다). 항목별 표시/숨김, 필터 줄 표시 여부 설정.
- **저장**: 핵심 컬럼(title, status, parent, eval_id, page_path, note)은 그대로 두고, 사용자 정의 값은 `tasks.props` JSON(`{"requester":"김대리","product":"A"}`) + 정의는 `task_fields` 테이블 (5장). 기존 `priority`·`requester`·`due_date`·`planned_date` 데이터는 마이그레이션으로 props로 옮기되 API 필터 이름(`priority`, `requester`)은 호환 유지 `[가정 — P2B에서 확정]`.
- 평가 현황판의 값 항목(`eval_cells.fields`, 4.3)과 같은 사상이므로 타입 정의를 공통으로 쓴다.

### 4.2.3 하나의 데이터 · 구조 · 할일 페이지 위치 (2026-11-24 요청, 기준 화면 `web/design/prototype_v4.html`)
> 사용자 요청: "월간 일지는 텍스트 단위고 할일이랑 오늘은 별도로 되어 있다 — 다 연동이 돼야 의미가 있다." 그리고 유형·제품 같은 항목을 **지라 Structure처럼** 보고 끌어서 바꾸며, 항목을 나중에 추가·삭제할 수 있어야 한다.

**A. 일지 줄 = 할일 (단일 원본)**
- 일지 칸에서 표시가 붙은 줄(`[ ]`·`[x]`·`[*]`·`[!]`)은 곧 할일이다. 줄을 벗어나거나 칸에서 포커스가 빠지면 할일이 만들어지고, 줄 끝에 `^t<id>`가 붙는다(사람·LLM이 읽을 수 있는 블록 id). 표시 없는 줄은 그냥 메모.
  ```
  - [ ] LOT-TEST-002 리뷰 결과 정리 ^t14
    - B사 누락분 먼저              ← 메모 줄 (할일 아님)
  - [*] LOT-TEST-003 반복도 확인 ^t18
  ```
- 줄의 날짜 = 할일의 `하기로 한 날`. 할일 목록·오늘 화면·할일 페이지에서 체크·제목·하기로 한 날을 바꾸면 해당 일지 줄도 바뀐다(날짜가 바뀌면 줄이 그 날 칸으로 이동). 반대로 일지에서 체크하면 할일이 완료된다.
- 일지에서 `^t` 줄을 지우면 할일은 남기고 `하기로 한 날`만 비운다(토스트로 알림). 할일을 휴지통으로 보내면 일지 줄도 빠진다.
- 표시 줄 아래 들여쓴 표시 줄 = 하위 할일(`parent`). 줄 안 `@사람`·`~11-27`·`!`·`항목:값` 토큰은 생성 시 항목으로 옮기고 줄에서는 지운다. 없는 선택지는 만들고 알린다.
- '오늘' 화면의 일지 칸은 월간 일지의 오늘 칸과 **같은 편집기·같은 데이터**다. 일지 화면 옆 "날짜 없는 할일"을 칸에 끌어 놓으면 그날로 잡힌다.

**B. 줄 편집기 (일지·오늘·노트·할일 페이지 공통)** — 4.2.1의 키 + 다음 동작
- **더블클릭 접기**: 하위 줄이 있는 줄(또는 제목)을 더블클릭하면 하위를 접고 `⋯ n줄`을 표시한다. 하위가 없는 줄의 더블클릭은 일반 단어 선택. 접힘 상태는 보기 설정이며 파일에 쓰지 않는다(4.1과 같음). 줄 왼쪽 여백의 ▸/▾를 눌러도 된다.
- **이미지 붙여넣기**: 기본은 자동 크기(본문 너비 안, 최대 높이 제한, 비율 유지). 마우스를 올리면 `자동 · 작게(240) · 보통(480) · 크게(720) · 원본 · [__]px` 막대가 뜨고, 오른쪽 아래 손잡이를 끌어 10px 단위로 조절한다. 저장: `![](files/img-….png){w=480}` (`w=auto` / `w=orig` / 숫자) `[가정 — 표기법 P3에서 확정]`.

**C. 할일 페이지 (Ctrl+N)**
- `Ctrl+N`(일반 탭에서 브라우저가 가로채면 `Alt+N`)으로 새 할일 + 페이지를 만들고 바로 제목 편집으로 들어간다. 기본값(아래 D)과 `하기로 한 날=오늘`이 채워져 오늘 일지에도 줄이 생긴다. 기존 할일도 상세에서 "페이지 만들기" 가능. 페이지 본문 = 할일 메모.
- 페이지의 트리 위치는 **위치 규칙**으로 정한다:
  - 규칙 = `만약 [항목] [이(가)|아님|값 있음|비어 있음] [값] 그리고 … → 경로 템플릿`. 위에서부터 처음 맞는 규칙 하나만 적용, 끌어서 순서 변경.
  - 템플릿 변수: `{연}` `{월}` `{에픽위치}` + **모든 항목 이름**(`{유형}` `{제품}` … 새 항목을 만들면 변수도 생김). 계층 값은 경로로 펼친다(`{제품}` = `HBM/HBM-A`). 값이 없으면 `미분류`.
  - 맞는 규칙이 없을 때 기본 위치: `일지 아래(일지/{연}/{연}년 {월}월)` / `유형별 폴더` / `할일 폴더` 중 선택.
  - 예) `유형=셋업 그리고 제품=HBM → MI 공정업무/셋업/{제품}`.
  - 폴더가 없으면 자동 폴더를 만든다(트리에 '자동' 표시). 할일의 항목이 바뀌면 페이지가 새 위치로 옮겨지고 토스트로 알린다.
  - 트리에서 페이지를 직접 끌어 놓으면 **위치 고정**(규칙보다 우선, 상세에서 해제).

**D. 빠른 추가 기본값**: 상세 입력에서 고른 값(하기로 한 날·에픽·모든 항목)이 다음 할일의 기본값이 된다(끄기·비우기 가능). 일지 줄에서 만들어지는 할일에도 같은 기본값을 쓴다.

**E. 구조 화면 (지라 Structure식)** — 사이드바 '구조'
- **구조 보기**: 묶는 순서 칩(예: `제품 › 유형`)으로 할일을 트리 표로 본다. 칩은 추가·삭제·끌어서 순서 변경. 묶음 행마다 개수·진행률·"여기에 할일".
  - 할일 행을 다른 묶음에 끌어 놓으면 그 묶음 경로의 값으로 바뀐다(예: `HBM › 셋업` → `DRAM › 이슈`). 묶음 행을 끌면 안의 할일 전체가 바뀐다. 모두 실행 취소 가능. 일지·페이지 위치에 바로 반영.
- **항목 관리**: 항목 카드(이름·타입·필터 줄/행 표시 토글). 선택지는 추가·이름 변경(더블클릭)·색·삭제. **끌어서 순서 변경, 가운데에 놓으면 하위 값**(계층 선택지 — 예: `HBM-A`를 `HBM` 아래로). 항목 카드도 끌어서 순서 변경(빠른 추가·속성 순서). 새 항목 추가 시 빠른 추가·필터·구조·규칙 변수에 즉시 나타난다.
  - 쓰는 할일·페이지가 있는 선택지를 지우면 **옮길 값을 먼저 고르게** 한다(또는 비우기). 항목 삭제는 값 보관(4.2.2).
- **페이지 위치 규칙**: C의 규칙 편집 + 할일 페이지별 현재 위치·근거(규칙 n / 기본 / 고정) 표.

**F. 페이지 트리 드래그 앤 드롭**: 행을 끌어 다른 행 위·아래(순서) 또는 가운데(하위로) 놓는다. 자기 하위로는 못 옮긴다. 할일 페이지·자동 폴더는 규칙/고정으로만 위치가 정해진다(F로 끌면 고정).

**데이터 모델 추가 `[가정 — 구현 작업에서 확정]`**: `tasks.has_page`(INTEGER), `tasks.page_pin`(TEXT, 고정 경로), `task_fields.options`의 선택지에 `parent`(계층), 위치 규칙은 `settings.page_rules`(JSON 배열) + `settings.page_fallback`. 일지 줄의 `^t<id>`는 파일 본문에 그대로 저장한다.

**할일 (tasks) — Q-04 잠정안**
- 2단계: **상위(평가·페이지·프로젝트) > 할일**. 필요하면 하위 체크리스트로 3단계 흉내.
- 필드: 제목, 상태(todo/doing/done/hold), 연결(평가/페이지), 메모 + **사용자 정의 항목**(우선순위·요청자·납기·하기로 한 날은 기본 제공 항목, 4.2.2).
- 화면: 목록 + **버튼 필터**(상태·우선순위·납기 임박·요청자), 인라인 편집.
- **확정(P2-03) API** (`/api/todos`, 스키마 변경 없음):
  - `GET /api/todos` → `{items, requesters}`. 필터(모두 선택, AND): `status`·`priority`(쉼표 구분 다중), `requester`, `due_within=N`(오늘~N일 뒤 납기, done 제외), `overdue=true`(납기 지남, done 제외), `planned_date`, `eval_id`, `page_path`, `parent_task_id`, `top_level=true`, `q`(제목·메모 검색). 정렬: 납기 오름차순(없으면 뒤), 우선순위, id.
  - `POST /api/todos`(title 필수, 201), `GET /{id}`, `PATCH /{id}`(보낸 필드만 수정, null로 비우기 가능), `DELETE /{id}` → `{ok:true}`. 상위 할일 삭제 시 하위는 최상위로 풀림. 순환·자기 참조 거부.
  - 오류: 검증 400, 없음 404, 요청 형식 오류 422 — 모두 `{"error": "..."}`.
- **확정(P2-05/06) API**:
  - `GET /api/settings` → `{settings}`, `PUT /api/settings/{key}` `{value}` (허용 키: `journal_auto_show` on/off 기본 on, `theme` system|light|dark 기본 system, `density` compact|normal|cozy 기본 normal. theme·density는 그 외 값이면 400). 정적 파일(비 `/api`)은 `Cache-Control: no-cache`로 서빙.
  - `GET /api/journal/{yyyy-mm}/auto` → `{month, enabled, days: {"YYYY-MM-DD": [{id,title,status,priority,due_date}]}}` (납기가 그날이고 done 아닌 할일, 읽기 전용·파일에 쓰지 않음).
  - `POST /api/todos/from-line` `{date, line_index}` → 201 `{task, month, path, days}`. 체크박스 줄만, 할일 `planned_date`=그 날짜, 줄 끝에 ` → 할일 #id` 추가(이미 있으면 거부). (경로는 `/api/tasks`가 아니라 `/api/todos`)
  - `GET /api/dashboard/today` → `{date, month, journal, planned, due_soon(3일), overdue, evaluations:[]}` + (P2B-05) `planned_all`(오늘 계획, 완료 포함), `marked`(★·! 미완료), `requesters`, `tasks`(오늘 일지가 연결한 할일 `{id: task}`).
- **일지 줄 ↔ 할일 동기화 (P2B-05, `app/journal_links.py`)**: 연결된 줄은 끝이 ` → 할일 #<id>`다. 오늘·주간·월간·할일 목록·상세 패널은 같은 ID를 읽는다.
  - 할일 → 일지: `POST/PATCH/DELETE /api/todos`가 제목·완료·표시(`mark`)·`planned_date` 변화를 해당 줄에 반영한다. 응답에 `journal_days: {날짜: 본문}`(바뀐 날). `planned_date`를 새 날짜로 바꾸면 줄(들여쓴 하위 줄 포함)이 그날 칸 끝으로 이동하고, 줄이 없으면 새로 만든다. `planned_date`를 비우면 하위 줄 없는 줄은 삭제, 하위 줄이 있으면 텍스트만 남기고 연결을 끊는다. 할일 삭제는 줄의 연결만 끊는다. 납기(`due_date`)는 건드리지 않는다.
  - 일지 → 할일: `PUT /api/journal/{yyyy-mm}/{dd}`가 저장 전에 그날의 연결 줄을 동기화한다(제목, `[x]` 완료, `[*]`·`[!]` 표시, 붙여넣어 옮긴 줄 = 계획일 변경). 같은 ID가 두 줄이면 뒤 줄은 연결을 푼다(복제로 이슈가 늘지 않음). 줄이 사라지면 그날의 계획 연결만 해제(할일은 남음). 응답 `{..., content(정규화된 본문), changed:[id], other_days, tasks}`.
  - `GET /api/journal/{yyyy-mm}`에 `tasks: {id: task}`(그 달 연결 할일) 추가.
  - 승격 `POST /api/todos/from-line`: `[ ]`·`[x]`·`[*]`·`[!]` 줄 지원(`*`→mark star, `!`→mark urgent+우선순위 1, `x`→done). 같은 날 같은 제목의 열린 할일이 있으면 새로 만들지 않고 연결(`reused:true`); 그 할일이 이미 그날 줄에 연결돼 있으면 409. 응답에 `tasks`.
  - `GET /api/todos` 추가 필터: `ids=1,2`, `planned_from`/`planned_to`, `due_from`/`due_to`(양끝 포함), `unplanned=true`, `marked=true`, `open_only=true`. `mark`는 `POST/PATCH`로도 받는다(`star`·`urgent`·null).

### 4.3 평가 현황판 (board 타입, P4)

**템플릿 (eval_templates)**
- `stages`: 순서 있는 단계 목록 `[{key, label, color, warn_hours}]` — 편집 가능.
  마스터 기본값: 검사대기 → 검사완료 → 리뷰대기 → 리뷰완료&분류대기 → 분류완료 → 정리완료
- `fields`: 칸에 넣는 값 항목 `[{key, label, type}]`, type = `number | text | okng | check`
  마스터 기본값 `[가정]`: 반복도(okng), scan time(number, 분), 디펙 모수(number), 분류 완료(check), 이슈(text)
- 평가 생성 시 템플릿을 **복사**해서 그 평가에서만 고친다 (마스터는 안 바뀜). "이 평가 구성을 새 마스터로 저장" 버튼.

**평가 만들기 (마법사)**
1. 템플릿 선택 2. 설비 목록 붙여넣기 3. Lot·웨이퍼 붙여넣기(`LOT-TEST-001  1,2,3` 형식 또는 엑셀 2열) 4. 제외할 조합 끄기 → 칸 자동 생성.

**현황판 화면**
- 기본: 행 = Lot/웨이퍼, 열 = 설비, 칸 = 단계 색 + 값 요약.
- 상단 **보기 버튼**(토글 칩): `설비별` `Lot별` `단계별` `남은 것만` `값 보기`.
- 칸 클릭 → 옆 패널에서 단계 버튼으로 전환 + 값 입력 + 메모.
- **다중 선택 일괄 전환**: 행·열·드래그로 여러 칸 선택 → 단계 버튼 한 번.
- 단계별 진행률 막대(전체 / 설비별).
- 엑셀 내보내기.

**대기 시간 (v0.1 queue_items 대체)**
- 단계 전환마다 `eval_stage_log`에 기록 → 현재 단계에 머문 시간 = 지금 − 마지막 전환 시각.
- 단계마다 `warn_hours` 초과 시 주황, 2배 초과 시 빨강. "오늘" 화면에 오래 머문 칸 Top N.

### 4.4 Lot 상태 (MOS) (P4)
- **붙여넣기 어댑터**: MOS 화면에서 복사한 표를 붙여넣으면 Lot 번호·step·Hold·위치를 읽어 `lot_status`에 시각과 함께 저장. 열 매핑은 처음 한 번 지정.
- 현황판 Lot 행에 최신 MOS 상태 배지 표시.
- 나중에: 회사 PC에서 dcoll Python 스크립트가 **같은 테이블**에 넣는다(`source = 'dcoll'`). 앱은 출처를 몰라도 된다.

### 4.5 MI 정보 (table 타입, P5)
- **Plan / Step 정보**: process plan **엑셀 파일 가져오기**(열 매핑 한 번 지정, 다시 가져오면 갱신) + 엑셀형 표. 원본 파일 경로를 함께 기록.
- **DOI 라이브러리 (D-18)**: DOI = Defect of Interest. **이미지가 핵심**이라 표가 아니라 카드+표 겸용 화면.
  - 항목: 제품, plan, step, 결함 종류, 설명, 검출 설비·조건, 이미지 여러 장, 출처(부서·작성자), 태그.
  - **PPT 가져오기**: 기존 DOI PPT에서 슬라이드별 이미지·텍스트를 뽑아 초안 생성 → 사람이 확인·수정. (python-pptx)
  - 보기: 제품·step·결함 종류 버튼 필터, 이미지 그리드 / 표 전환. plan/step 정보와 연결.
  - **공유 패키지**: 선택한 DOI를 폴더 한 개(이미지 + `doi.json`)로 내보내기 → 사내 드라이브에 두면 다른 사람·부서가 가져오기. 가져온 항목은 출처 표시 + 읽기 전용. (다른 제품·부서 DOI를 참고할 수 없는 불편 해소의 첫 단계)
- 공통: 엑셀 붙여넣기 일괄 입력, 다른 페이지에서 링크.

### 4.6 RCP 관리 (P6) — 읽기 전용 우선 (D-11)
- **수집**: FTP 경로 등록(설비·라인별) + **이름 필터**(예: `aabb` 포함) → 해당 레시피의 파라미터 파일만 로컬 캐시로 내려받음. Python 표준 `ftplib`.
- **파싱 (2단 구조)**:
  1. **범용 파서 내장**: XML(경로 평탄화 `Inspection/Optics/Focus`), INI(`[섹션] 키`), TXT(`키=값`, `키: 값`, 탭 구분) → `{파라미터 경로: 값}`. 대부분 이걸로 읽힌다.
  2. **설비사별 매핑 파일** `parsers/<vendor>.json`: 어떤 파일을 어떤 파서로 읽을지, 보여줄 파라미터·한글 이름·단위·묶음. 범용 파서로 안 되는 형식만 `parsers/<vendor>.py`.
  - 매핑 파일·파서는 LLM과 대화하며 만든다(스킬 `recipe-parser-maker`, 회사에서).
- **보기**: 파라미터 비교 표 — 같은 레시피의 설비·라인 간 차이 강조.
- **이력**: 수집할 때마다 스냅샷 → 바뀐 파라미터 감지·diff.
- **수정·업로드 (마지막 단계)**: 자동 백업 → diff 미리보기 → 명시적 확인 → 업로드 → 로그. 기본은 꺼둠(설정에서 켬).

### 4.7 LLM 연동 (P7, D-10)
**1단계 — 파일 + 스킬 + CLI** (사내 OpenCode / Claude Code / Codex 공통)
- 노트·일지가 일반 파일이라 에이전트가 바로 읽고 쓴다.
- 정형 데이터는 에이전트용 CLI로: `python -m app.cli eval show <id>`, `task add ...`, `eval set-stage ...`
- `skills/` 폴더 (에이전트가 읽는 SKILL.md):
  | 스킬 | 예시 요청 |
  |---|---|
  | `status-brief` | "지금 이 설비 뭐 해야 돼?" → 평가·할일·MOS에서 그 설비의 남은 일 정리 |
  | `pptx-company` | "이걸로 저 PPT 형식으로 만들어줘" (사내 템플릿 기반) |
  | `fill-table` | "이 표 채워줘, raw data는 여기" |
  | `paper-patent` | 링크·레퍼런스 → 사내 논문·특허·기술자산화 초안 (이론/시뮬/실험/데이터/시각화/논리) |
  | `lecture-html` | 대학원 수준 interactive HTML 강의, 스터디 로드맵 |
  | `recipe-parser-maker` | 설비사 레시피 파일 샘플 → 파서 생성 |
  | `skill-maker` | 대화하면서 새 스킬 만들기 |
- 앱의 **"AI에게 요청" 버튼**: 현재 페이지 경로 + 선택한 데이터 + 고른 스킬을 담은 요청문을 클립보드로 복사 → 에이전트에 붙여넣기.

**2단계 — 사내 LLM API 직접 호출** (회사에서)
- Python에서 호출 가능 확인됨(2026-11-24). 사내 프록시가 인증을 처리하므로 키는 임의 값.
- 설정 파일 `config/local.json`(git 제외): `llm_base_url`, `llm_api_key`, `llm_model`, `proxy`. 코드에 주소·키를 넣지 않는다.
- 호출 모듈 `app/llm.py` 하나로 모은다(OpenAI 호환 형식 `[가정]` — P7-09 시작 때 회사에서 확인된 Python 예제 코드를 기준으로 맞춘다).
- 앱 안 채팅 패널: 현재 페이지·선택한 표·평가 데이터를 맥락으로 붙여 요약·채우기·초안.

## 5. 데이터 모델 (SQLite)

공통 컬럼: `id INTEGER PK`, `created_at TEXT`, `updated_at TEXT` (ISO 8601).

### task_fields (P2B-03, 마이그레이션 `002_task_fields.sql` — 4.2.2)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| key | TEXT UNIQUE | 내부 이름(영문, 변경 불가). `tasks.props`의 키 |
| label | TEXT | 화면 이름(변경 가능) |
| type | TEXT | `choice` / `multi` / `text` / `person` / `date` / `number` / `check` |
| options | TEXT(JSON) | 선택지 `[{value,label,color}]` (choice·multi) |
| sort_order | INTEGER | 표시 순서 |
| show_filter / show_row | INTEGER | 필터 줄·행 메타 표시 여부 |
| archived | INTEGER | 1이면 숨김(값은 보존, 새 값 쓰기 거부) |
| builtin | INTEGER | 1이면 기본 제공(priority·requester·due_date·planned_date) |

`tasks`에 `props TEXT NOT NULL DEFAULT '{}'`(JSON)를 추가했다. **호환 방식(P2B-03 확정)**: 기존 `priority`·`requester`·`due_date`·`planned_date` 컬럼은 **지우지 않고** 같은 키의 `props` 값과 함께 쓰는 미러로 유지한다(마이그레이션이 기존 값을 props로 복사). 그래서 기존 SQL·필터·일지 자동 표시·대시보드가 그대로 동작한다. 쓸 때는 둘을 항상 같이 갱신한다.
- 선택지 `{value,label,color?,parent?,archived?}`: `value`는 글자 또는 정수, `parent`는 같은 항목 안의 다른 선택지(계층, 순환 거부). 우선순위의 선택지는 1·2·3 고정(이름·색만 변경).
- 값 검증: choice=선택지 값, multi=선택지 값 목록(중복 제거), text/person=글자, date=YYYY-MM-DD, number=숫자, check=참/거짓.

**API (P2B-03, 모두 `/api/todos` 아래, 오류는 `{"error"}`)**
- `GET /api/todos/fields?include_archived=true` → `{items}`; `POST` `{key,label,type,options?}` → 201 (key 형식 `^[a-z][a-z0-9_]{0,31}$`, 예약어·중복 거부, 중복 409); `GET /fields/{key}` (+`used_by`); `PATCH /fields/{key}` `{label,type,show_filter,show_row,archived,sort_order,options,option_moves}`; `PUT /fields/order` `{keys:[...]}`(전체 key 한 번씩).
- 타입 변경은 기본 항목이거나 값이 있으면 409. 선택지 `＋`: `POST /fields/{key}/options` `{label,color?,parent?}` → 항목 반환.
- 선택지 삭제: `PATCH`의 `options`에서 빼면 된다. 그 선택지를 쓰는 할일이 있으면 409 — `option_moves: {"옛값": "새값" | null}`로 옮기거나 비운다. 위치 규칙이 쓰는 선택지는 409. 지운 선택지의 하위는 한 단계 위로 올라간다.
- 항목 삭제 `DELETE /fields/{key}`: 값이 있거나 기본 항목이면 **보관**(`archived`, 값 보존), 값이 없으면 삭제. `?purge=true`는 정의와 모든 할일 값을 완전 삭제(기본 항목이면 미러 컬럼도 비움, priority는 2). 위치 규칙이 쓰는 항목은 purge 409(`규칙 n번`).
- 할일: 응답에 `props`(객체)가 추가된다. `POST/PATCH`는 `props`(키별 병합, null=제거)를 받는다. 기존 최상위 `priority`·`requester`·`due_date`·`planned_date`도 그대로 받으며 둘이 겹치면 최상위가 이긴다. 정의 없는 키·보관된 항목에 쓰기는 400.
- 필터: 기존 필터는 그대로, 추가로 `?field_<key>=a,b`(한 항목 안에서는 OR, 항목끼리 AND; multi는 하나라도 포함). 없는 항목은 404.
- 위치 규칙: `GET/PUT /api/todos/page-rules` `{rules:[{conditions:[{field,op,value?}],path}]}` → `settings.page_rules`(JSON). op는 `is`·`not`·`set`·`empty`. 저장 시 항목·선택지·템플릿 변수(`{연}` `{월}` `{에픽위치}` 또는 항목 key·이름)가 실제로 있는지 검증한다.

**이슈 페이지·위치 규칙 (P2B-09, 마이그레이션 없음 — `tasks.page_path` 재사용)**
- 페이지 = `note` 폴더 + `_page.json`의 `task_id`(이슈 ID). 자동 폴더는 `auto: true`. `GET /api/pages/tree` 노드에 `task_id`·`auto` 추가. `PATCH /api/pages`로 페이지를 옮기면 `tasks.page_path`가 따라가고 `DELETE`(휴지통)하면 비워진다.
- `POST /api/todos/page-preview` `{task_id, relocate?, override?}` 또는 `{draft:{title,props,planned_date,…}, override?}` → `{folder, by, kind(rule|default|journal|folder), rule, title, page_path, new_folders[], journal}`. 이미 페이지가 있으면 `{exists:true, path}`(`relocate:true`면 `current`와 계획도 함께). 아무것도 쓰지 않는다. override = `{kind:"journal"}` | `{kind:"folder", path}` | 생략/`auto`.
- `POST /api/todos/{id}/page` `{override?}` → `{created, path, page, placement, task}`. 두 번째부터 `created:false`(기존 페이지, 내용·위치 불변). `POST /api/todos/with-page` = `POST /api/todos` 본문 + `override?` → 201 `{created, path, page, placement, task(+journal_days)}`. `POST /api/todos/{id}/page/relocate` `{override?}` → `{moved, path, from?}`(페이지 없으면 409, 자기 하위 400).
- `GET/PUT /api/todos/page-rules` 응답·본문에 `fallback`(`journal`·`type`·`inbox`) 추가. PUT은 규칙·기본값을 모두 검증한 뒤에 저장한다. `POST /api/todos/page-rules/overview` `{rules?, fallback?}` → `{rules:[{index, matches, example:{id,title,folder}}], pages:[{task_id, title, path, folder, rule_folder, by, differs}], fallback, fallbacks}` (저장하지 않은 초안도 계산).
- 템플릿: `{연}{월}`은 하기로 한 날(없으면 생성일), `{에픽위치}`는 에픽 이름과 같은 제목의 첫 페이지 경로(없으면 `미분류`) `[가정]`, 항목 값은 계층이면 경로(`HBM/HBM-A`), 없으면 `미분류`. 값 안의 금지 문자는 제거. 기본 위치: 일지 `일지/{연}/{연}-{월}`, 유형별 `MI 공정업무/{유형}`, 할일 폴더 `MI 공정업무/할일`(최상위 7번째 트리를 만들지 않으려 SPEC 초안 `할일`에서 변경).
- 화면: 이슈 상세의 '페이지' 행(확장/열기/위치 변경), 할일 화면 '할일 페이지 추가'(Alt+N, Ctrl+N), 구조 › '페이지 위치 규칙' 탭(조건 칩 편집, 순서 ↑↓, 변수 칩, 해당 이슈 수·예시, 기본 위치 칩, 페이지별 현재 위치 vs 규칙 위치와 '옮기기').

**구조 보기·분류 관리 (P2B-07, 마이그레이션 `004_structure_defaults.sql`)**
- 004: 기본 분류 `epic`(에픽)·`type`(유형)을 일반 `choice` 항목(builtin=0)으로 시드 — 이름 변경·보관·삭제 가능. 초기 보기는 에픽 → 유형 → 이슈.
- 보기 설정은 `settings.structure_view`(JSON `{mode:"fields"|"free", levels:[key…], styles:{key:{icon,color}}}`)에 저장되고 재시작 후 복원된다. 이슈의 분류 값(`tasks.props`)과 완전히 별개다. 계층 후보는 단일값 항목(`choice`·`person`, 보관 안 됨)뿐.
- `GET /api/structure/view` → `{mode, levels:[{key,label,icon,color}], available:[…], free_reason, saved, icons, colors}`. 저장된 계층에 삭제·보관된 분류가 있으면 **규칙이 깨진 것**으로 보고 `mode:"free"` + `free_reason`을 돌려준다(저장 값은 보존).
- `PUT /api/structure/view` `{mode, levels:[key | "new:<tmp>"], new_fields:[{tmp,label}], styles}` — 전부 검증한 뒤 새 분류(`c1`, `c2`… choice 항목)를 만들고 설정을 한 번에 저장(적용 = 원자적, 취소 = 서버 호출 없음). 오류: 중복·예약 이름 409/400, 계층 8단계 초과, 알 수 없는 아이콘·색(`layers grid box person flag ring` × `violet mint blue peach pink yellow`).
- `GET /api/structure/classes` → 분류별 `{used_by, rules[], in_view, archived, builtin, groupable}`; `GET /api/structure/classes/{key}/impact` → `{used_by, total_tasks, options:[{value,label,count,rules[]}], rules[], in_view}`. 삭제·보관·선택지 이동은 기존 `/api/todos/fields` API(`DELETE`, `?purge=true`, `PATCH option_moves`)를 그대로 쓴다.

**구조 작업표·자유 배치·복사 (P2B-08, 마이그레이션 `005_structure_free.sql`)**
- 자유 배치 위치는 `structure_nodes`(id, parent_id, label, field_key?, field_value?, position)와 `structure_items`(task_id, node_id, position)에만 저장한다. vault 페이지 트리와 별개. 그룹은 선택적으로 분류 값에 묶이며(`field_key/field_value`), 그 아래에 놓인 이슈는 그 값을 받는다. 처음 열 때 현재 계층(`structure_view.levels`)을 그룹으로 한 번 복제하고(`settings.structure_free_seeded`) 이후 편집은 유지한다.
- `GET /api/structure/free` → `{nodes:[…], items:[{task_id,node_id,position}]}` (배치 안 된 이슈는 최상위 끝).
- `POST /api/structure/free/move` `{kind:"group"|"issue", id, parent_id|null, before?:{kind,id}}` → `{free, changed:[task_id…]}`. 그룹은 하위와 함께 이동하고 자기 하위로 옮기면 400 `순환`. 옮긴 이슈(그룹이면 하위 이슈 전체)는 새 경로의 분류 값을 받는다. 이슈 ID 불변. 분류 보기에서의 이동은 `PATCH /api/todos/{id}`의 `props`.
- `POST /api/structure/free/groups` `{label, parent_id|null}` → `free` (분류 값에 묶이지 않은 그룹).
- `POST /api/structure/copy` — `{kind:"issue", task_id}`(제목 + " · 복사본"), `{kind:"group", field_key, value, task_ids}`(분류 보기: choice 분류의 새 선택지 "X · 복사본"을 만들고 그 값으로 복사. `field_key:"epic"`이면 다른 유형 가지의 같은 에픽 이슈 전부 포함), `{kind:"node", node_id}`(자유 배치: 선택한 하위 트리만, 바인딩된 그룹은 새 선택지). 응답 `{created:[새 id…], map, option?, node_id?, free?}`. 복사본은 새 ID이며 상태·메모·props는 값 복사(원본과 독립). 계획일·페이지·평가 연결은 복사하지 않는다.

### tasks
| 컬럼 | 타입 | 설명 |
|---|---|---|
| title | TEXT NOT NULL | |
| status | TEXT | `todo` / `doing` / `done` / `hold` |
| priority | INTEGER | 1(높음)~3 |
| requester | TEXT | 요청자 |
| due_date | TEXT | 납기 |
| planned_date | TEXT | 하기로 한 날 |
| parent_task_id | INTEGER FK | 선택 (하위 할일) |
| eval_id | INTEGER FK | 선택 |
| page_path | TEXT | 선택 (vault 상대 경로) |
| note | TEXT | |
| mark | TEXT | `star` / `urgent` / NULL — 일지 줄의 ★·! 표시 (003, P2B-05). 완료 여부는 `status` |

### eval_templates
| 컬럼 | 타입 | 설명 |
|---|---|---|
| name | TEXT NOT NULL | |
| is_master | INTEGER | 0/1 |
| stages | TEXT(JSON) | `[{key,label,color,warn_hours}]` |
| fields | TEXT(JSON) | `[{key,label,type}]` |

### evaluations
| 컬럼 | 타입 | 설명 |
|---|---|---|
| name | TEXT NOT NULL | 예: 2026 3사 검출성 평가 |
| page_path | TEXT | board 페이지 |
| stages, fields | TEXT(JSON) | 템플릿에서 복사한 이 평가 전용 구성 |
| status | TEXT | `active` / `done` / `hold` |
| start_date, due_date | TEXT | |

### eval_equipment
`evaluation_id FK, name TEXT, vendor TEXT, sort INTEGER`

### eval_lots / eval_wafers
`eval_lots: evaluation_id FK, lot_no TEXT, sort INTEGER`
`eval_wafers: lot_id FK, wafer_no TEXT, sort INTEGER`

### eval_cells  ← 현황판 핵심
| 컬럼 | 타입 | 설명 |
|---|---|---|
| evaluation_id | INTEGER FK | |
| equipment_id | INTEGER FK | |
| wafer_id | INTEGER FK | |
| stage_key | TEXT | 현재 단계 (NULL = 시작 전) |
| stage_at | TEXT | 현재 단계 진입 시각 |
| values | TEXT(JSON) | `{field_key: value}` |
| excluded | INTEGER | 0/1 (없는 조합) |
| note | TEXT | |
UNIQUE(equipment_id, wafer_id)

### eval_stage_log
`cell_id FK, from_stage TEXT, to_stage TEXT, at TEXT` — 대기 시간·이력 계산의 원천.

### lot_status (MOS)
`lot_no TEXT, step TEXT, hold INTEGER, location TEXT, raw TEXT(JSON), source TEXT('paste'|'dcoll'), captured_at TEXT`

### plans / steps (P5) — P5-01에서 엑셀 열 구성 보고 상세화

### doi / doi_images (P5)
`doi: product, plan, step, defect_type, title, description, tool_condition, source_dept, source_author, origin('mine'|'imported'), package_id, tags`
`doi_images: doi_id FK, file_path (data/doi/<id>/…), caption, sort`
### recipe_sources / recipes / recipe_params / recipe_snapshots (P6) — P6-01에서 상세화

### settings
`key TEXT PK, value TEXT` — 일지 자동 표시 on/off, 경고 배수, 백업 폴더, 레시피 쓰기 허용 등.

## 6. 화면

| # | 화면 | 핵심 내용 | 단계 |
|---|---|---|---|
| S0 | **사이드바 페이지 트리** | 하위 페이지 추가, 드래그로 이동·순서, 접기, 종류 아이콘 | P1 |
| S1 | **오늘** | 이번 달 일지 오늘 칸, 오늘·납기 임박 할일, 밀린 평가 단계 Top N | P2(→P4 확장) |
| S2 | **월간 일지** | 주 열 × 요일 행 그리드, 칸 편집, 자동 표시 토글 | P2 |
| S3 | **할일** | 버튼 필터 + 인라인 편집 | P2 |
| S4 | **노트 페이지** | 단 추가·열 너비·스크롤/맞춤, 접기, 표 블록 | P3 |
| S5 | **HTML 페이지** | iframe 표시, 편집은 파일/AI로 | P3 |
| S6 | **평가 현황판** | 보기 버튼, 칸 패널, 일괄 전환, 진행률 | P4 |
| S7 | 평가 템플릿 편집 | 단계·값 항목 편집, 마스터 지정 | P4 |
| S8 | **MI 정보 표** | Plan/Step, DOI | P5 |
| S9 | **RCP 관리** | 소스·필터, 비교 표, 이력 | P6 |
| S10 | 설정 | 자동 표시, 경고, 백업, 레시피 쓰기 허용 | P2~ |

공통 UI 원칙 (D-12): **드롭다운 대신 버튼·토글 칩**, 상단 빠른 추가(할일/페이지), 단축키 `/`(검색), `N`(새 할일).

**P2B 추가 요구 (2026-11-24, 사용자 피드백)**
1. **페이지 트리가 주 내비게이션 (D-24)**: 사이드바에 `일지 / MI 공정업무 / 연구 개발 / 성과 / 업무 매뉴얼 / 스터디` 가 항상 보이고, 접기·펼치기·하위 추가·드래그 이동. 오늘·할일은 그 위의 바로가기일 뿐 홈을 대체하지 않는다. 트리 한 줄의 폭·깊이(최소 4단계)·긴 제목 처리를 설계에 포함.
2. **쓰기가 먼저**: 오늘 화면에서 오늘 일지 칸을 그 자리에서 바로 쓴다(별도 이동 없이). 4.2.1의 키 입력이 모든 일지 칸에서 동작.
3. **다크 모드 (D-23)**: 라이트/다크/시스템 3택(버튼 3개), 기본 = 시스템 설정 따름 `[가정]`. 모든 색은 CSS 변수 토큰으로만 쓰고 하드코딩 색 금지, 사이드바·표·카드·칩·편집기·HTML 페이지 프레임 경계까지 양쪽 테마에서 대비 확보. 선택은 `settings`(`theme`)에 저장.
4. **항목이 바뀌는 UI**: 필터·메타 표시는 정의된 사용자 항목에서 생성(4.2.2). 고정된 "우선순위/요청자" 줄을 하드코딩하지 않는다.
5. 색은 부차적 — 정보 구조·입력 흐름(키보드)·한눈에 보기가 우선.

## 7. API 초안
```
GET    /api/health
# 페이지 (vault)
GET    /api/pages/tree
GET    /api/pages?path=          PUT /api/pages?path=      # 내용 읽기/저장
POST   /api/pages                # {parent, title, type}
PATCH  /api/pages?path=          # 이름 변경, 이동, 순서
DELETE /api/pages?path=          # vault/.trash/ 로 이동
GET    /api/search?q=
# 일지
GET    /api/journal/{yyyy-mm}    PUT /api/journal/{yyyy-mm}/{dd}
GET    /api/journal/{yyyy-mm}/auto   # 자동 표시 데이터
# 할일
GET/POST /api/tasks              PATCH/DELETE /api/tasks/{id}
POST   /api/tasks/from-line      # 일지 줄 승격
# 평가
GET/POST /api/eval-templates     PATCH /api/eval-templates/{id}
GET/POST /api/evaluations        GET /api/evaluations/{id}/board
POST   /api/evaluations/{id}/cells/stage   # {cell_ids[], stage_key}
PATCH  /api/eval-cells/{id}               # values, note
GET    /api/evaluations/{id}/export.xlsx
# MOS
POST   /api/lot-status/paste     GET /api/lot-status?lot_no=
# 오늘
GET    /api/dashboard/today
```

## 8. 단계 계획 (project_flow.html과 동일)
| 단계 | 내용 | 끝나면 |
|---|---|---|
| P0 | 준비·설계 | SPEC v1.0, 환경 준비 |
| P1 | 뼈대 | run.bat으로 페이지 트리가 뜬다 |
| P2 | **일지·할일** (1순위) | 원노트 일지를 이걸로 대체해 실사용 시작 + 회사 PC 시험 설치 |
| P3 | **노트** (2순위) | 원노트 계층 노트 대체 |
| P4 | **평가 현황판** (3순위) | 다음 설비사 평가를 이걸로 진행 |
| P5 | MI 정보 | Plan/Step/DOI |
| P6 | RCP 관리 | 읽기 전용 → 수정은 마지막 |
| P7 | LLM 연동 | 스킬·CLI → 사내 LLM API |
| P8 | 이식·운영 | 오프라인 설치, 백업, 원노트 이관 |

## 9. 비기능 요구
- 오프라인 동작 (외부 요청 0건). HTML 페이지의 외부 요청은 경고. 예외: 회사에서 설정한 사내 LLM 주소, 레시피 FTP.
- **사외 반출 금지 (D-17)**: 회사 데이터(vault, DB, 레시피, DOI 이미지)는 집으로 가져오지 않는다. 집에서는 가짜 데이터로 개발, 실제 데이터 작업과 회사 전용 스킬은 회사에서.
- 브라우저: **Chromium 계열**(Edge 우선, Chrome, 네이버 웨일) 최신 버전 (D-16).
- 시작 5초 이내, 페이지 열기 300ms 이내, 현황판 5,000칸 렌더 1초 이내 `[가정]`.
- 백업: 하루 1회 `data/` + `vault/`를 `backups/`에 zip, 30개 보관.
- 삭제는 휴지통(`vault/.trash/`) 경유.
- 회사 이식: `install.bat` 한 번 → `run.bat`. 패키지는 사내 프록시 경유 pip 설치(프록시 주소는 설정으로 입력), 막힌 패키지만 wheel 파일로.

## 10. P2 완료 조건 (첫 실사용)
- [ ] `run.bat` 더블클릭으로 실행, 페이지 트리 표시
- [ ] 월간 일지 그리드에서 매일 쓰기, 자동 표시 토글 동작
- [ ] 할일 추가·버튼 필터·인라인 편집, 일지 줄 → 할일 승격
- [ ] "오늘" 화면에서 오늘 칸 + 납기 임박 할일 확인
- [ ] 인터넷 끊고 동작, 회사 PC 시험 설치 성공
- [ ] 1주일 실사용 후 피드백 목록 작성
