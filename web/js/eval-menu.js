// Context menu of the evaluation board (V-010): cells, stage list items, equipment / Lot / evaluation headers.
// Every entry calls the board's own functions (moveCells, setStatuses, setExcluded, editor) so undo toasts, the busy
// guard and the server rules stay in one place. This file only decides what to offer.
import { ENTITY_STATUS, EVALUATION_STATUS, entityName, findEntity, statusOf, touchedEntities } from "./eval-entity-model.js";
import { locate, nextStageMoves, targetMoves } from "./eval-select-model.js";

const num = (n) => n.toLocaleString("ko-KR");

// d: { board(), sel, activeIds(), setSelection, selectLine, moveCells, setStatuses, setExcluded, editor, edit, root }
export function boardMenu(d, target) {
  const board = d.board();
  const cellNode = target.closest("td[data-id], li[data-id]");
  const badge = target.closest("[data-edit]");
  const head = target.closest("[data-sel]");

  const entityStatus = (kind, ids) => {
    const items = ids.map((id) => findEntity(board, kind, id)).filter(Boolean);
    const now = new Set(items.map(statusOf));
    return {
      label: kind === "lot" ? "Lot 상태" : "설비 상태", icon: "flag",
      items: ENTITY_STATUS.map((s) => ({ label: s.label, icon: s.icon, radio: true, checked: now.size === 1 && now.has(s.key), run: () => d.setStatuses(kind, ids, s.key) })),
    };
  };
  const editItem = (kind, id, anchor) => ({
    label: kind === "lot" ? "Lot 이름·메모 편집…" : "설비 이름·메모 편집…", icon: "edit", keys: kind === "lot" ? "L" : "E",
    run: () => d.editor.open(anchor, kind, id),
  });

  if (badge && badge.dataset.edit === "evaluation") {
    const status = board.evaluation.status;
    return [[{
      label: "평가 상태", icon: "flag",
      items: EVALUATION_STATUS.map((s) => ({ label: s.label, icon: s.icon, radio: true, checked: status === s.key, run: () => d.setStatuses("evaluation", [board.evaluation.id], s.key) })),
    }]];
  }
  if (badge) {
    const kind = badge.dataset.edit;
    const id = Number(badge.dataset.id);
    return [[entityStatus(kind, [id]), editItem(kind, id, badge)]];
  }

  if (cellNode) {
    const id = Number(cellNode.dataset.id);
    const cell = board.byId.get(id);
    if (!cell) return null;
    const inSel = d.sel.ids.includes(id);
    let ids = inSel ? (cell.excluded ? [id] : d.activeIds()) : [id];
    if (!inSel) {
      const r = cellNode.dataset.r;
      d.setSelection([id], { anchor: r === undefined ? undefined : { r: Number(r), c: Number(cellNode.dataset.c) }, lastId: id, quiet: true });
    }
    if (!ids.length) ids = [id];
    const spot = locate(board, id);
    const many = ids.length > 1;
    const excluded = ids.every((x) => board.byId.get(x)?.excluded);
    const title = spot ? `${spot.row.lot.lot_no} · 웨이퍼 ${spot.row.wafer.wafer_no} · ${board.equipment[spot.column].name}` : "";
    const touched = touchedEntities(board, ids);
    const next = nextStageMoves(board, ids);
    const stageNow = (key) => ids.every((x) => (board.byId.get(x)?.stage_key ?? null) === key);
    const matrix = cellNode.dataset.r !== undefined;
    const stageGroup = excluded ? [] : [
      { label: next.length ? `다음 단계로 · ${board.stages[board.stageIndex.get(next[0].stage_key)].label}` : "다음 단계로", icon: "step", disabled: !next.length && "마지막 단계예요", run: () => d.moveCells(next, { label: "다음" }) },
      {
        label: many ? `${num(ids.length)}칸 단계 지정` : "단계 지정", icon: "flag",
        items: board.stages.map((s) => ({ label: s.label, radio: true, checked: stageNow(s.key), run: () => d.moveCells(targetMoves(ids, s.key), { label: s.label }) })),
      },
    ];
    return [
      [{ header: many ? `${num(ids.length)}칸 선택` : title }, ...stageGroup,
        { label: excluded ? (many ? "평가에 포함" : "평가에 포함하기") : many ? `${num(ids.length)}칸 평가에서 제외` : "이 칸 평가에서 제외", icon: excluded ? "check" : "ban", run: () => d.setExcluded(ids, !excluded) }],
      [
        ...(touched.equipment.length ? [entityStatus("equipment", touched.equipment)] : []),
        ...(touched.lots.length ? [entityStatus("lot", touched.lots)] : []),
        !many && spot ? editItem("equipment", cell.equipment_id, d.root.querySelector(`[data-edit="equipment"][data-id="${cell.equipment_id}"]`) || cellNode) : null,
        !many && spot ? editItem("lot", spot.row.lot.id, d.root.querySelector(`[data-edit="lot"][data-id="${spot.row.lot.id}"]`) || cellNode) : null,
      ],
      matrix ? [{
        label: "범위 선택", icon: "select-all",
        items: [
          { label: "이 웨이퍼의 모든 설비", run: () => d.selectLine("row", Number(cellNode.dataset.r), "replace") },
          { label: `${board.equipment[Number(cellNode.dataset.c)]?.name ?? "이"} 설비의 모든 웨이퍼`, run: () => d.selectLine("col", Number(cellNode.dataset.c), "replace") },
          { label: "이 Lot 전체", run: () => d.selectLine("lot", spot.row.lot.id, "replace") },
          { label: "표시 중인 모든 칸", keys: "Ctrl+A", run: () => d.selectLine("all", 0, "replace") },
        ],
      }] : null,
    ];
  }

  if (head) {
    const kind = head.dataset.sel;
    if (kind === "col") {
      const c = Number(head.dataset.c);
      const item = board.equipment[c];
      if (!item) return null;
      return [
        [{ header: item.name }, entityStatus("equipment", [item.id]), editItem("equipment", item.id, d.root.querySelector(`[data-edit="equipment"][data-id="${item.id}"]`) || head)],
        [{ label: "이 설비의 모든 칸 선택", icon: "select-all", run: () => d.selectLine("col", c, "replace") }],
      ];
    }
    if (kind === "lot") {
      const lot = board.lots.find((l) => l.id === Number(head.dataset.lot));
      if (!lot) return null;
      return [
        [{ header: entityName("lot", lot) }, entityStatus("lot", [lot.id]), editItem("lot", lot.id, d.root.querySelector(`[data-edit="lot"][data-id="${lot.id}"]`) || head)],
        [{ label: "이 Lot의 모든 칸 선택", icon: "select-all", run: () => d.selectLine("lot", lot.id, "replace") }],
      ];
    }
    if (kind === "row") return [[{ label: "이 웨이퍼의 모든 설비 칸 선택", icon: "select-all", run: () => d.selectLine("row", Number(head.dataset.r), "replace") }]];
    if (kind === "all") return [[{ label: "표시 중인 모든 칸 선택", icon: "select-all", keys: "Ctrl+A", run: () => d.selectLine("all", 0, "replace") }]];
  }
  return null;
}
