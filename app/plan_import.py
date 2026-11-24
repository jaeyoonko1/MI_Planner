"""Process-plan Excel -> Plan/Step rows (P5-01). Pure parsing + dry-run classification; no writes here.

Header mapping is tolerant: names are compared without case/space/separators, Korean and English aliases
are built in, and a saved or user-chosen mapping (field -> header text) overrides the guess.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from app.xlsx_read import SheetData

# field key, Korean label, aliases (matched after normalising)
FIELDS: list[tuple[str, str, list[str]]] = [
    ("product", "제품", ["product", "device", "item", "제품", "제품명", "품목", "디바이스"]),
    ("plan", "Plan", ["plan", "processplan", "planname", "flow", "route", "공정플랜", "플랜", "플랜명", "공정", "공정명"]),
    ("step_code", "Step ID", ["stepid", "stepcode", "stepno", "stepnumber", "stepseq", "step#", "스텝id", "스텝코드", "스텝번호", "step번호", "공정코드", "공정번호"]),
    ("step_name", "Step 이름", ["stepname", "stepdesc", "stepdescription", "step", "operation", "operationname", "스텝", "스텝명", "스텝이름", "step명", "step이름", "step설명", "스텝설명", "공정스텝"]),
    ("area", "공정 영역", ["area", "module", "process", "processarea", "part", "bay", "영역", "공정영역", "모듈", "파트"]),
    ("tool_group", "설비 그룹", ["toolgroup", "equipmentgroup", "eqgroup", "eqpgroup", "tool", "equipment", "eqp", "설비그룹", "설비", "장비"]),
    ("recipe", "레시피", ["recipe", "recipename", "rcp", "rcpname", "레시피", "레시피명"]),
    ("layer", "레이어", ["layer", "layername", "mask", "레이어", "층"]),
    ("note", "비고", ["note", "notes", "remark", "remarks", "comment", "comments", "memo", "비고", "메모", "참고"]),
]
FIELD_KEYS = [k for k, _, _ in FIELDS]
LABELS = {k: label for k, label, _ in FIELDS}
COMPARE = ["step_code", "name", "area", "tool_group", "recipe", "layer", "note"]
MAX_PREVIEW = 300
MAX_TEXT = 500
MAX_EXTRA_COLS = 30
HEADER_SCAN_ROWS = 25


class ImportOptionError(ValueError):
    pass


def norm(text: Any) -> str:
    return re.sub(r"[\s_\-./()\[\]:#]+", "", str(text or "").lower())


def _alias_map() -> dict[str, str]:
    return {norm(a): key for key, _, aliases in FIELDS for a in aliases}


def score_row(cells: list[str]) -> int:
    aliases = _alias_map()
    seen: set[str] = set()
    for cell in cells:
        key = aliases.get(norm(cell))
        if key:
            seen.add(key)
    return len(seen)


def detect_header_row(rows: list[list[str]]) -> tuple[int, int]:
    """Return (0-based index, score). Falls back to the first non-empty row when nothing looks like a header."""
    best, best_score, first = -1, 0, -1
    for i, cells in enumerate(rows[:HEADER_SCAN_ROWS]):
        if any(cells) and first < 0:
            first = i
        s = score_row(cells)
        if s > best_score:
            best, best_score = i, s
    if best >= 0 and best_score >= 2:
        return best, best_score
    return max(first, 0), best_score if best_score else 0


def guess_mapping(headers: list[str]) -> dict[str, str]:
    """field -> header text. Exact alias hits first; each header is used once."""
    aliases = _alias_map()
    out: dict[str, str] = {}
    used: set[int] = set()
    for i, h in enumerate(headers):
        key = aliases.get(norm(h))
        if key and key not in out and h:
            out[key] = h
            used.add(i)
    return out


def resolve_mapping(headers: list[str], chosen: dict[str, str] | None) -> dict[str, str]:
    """Merge the user's mapping over the guess. A chosen value of "" means 'this field has no column'."""
    out = guess_mapping(headers)
    present = {h for h in headers if h}
    for key, header in (chosen or {}).items():
        if key not in FIELD_KEYS:
            continue
        if header == "":
            out.pop(key, None)
        elif header in present:
            out[key] = header
    # "Step" alone is ambiguous: when a Step ID column also exists, the name stays a name.
    return out


@dataclass
class Parsed:
    sheet: str
    header_row: int  # 1-based
    headers: list[str]
    mapping: dict[str, str]
    extra_headers: list[str]
    rows: list[dict[str, Any]] = field(default_factory=list)
    errors: list[dict[str, Any]] = field(default_factory=list)
    total_rows: int = 0
    can_apply: bool = True
    problem: str = ""


def _clip(value: str) -> str:
    return value.strip()[:MAX_TEXT]


