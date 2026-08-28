const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  // Ensure repo_name column exists (no-op if already present).
  try {
    await env.DB.exec(`ALTER TABLE tasks ADD COLUMN repo_name TEXT`);
  } catch { /* duplicate column — expected after first run */ }

  try {
    const [taskRows, workItemRows] = await Promise.all([
      env.DB.prepare(`
        SELECT repo_name,
               COUNT(id)                                              AS total_tasks,
               SUM(CASE WHEN status = 'Done' THEN 1 ELSE 0 END)     AS done_tasks,
               GROUP_CONCAT(DISTINCT okr_id)                         AS linked_okrs
        FROM tasks
        WHERE repo_name IS NOT NULL
        GROUP BY repo_name
        ORDER BY total_tasks DESC
      `).all(),
      env.DB.prepare(`
        SELECT repo_name,
               COUNT(id)                                                                    AS work_items,
               SUM(CASE WHEN status IN ('not_started','in_progress','blocked') THEN 1 ELSE 0 END) AS open_work_items
        FROM work_items
        GROUP BY repo_name
      `).all(),
    ]);

    // Merge by repo_name — union of both sets.
    const byRepo = {};
    for (const row of taskRows.results) {
      byRepo[row.repo_name] = {
        repo_name: row.repo_name,
        total_tasks: row.total_tasks,
        done_tasks: row.done_tasks,
        linked_okrs: row.linked_okrs || null,
        work_items: 0,
        open_work_items: 0,
      };
    }
    for (const row of workItemRows.results) {
      if (byRepo[row.repo_name]) {
        byRepo[row.repo_name].work_items = row.work_items;
        byRepo[row.repo_name].open_work_items = row.open_work_items;
      } else {
        byRepo[row.repo_name] = {
          repo_name: row.repo_name,
          total_tasks: 0,
          done_tasks: 0,
          linked_okrs: null,
          work_items: row.work_items,
          open_work_items: row.open_work_items,
        };
      }
    }

    return new Response(JSON.stringify(Object.values(byRepo)), { headers: CORS });
  } catch {
    return new Response(JSON.stringify([]), { headers: CORS });
  }
}
