---
name: fill-table
description: raw data(CSV·TSV·엑셀에서 복사한 글)로 노트의 표(vault 페이지의 마크다운 표) 또는 평가 현황판 칸 값을 채운다. "이 표 채워줘, raw data는 여기", "스캔 결과 CSV로 현황판 값 넣어줘" 같은 요청에 쓴다. 미리보기 → 확인 → 적용 순서.
---
# fill-table — raw data로 표 채우기

도우미: `python skills/fill-table/scripts/fill_table.py`(표준 라이브러리, 기본은 미리보기만). 평가 현황판은 CLI `eval set-cell`로만 쓴다.

## 언제 쓰나
- 노트 페이지(`vault/<경로>/index.md`) 안의 GFM 표 → **md 모드**
- 평가 현황판의 값 항목(스캔 시간·디펙 모수·OK/NG 등)이나 칸 메모 → **board 모드**
- MI 정보 표(Plan/Step)·RCP는 대상이 아니다. MI 정보 표는 결과를 TSV로 만들어 주고 화면에서 붙여넣게 안내한다. RCP는 쓰지 않는다(D-11).

## 입력
- 대상: 페이지 경로(‘AI에게 요청’의 위치) 또는 평가 ID. 페이지에 표가 여럿이면 몇 번째인지.
- raw data: 파일 경로(.csv/.tsv/.txt, UTF-8 또는 CP949). 채팅에 붙여넣은 글이면 `data/tmp/fill-raw.tsv`에 UTF-8로 저장해 그 경로를 쓴다. .xlsx는 엑셀에서 범위를 복사해 붙여넣게(또는 CSV로 저장) 한다.

## 절차
1. **raw 읽기** — `python skills/fill-table/scripts/fill_table.py raw data/tmp/fill-raw.tsv`
   머리글이 이상하면(첫 줄이 값) `--no-header`를 붙이고 열 이름은 `1,2,3…`로 쓴다.
2. **대상 보기**
   - md: `… fill_table.py tables "vault/<경로>/index.md"` → 표 번호·머리글·앞 3줄
   - board: `python -m app.cli eval show 3 --full` → `fields`(key·label·type), 칸의 설비·Lot·Wafer
3. **짝 정하기** — 행을 맞출 열(key)과 채울 열(map)을 정한다.
   - md: `--key 표열=raw열`(같은 이름이면 `--key Wafer`), 여러 개면 모두 맞아야 같은 행. `--map 표열=raw열`(생략하면 이름이 같은 열끼리).
   - board: `--match equipment=raw열 --match lot=raw열 --match wafer=raw열`(raw에 있는 것만), `--map 항목key또는label=raw열`, 칸 메모는 `--map note=raw열`.
   - 비교는 앞뒤 공백·대소문자 무시, 숫자만 있는 값은 `01`=`1`. 열 이름이 애매하면(예: `val1`, `val2`) **추측하지 말고 사용자에게 묻는다**.
4. **미리보기(dry run)** — 같은 명령을 `--apply` 없이 실행:
   - md: `… fill_table.py md "vault/<경로>/index.md" --table 1 --raw data/tmp/fill-raw.tsv --key Wafer=WF --map "Scan(분)=scan_min"`
   - board: `… fill_table.py board 3 --raw data/tmp/fill-raw.tsv --match lot=Lot --match wafer=WF --map scan_time=scan_min`
   - DB·vault 경로를 바꿔야 하면 `--db`·`--vault`는 `md`/`board`보다 **앞**에 쓴다.
5. **사용자에게 보여 주기** — 요약 표로: 채울 칸 수(`changes`), 이미 값이 달라 건너뛴 칸(`conflicts`, 기존값→새값), 형식이 틀린 값(`invalid`), 표에 없는 raw 행(`unmatched_raw`), raw에 두 번 나온 key(`duplicate_raw_keys`, 어느 쪽도 쓰지 않음).
   - 기본은 **빈 칸만 채운다**. 덮어쓰기는 사용자가 conflicts를 보고 "덮어써"라고 할 때만 `--overwrite`.
   - md에서 표에 없는 행을 아래에 추가하려면 사용자가 원할 때만 `--add-missing`.
