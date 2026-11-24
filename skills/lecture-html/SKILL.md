---
name: lecture-html
description: 대학원 수준의 interactive HTML 강의(광학·고체물리·빛-물질 상호작용·선형대수·AI·영상처리)와 스터디 로드맵을 vault의 html 페이지로 만든다. 슬라이더·그래프·확인 문제가 있고 인터넷 없이(CDN 없이) 앱 안에서 동작한다. "OPT5 결상 이론 강의 만들어줘", "푸리에 광학 interactive로 공부하고 싶어", "스터디 로드맵 만들어줘/갱신해줘" 같은 요청에 쓴다.
---
# lecture-html — interactive 강의 · 스터디 로드맵

도우미: `python skills/lecture-html/scripts/lecture_html.py new|check|sync|modules`(표준 라이브러리, 네트워크 없음).
결과는 **새 html 페이지** 하나(기본 위치 `vault/스터디/`). 앱이 샌드박스 iframe으로 열고, 진행 상황(이해한 절·문제 답·메모)은 그 페이지의 `_state.json`에 저장된다.

## 언제 쓰나
| 요청 | 할 일 |
|---|---|
| 특정 주제 강의 | `--kind lecture` — 로드맵 모듈 하나 = 강의 한 페이지(50~90분 분량) |
| 공부 순서·계획 | `--kind roadmap` — 트랙·모듈·선수 관계 그래프, 진행 상태 |
| 강의를 만든 뒤 | `sync`로 로드맵 카드에 강의 경로를 연결 |
- 논문·특허 초안은 `paper-patent`, 표 채우기는 `fill-table`.

## 입력 (처음에 묻는 것 — 한 번에 1~2개, 답한 것은 다시 묻지 않음)
1. 주제와 **모듈 ID**: `python skills/lecture-html/scripts/lecture_html.py modules "vault/스터디/스터디 로드맵/index.html"`로 목록을 보여 주고 고르게 한다(로드맵이 없으면 인자 없이 → 기본 커리큘럼). 로드맵에 없는 주제면 새 모듈 ID를 정하고 로드맵에도 추가할지 묻는다.
2. 수준·분량(기본 대학원, 50~90분), 특히 보고 싶은 현업 연결(검사 감도·계측 불확도 등).
3. 참고 자료(있으면): 사용자가 가진 교재 장·노트 페이지. **링크는 열지 않는다** — 본문을 붙여넣게 한다.

## 절차 — 강의
1. **뼈대 확인 먼저** — 본문 전에 아래 표를 보여 주고 확인받는다.
   ```
   목표(동사로): 유도한다 / 계산한다 / 예측한다 / 설명한다   (3~5개)
   절 | 직관 → 식 | 위젯(무엇을 움직이면 무엇이 보이나) | 확인 문제(겨냥한 오개념)
   1 Airy PSF | 원형 동공 FT → 식(1) | λ·NA → 단면·2D, 0.61λ/NA | —
   2 두 점 분해 | 세기 합 | 분리 거리 → 골 깊이·판정 | 지름/반지름 혼동
   ```
2. **페이지 만들기** — 미리보기: `… lecture_html.py new --kind lecture --title "결상 이론" --subject 광학 --module OPT5 --parent 스터디/광학`
   좋다고 하면 `--apply`(상위 페이지가 없으면 `--make-parent`). 템플릿(`templates/lecture.html`)으로 새 페이지가 생긴다(`_page.json`에 `skill`, `doc_kind`, `module`). 같은 이름이 있으면 `(2)`가 붙고 기존 페이지는 건드리지 않는다.
