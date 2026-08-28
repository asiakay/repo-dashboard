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

## OKR & Task Tracker (MCP integration)

### New files
- `db/migrations/0002_okr_task_tracker.sql` — D1 migration adding `okrs` and `tasks` tables.
- `functions/api/mcp.js` — JSON-RPC 2.0 MCP endpoint at `/api/mcp`.

### New D1 tables

```sql
-- Strategic objectives / key results
CREATE TABLE okrs (
    id TEXT PRIMARY KEY,              -- e.g. 'KR-1.1'
    objective TEXT NOT NULL,          -- high-level goal title
    key_result TEXT NOT NULL,         -- measurable outcome
    target_date TEXT,                 -- YYYY-MM-DD or 'Ongoing'
    status TEXT CHECK(status IN ('Planned','In Progress','In Review','Completed'))
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
| `register_okr` | `id`, `objective`, `key_result` | Create or update an OKR |

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

## What's NOT built yet (as of last update)

- Open PR/branch data is not surfaced on repo cards — only manually-logged `work_items` rows.
- No auth on the work-items API — anyone with the URL can read/write. Fine for personal use, worth revisiting if this is ever shared beyond Asia.
- The OKR/tasks data is not yet surfaced in the dashboard frontend — it's API + MCP only at this stage.
