"""status-brief helper: collect what is left for one equipment (or everything) via the agent CLI only.

Usage (from the MI_Planner folder):
    python skills/status-brief/scripts/brief.py --equipment EQ-A01 [--md]
    python skills/status-brief/scripts/brief.py --eval 3 [--days 7] [--md]
    python skills/status-brief/scripts/brief.py            # every active evaluation

Read-only: it only runs `python -m app.cli` list/show/stalled/search commands. Stdlib only.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]


class BriefError(Exception):
    pass


def run_cli(opts: argparse.Namespace, *argv: str) -> Any:
    cmd = [sys.executable, "-m", "app.cli"]
    if opts.db:
        cmd += ["--db", str(opts.db)]
    if opts.vault:
        cmd += ["--vault", str(opts.vault)]
    done = subprocess.run(cmd + list(argv), cwd=ROOT, capture_output=True, text=True, encoding="utf-8")
    try:
        data = json.loads(done.stdout)
    except json.JSONDecodeError:
        raise BriefError(f"CLI 출력이 JSON이 아닙니다: {' '.join(argv)}\n{done.stderr.strip()[-400:]}") from None
    if done.returncode:
        raise BriefError(data.get("error", "CLI 오류") if isinstance(data, dict) else "CLI 오류")
    return data


def _match(name: str, query: str | None) -> bool:
    return not query or query.casefold() in name.casefold()


def _groups(board: dict[str, Any], query: str | None) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Group live cells of the matching equipment by (equipment, stage); last stage only counts as done."""
    stages = board["stages"]
    order = {s["key"]: i for i, s in enumerate(stages)}
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    empty: dict[str, int] = {}
    for cell in board.get("cells", []):
        if cell["excluded"] or not _match(cell["equipment"], query):
            continue
        idx = order.get(cell["stage_key"], 0)
        for field in board["fields"]:
            if cell["values"].get(field["key"]) in (None, ""):
                empty[field["label"]] = empty.get(field["label"], 0) + 1
        key = (cell["equipment"], cell["stage_key"])
        g = groups.setdefault(key, {
            "equipment": cell["equipment"], "stage_key": cell["stage_key"], "stage_label": stages[idx]["label"],
            "next_stage_label": stages[idx + 1]["label"] if idx + 1 < len(stages) else None,
            "is_last": idx == len(stages) - 1, "order": idx, "cells": [], "max_wait_h": None, "warn": 0})
        g["cells"].append({"cell_id": cell["id"], "lot_no": cell["lot_no"], "wafer_no": cell["wafer_no"],
                           "wait_h": cell.get("wait_h"), "warn": cell.get("warn") or 0, "note": cell.get("note")})
        if cell.get("wait_h") is not None:
            g["max_wait_h"] = max(g["max_wait_h"] or 0, cell["wait_h"])
        g["warn"] = max(g["warn"], cell.get("warn") or 0)
    ordered = sorted(groups.values(), key=lambda g: (g["equipment"], g["order"]))
    return ordered, empty


def collect(opts: argparse.Namespace) -> dict[str, Any]:
    query = (opts.equipment or "").strip() or None
    evals = run_cli(opts, "eval", "list")["items"]
    if opts.eval is not None:
        evals = [e for e in evals if e["id"] == opts.eval]
        if not evals:
            raise BriefError(f"평가 #{opts.eval}을 찾을 수 없습니다.")
    else:
        evals = [e for e in evals if e["status"] == "active"]

    evaluations, matched = [], set()
    for item in evals:
        board = run_cli(opts, "eval", "show", str(item["id"]), "--full")
        names = [e["name"] for e in board["equipment"] if _match(e["name"], query)]
        if not names:
            continue
        matched.update(names)
        groups, empty = _groups(board, query)
        evaluations.append({**board["evaluation"], "equipment": names, "groups": groups, "empty_fields": empty})

    eval_ids = {e["id"] for e in evaluations}
    stalled = [s for s in run_cli(opts, "eval", "stalled", "--limit", "200")["items"]
               if s["evaluation_id"] in eval_ids and _match(s["equipment"], query)]

    def related(task: dict[str, Any]) -> bool:
        text = f"{task.get('title') or ''} {task.get('note') or ''}"
        return task.get("eval_id") in eval_ids or (query is not None and query.casefold() in text.casefold())

    open_tasks = run_cli(opts, "task", "list", "--open", "--limit", "500")["items"]
    if query or opts.eval is not None:
        open_tasks = [t for t in open_tasks if related(t)]
    overdue_ids = {t["id"] for t in run_cli(opts, "task", "list", "--overdue", "--limit", "500")["items"]}
    soon_ids = {t["id"] for t in run_cli(opts, "task", "list", "--due-within", str(opts.days), "--limit", "500")["items"]}
    keep = ("id", "title", "status", "priority", "mark", "due_date", "planned_date", "requester", "eval_id")
    slim = [{k: t.get(k) for k in keep} for t in open_tasks]

    notes = run_cli(opts, "search", query, "--limit", "5")["pages"] if query else []
    return {
        "filter": {"equipment": query, "eval": opts.eval, "days": opts.days},
        "matched_equipment": sorted(matched),
        "evaluations": evaluations,
        "stalled": stalled,
        "tasks": {
            "overdue": [t for t in slim if t["id"] in overdue_ids],
            "due_soon": [t for t in slim if t["id"] in soon_ids and t["id"] not in overdue_ids],
            "other_open": [t for t in slim if t["id"] not in overdue_ids | soon_ids],
        },
        "notes": notes,
    }


