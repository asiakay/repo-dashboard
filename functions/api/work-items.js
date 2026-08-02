const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT * FROM work_items ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 WHEN 'not_started' THEN 2 ELSE 3 END, repo_name ASC"
    ).all();
    return new Response(JSON.stringify(results), { headers: CORS });
  }

  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
    }

    const {
      repo_name, task_description, status, assigned_to,
      depends_on_repo, started_at, completed_at, notes,
      source_type, source_url, github_issue_number,
    } = body;

    if (!repo_name || !task_description || !status || !assigned_to) {
      return new Response(JSON.stringify({ error: "Missing required fields: repo_name, task_description, status, assigned_to" }), { status: 400, headers: CORS });
    }

    // If github_issue_number is present, upsert by (repo_name, github_issue_number).
    // Never downgrade a task that's already 'done' — the sync respects manual completions.
    if (github_issue_number != null) {
      const result = await env.DB.prepare(`
        INSERT INTO work_items
          (repo_name, task_description, status, assigned_to, depends_on_repo,
           started_at, completed_at, notes, source_type, source_url, github_issue_number)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(repo_name, github_issue_number) DO UPDATE SET
          task_description = excluded.task_description,
          source_url       = excluded.source_url,
          notes            = CASE WHEN work_items.notes IS NULL OR work_items.source_type = 'github_issue'
                                  THEN excluded.notes ELSE work_items.notes END,
          status           = CASE WHEN work_items.status = 'done' THEN 'done' ELSE excluded.status END
        RETURNING *
      `).bind(
        repo_name, task_description, status, assigned_to, depends_on_repo || null,
        started_at || null, completed_at || null, notes || null,
        source_type || 'github_issue', source_url || null, github_issue_number
      ).first();

      return new Response(JSON.stringify(result), { status: 201, headers: CORS });
    }

    // Regular manual insert
    const result = await env.DB.prepare(
      `INSERT INTO work_items
         (repo_name, task_description, status, assigned_to, depends_on_repo,
          started_at, completed_at, notes, source_type, source_url, github_issue_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
    ).bind(
      repo_name, task_description, status, assigned_to, depends_on_repo || null,
      started_at || null, completed_at || null, notes || null,
      source_type || 'manual', source_url || null, null
    ).first();

    return new Response(JSON.stringify(result), { status: 201, headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
}
