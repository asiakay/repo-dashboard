const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Agent decision feed. A Claude Code session GETs this at start to know what to work on.
// Returns the top-priority agent tasks with full context so an agent can act autonomously.
export async function onRequest(context) {
  const { env, request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  // Load repo health from the static JSON (written hourly by GitHub Actions)
  let repoHealthMap = {};
  try {
    // In Pages Functions, static assets aren't directly readable; we fetch from self.
    const url = new URL(request.url);
    const reposRes = await fetch(`${url.origin}/data/repos.json`);
    if (reposRes.ok) {
      const reposData = await reposRes.json();
      const repos = Array.isArray(reposData) ? reposData : (reposData.repos || []);
      for (const r of repos) {
        repoHealthMap[r.name] = { health: r.health, open_issues: r.open_issues };
      }
    }
  } catch {
    // Health data is optional — proceed without it
  }

  // Fetch actionable agent tasks, prioritized:
  //   1. in_progress first (resume before starting new work)
  //   2. github_issue-sourced before manual (structured context available)
  //   3. oldest first within each group (respect queue order)
  const { results } = await env.DB.prepare(`
    SELECT * FROM work_items
    WHERE assigned_to = 'agent' AND status IN ('not_started', 'in_progress')
    ORDER BY
      CASE status WHEN 'in_progress' THEN 0 ELSE 1 END,
      CASE WHEN source_type = 'github_issue' THEN 0 ELSE 1 END,
      id ASC
    LIMIT 10
  `).all();

  // Attach repo health context to each task
  const queue = results.map(item => ({
    ...item,
    repo_health: repoHealthMap[item.repo_name] || null,
  }));

  const nextTask = queue[0] || null;

  return new Response(JSON.stringify({
    queue_depth: queue.length,
    next_task: nextTask,
    queue,
    generated_at: new Date().toISOString(),
    instructions: [
      "1. Pick `next_task` — it is the highest-priority item.",
      "2. If `next_task.source_url` is set, read that GitHub issue for full context before starting.",
      "3. Signal start: PUT /api/work-items/{next_task.id} with {status:'in_progress', started_at:'<ISO timestamp>'}.",
      "4. After completing: PUT /api/work-items/{next_task.id} with {status:'done', completed_at:'<ISO timestamp>', notes:'<brief summary>'}.",
      "5. If blocked: PUT with {status:'blocked', notes:'<reason>'}.",
    ].join(" "),
  }), { headers: CORS });
}
