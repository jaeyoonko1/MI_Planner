"""Excel export of one evaluation board (P4-07). Wait/warn values come from the board query (D-09)."""
from __future__ import annotations

from typing import Any

from app import xlsx
from app.xlsx import STYLE_HEADER, STYLE_TITLE, STYLE_WRAP, Sheet

STATE = {"active": "진행 중", "done": "완료", "hold": "보류"}
ENTITY_STATE = {"wait": "대기", "active": "진행", "hold": "보류", "done": "완료"}
WARN_TEXT = {0: "정상", 1: "경고", 2: "심각"}
UNASSIGNED = "미배정"


def _value(field: dict[str, Any], value: Any) -> Any:
    if value is None:
        return None
    if field["type"] == "okng":
        return {"ok": "OK", "ng": "NG"}.get(value, value)
    if field["type"] == "check":
        return "예" if value else "아니오"
    return value


def build_rows(board: dict[str, Any]) -> dict[str, Any]:
    """Flatten a board payload into the table rows the sheets use (also used by tests)."""
    evaluation = board["evaluation"]
    stages = {s["key"]: s for s in evaluation["stages"]}
    equipment = {e["id"]: e for e in board["equipment"]}
    wafers = {w["id"]: (lot["lot_no"], w["wafer_no"]) for lot in board["lots"] for w in lot["wafers"]}
    lot_of = {w["id"]: lot for lot in board["lots"] for w in lot["wafers"]}
    order = {wid: i for i, wid in enumerate(wafers)}
    cells = sorted(board["cells"], key=lambda c: (order.get(c["wafer_id"], 0), c["equipment_id"]))
    fields = evaluation["fields"]
    rows = []
    for c in cells:
        lot, wafer = wafers[c["wafer_id"]]
        eq = equipment[c["equipment_id"]]
        stage = "제외" if c["excluded"] else stages.get(c["stage_key"], {}).get("label", UNASSIGNED)
        rows.append({
            "equipment": eq["name"], "vendor": eq.get("vendor") or "", "lot": lot, "wafer": wafer,
            "eq_status": ENTITY_STATE.get(eq.get("status"), ""), "lot_status": ENTITY_STATE.get(lot_of[c["wafer_id"]].get("status"), ""),
            "stage": stage, "excluded": c["excluded"], "at": c["at"] or "",
            "wait_h": None if c["excluded"] or c["wait_h"] is None else round(c["wait_h"], 1),
            "warn": "" if c["excluded"] else WARN_TEXT.get(c["warn"], ""),
            "values": [_value(f, c["values"].get(f["key"])) for f in fields], "note": c["note"] or "",
        })
    return {"rows": rows, "fields": fields, "stages": evaluation["stages"]}


def build_xlsx(board: dict[str, Any], exported_at: str) -> bytes:
    evaluation = board["evaluation"]
    flat = build_rows(board)
    taken: set[str] = set()
    summary = Sheet(xlsx.sheet_name("요약", taken), widths=[24, 16, 16, 12, 12])
    summary.add([evaluation["name"]], STYLE_TITLE)
    for label, value in [
        ("상태", STATE.get(evaluation["status"], evaluation["status"])),
        ("내보낸 시각", exported_at), ("대기 기준 시각", board["now"]),
        ("설비", evaluation["equipment_count"]), ("Lot", evaluation["lot_count"]),
        ("웨이퍼", evaluation["wafer_count"]), ("평가 칸", evaluation["cell_count"]),
        ("제외 칸", evaluation["excluded_count"]),
    ]:
        summary.add([label, value])
    summary.add([])
    summary.add(["단계", "칸 수", "경고 기준(시간)", "경고 칸", "심각 칸"], STYLE_HEADER)
    live = [r for r in flat["rows"] if not r["excluded"]]
    for stage in flat["stages"]:
        mine = [r for r in live if r["stage"] == stage["label"]]
        summary.add([stage["label"], len(mine), stage.get("warn_hours"),
                     sum(r["warn"] == "경고" for r in mine), sum(r["warn"] == "심각" for r in mine)])
    summary.add([UNASSIGNED, sum(r["stage"] == UNASSIGNED for r in live), None, 0, 0])
    summary.add([])
    summary.add(["설비·Lot", "구분", "상태", "메모"], STYLE_HEADER)
    for e in board["equipment"]:
        summary.add([e["name"], "설비", ENTITY_STATE.get(e.get("status"), ""), e.get("note") or ""])
    for lot in board["lots"]:
        summary.add([lot["lot_no"], "Lot", ENTITY_STATE.get(lot.get("status"), ""), lot.get("note") or ""])

    headers = ["설비", "설비사", "Lot", "웨이퍼", "단계", "제외", "단계 진입 시각", "대기(시간)", "대기 상태",
               "설비 상태", "Lot 상태", *[f["label"] for f in flat["fields"]], "메모"]
    cells = Sheet(xlsx.sheet_name("칸 목록", taken),
                  widths=[14, 14, 16, 9, 18, 7, 22, 11, 10, 10, 10, *[14] * len(flat["fields"]), 32],
                  freeze_header=True, autofilter=True)
    cells.add(headers, STYLE_HEADER)
    for r in flat["rows"]:
        plain = [r["equipment"], r["vendor"], r["lot"], r["wafer"], r["stage"],
                 "제외" if r["excluded"] else "", r["at"], r["wait_h"], r["warn"],
                 r["eq_status"], r["lot_status"], *r["values"]]
        cells.add_styled([(v, 0) for v in plain] + [(r["note"], STYLE_WRAP)])

    equipment = [e["name"] for e in board["equipment"]]
    grid = Sheet(xlsx.sheet_name("설비별 단계", taken), widths=[24, *[18] * len(equipment)], freeze_header=True)
    grid.add(["Lot · 웨이퍼", *equipment], STYLE_HEADER)
    by_wafer: dict[tuple[str, str], dict[str, str]] = {}
    for r in flat["rows"]:
        by_wafer.setdefault((r["lot"], r["wafer"]), {})[r["equipment"]] = r["stage"]
    for (lot, wafer), stages in by_wafer.items():
        grid.add([f"{lot} · {wafer}", *[stages.get(name, "") for name in equipment]])
    return xlsx.build_workbook([summary, cells, grid])