def _cells(cells: list[dict[str, Any]]) -> str:
    return ", ".join(f"{c['lot_no']}#{c['wafer_no']}" for c in cells[:8]) + (f" 외 {len(cells) - 8}" if len(cells) > 8 else "")


def _task_line(t: dict[str, Any]) -> str:
    due = f" (기한 {t['due_date']})" if t.get("due_date") else ""
    return f"- 할일 #{t['id']} {t['title']}{due}"


def to_markdown(brief: dict[str, Any]) -> str:
    who = ", ".join(brief["matched_equipment"]) or brief["filter"]["equipment"] or (f"평가 #{brief['filter']['eval']}" if brief["filter"]["eval"] else "전체")
    out = [f"## {who} 현황 브리핑"]
    if brief["filter"]["equipment"] and not brief["matched_equipment"]:
        out.append(f"- 진행 중 평가에서 '{who}' 설비를 찾지 못했습니다. 설비 이름을 확인하세요.")
    urgent = [f"- [경고{s['warn']}] {s['equipment']} {s['lot_no']}#{s['wafer_no']} — {s['stage_label']} {s['wait_h']}시간 대기"
              f" (기준 {s['warn_hours']}시간, {s['evaluation_name']}, 칸 {s['cell_id']})" for s in brief["stalled"]]
    urgent += [_task_line(t) + " — 기한 지남" for t in brief["tasks"]["overdue"]]
    out += ["", "### 1. 먼저 할 일 (경고·기한 지남)"] + (urgent or ["- 없음"])
    out += ["", "### 2. 평가별 다음 단계"]
    for ev in brief["evaluations"]:
        due = f", 마감 {ev['due_date']}" if ev.get("due_date") else ""
        out.append(f"**{ev['name']}** (#{ev['id']}{due}, `vault/{ev['page_path']}/`)")
        live = [g for g in ev["groups"] if not g["is_last"]]
        done = sum(len(g["cells"]) for g in ev["groups"] if g["is_last"])
        for g in live:
            wait = f", 최장 {g['max_wait_h']}시간" if g["max_wait_h"] is not None else ""
            out.append(f"- {g['equipment']} · {g['stage_label']} {len(g['cells'])}장 → 다음: {g['next_stage_label']}"
                       f"{wait} ({_cells(g['cells'])})")
        if done:
            out.append(f"- 완료 단계 {done}장")
        if not live and not done:
            out.append("- 남은 칸 없음")
        if ev["empty_fields"]:
            out.append("- 빈 값: " + ", ".join(f"{k} {v}칸" for k, v in ev["empty_fields"].items()))
    if not brief["evaluations"]:
        out.append("- 해당 평가 없음")
    out += ["", f"### 3. {brief['filter']['days']}일 안 기한"] + ([_task_line(t) for t in brief["tasks"]["due_soon"]] or ["- 없음"])
    if brief["tasks"]["other_open"]:
        out += ["", "### 4. 그 밖의 열린 할일"] + [_task_line(t) for t in brief["tasks"]["other_open"][:10]]
    if brief["notes"]:
        out += ["", "### 참고 페이지"] + [f"- `vault/{p['path']}/` {p['title']}" for p in brief["notes"]]
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    p = argparse.ArgumentParser(description="status-brief: equipment status from the agent CLI (read-only)")
    p.add_argument("--equipment", help="equipment name or part of it, e.g. EQ-A01")
    p.add_argument("--eval", type=int, help="one evaluation id (any status)")
    p.add_argument("--days", type=int, default=7, help="due-soon window in days")
    p.add_argument("--md", action="store_true", help="print a Korean markdown draft instead of JSON")
    p.add_argument("--db")
    p.add_argument("--vault")
    opts = p.parse_args(argv)
    try:
        brief = collect(opts)
    except BriefError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(to_markdown(brief) if opts.md else json.dumps(brief, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
