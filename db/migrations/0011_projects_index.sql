-- Migration 0011: projects index (handoff cards)
-- Also in db/schema.sql, which the deploy workflow re-applies on every push to main,
-- so production gets this table automatically on merge. Kept here as a record.
-- Manual apply: wrangler d1 execute repo-dashboard-work-items --remote --file=db/migrations/0011_projects_index.sql

-- ── Projects index (handoff cards) ─────────────────────────────────────────
-- One row per project page/app. Each card says what it is, where its front end
-- and back end live, how to edit both, and what someone needs to take it over.
-- See docs/projects.md.

CREATE TABLE IF NOT EXISTS projects (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    slug            TEXT NOT NULL UNIQUE,      -- stable key, e.g. 'the-creative-principle'
    name            TEXT NOT NULL,
    hook            TEXT,                      -- one line: why it matters
    summary         TEXT,                      -- one sentence: what it is and who it's for
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK(status IN ('draft','live','paused','archived')),
    front_end_url   TEXT,                      -- live page
    front_end_host  TEXT,                      -- e.g. 'Claude artifact', 'Cloudflare Pages', 'GitHub Pages'
    back_end_type   TEXT,                      -- e.g. 'Tally form', 'D1', 'none'
    back_end_url    TEXT,                      -- where data lands / the service's page
    edit_front_end  TEXT,                      -- link or instructions for editing the page
    edit_back_end   TEXT,                      -- link or instructions for editing the back end
    repo_name       TEXT,                      -- GitHub repo, if any (matches /api/repos names)
    handoff_notes   TEXT,                      -- what to know before building on it
    value_note      TEXT,                      -- portfolio / sellable / community value, price if any
    tags            TEXT,                      -- comma-separated
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
