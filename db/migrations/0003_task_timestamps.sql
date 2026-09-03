-- Add started_at and completed_at to tasks for status-transition timestamps.
-- Apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0003_task_timestamps.sql
ALTER TABLE tasks ADD COLUMN started_at TEXT;
ALTER TABLE tasks ADD COLUMN completed_at TEXT;
