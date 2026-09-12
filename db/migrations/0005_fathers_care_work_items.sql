-- Migration 0005: fathers-care work_items for active guardianship/placement stages
-- Apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0005_fathers_care_work_items.sql
--
-- "fathers-care" is a synthetic label (not a GitHub repo) used as repo_name so these
-- items join with deadline_signals via the standard affects_repos string-match path.
-- notes fields include a DAD-N reference so work_items and okrs stay cross-traceable
-- without a real foreign key.

INSERT INTO work_items
  (repo_name, task_description, status, assigned_to, depends_on_repo, notes, source_type)
VALUES
  (
    'fathers-care',
    'Compel hospital case-management records release (PHI authorization form)',
    'in_progress',
    'asia',
    'masshealth-crm',
    'DAD-2: Stage 2 — Compel hospital case-management records release',
    'manual'
  ),
  (
    'fathers-care',
    'Secure conditional bed acceptance from MassHealth-pending SNF',
    'not_started',
    'asia',
    'masshealth-crm',
    'DAD-5: Stage 5 — Secure conditional bed acceptance from MassHealth-pending SNF',
    'manual'
  ),
  (
    'fathers-care',
    'Serve safe discharge demand & secure hospital-funded transport',
    'not_started',
    'asia',
    NULL,
    'DAD-6: Stage 6 — Serve safe discharge demand & secure hospital-funded transport',
    'manual'
  ),
  (
    'fathers-care',
    'File Motion to Amend/Correct address on ME guardianship petition',
    'not_started',
    'asia',
    NULL,
    'DAD-8: Guardianship — prerequisite filing before Sept 29 hearing',
    'manual'
  ),
  (
    'fathers-care',
    'Prepare for Sept 29 ME guardianship hearing + concurrent MA transfer filing',
    'in_progress',
    'asia',
    NULL,
    'DAD-8: Guardianship — Permanent guardianship awarded in Maine (Sept 29) + concurrent MA guardianship transfer filing',
    'manual'
  );