def parse_sheet(sheet: SheetData, *, header_row: int | None, mapping: dict[str, str] | None,
                product_default: str = "", fill_down: bool = True) -> Parsed:
    rows = sheet.rows
    if header_row is None:
        hi, _ = detect_header_row(rows)
    else:
        if header_row < 1:
            raise ImportOptionError("머리글 줄 번호는 1 이상이어야 해요.")
        hi = header_row - 1
    cells = rows[hi] if hi < len(rows) else []
    width = len(cells)
    headers = [h.strip() for h in cells]
    resolved = resolve_mapping(headers, mapping)
    col_of = {}
    for key, header in resolved.items():
        col_of[key] = headers.index(header)
    mapped_cols = set(col_of.values())
    extra_cols = [i for i, h in enumerate(headers) if h and i not in mapped_cols][:MAX_EXTRA_COLS]
    result = Parsed(sheet.name, hi + 1, headers, resolved, [headers[i] for i in extra_cols])
    if "step_code" not in col_of and "step_name" not in col_of:
        result.can_apply = False
        result.problem = "Step ID 또는 Step 이름 열을 찾지 못했어요. 열 지정에서 골라 주세요."
    if not any(headers):
        result.can_apply = False
        result.problem = "머리글 줄이 비어 있어요. 머리글 줄 번호를 바꿔 보세요."
    if "plan" not in col_of and not sheet.name.strip():
        result.can_apply = False
    last: dict[str, str] = {}
    seen: dict[tuple[str, str, str], int] = {}

    def get(row: list[str], key: str) -> str:
        i = col_of.get(key)
        return _clip(row[i]) if i is not None and i < len(row) else ""

    for ri in range(hi + 1, len(rows)):
        row = rows[ri]
        if not any(c.strip() for c in row):
            continue
        result.total_rows += 1
        rec = {"row": ri + 1}
        for key in FIELD_KEYS:
            rec[key] = get(row, key)
        if fill_down:
            if rec["product"] and rec["product"] != last.get("product"):
                last.pop("plan", None)  # a new product starts its own plan, never the previous one's
            for key in ("product", "plan"):
                if rec[key]:
                    last[key] = rec[key]
                else:
                    rec[key] = last.get(key, "")
        rec["product"] = rec["product"] or product_default.strip()
        rec["plan"] = rec["plan"] or sheet.name.strip()
        rec["name"] = rec["step_name"] or rec["step_code"]
        rec["key"] = rec["step_code"] or rec["step_name"]
        rec["extra"] = {headers[i]: _clip(row[i]) for i in extra_cols if i < len(row) and row[i].strip()}
        problem = ""
        if not rec["key"]:
            problem = "Step ID와 이름이 모두 비어 있어요."
        elif not rec["product"]:
            problem = "제품을 알 수 없어요. 제품 열을 지정하거나 제품 이름을 입력해 주세요."
        else:
            ident = (rec["product"], rec["plan"], rec["key"])
            if ident in seen:
                problem = f"같은 Step이 {seen[ident]}행에 이미 있어요."
            else:
                seen[ident] = rec["row"]
        if problem:
            result.errors.append({"row": rec["row"], "message": problem, "step": rec["key"]})
            continue
        result.rows.append(rec)
    return result


def classify(parsed: Parsed, existing: dict[tuple[str, str], dict[str, dict[str, Any]]]) -> dict[str, Any]:
    """Compare parsed rows with stored plans. existing[(product, plan)] = {step_key: stored step dict}.

    Returns counts, per-plan summary and per-row statuses; the repository applies exactly this plan.
    """
    counts = {"new": 0, "update": 0, "same": 0, "error": len(parsed.errors), "missing": 0}
    plans: dict[tuple[str, str], dict[str, Any]] = {}
    for rec in parsed.rows:
        pk = (rec["product"], rec["plan"])
        stored = existing.get(pk)
        info = plans.setdefault(pk, {"product": pk[0], "plan": pk[1], "new_plan": stored is None,
                                     "new": 0, "update": 0, "same": 0, "missing": 0, "keys": set()})
        info["keys"].add(rec["key"])
        old = (stored or {}).get(rec["key"])
        if old is None:
            rec["status"], rec["changes"] = "new", []
        else:
            changed = [LABELS.get(f if f != "name" else "step_name", f) for f in COMPARE
                       if (old.get(f) or "") != (rec.get(f) or "")]
            if (old.get("extra") or {}) != rec["extra"]:
                changed.append("기타 열")
            rec["status"] = "update" if changed else "same"
            rec["changes"] = changed
            rec["step_id"] = old["id"]
        counts[rec["status"]] += 1
        info[rec["status"]] += 1
    for pk, info in plans.items():
        stored = existing.get(pk) or {}
        gone = [k for k, s in stored.items() if k not in info["keys"] and not s.get("stale")]
        info["missing"] = len(gone)
        counts["missing"] += len(gone)
        info["missing_keys"] = gone
        del info["keys"]
    return {"counts": counts, "plans": list(plans.values())}
