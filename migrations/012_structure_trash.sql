-- 012_structure_trash: restorable deletions from the structure screen (V-004).
-- One row = one delete operation. `payload` is a JSON snapshot (task rows, group rows, sibling order, page and
-- journal-line bookkeeping) from which the operation is undone exactly. Rows are never purged automatically.
CREATE TABLE structure_trash (
    id          INTEGER PRIMARY KEY,
    summary     TEXT NOT NULL,
    payload     TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    restored_at TEXT
);