6. **적용** — 사용자가 승인하면 같은 명령에 `--apply`. md는 원본을 `vault/.backup/fill-table/`에 복사한 뒤 표 줄만 고친다(다른 줄은 그대로). board는 칸마다 `eval set-cell`을 부른다.
7. **확인** — md: 다시 `tables`로 결과 확인, 앱에서 그 페이지를 열어 두었다면 새로고침하라고 안내. board: `python -m app.cli eval show 3 --full`로 값 확인. `errors`가 있으면 그 칸과 이유를 그대로 보고한다.

## 출력
```
표 1(Wafer 기준) 미리보기 — 채움 5칸 · 건너뜀 1칸 · 표에 없는 raw 1행
| 행 | 열 | 기존 | 새 값 |
| 01 | Scan(분) | | 12.5 |
| 02 | Scan(분) | 12.8 | 12.9 ← 값이 달라 건너뜀 |
raw에만 있는 행: 03 → 표 아래에 추가할까요?
적용할까요? (빈 칸만 / 덮어쓰기 포함)
```
적용 후: 바뀐 칸 수, 백업 파일 경로(md), 실패한 칸(board).

## 구조화 Excel 표 값 조회 및 채우기

- `… fill_table.py excel-tables "vault/<경로>/index.md"` → 표 ID·열 ID·행 수.
- `… fill_table.py excel-export "vault/<경로>/index.md" --table-id TABLE_ID` → 표·행·열 ID, 셀 표시 문자열, 확인한 원시 값과 타입, 병합 범위의 JSON을 표준 출력으로 내보낸다.
- 두 명령은 노트를 읽기만 한다. JSON은 값 전달용이며 서식 데이터는 포함하지 않는다. 값의 타입을 확인하지 못한 칸은 `value: null`로 표시한다. 빈 칸과 병합 영역의 앵커 이외 칸도 `null`로 남긴다. ID가 중복되거나 지원 버전의 그리드가 유효하지 않은 표는 선택할 수 없다.
- `tables`의 번호와 `md --table`은 기존 GFM 표에 적용한다.
- `… fill_table.py excel-fill "vault/<경로>/index.md" --table-id TABLE_ID --values data/tmp/cells.json`으로 변경을 미리 본다. 행 ID와 열 ID는 `excel-export`에서 읽는다. 입력 파일은 아래 형태의 UTF-8 JSON 배열이다. 원시 값 타입을 모르면 `value: null`을 명시한다. 숫자 원시 문자열에는 소수점으로 점을 쓰며 실제 셀에 보여 줄 문자열은 별도로 제공한다.

```json
[
  {"rowId": "r1", "columnId": "lot", "displayText": "001", "value": {"type": "text", "raw": "001"}},
  {"rowId": "r1", "columnId": "rate", "displayText": "12,50%", "value": {"type": "number", "raw": "0.125"}}
]
```

- 유효한 대상에 승인 후 `--apply`를 붙인다. 다른 값이 들어 있는 셀이 하나라도 있으면 이번 입력 전체가 대기하며, 승인받은 경우 `--overwrite`를 사용한다. 병합 셀은 병합의 첫 칸을 지정한다. 셀 전체 서식과 표시 형식은 보존하고 표시 문자열이 바뀌면 이전 문자열의 부분 서식은 제거한다. 기존 잠금과 원본 백업을 사용한다.

## 하지 말 것
- 미리보기와 사용자 승인 없이 `--apply` 하지 않는다. 값을 계산·보정·반올림하지 않는다(요청이 있을 때만, 그때도 미리보기에 표시).
- index.md를 손으로 통째로 다시 쓰지 않는다(표 밖 내용·단 표식 `<!-- column -->` 보존). DB를 직접 고치지 않는다.
- 덮어쓴 원본·백업을 지우지 않는다. 지울 것이 있으면 `vault/.trash/`로 옮긴다.
- RCP 쓰기 금지(D-11). 외부 네트워크 금지. 예시는 가짜 값(`EQ-A01`, `LOT-TEST-001`)만.
