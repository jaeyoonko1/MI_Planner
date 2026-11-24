-- P5-02: DOI (Defect of Interest) library. uid is the stable id that P5-03 (PPT import) and P5-04 (share package)
-- carry across machines; image files live at data/doi/<doi uid>/<image uid>.<ext> and are stored as relative paths.
CREATE TABLE doi (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  product TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  defect_type TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tool_condition TEXT NOT NULL DEFAULT '',
  source_dept TEXT NOT NULL DEFAULT '',
  source_author TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'mine' CHECK (origin IN ('mine', 'imported')),
  package_id TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'draft')),
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_doi_deleted ON doi(deleted_at);
CREATE TABLE doi_images (
  id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL UNIQUE,
  doi_id INTEGER NOT NULL REFERENCES doi(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  thumb_path TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL DEFAULT '',
  caption TEXT NOT NULL DEFAULT '',
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_doi_images_doi ON doi_images(doi_id, sort);
