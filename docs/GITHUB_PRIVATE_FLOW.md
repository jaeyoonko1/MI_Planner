# MI Planner — GitHub 비공개 로드맵

개인 계정의 GitHub Pages를 사용하지 않고, **기존 비공개 저장소 안에서만** 진행 현황을 확인합니다. 저장소 접근 권한이 없는 사람에게 공개되는 사이트는 생성하지 않습니다.

## 링크

- **[현재 진행률](https://github.com/jaeyoonko1/MI_Planner/blob/master/docs/PROJECT_FLOW_STATUS.md)**: GitHub 로그인 후 모바일·PC에서 읽는 Markdown 대시보드
- **[최신 업데이트와 HTML 다운로드](https://github.com/jaeyoonko1/MI_Planner/actions/workflows/update-private-flow.yml)**: 각 push의 GitHub Actions 화면. 실행 요약에 진행률이 표시되며 아티팩트 `MI-Planner-Flow-HTML`을 다운로드할 수 있습니다.

## 작동 방식

1. 기본 브랜치 `master`에 push하거나 Actions에서 **Run workflow**를 실행합니다.
2. 워크플로가 프로젝트의 `project_flow.html`에서 최신 `FLOW` 데이터를 읽습니다.
3. `docs/PROJECT_FLOW_STATUS.md`를 자동 갱신하고, GitHub Actions 실행 요약에도 같은 대시보드를 표시합니다.
4. 원본 HTML은 최신 커밋·KST 생성 시각을 포함해 ZIP 아티팩트로 30일간 보관됩니다. 브라우저에서 `index.html`을 열면 원래 HTML의 검색·필터·단계 진행률을 사용할 수 있습니다.

**주의:** GitHub는 개인 비공개 저장소의 HTML 파일을 일반 웹사이트처럼 직접 실행해서 보여주지 않습니다. 따라서 GitHub 내에서 바로 볼 때는 Markdown 대시보드, 원본 HTML을 사용할 때는 다운로드 후 로컬 열기 방식입니다.

## 보안

- GitHub Pages 배포, 공개 브랜치, 외부 CDN, 제3자 호스팅 **없음**.
- HTML 아티팩트는 기존 Private 저장소의 접근 권한이 있는 사람만 다운로드할 수 있습니다.
- 생성 대상은 `project_flow.html` 하나입니다. 앱의 `vault/`, `data/`, `config/`는 포함되지 않습니다.
- 로드맵의 작업 완료는 `FLOW`의 `done: true` 값을 바꿔서 확정합니다. Push 자체로 완료 처리하지 않습니다.

## 초기 설치 및 테스트

`.github/workflows/update-private-flow.yml`을 포함한 변경 PR을 기본 브랜치에 병합하면 자동으로 작동합니다. 별도의 Settings → Pages 설정은 **하지 않습니다**.

```powershell
node --test tests/test_private_flow.mjs
py -3.11 -m unittest discover -s tests -p test_flow_site.py -v
node scripts/render_flow_markdown.mjs
py -3.11 scripts/build_flow_site.py --output _site
```

로컬에서 생성한 `_site/`는 Git에 추가하지 마세요.