3. **본문 쓰기** — 결과의 `file`(index.html)을 열어 `[확인 필요]`를 채운다. 완성 예시는 `skills/lecture-html/examples/optics_resolution.html` — 구조·문체·위젯 코드를 그대로 본뜬다.
   - **런타임 블록(`mi-lecture-runtime:start` ~ `end`)은 고치지 않는다.** 내용은 `<main class="lx">` 안에, 위젯 코드는 맨 아래 `<script>`에만.
   - 구성 요소: `section.lx-sec`(절, `id` 영문) · `div.lx-eq`(MathML `<math display="block">`, 번호는 `data-n="(1)"`) · `div.lx-callout`(`data-kind` = `key` 핵심 / `mi` 현업 연결 / `warn` 주의) · `details.lx-deriv`(긴 유도) · `table.lx-table` · `figure.lx-widget[data-widget=이름]` · `div.lx-quiz[data-id][data-answer]`(`ol > li[data-key]` + `div.lx-why` 해설).
   - 위젯: `MI.widget("이름", (fig, ui) => { … ui.render(() => { … }) })`. 도구: `ui.slider({label,min,max,step,value,unit,fmt})`, `ui.chips({label,options:[[값,"글"]],value})`(**드롭다운 금지, D-12**), `ui.plot({x,y,xlabel,ylabel,height})` → `.draw([{x,y,color,dash,fill,label}], {marks,points})`, `ui.field({size})` → `.draw((u,v)=>0..1, "heat"|"gray"|"div")`, `ui.readout(라벨)` → `.set(글, "ok"|"warn"|"bad")`. 수학: `MI.math.linspace/besselJ/airy/sinc/gauss/clamp/fmt/ticks`. 색은 `"blue" "cyan" "violet" "green" "red" "yellow"`(테마 토큰).
   - 글쓰기 기준: 절마다 **직관(그림·위젯) → 식(기호 정의) → 해석 → 현업 연결** 순. 대학원 수준이면 유도를 생략하지 말고 `details`로 접는다. 위젯은 "무엇을 움직이면 무엇이 보이는지"가 캡션 한 줄로 설명돼야 한다. 확인 문제는 흔한 오개념을 오답으로 넣고 해설에서 왜 틀렸는지 쓴다.
   - **수치는 위젯 계산과 본문이 같아야 한다**(예: 0.61×266/0.9 ≈ 180 nm). 확실하지 않은 값·교재 장 번호는 쓰지 말고 `[확인 필요]`로 남긴다.
   - 현업 예시는 가짜 이름만(`EQ-A01`, `LOT-TEST-001`). 실제 설비·레시피·회사 수치 금지.
4. **검사** — `… lecture_html.py check "vault/스터디/광학/결상 이론/index.html"`
   - `errors`(외부 요청·`<script src>`·외부/상대 파일 참조·`alert/confirm/prompt`·`fetch`·등록 안 된 위젯·정답 보기 없음)는 반드시 고친다. `warnings`(새 창·form·`<select>`·브라우저 저장소 직접 사용·위젯/문제/참고 없음)는 이유가 없으면 고친다. `ok: true`가 될 때까지 반복(남은 `[확인 필요]`는 사용자에게 알린다).
5. **로드맵 연결** — `… lecture_html.py sync "vault/스터디/스터디 로드맵/index.html"` 미리보기 → `--apply`(원본은 `vault/.backup/lecture-html/`에 백업, 데이터 블록만 바뀜).
6. **보고** — 아래 출력 형식.

## 절차 — 로드맵
1. 없으면: `… new --kind roadmap --parent 스터디 --apply` (기본 커리큘럼 7트랙 38모듈: 선형대수·광학·고체물리·빛-물질·AI·영상처리·MI 종합).
2. 고치기: index.html의 `<script type="application/json" id="roadmap-data">`만 고친다(화면 코드는 그대로). 모듈 = `{"id","track","title","level":"기초|중급|대학원","hours","prereq":[],"outcomes":[],"refs":[],"page":""}`. 트랙 색은 `blue cyan violet green yellow orange pink red`.
3. `check`로 id 중복·없는 선수·순환을 확인 → `sync`로 강의 연결. 진행 상태는 사용자가 화면에서 바꾼다(에이전트가 `_state.json`을 고치지 않는다).

## 출력
```
강의: vault/스터디/광학/결상 이론/ (OPT5 · 절 5 · 위젯 3 · 문제 3 · 식 20)
check ok · 남은 [확인 필요] 0 · 로드맵 OPT5 카드에 연결됨
다음: 앱에서 열어 위젯을 움직여 보고, 틀린 수치·설명이 있으면 알려 주세요
```

## 하지 말 것
- CDN·웹폰트·외부 이미지·외부 스크립트(`<script src>`), 링크 열기, `fetch`. 그림은 SVG·canvas·MathML로 직접 그린다(오프라인, D-17).
- 런타임 블록 수정, `alert/confirm/prompt`, `localStorage` 직접 사용(앱 안에서는 막힘 — 진행 상황은 런타임이 저장).
- 기존 페이지 덮어쓰기·삭제(새 페이지만, 지울 것은 `vault/.trash/`로). DB 직접 수정, RCP 쓰기(D-11).
- 교재 문장 길게 베끼기(요약하고 서지 정보만), 출처 없는 수치 지어내기.
