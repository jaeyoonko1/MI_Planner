-- P6-01: RCP management (read-only first, D-11 / D-36). Host and credentials never live here: a source names an
-- FTP profile that is resolved from config/local.json (git excluded). Raw files live in a content-addressed cache
-- under data/recipes/blobs/<sha[:2]>/<sha>; rows below store only relative cache paths and hashes.
CREATE TABLE recipe_sources (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  vendor TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  equipment TEXT NOT NULL DEFAULT '',
  line TEXT NOT NULL DEFAULT '',
  ftp_profile TEXT NOT NULL DEFAULT '',
  remote_dir TEXT NOT NULL DEFAULT '',
  layout TEXT NOT NULL DEFAULT 'folder' CHECK (layout IN ('folder', 'file')),
  name_filter TEXT NOT NULL DEFAULT '[]',
  file_globs TEXT NOT NULL DEFAULT '[]',
  mapping TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE recipe_runs (
  id INTEGER PRIMARY KEY,
  source_id INTEGER REFERENCES recipe_sources(id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'partial', 'error', 'cancelled', 'dry_run')),
  listed INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  downloaded INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  new_snapshots INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_recipe_runs_source ON recipe_runs(source_id, id);
CREATE TABLE recipes (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES recipe_sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  remote_path TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0 CHECK (missing IN (0, 1)),
  current_snapshot_id INTEGER,
  UNIQUE (source_id, name)
);
CREATE INDEX idx_recipes_name ON recipes(name COLLATE NOCASE);
CREATE TABLE recipe_snapshots (
  id INTEGER PRIMARY KEY,
  recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  run_id INTEGER REFERENCES recipe_runs(id) ON DELETE SET NULL,
  collected_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  file_count INTEGER NOT NULL DEFAULT 0,
  param_count INTEGER NOT NULL DEFAULT 0,
  parse_status TEXT NOT NULL DEFAULT 'ok' CHECK (parse_status IN ('ok', 'partial', 'error', 'unparsed')),
  parser_info TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_recipe_snapshots_recipe ON recipe_snapshots(recipe_id, id);
CREATE TABLE recipe_files (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES recipe_snapshots(id) ON DELETE CASCADE,
  rel_path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  remote_mtime TEXT NOT NULL DEFAULT '',
  cache_path TEXT NOT NULL,
  parser TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  UNIQUE (snapshot_id, rel_path)
);
CREATE INDEX idx_recipe_files_sha ON recipe_files(sha256);
CREATE TABLE recipe_params (
  id INTEGER PRIMARY KEY,
  snapshot_id INTEGER NOT NULL REFERENCES recipe_snapshots(id) ON DELETE CASCADE,
  file_id INTEGER NOT NULL REFERENCES recipe_files(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0,
  UNIQUE (file_id, path)
);
CREATE INDEX idx_recipe_params_snapshot ON recipe_params(snapshot_id, sort);
