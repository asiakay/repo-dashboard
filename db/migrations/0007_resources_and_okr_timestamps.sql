-- Migration 0007: resources table + okrs.created_at for pace tracking
-- Apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0007_resources_and_okr_timestamps.sql
--
-- 1. okrs.created_at — used to compute expected pace: (elapsed / total) × 100.
--    Added with DEFAULT CURRENT_TIMESTAMP so new OKRs stamp their creation time.
--    Existing rows get NULL; the frontend handles NULL gracefully (skips pace signal).
--
-- 2. resources — lightweight inventory of tools, skills, financial resources, and
--    network assets; utilization state drives the Capacity view's resource-side signals.

ALTER TABLE okrs ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE IF NOT EXISTS resources (
  id          INTEGER  PRIMARY KEY AUTOINCREMENT,
  name        TEXT     NOT NULL,
  category    TEXT     NOT NULL
              CHECK(category IN ('tool_repo','skill','network','financial','other')),
  utilization TEXT     NOT NULL DEFAULT 'unknown'
              CHECK(utilization IN ('abundant','underused','active','depleted','unknown')),
  notes       TEXT,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
