-- 001_init: tasks and settings (SPEC section 5). Timestamps are ISO 8601 strings.
CREATE TABLE tasks (
    id             INTEGER PRIMARY KEY,
    title          TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','hold')),
    priority       INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
    requester      TEXT,
    due_date       TEXT,
    planned_date   TEXT,
    parent_task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
    eval_id        INTEGER,  -- FK to evaluations is added when that table exists (P4)
    page_path      TEXT,
    note           TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due ON tasks(due_date);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
);
