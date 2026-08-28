CREATE TABLE IF NOT EXISTS work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_name TEXT NOT NULL,
  task_description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('not_started','in_progress','blocked','done')),
  assigned_to TEXT NOT NULL CHECK(assigned_to IN ('asia','agent')),
  depends_on_repo TEXT,
  started_at TEXT,
  completed_at TEXT,
  notes TEXT,
  source_type TEXT DEFAULT 'manual' CHECK(source_type IN ('manual','github_issue','github_pr')),
  source_url TEXT,
  github_issue_number INTEGER,
  manual_consequence_override INTEGER CHECK(manual_consequence_override BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_items_issue
  ON work_items(repo_name, github_issue_number)
  WHERE github_issue_number IS NOT NULL;

-- For existing D1 instances, run this migration once:
-- ALTER TABLE work_items ADD COLUMN manual_consequence_override INTEGER CHECK(manual_consequence_override BETWEEN 1 AND 5);

CREATE TABLE IF NOT EXISTS deadline_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  due_date TEXT NOT NULL,
  consequence_severity INTEGER NOT NULL CHECK(consequence_severity BETWEEN 1 AND 5),
  affects_repos TEXT NOT NULL,   -- JSON array as text, e.g. '["front-porch-economics"]'
  source_repo TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT 'default',  -- 'legal', 'grant', or 'default'
  notes TEXT,
  last_synced TEXT NOT NULL
);
-- This table is replaced wholesale on each sync run — never edit directly from the UI.

-- ── OKR & Task Tracker ──────────────────────────────────────────────────────

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

-- Seed data
INSERT INTO work_items (repo_name, task_description, status, assigned_to, depends_on_repo) VALUES
  ('hemp-pilot-ops-dashboard', 'Fix /deal-room 404', 'not_started', 'agent', NULL),
  ('moving-agent', 'Audit: active vs dormant, confirm purpose', 'not_started', 'agent', NULL),
  ('commonground', 'Audit: active vs dormant, confirm purpose', 'not_started', 'agent', NULL),
  ('temporal-convergence', 'Audit: active vs dormant, confirm purpose', 'not_started', 'agent', NULL),
  ('root-studio', 'Audit: active vs dormant, confirm purpose', 'not_started', 'agent', NULL),
  ('receipt-logger', 'Audit: active vs dormant, confirm purpose (Ledger)', 'not_started', 'agent', NULL),
  ('repo-dashboard', 'Add Active Work view + fix 0-repos bug', 'in_progress', 'agent', NULL),
  ('one-hour-service-library', 'Fix empty category / booking flow', 'not_started', 'agent', 'front-porch-economics'),
  ('front-porch-economics', 'Build shared auth/data layer', 'not_started', 'asia', NULL),
  ('solar-roots', 'Design cohort/program shape', 'not_started', 'asia', NULL),
  ('grantmatch', 'Decide funding-match framing', 'not_started', 'asia', NULL),
  ('pwse', 'Decide public vs. gated', 'not_started', 'asia', NULL);
