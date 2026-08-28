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
    // Tables don't exist yet — migration hasn't been applied to the remote D1 database.
    return new Response(
      JSON.stringify({ okrs: [], today: { date: today, tasks: [] }, migration_pending: true }),
      { headers: CORS }
    );
  }

  return new Response(
    JSON.stringify({ okrs, today: { date: today, tasks } }),
    { headers: CORS }
  );
}
