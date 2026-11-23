-- 004_structure_defaults: the two classifications the initial structure view groups by (epic -> type -> issue).
-- They are ordinary user-defined fields (builtin = 0): they can be renamed, hidden from the view or deleted.
INSERT OR IGNORE INTO task_fields (key, label, type, options, sort_order, show_filter, show_row, builtin, created_at, updated_at)
VALUES
 ('epic', '에픽', 'choice', '[]', 5, 1, 1, 0, '2026-11-24T00:00:00', '2026-11-24T00:00:00'),
 ('type', '유형', 'choice', '[]', 6, 1, 1, 0, '2026-11-24T00:00:00', '2026-11-24T00:00:00');
