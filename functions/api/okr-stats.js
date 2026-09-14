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
                o.created_at,
                COALESCE(o.category, 'project') AS category,
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
         ORDER BY o.category, o.id`
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
    // Attach OKR-level dependencies (soft-fail if table not yet created)
    try {
      const { results: deps } = await env.DB.prepare(
        `SELECT od.okr_id, od.depends_on_okr_id, o.objective AS dep_objective
         FROM okr_dependencies od
         JOIN okrs o ON o.id = od.depends_on_okr_id`
      ).all();
      const depsMap = {};
      for (const d of deps) (depsMap[d.okr_id] = depsMap[d.okr_id] || []).push(d);
      okrs = okrs.map(o => ({ ...o, deps: depsMap[o.id] || [] }));
    } catch {
      okrs = okrs.map(o => ({ ...o, deps: [] }));
    }
  } catch {
    // Tables don't exist yet — apply the schema inline and retry (no wrangler CLI needed).
    try {
      await env.DB.exec(`
        CREATE TABLE IF NOT EXISTS okrs (
          id TEXT PRIMARY KEY,
          objective TEXT NOT NULL,
          key_result TEXT NOT NULL,
          target_date TEXT,
          status TEXT CHECK(status IN ('Planned','In Progress','In Review','Completed')) DEFAULT 'In Progress',
          created_at TEXT DEFAULT NULL,
          category TEXT DEFAULT 'project' CHECK(category IN ('project','education','life_admin','health','financial','other'))
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
                  o.created_at,
                  COALESCE(o.category, 'project') AS category,
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
           ORDER BY o.category, o.id`
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
      okrs = okrResult2.results.map(o => ({ ...o, deps: [] }));
      tasks = taskResult2.results;
    } catch {
      // exec() itself failed — D1 binding misconfigured or unknown error.
      return new Response(
        JSON.stringify({ okrs: [], today: { date: today, tasks: [] }, migration_pending: true }),
        { headers: CORS }
      );
    }
  }

  // Augment education OKRs with assignment-based progress (soft-fail)
  try {
    const { results: asnStats } = await env.DB.prepare(`
      SELECT
        okr_id,
        COUNT(*)                                                           AS total_assignments,
        SUM(CASE WHEN status IN ('Submitted','Graded') THEN 1 ELSE 0 END) AS completed_assignments,
        MIN(CASE WHEN status NOT IN ('Submitted','Graded')
                  AND due_date >= DATE('now')
                 THEN due_date END)                                        AS next_due_date
      FROM assignments
      WHERE okr_id IS NOT NULL
      GROUP BY okr_id
    `).all();
    const asnMap = {};
    for (const a of asnStats) asnMap[a.okr_id] = a;
    okrs = okrs.map(o => {
      const asn = asnMap[o.id];
      if (!asn || asn.total_assignments === 0) return o;
      const pct = Math.round(1000 * asn.completed_assignments / asn.total_assignments) / 10;
      return {
        ...o,
        has_assignments: true,
        total_assignments: asn.total_assignments,
        completed_assignments: asn.completed_assignments,
        total_tasks: asn.total_assignments,
        done_tasks: asn.completed_assignments,
        completion_pct: pct,
        next_due_date: asn.next_due_date || null,
      };
    });
  } catch {
    // assignments table not present — skip silently
  }

  return new Response(
    JSON.stringify({ okrs, today: { date: today, tasks } }),
    { headers: CORS }
  );
}
