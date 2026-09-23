# Context for any Claude Code session working in this repo

Keep this file current as the architecture evolves — update it whenever a structural change lands, not just when someone remembers to.

## What this app is

A live GitHub repo health dashboard for github.com/asiakay, with an added "Active Work" layer that tracks what's currently being worked on (by Asia or by an agent) across her whole project ecosystem — not just this repo.

## Architecture

Static Cloudflare Pages site — no build step, no package.json, vanilla HTML/CSS/JS.

- `public/data/repos.json` — repo health data, committed hourly by a GitHub Actions workflow; fetched directly by the frontend (not via an API function).
- `functions/api/repos.js` — a Cloudflare Pages Function; exists but is not currently used by the frontend for repo data (frontend reads the static JSON directly instead).
- `functions/api/work-items.js` / `functions/api/work-items/[id].js` — API for the D1-backed work-items tracker (GET/POST list+create, PUT update by id). The PUT handler auto-stamps `started_at`/`completed_at` based on status transitions (server-side).
- `functions/api/me.js` — GET `/api/me`; returns `{ email, authenticated }` from the `Cf-Access-Authenticated-User-Email` header injected by Cloudflare Access.
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

## OKR & Task Tracker (MCP integration)

### New files
- `db/migrations/0002_okr_task_tracker.sql` — D1 migration adding `okrs` and `tasks` tables.
- `functions/api/mcp.js` — JSON-RPC 2.0 MCP endpoint at `/api/mcp`.

### New D1 tables

```sql
-- Strategic objectives / key results
CREATE TABLE okrs (
    id TEXT PRIMARY KEY,              -- e.g. 'KR-1.1' or 'EDU-1.1'
    objective TEXT NOT NULL,          -- high-level goal title
    key_result TEXT NOT NULL,         -- measurable outcome
    target_date TEXT,                 -- YYYY-MM-DD or 'Ongoing'
    status TEXT CHECK(status IN ('Planned','In Progress','In Review','Completed')),
    category TEXT DEFAULT 'project'   -- 'project','education','life_admin','health','financial','other'
);

-- Micro-tasks linked to OKRs
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL DEFAULT (DATE('now')),
    description TEXT NOT NULL,
    okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
    time_spent TEXT,                  -- free-form, e.g. '45m', '1.5h'
    status TEXT CHECK(status IN ('To Do','In Progress','Done')),
    notes TEXT,
    depends_on_task_id INTEGER REFERENCES tasks(id),  -- blocking relationship within an OKR
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- OKR-to-OKR ordering (cross-OKR dependencies)
CREATE TABLE okr_dependencies (
    okr_id            TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
    depends_on_okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
    note              TEXT,
    PRIMARY KEY (okr_id, depends_on_okr_id)
);
```

### Apply the migration

```bash
# Remote (production):
wrangler d1 execute repo-dashboard-work-items --remote \
  --file=db/migrations/0002_okr_task_tracker.sql

# Local dev:
wrangler d1 execute repo-dashboard-work-items --local \
  --file=db/migrations/0002_okr_task_tracker.sql
```

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `MCP_SECRET_TOKEN` | No (opt-in) | Bearer token protecting `/api/mcp`. When unset, the endpoint is open (safe for local dev). |

Set via Wrangler:
```bash
wrangler secret put MCP_SECRET_TOKEN
# or via the Cloudflare Pages dashboard: Settings → Environment variables → Secrets
```

### MCP endpoint (`POST /api/mcp`)

JSON-RPC 2.0 transport. All requests must include `Content-Type: application/json`. When `MCP_SECRET_TOKEN` is configured, include `Authorization: Bearer <token>`.

**Methods:**
- `tools/list` — enumerate available tools
- `tools/call` — invoke a tool by name

**Tools:**

| Tool | Required args | Description |
|---|---|---|
| `log_task` | `description`, `okr_id` | Log a micro-task against an OKR |
| `get_okr_progress` | _(none)_ | Aggregated completion % per OKR |
| `get_daily_summary` | `date` (optional, defaults to UTC today) | All tasks for a date |
| `register_okr` | `id`, `objective`, `key_result` | Create or update an OKR. Optional: `category` (`project`/`education`/`life_admin`/`health`/`financial`/`other`, defaults to `project`) |
| `list_agent_tasks` | _(none)_ | Return the agent work queue (assigned_to=agent, excludes done by default). Optional: `include_done`, `repo_name` filter |
| `start_task` | `task_id` | Claim a work-item task: set status=in_progress, stamp started_at. Idempotent if already in_progress |
| `finish_task` | `task_id` | Complete a work-item task: set status=done, stamp completed_at. Optional `notes` appended to existing |
| `list_okr_tasks` | _(none)_ | Return OKR micro-tasks from the `tasks` table. Optional: `okr_id`, `status`, `include_done` |
| `start_okr_task` | `task_id` | Advance an OKR micro-task to In Progress; stamps `started_at`. Idempotent |
| `finish_okr_task` | `task_id` | Advance an OKR micro-task to Done; stamps `completed_at`. Optional: `notes`, `time_spent` |

