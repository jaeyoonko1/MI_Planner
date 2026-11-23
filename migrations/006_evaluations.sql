-- 006_evaluations: template definitions, evaluation snapshots and board data (P4-02, D-30).
CREATE TABLE eval_templates (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL CHECK (length(trim(name)) > 0),
    is_master INTEGER NOT NULL DEFAULT 0 CHECK (is_master IN (0, 1)),
    stages    TEXT NOT NULL CHECK (json_type(stages) = 'array' AND json_array_length(stages) > 0),
    fields    TEXT NOT NULL DEFAULT '[]' CHECK (json_type(fields) = 'array')
);
CREATE UNIQUE INDEX idx_eval_templates_master ON eval_templates(is_master) WHERE is_master = 1;

INSERT INTO eval_templates (name, is_master, stages, fields)
VALUES (
    '기본 설비 평가', 1,
    '[
        {"key":"inspection_wait","label":"검사대기","color":"#8f9bb5","warn_hours":null},
        {"key":"inspection_done","label":"검사완료","color":"#729eff","warn_hours":null},
        {"key":"review_wait","label":"리뷰대기","color":"#8a5cff","warn_hours":null},
        {"key":"classification_wait","label":"리뷰완료&분류대기","color":"#ffd15c","warn_hours":null},
        {"key":"classification_done","label":"분류완료","color":"#2de6ff","warn_hours":null},
        {"key":"closed","label":"정리완료","color":"#39e58c","warn_hours":null}
    ]',
    '[
        {"key":"repeatability","label":"반복도","type":"okng"},
        {"key":"scan_time","label":"스캔 시간 (분)","type":"number"},
        {"key":"defect_count","label":"디펙 모수","type":"number"},
        {"key":"classified","label":"분류 완료","type":"check"},
        {"key":"issue","label":"이슈","type":"text"}
    ]'
);

CREATE TABLE evaluations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    page_path  TEXT UNIQUE,
    stages     TEXT NOT NULL CHECK (json_type(stages) = 'array' AND json_array_length(stages) > 0),
    fields     TEXT NOT NULL DEFAULT '[]' CHECK (json_type(fields) = 'array'),
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'done', 'hold')),
    start_date TEXT,
    due_date   TEXT
);
CREATE INDEX idx_evaluations_status ON evaluations(status, id);

CREATE TABLE eval_equipment (
    id            INTEGER PRIMARY KEY,
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    name          TEXT NOT NULL CHECK (length(trim(name)) > 0),
    vendor        TEXT,
    sort          INTEGER NOT NULL DEFAULT 0,
    UNIQUE (evaluation_id, name),
    UNIQUE (id, evaluation_id)
);
CREATE INDEX idx_eval_equipment_order ON eval_equipment(evaluation_id, sort, id);

CREATE TABLE eval_lots (
    id            INTEGER PRIMARY KEY,
    evaluation_id INTEGER NOT NULL REFERENCES evaluations(id) ON DELETE CASCADE,
    lot_no        TEXT NOT NULL CHECK (length(trim(lot_no)) > 0),
    sort          INTEGER NOT NULL DEFAULT 0,
    UNIQUE (evaluation_id, lot_no),
    UNIQUE (id, evaluation_id)
);
CREATE INDEX idx_eval_lots_order ON eval_lots(evaluation_id, sort, id);

CREATE TABLE eval_wafers (
    id            INTEGER PRIMARY KEY,
    evaluation_id INTEGER NOT NULL,
    lot_id        INTEGER NOT NULL,
    wafer_no      TEXT NOT NULL CHECK (length(trim(wafer_no)) > 0),
    sort          INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (lot_id, evaluation_id) REFERENCES eval_lots(id, evaluation_id) ON DELETE CASCADE,
    UNIQUE (lot_id, wafer_no),
    UNIQUE (id, evaluation_id)
);
CREATE INDEX idx_eval_wafers_order ON eval_wafers(lot_id, sort, id);

CREATE TABLE eval_cells (
    id            INTEGER PRIMARY KEY,
    evaluation_id INTEGER NOT NULL,
    equipment_id  INTEGER NOT NULL,
    wafer_id      INTEGER NOT NULL,
    stage_key     TEXT,
    field_values  TEXT NOT NULL DEFAULT '{}' CHECK (json_type(field_values) = 'object'),
    excluded      INTEGER NOT NULL DEFAULT 0 CHECK (excluded IN (0, 1)),
    note          TEXT,
    FOREIGN KEY (equipment_id, evaluation_id) REFERENCES eval_equipment(id, evaluation_id) ON DELETE CASCADE,
    FOREIGN KEY (wafer_id, evaluation_id) REFERENCES eval_wafers(id, evaluation_id) ON DELETE CASCADE,
    UNIQUE (equipment_id, wafer_id)
);
CREATE INDEX idx_eval_cells_board ON eval_cells(evaluation_id, stage_key, id);
CREATE INDEX idx_eval_cells_wafer ON eval_cells(wafer_id, evaluation_id);

CREATE TABLE eval_stage_log (
    id         INTEGER PRIMARY KEY,
    cell_id    INTEGER NOT NULL REFERENCES eval_cells(id) ON DELETE CASCADE,
    from_stage TEXT,
    to_stage   TEXT,
    at         TEXT NOT NULL
);
CREATE INDEX idx_eval_stage_log_latest ON eval_stage_log(cell_id, at DESC, id DESC);
