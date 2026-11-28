// Task writes shared by the task row, the inspector and their context menus (V-010): one implementation each.
import { api } from "./api.js";
import { hub } from "./hub.js";
import { toast } from "./toast.js";
import { addDays, dateChoices, fmtMD, todayISO } from "./ui.js";

export const STATUS_CHOICES = [["todo", "할일"], ["doing", "진행"], ["hold", "보류"], ["done", "완료"]];
export const PRIORITY_CHOICES = [[1, "높음"], [2, "보통"], [3, "낮음"]];

export async function writeTask(id, data) {
  try {
    await hub.patchTask(id, data);
  } catch (e) {
    toast(`저장하지 못했어요 · ${e.message}`, { error: true, action: { label: "다시 시도", run: () => writeTask(id, data) } });
  }
}

// Restore the same issue ID and links through the shared structure trash.
export async function deleteTaskUndoable(id, after) {
  try {
    const items = [{ kind: "issue", id: Number(id) }];
    const res = await api.structureDelete({ items, children: "move_up" });
    hub.applyDays(res.journal_days);
    hub.emit({ kind: "task", id });
    after?.();
    const detail = res.impact?.subtasks ? " · 하위 이슈는 한 단계 위로 올라갔어요" : "";
    toast(`#${id} 삭제했어요${detail}`, {
      ms: 8000,
      action: {
        label: "되돌리기",
        run: async () => {
          const restored = await api.structureRestore(res.trash_id);
          hub.applyDays(restored.journal_days);
          hub.emit({ kind: "task", id });
        },
      },
    });
  } catch (e) { toast(`삭제하지 못했어요 · ${e.message}`, { error: true }); }
}

// Context menu groups for one task. `open` / `rename` are optional (only where the surface has them).
export function taskGroups(t, { open, rename, close } = {}) {
  const id = t.id;
  const done = t.status === "done";
  const radio = (list, now, key) => list.map(([value, label]) => ({
    label, radio: true, checked: now === value, run: () => writeTask(id, { [key]: value }),
  }));
  const dates = (key, now) => {
    const base = now || todayISO();
    return [
      ...dateChoices(key === "due_date" ? "due" : "plan").map(([value, label]) => ({
        label: value ? `${label} · ${fmtMD(value)}` : label, radio: true, checked: (now || null) === value, run: () => writeTask(id, { [key]: value }),
      })),
      { separator: true },
      { label: "하루 앞당기기", icon: "arrow-up", run: () => writeTask(id, { [key]: addDays(base, -1) }) },
      { label: "하루 미루기", icon: "arrow-down", run: () => writeTask(id, { [key]: addDays(base, 1) }) },
    ];
  };
  return [
    [
      { label: done ? "완료 취소" : "완료로 표시", icon: "check", run: () => writeTask(id, { status: done ? "todo" : "done" }) },
      { label: "별표", icon: "star", checked: t.mark === "star", run: () => writeTask(id, { mark: t.mark === "star" ? null : "star" }) },
      { label: "긴급 표시", icon: "alert", checked: t.mark === "urgent", run: () => writeTask(id, { mark: t.mark === "urgent" ? null : "urgent" }) },
    ],
    [
      { label: "상태", icon: "flag", items: radio(STATUS_CHOICES, t.status, "status") },
      { label: "우선순위", icon: "step", items: radio(PRIORITY_CHOICES, t.priority, "priority") },
      { label: "하기로 한 날", icon: "cal", items: dates("planned_date", t.planned_date) },
      { label: "납기", icon: "clock", items: dates("due_date", t.due_date) },
    ],
    [
      open ? { label: "상세 열기", icon: "open", keys: "Shift+Enter", run: open } : null,
      rename ? { label: "이름 변경", icon: "edit", run: rename } : null,
    ],
    [{ label: "삭제", icon: "trash", danger: true, run: () => deleteTaskUndoable(id, close) }],
  ];
}
