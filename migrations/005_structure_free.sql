-- 005_structure_free: free-layout positions for the structure view (P2B-08, D-27).
-- Separate from the vault page tree: these rows only say where groups and issues sit in the structure worksheet.
CREATE TABLE structure_nodes (
    id          INTEGER PRIMARY KEY,
    parent_id   INTEGER REFERENCES structure_nodes(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    field_key   TEXT,  -- optional binding: issues placed under this group get field_key = field_value
    field_value TEXT,  -- JSON-encoded value (null = "unclassified")
    position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_structure_nodes_parent ON structure_nodes(parent_id);

CREATE TABLE structure_items (
    task_id  INTEGER PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
    node_id  INTEGER REFERENCES structure_nodes(id) ON DELETE SET NULL,
    position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_structure_items_node ON structure_items(node_id);
