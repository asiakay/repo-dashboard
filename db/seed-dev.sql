-- Local dev seed data — run after schema.sql to populate all frontend tabs
-- Usage: npm run seed:data
-- (schema.sql already seeds work_items; this file seeds OKRs, tasks, and deadline_signals)

-- OKRs (drives the OKR Progress tab via /api/okr-stats)
INSERT OR IGNORE INTO okrs (id, objective, key_result, target_date, status) VALUES
  ('KR-1.1', 'Stabilize active project ecosystem', 'Dashboard shows live health for all active repos', '2026-09-30', 'In Progress'),
  ('KR-1.2', 'Stabilize active project ecosystem', 'All work items have a clear owner and status', '2026-09-30', 'In Progress'),
  ('KR-2.1', 'Ship Solar Roots v1', 'Cohort application page live and accepting submissions', '2026-10-31', 'Planned'),
  ('KR-2.2', 'Ship Solar Roots v1', 'Grant narrative submitted to at least one funder', '2026-10-31', 'Planned'),
  ('KR-3.1', 'Front Porch Economics shared auth layer', 'Auth layer used by at least 2 apps', '2026-11-30', 'Planned');

-- Tasks (logged micro-work against OKRs)
INSERT OR IGNORE INTO tasks (date, description, okr_id, time_spent, status, notes) VALUES
  ('2026-08-25', 'Fixed repo count normalization bug in repos.js', 'KR-1.1', '45m', 'Done', NULL),
  ('2026-08-26', 'Added Active Work tab to dashboard frontend', 'KR-1.1', '2h', 'Done', NULL),
  ('2026-08-27', 'Wired MCP endpoint to D1 okrs + tasks tables', 'KR-1.2', '1.5h', 'Done', NULL),
  ('2026-08-28', 'Set up local dev scaffold (wrangler pages dev + seed scripts)', 'KR-1.1', '1h', 'Done', NULL),
  ('2026-08-28', 'Drafted Solar Roots cohort intake form outline', 'KR-2.1', '30m', 'In Progress', NULL),
  ('2026-08-28', 'Researched front-porch-economics auth options', 'KR-3.1', '1h', 'In Progress', NULL);

-- Deadline signals (drives the Priority tab via /api/priority)
INSERT OR IGNORE INTO deadline_signals (title, due_date, consequence_severity, affects_repos, source_repo, domain, notes, last_synced) VALUES
  ('Solar Roots grant application deadline', '2026-10-01', 4, '["solar-roots"]', 'solar-roots', 'grant', 'First round grant submission', datetime('now')),
  ('Front Porch Economics Q4 planning', '2026-09-15', 3, '["front-porch-economics","one-hour-service-library"]', 'front-porch-economics', 'default', 'Q4 roadmap locked by this date', datetime('now')),
  ('repo-dashboard monthly review', '2026-09-01', 2, '["repo-dashboard"]', 'repo-dashboard', 'default', 'Review active work items and prune done rows', datetime('now'));
