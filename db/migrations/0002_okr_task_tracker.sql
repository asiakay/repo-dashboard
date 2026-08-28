-- OKR & Task Tracker schema extension
-- Apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0002_okr_task_tracker.sql

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS okrs (
    id TEXT PRIMARY KEY,
    objective TEXT NOT NULL,
    key_result TEXT NOT NULL,
    target_date TEXT,
    status TEXT CHECK(status IN ('Planned', 'In Progress', 'In Review', 'Completed')) DEFAULT 'In Progress'
);

CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (DATE('now')),
    description TEXT NOT NULL,
    okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
    time_spent TEXT,
    status TEXT CHECK(status IN ('To Do', 'In Progress', 'Done')) DEFAULT 'Done',
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_tasks_okr_id ON tasks(okr_id);

INSERT OR IGNORE INTO okrs (id, objective, key_result, target_date, status) VALUES
  ('KR-1.1', 'Anchor Funding', 'Cooperative Grant Application Package', '2026-10-15', 'In Progress'),
  ('KR-1.2', 'Anchor Funding', 'Operating & Financial Budget Model', '2026-11-01', 'Planned'),
  ('KR-2.1', 'Cohort Expansion', 'Pilot Community Training Cohort Launch', '2026-11-15', 'Planned'),
  ('KR-3.1', 'Content Flywheel', 'Master Weekly Content Package Release', '2026-09-30', 'In Progress'),
  ('KR-4.1', 'Operational Balance', 'Evening Reset Protocol Adherence', 'Ongoing', 'In Progress');
