-- Repo health data: D1-backed cache for the GitHub repo list, and live-site
-- probe results written by .github/workflows/update.yml.
--
-- Production does not need this applied by hand: the same statements are in
-- db/schema.sql, which .github/workflows/deploy.yml re-applies on every push
-- to main. This file exists so local databases can be brought up to date:
--   wrangler d1 execute repo-dashboard-work-items --local \
--     --file=db/migrations/0011_repo_cache_and_site_status.sql

CREATE TABLE IF NOT EXISTS cache_entries (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_status (
    repo_name   TEXT PRIMARY KEY,
    homepage    TEXT NOT NULL,
    is_error    INTEGER NOT NULL CHECK(is_error IN (0, 1)),
    http_status INTEGER,
    checked_at  TEXT NOT NULL
);
