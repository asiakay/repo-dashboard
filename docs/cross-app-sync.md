# Cross-App Sync: masshealth-crm → repo-dashboard MCP

## Problem

Checking a repatriation stage in masshealth-crm and logging a task against the matching DAD-N OKR in repo-dashboard are currently two disconnected manual steps. This note describes the correct mechanism to wire them together.

## Architecture: worker-proxied, not client-side

**The MCP bearer token must never appear in client-side JavaScript globals.** A value set as `window.REPODASH_MCP_TOKEN` in `index.html` reaches every visitor's browser, is extractable from DevTools, and authorizes `log_task` / `register_okr` on a CORS-open endpoint from anywhere. That is a P1 exposure.

The correct flow routes through the masshealth-crm worker — a trusted server environment where env secrets are safe:

```
Browser (masshealth-crm frontend)
  └─ POST /api/repodash/log-stage   (authenticated with WRITE_TOKEN)
       ↓
  masshealth-crm Worker (Cloudflare Worker)
       └─ POST /api/mcp             (authenticated with REPODASH_MCP_TOKEN env secret)
            ↓
  repo-dashboard Pages Function
```

The browser never sees `REPODASH_MCP_TOKEN`. The worker holds it as a `wrangler secret`.

## Worker-side endpoint (to build in masshealth-crm/worker/index.js)

```js
// POST /api/repodash/log-stage
// Body: { stage: number, stage_title: string }
// Auth: WRITE_TOKEN (already required on all write routes)
// Env: REPODASH_MCP_URL, REPODASH_MCP_TOKEN (wrangler secrets)
if (path === '/api/repodash/log-stage' && method === 'POST') {
  const { stage, stage_title } = await request.json();
  const mcpUrl = (env.REPODASH_MCP_URL || '').trim();
  if (mcpUrl && stage) {
    const headers = { 'Content-Type': 'application/json' };
    if (env.REPODASH_MCP_TOKEN) headers['Authorization'] = `Bearer ${env.REPODASH_MCP_TOKEN}`;
    try {
      await fetch(mcpUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'log_task',
            arguments: {
              description: `Repatriation stage ${stage} completed: ${stage_title}`,
              okr_id: `DAD-${stage}`,
            },
          },
        }),
      });
    } catch (e) {
      // Silent failure — stage save already succeeded; MCP log is best-effort
      console.warn('[repodash sync]', e.message);
    }
  }
  return json({ ok: true });
}
```

## Browser-side call (in masshealth-crm/index.html)

Replace the direct `/api/mcp` fetch with a call through the worker:

```js
// Inside the repatriation stage checkbox handler, after saveState():
async function logStageToRepoDash(stageNumber, stageTitle) {
  // Routes through the worker — MCP token never touches the browser.
  await d1Fetch('/api/repodash/log-stage', 'POST', {
    stage: stageNumber,
    stage_title: stageTitle,
  });
  // d1Fetch is already silent on failure.
}
```

## Configuration

**masshealth-crm worker env secrets** (set via Cloudflare dashboard or `wrangler secret put`):

| Secret | Value |
|--------|-------|
| `REPODASH_MCP_URL` | `https://repo-dashboard.pages.dev/api/mcp` |
| `REPODASH_MCP_TOKEN` | value of repo-dashboard's `MCP_SECRET_TOKEN` (if set) |

**Nothing new goes in `index.html`** — no `window.REPODASH_MCP_URL`, no `window.REPODASH_MCP_TOKEN`.

## OKR mapping

| Stage checkbox | okr_id sent to log_task |
|---------------|------------------------|
| Stage 1 | DAD-1 |
| Stage 2 | DAD-2 |
| Stage 3 | DAD-3 |
| Stage 4 | DAD-4 |
| Stage 5 | DAD-5 |
| Stage 6 | DAD-6 |
| Stage 7 | DAD-7 |
| (no checkbox — guardianship track) | DAD-8 — log manually via MCP or OKR Progress tab |

## Failure mode

The worker's fetch to `/api/mcp` is fire-and-forget, wrapped in try/catch. If it fails (network, auth, timeout), `POST /api/repodash/log-stage` still returns `{ ok: true }` — the stage save is never blocked by a cross-app call.

## What this is NOT

- No webhook, no queue, no polling. One server-side fetch per checkbox interaction.
- No bi-directional sync. repo-dashboard does not write back to masshealth-crm.

## Status

**Built.** Both the worker route and the browser-side call are in `masshealth-crm` main.

Remaining one-time setup (Cloudflare dashboard):
1. Set `REPODASH_MCP_URL` and `REPODASH_MCP_TOKEN` as worker secrets on `masshealth-crm-api`.
2. Optionally set `MCP_SECRET_TOKEN` on the repo-dashboard Pages project to lock the MCP endpoint.
