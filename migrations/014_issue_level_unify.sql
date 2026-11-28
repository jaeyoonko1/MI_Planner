-- Existing plain issues become members of a real, editable default level.
ALTER TABLE issue_levels ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1));
CREATE UNIQUE INDEX idx_issue_levels_default ON issue_levels(is_default) WHERE is_default = 1;

-- Reserve IDs from deleted levels so older trash entries can still restore them.
INSERT INTO issue_levels (id, label, rank, icon, color, created_at, updated_at, is_default)
SELECT MAX(
    COALESCE((SELECT MAX(id) FROM issue_levels), 0),
    COALESCE((SELECT MAX(json_extract(payload, '$.level.id')) FROM structure_trash
              WHERE json_extract(payload, '$.kind') = 'level'), 0)
) + 1, '이슈', 0, 'issue', 'blue', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1;

UPDATE tasks SET level_id = (SELECT id FROM issue_levels WHERE is_default = 1)
WHERE level_id IS NULL;

UPDATE structure_trash
SET payload = json_set(payload,
    '$.order[#]', (SELECT id FROM issue_levels WHERE is_default = 1),
    '$.to', COALESCE(json_extract(payload, '$.to'), (SELECT id FROM issue_levels WHERE is_default = 1))
)
WHERE restored_at IS NULL AND json_extract(payload, '$.kind') = 'level';

CREATE TRIGGER tasks_default_level_insert
AFTER INSERT ON tasks WHEN NEW.level_id IS NULL
BEGIN
    UPDATE tasks SET level_id = (SELECT id FROM issue_levels WHERE is_default = 1) WHERE id = NEW.id;
END;

CREATE TRIGGER tasks_default_level_update
AFTER UPDATE OF level_id ON tasks WHEN NEW.level_id IS NULL
BEGIN
    UPDATE tasks SET level_id = (SELECT id FROM issue_levels WHERE is_default = 1) WHERE id = NEW.id;
END;
