import { requireWriteAuth } from "../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

async function insertTask(env, { description, okr_id, time_spent, status, notes, repo_name }) {
  const sql = "INSERT INTO tasks (description,okr_id,time_spent,status,notes,repo_name) VALUES (?,?,?,?,?,?) RETURNING *";
  const binds = [description, okr_id, time_spent || null, status, notes || null, repo_name || null];
  try {
    return await env.DB.prepare(sql).bind(...binds).first();
  } catch (err) {
    if (!String(err).includes("no such column")) throw err;
    // repo_name column not yet added — migrate then retry.
    await env.DB.exec(`ALTER TABLE tasks ADD COLUMN repo_name TEXT`);
    return env.DB.prepare(sql).bind(...binds).first();
  }
}

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === "GET") {
    const url = new URL(request.url);
    const filterStatus = url.searchParams.get("status");
    const filterOkr = url.searchParams.get("okr_id");

    let sql = `
      SELECT t.*,
             o.objective, o.key_result, o.status AS okr_status,
             dt.description AS blocked_by_desc, dt.status AS blocked_by_status
      FROM tasks t
      JOIN okrs o ON o.id = t.okr_id
      LEFT JOIN tasks dt ON dt.id = t.depends_on_task_id
    `;
    const binds = [];
    const conditions = [];
    if (filterStatus) { conditions.push("t.status = ?"); binds.push(filterStatus); }
    if (filterOkr)    { conditions.push("t.okr_id = ?"); binds.push(filterOkr); }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY CASE t.status WHEN 'In Progress' THEN 0 WHEN 'To Do' THEN 1 ELSE 2 END, t.okr_id, t.id";

    const { results } = await env.DB.prepare(sql).bind(...binds).all();

    // When filtering by OKR, also return assignments linked to that OKR (soft-fail)
    if (filterOkr) {
      let asnRows = [];
      try {
        const { results: asns } = await env.DB.prepare(`
          SELECT a.id, a.title AS description, a.due_date, a.status, a.notes,
                 a.course_id, a.deliverable_type, a.weight_pct, a.okr_id,
                 1 AS is_assignment, c.name AS course_name
          FROM assignments a
          LEFT JOIN courses c ON c.id = a.course_id
          WHERE a.okr_id = ?
          ORDER BY a.due_date ASC NULLS LAST
        `).bind(filterOkr).all();
        asnRows = asns;
      } catch {
        // assignments table not present
      }
      return new Response(JSON.stringify([...asnRows, ...results]), { headers: CORS });
    }

    return new Response(JSON.stringify(results), { headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const authError = requireWriteAuth(request, env);
  if (authError) return authError;

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
  }

  const { description, okr_id, time_spent, status = "Done", notes, repo_name } = body;

  if (!description || !okr_id) {
    return new Response(
      JSON.stringify({ error: "description and okr_id are required" }),
      { status: 400, headers: CORS }
    );
  }

  const okr = await env.DB.prepare("SELECT id FROM okrs WHERE id = ?").bind(okr_id).first();
  if (!okr) {
    return new Response(
      JSON.stringify({ error: `OKR '${okr_id}' not found` }),
      { status: 400, headers: CORS }
    );
  }

  const task = await insertTask(env, { description, okr_id, time_spent, status, notes, repo_name });
  return new Response(JSON.stringify(task), { status: 201, headers: CORS });
}
