-- Migration 0006: deadline_signals for guardianship/placement hard dates
-- Apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0006_fathers_care_deadline_signals.sql
--
-- Both signals use domain='legal' so the legal lead-time curve applies.
-- At 17 days (Sept 29) and 21 days (Oct 3) from 2026-09-12, both fall in the
-- ≤30-day bucket (score 4). With consequence_severity 5: impact = 5×4 = 20 → Tier 1 Immediate Focus.
--
-- affects_repos is stored as a JSON text array; the priority.js parser handles both
-- string and pre-parsed forms via parseSignal().

INSERT INTO deadline_signals
  (title, due_date, consequence_severity, affects_repos, source_repo, domain, last_synced)
VALUES
  (
    'ME Permanent Guardianship hearing + MA transfer filing',
    '2026-09-29',
    5,
    '["fathers-care"]',
    'fathers-care',
    'legal',
    '2026-09-12'
  ),
  (
    'MA placement/transport target date',
    '2026-10-03',
    5,
    '["fathers-care","masshealth-crm"]',
    'fathers-care',
    'legal',
    '2026-09-12'
  );
