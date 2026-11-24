-- P5-01: process plan / step tables filled by Excel import. Re-import updates rows by (product, plan, step_key).
CREATE TABLE plans (
  id INTEGER PRIMARY KEY,
  product TEXT NOT NULL,
  name TEXT NOT NULL,
  source_file TEXT NOT NULL DEFAULT '',
  source_path TEXT NOT NULL DEFAULT '',
  sheet TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL,
  UNIQUE(product, name)
);
CREATE TABLE steps (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  step_key TEXT NOT NULL,
  seq INTEGER NOT NULL,
  step_code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  tool_group TEXT NOT NULL DEFAULT '',
  recipe TEXT NOT NULL DEFAULT '',
  layer TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '{}',
  stale INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, step_key)
);
CREATE INDEX idx_steps_plan_seq ON steps(plan_id, seq);
CREATE TABLE plan_imports (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  sheet TEXT NOT NULL,
  at TEXT NOT NULL,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL,
  unchanged INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  missing INTEGER NOT NULL
);