**Error codes:**

| Code | Meaning |
|---|---|
| `-32000` | Unauthorized (HTTP 401) |
| `-32601` | Method or tool not found |
| `-32603` | Internal error |
| `-32700` | JSON parse error |
| `-32600` | Invalid JSON-RPC request |

### MCP client configuration

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "repo-dashboard": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-pages-domain>/api/mcp"],
      "env": {
        "MCP_REMOTE_AUTHORIZATION_HEADER": "Bearer <your-token>"
      }
    }
  }
}
```

**Cursor** (`.cursor/mcp.json` in your project):
```json
{
  "mcpServers": {
    "repo-dashboard": {
      "url": "https://<your-pages-domain>/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

**Claude Code** (add to project or global MCP config):
```json
{
  "mcpServers": {
    "repo-dashboard": {
      "type": "http",
      "url": "https://<your-pages-domain>/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-token>"
      }
    }
  }
}
```

Replace `<your-pages-domain>` with the actual Cloudflare Pages URL and `<your-token>` with the value of `MCP_SECRET_TOKEN`.

### Example tool calls (curl)

```bash
TOKEN="your-secret-token"
BASE="https://<your-pages-domain>/api/mcp"

# List tools
curl -s -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Log a task
curl -s -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"log_task","arguments":{"description":"Drafted grant narrative intro","okr_id":"KR-1.1","time_spent":"1.5h"}}}'

# Check progress
curl -s -X POST "$BASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_okr_progress","arguments":{}}}'
```

## Pipeline / Kanban view

The **Pipeline** tab shows OKR micro-tasks (`tasks` table) as a Kanban board: **In Progress → To Do → Done**.

- Frontend: `public/js/app.js` `renderPipeline()`, styles in `public/styles.css` under "Pipeline / Kanban board".
- REST: `GET /api/tasks` (open), `PUT /api/tasks/:id` (write-auth) — implemented in `functions/api/tasks.js` and `functions/api/tasks/[id].js`.
- Clicking **Advance** on a card calls `PUT /api/tasks/:id` with the next status; the server auto-stamps `started_at` / `completed_at`.
- The OKR filter dropdown at top-right filters all three columns simultaneously.
- Migration `db/migrations/0003_task_timestamps.sql` (applied to production D1) adds `started_at TEXT` and `completed_at TEXT` to the `tasks` table.

## Header focus strip (current priority micro-task)

A strip under the topbar (`#focus-strip`, `renderFocusStrip()` in `public/js/app.js`) shows the current OKR micro-task from `pipelineTasks`: In Progress tasks (oldest `started_at` first), falling back to the next unblocked To Do ("Up next"). Hidden when there is nothing to show or `/api/tasks` failed.

- Two designs under test: `simple` (read-only; click → Pipeline tab) and `interactive` (‹ › cycling, inline Start/Done via `PUT /api/tasks/:id`, attention-responsive visuals). Pick with `?header=simple|interactive` or the ◐ toggle; the choice is remembered in `localStorage.focusStripMode`.
- Attention signals (interactive only): pointer proximity to the header sets `window.headerAttention.level`, which `public/js/tunnel.js` reads to speed up/brighten the rings; idle >90s makes the strip "breathe"; returning to the tab after >60s plays a wave and a tunnel flare (`headerAttention.pulseAt`). CSS animations respect `prefers-reduced-motion`.
- Any code that reloads `pipelineTasks` should call `renderFocusStrip()` afterwards.

## Task search modal

OKR/Pipeline micro-task text (Today tab OKR rows, OKR Progress task lists and "today" list, Pipeline cards) is rendered with `taskLink(text, id)` in `public/js/app.js`. Clicking one opens `#task-search-modal` (a native `<dialog>` in `public/index.html`), which searches the data the page has already loaded (OKR tasks, OKRs, work items, repos, resources). It runs fully client-side with no API call. Matching is per-word with stopwords removed and prefix matching (≥4 chars). The clicked task is left out of its own results. Clicking a result switches to the relevant tab, or opens the repo on GitHub. Styles live under "Task search" in `public/styles.css`. The focus strip keeps its own click behavior and is not linked.

## What's NOT built yet (as of last update)

- Open PR/branch data is not surfaced on repo cards — only manually-logged `work_items` rows.
- Write auth uses `WRITE_TOKEN` (local dev) and Cloudflare Access (production). `functions/_shared/auth.js` checks the `Cf-Access-Authenticated-User-Email` header first; if present, the user is considered authenticated. If absent (local dev), it falls back to `WRITE_TOKEN` bearer-token check. Read endpoints remain open.
