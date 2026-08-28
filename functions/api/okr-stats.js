const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const today = new Date().toISOString().slice(0, 10);

  let okrs = [], tasks = [];
  try {
    const [okrResult, taskResult] = await Promise.all([
      env.DB.prepare(
        `SELECT o.id,
                o.objective,
                o.key_result,
                o.target_date,
                o.status,
                COUNT(t.id) AS total_tasks,
                SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS done_tasks,
                ROUND(
                  CASE WHEN COUNT(t.id) = 0 THEN 0
                       ELSE 100.0 * SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) / COUNT(t.id)
                  END, 1
                ) AS completion_pct
         FROM okrs o
         LEFT JOIN tasks t ON t.okr_id = o.id
         GROUP BY o.id
         ORDER BY o.id`
      ).all(),
      env.DB.prepare(
        `SELECT t.id, t.date, t.description, t.okr_id, t.time_spent, t.status, t.notes, t.created_at,
                o.objective, o.key_result
         FROM tasks t
         JOIN okrs o ON o.id = t.okr_id
         WHERE t.date = ?
         ORDER BY t.created_at`
      ).bind(today).all(),
    ]);
    okrs = okrResult.results;
    tasks = taskResult.results;
  } catch {
    // Tables don't exist yet — apply the schema inline and retry (no wrangler CLI needed).
    try {
      await env.DB.exec(`
        CREATE TABLE IF NOT EXISTS okrs (
          id TEXT PRIMARY KEY,
          objective TEXT NOT NULL,
          key_result TEXT NOT NULL,
          target_date TEXT,
          status TEXT CHECK(status IN ('Planned','In Progress','In Review','Completed')) DEFAULT 'In Progress'
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL DEFAULT (DATE('now')),
          description TEXT NOT NULL,
          okr_id TEXT NOT NULL REFERENCES okrs(id) ON DELETE CASCADE,
          time_spent TEXT,
          status TEXT CHECK(status IN ('To Do','In Progress','Done')) DEFAULT 'Done',
          notes TEXT,
          repo_name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_okr_id ON tasks(okr_id);
        INSERT OR IGNORE INTO okrs (id,objective,key_result,target_date,status) VALUES
          ('KR-1.1','Anchor Funding','Cooperative Grant Application Package','2026-10-15','In Progress'),
          ('KR-1.2','Anchor Funding','Operating & Financial Budget Model','2026-11-01','Planned'),
          ('KR-2.1','Cohort Expansion','Pilot Community Training Cohort Launch','2026-11-15','Planned'),
          ('KR-3.1','Content Flywheel','Master Weekly Content Package Release','2026-09-30','In Progress'),
          ('KR-4.1','Operational Balance','Evening Reset Protocol Adherence','Ongoing','In Progress');
      `);
      const [okrResult2, taskResult2] = await Promise.all([
        env.DB.prepare(
          `SELECT o.id,
                  o.objective,
                  o.key_result,
                  o.target_date,
                  o.status,
                  COUNT(t.id) AS total_tasks,
                  SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS done_tasks,
                  ROUND(
                    CASE WHEN COUNT(t.id) = 0 THEN 0
                         ELSE 100.0 * SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) / COUNT(t.id)
                    END, 1
                  ) AS completion_pct
           FROM okrs o
           LEFT JOIN tasks t ON t.okr_id = o.id
           GROUP BY o.id
           ORDER BY o.id`
        ).all(),
        env.DB.prepare(
          `SELECT t.id, t.date, t.description, t.okr_id, t.time_spent, t.status, t.notes, t.created_at,
                  o.objective, o.key_result
           FROM tasks t
           JOIN okrs o ON o.id = t.okr_id
           WHERE t.date = ?
           ORDER BY t.created_at`
        ).bind(today).all(),
      ]);
      okrs = okrResult2.results;
      tasks = taskResult2.results;
    } catch {
      // exec() itself failed — D1 binding misconfigured or unknown error.
      return new Response(
        JSON.stringify({ okrs: [], today: { date: today, tasks: [] }, migration_pending: true }),
        { headers: CORS }
      );
    }
  }

  return new Response(
    JSON.stringify({ okrs, today: { date: today, tasks } }),
    { headers: CORS }
  );
}
