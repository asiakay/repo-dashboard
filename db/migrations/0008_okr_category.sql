-- Add category field to okrs table for non-repo OKRs (education, life admin, etc.)
-- Apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0008_okr_category.sql

ALTER TABLE okrs ADD COLUMN category TEXT DEFAULT 'project'
  CHECK(category IN ('project','education','life_admin','health','financial','other'));

UPDATE okrs SET category = 'project' WHERE category IS NULL;
