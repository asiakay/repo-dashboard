-- Task-to-task dependency (blocking relationship within an OKR)
ALTER TABLE tasks ADD COLUMN depends_on_task_id INTEGER REFERENCES tasks(id);

-- OKR-to-OKR dependencies (cross-OKR ordering)
CREATE TABLE IF NOT EXISTS okr_dependencies (
  okr_id           TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
  depends_on_okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
  note             TEXT,
  PRIMARY KEY (okr_id, depends_on_okr_id)
);
