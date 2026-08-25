# Context for any Claude Code session working in this repo

Keep this file current as the architecture evolves — update it whenever a structural change lands, not just when someone remembers to.

## What this app is

A live GitHub repo health dashboard for github.com/asiakay, with an added "Active Work" layer that tracks what's currently being worked on (by Asia or by an agent) across her whole project ecosystem — not just this repo.

## Architecture

Static Cloudflare Pages site — no build step, no package.json, vanilla HTML/CSS/JS.

- `public/data/repos.json` — repo health data, committed hourly by a GitHub Actions workflow; fetched directly by the frontend (not via an API function).
- `functions/api/repos.js` — a Cloudflare Pages Function; exists but is not currently used by the frontend for repo data (frontend reads the static JSON directly instead).
- `functions/api/work-items.js` / `functions/api/work-items/[id].js` — API for the D1-backed work-items tracker (GET/POST list+create, PUT update by id).
- `wrangler.jsonc` — config; includes a `d1_databases` binding named `DB` pointing at the `repo-dashboard-work-items` database.
- `db/schema.sql` — the `work_items` table definition + seed data.
- `public/js/app.js` — all frontend logic: tab switching, repo rendering, work-item rendering, dependency-warning logic, inline edit forms.
- `public/styles.css` — dark theme; badge colors map to work-item status (gray = not_started, blue = in_progress, amber = blocked, green = done).

## Data model

```sql
CREATE TABLE work_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_name TEXT NOT NULL,
  task_description TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('not_started','in_progress','blocked','done')),
  assigned_to TEXT NOT NULL CHECK(assigned_to IN ('asia','agent')),
  depends_on_repo TEXT,
  started_at TEXT,
  completed_at TEXT,
  notes TEXT
);
```

One row per task, not per repo — a repo accumulates history over time rather than being overwritten.

## Key behaviors to preserve

- **Dependency warnings are soft, not hard blocks.** If a work item's `depends_on_repo` has any open (not_started/in_progress/blocked) items, show a warning banner — but still allow the status change. The person (or agent) may have a good reason to proceed anyway.
- **Repo health data and work-item data are separate systems** that get joined client-side (by `repo_name` matching) — don't conflate them into one table or one fetch path.
- `functions/api/repos.js` has a known normalization issue: it can call `.length` on the envelope object (`{ generated_at, repos: [] }`) instead of the array inside it. Any edit touching this file should normalize with `Array.isArray(repos) ? repos : (repos.repos || [])` before using `.length`.

## Where things can go wrong

- The repo-health data pipeline (GitHub Actions → repos.json) has previously broken silently when a processing script's expected file path drifted from where the fetch step actually wrote its output. If repo counts ever show as 0 or stuck on "Loading…" again, check for a path mismatch between the fetch step and the processing step before assuming a frontend bug.
- The frontend should always handle an error/empty-data response gracefully (show a message, don't just silently render zero) — this was added defensively after the above.

## What's NOT built yet (as of last update)

- Open PR/branch data is not surfaced on repo cards — only manually-logged `work_items` rows.
- No auth on the work-items API — anyone with the URL can read/write. Fine for personal use, worth revisiting if this is ever shared beyond Asia.
