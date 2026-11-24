# MI Planner 로드맵 자동 배포 — 최초 설정

`project_flow.html`은 프로젝트 진행률의 원본입니다. GitHub Actions는 기본 브랜치에 push할 때마다 해당 HTML을 정적 페이지로 생성해 배포합니다.

## 1. 파일 반영

다음 세 파일을 Git 저장소의 같은 경로에 추가하세요. `project_flow.html`은 기존 파일을 그대로 사용합니다.

```
.github/workflows/publish-flow.yml
scripts/build_flow_site.py
tests/test_flow_site.py
```

## 2. GitHub Pages 최초 활성화

1. GitHub 저장소 `jaeyoonko1/MI_Planner` → **Settings** → **Pages**.
2. **Build and deployment → Source**를 **GitHub Actions**로 선택.
3. 기본 브랜치(`main` 또는 현재 기본 브랜치)에 위 세 파일을 push.
4. **Actions → Publish project flow**에서 녹색 체크를 확인.
5. 주소를 엽니다: **https://jaeyoonko1.github.io/MI_Planner/**.

동일한 화면을 `/project_flow.html` 또는 `/process_flow.html`에서도 열 수 있습니다.

## 3. 이후 자동 갱신

- 기본 브랜치에 push하면 매번 자동 재배포합니다. 수동 실행은 GitHub **Actions → Publish project flow → Run workflow**.
- 완료율은 원본 `project_flow.html` 안의 작업별 `done: true` 값으로 계산합니다. 코드만 수정한 커밋으로 작업 완료를 추정하지 않으므로, 에이전트가 FLOW의 값을 갱신해야 진행률도 변경됩니다.
- 사이트 맨 위에는 실제 배포 시각(KST)과 최신 커밋이 표시됩니다.
- 웹에서 작업 체크·메모를 수정한 것은 그 브라우저에만 저장되고 GitHub 소스에는 반영되지 않습니다.

## 4. 보안

발행 아티팩트에는 생성된 로드맵 HTML 세 파일만 들어갑니다. `vault/`, `data/`, `config/`, `docs/WORKLOG.md` 및 회사 자료는 배포하지 않습니다. **로드맵 내용 자체는 인터넷에 공개될 수 있으므로** 실제 설비·제품·Lot·사내 운영 정보는 FLOW에 적지 마세요.

## 5. 로컬 테스트

```powershell
py -3.11 -m unittest discover -s tests -p test_flow_site.py -v
py -3.11 scripts/build_flow_site.py --output _site
```

`_site/index.html`을 열면 생성 화면을 미리 볼 수 있습니다. 로컬에서 생성한 `_site/`가 Git에 올라가지 않도록 `.gitignore`에 `_site/`를 추가하세요.

> 연결된 ChatGPT GitHub 앱에서 저장소가 404로 조회된다면, GitHub 앱 설치 권한에 `jaeyoonko1/MI_Planner`를 추가해야 직접 원격 파일을 수정할 수 있습니다. 이와 무관하게 PC에서 평소처럼 Git push하면 Actions가 실행됩니다.
