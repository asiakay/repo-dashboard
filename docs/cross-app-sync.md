# Cross-App Sync: masshealth-crm → repo-dashboard MCP

## Problem

Checking a repatriation stage in masshealth-crm and logging a task against the matching DAD-N OKR in repo-dashboard are currently two disconnected manual steps. This note describes the smallest mechanism to wire them together.

## Proposed mechanism (not yet built)

When the user checks a stage checkbox in masshealth-crm, in addition to the existing `saveState()` call, fire a `log_task` call to repo-dashboard's `/api/mcp` endpoint:

```js
// Inside the repatriation stage checkbox handler, after saveState():
async function logStageToRepoDash(stageNumber, stageTitle) {
  const mcpUrl = (window.REPODASH_MCP_URL || '').trim();
  const mcpToken = (window.REPODASH_MCP_TOKEN || '').trim();
  if (!mcpUrl) return; // no-op when not configured

  const headers = { 'Content-Type': 'application/json' };
  if (mcpToken) headers['Authorization'] = `Bearer ${mcpToken}`;

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
            description: `Repatriation stage ${stageNumber} completed: ${stageTitle}`,
            okr_id: `DAD-${stageNumber}`,
          },
        },
      }),
    });
  } catch (e) {
    console.warn('[repodash sync]', e.message); // silent failure — stage save already succeeded
  }
}
```

## Configuration in index.html

Add two new globals alongside `MASSHEALTH_WORKER_URL`:

```html
<script>
  window.MASSHEALTH_WORKER_URL  = 'https://masshealth-crm-api.asialakaygrady-6d4.workers.dev';
  window.MASSHEALTH_WRITE_TOKEN = ''; // masshealth-crm WRITE_TOKEN
  window.REPODASH_MCP_URL       = 'https://repo-dashboard.pages.dev/api/mcp';
  window.REPODASH_MCP_TOKEN     = ''; // repo-dashboard MCP_SECRET_TOKEN (if set)
</script>
```

## Failure mode

The `fetch` call is fire-and-forget and wrapped in try/catch. If it fails (network, 401, timeout), the stage checkbox save still succeeds — the user's D1 record is never blocked by a cross-app call.

## OKR mapping

| Stage checkbox | okr_id |
|---------------|--------|
| Stage 1 | DAD-1 |
| Stage 2 | DAD-2 |
| Stage 3 | DAD-3 |
| Stage 4 | DAD-4 |
| Stage 5 | DAD-5 |
| Stage 6 | DAD-6 |
| Stage 7 | DAD-7 |
| (no checkbox — guardianship track) | DAD-8 — log manually via MCP or OKR Progress tab |

## What this is NOT

- No webhook, no queue, no polling. One outbound fetch per checkbox interaction.
- No bi-directional sync. repo-dashboard does not write back to masshealth-crm.
- Not built yet. This note is the design gate before implementation.

## Next step to build it

1. Add `logStageToRepoDash` as above to the stage checkbox handler in `masshealth-crm/index.html`.
2. Add `REPODASH_MCP_URL` and `REPODASH_MCP_TOKEN` globals.
3. If `MCP_SECRET_TOKEN` is not set on repo-dashboard, the endpoint is open and no token is needed.
