-- 013_issue_levels: Jira-style issue hierarchy (V-011, D-48).
-- Upper levels (e.g. 에픽) are kinds of issue, not classification values: an epic is a row in `tasks` whose
-- level_id points here, and its children link to it through the existing tasks.parent_task_id.
-- Leaf issues keep level_id NULL (= "이슈", rank 0). Higher rank = upper level. Existing rows are untouched.
CREATE TABLE issue_levels (
    id          INTEGER PRIMARY KEY,
    label       TEXT NOT NULL,
    rank        INTEGER NOT NULL,
    icon        TEXT NOT NULL DEFAULT 'layers',
    color       TEXT NOT NULL DEFAULT 'violet',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

ALTER TABLE tasks ADD COLUMN level_id INTEGER REFERENCES issue_levels(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX idx_tasks_level ON tasks(level_id);

INSERT INTO issue_levels (label, rank, icon, color, created_at, updated_at)
VALUES ('에픽', 1, 'layers', 'violet', '2026-11-24T00:00:00', '2026-11-24T00:00:00');
