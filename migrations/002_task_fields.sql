-- 002_task_fields: user-defined task fields (D-22, SPEC 4.2.2 / 5).
-- Legacy columns priority/requester/due_date/planned_date stay as indexed mirrors of
-- the same keys in tasks.props, so existing queries, filters and journal code keep working.
ALTER TABLE tasks ADD COLUMN props TEXT NOT NULL DEFAULT '{}';

CREATE TABLE task_fields (
    id          INTEGER PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    type        TEXT NOT NULL CHECK (type IN ('choice','multi','text','person','date','number','check')),
    options     TEXT NOT NULL DEFAULT '[]',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    show_filter INTEGER NOT NULL DEFAULT 1,
    show_row    INTEGER NOT NULL DEFAULT 1,
    archived    INTEGER NOT NULL DEFAULT 0,
    builtin     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

INSERT INTO task_fields (key, label, type, options, sort_order, show_filter, show_row, builtin, created_at, updated_at)
VALUES
 ('priority', '우선순위', 'choice',
  '[{"value":1,"label":"높음","color":"red"},{"value":2,"label":"보통","color":"amber"},{"value":3,"label":"낮음","color":"gray"}]',
  1, 1, 1, 1, '2026-11-24T00:00:00', '2026-11-24T00:00:00'),
 ('requester', '요청자', 'person', '[]', 2, 1, 1, 1, '2026-11-24T00:00:00', '2026-11-24T00:00:00'),
 ('due_date', '납기', 'date', '[]', 3, 0, 1, 1, '2026-11-24T00:00:00', '2026-11-24T00:00:00'),
 ('planned_date', '하기로 한 날', 'date', '[]', 4, 0, 1, 1, '2026-11-24T00:00:00', '2026-11-24T00:00:00');

-- Move existing values into props (null values are simply absent).
UPDATE tasks SET props = json_set(props, '$.priority', priority);
UPDATE tasks SET props = json_set(props, '$.requester', requester) WHERE requester IS NOT NULL;
UPDATE tasks SET props = json_set(props, '$.due_date', due_date) WHERE due_date IS NOT NULL;
UPDATE tasks SET props = json_set(props, '$.planned_date', planned_date) WHERE planned_date IS NOT NULL;
