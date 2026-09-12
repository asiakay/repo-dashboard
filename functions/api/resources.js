import { requireWriteAuth } from "../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT * FROM resources
       ORDER BY
         CASE utilization
           WHEN 'abundant'  THEN 0
           WHEN 'underused' THEN 1
           WHEN 'active'    THEN 2
           WHEN 'depleted'  THEN 3
           ELSE 4
         END, name ASC`
    ).all();
    return new Response(JSON.stringify(results), { headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  const authError = requireWriteAuth(request, env);
  if (authError) return authError;

  let body;
  try { body = await request.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

  const { name, category, utilization = "unknown", notes } = body;

  if (!name || !category) {
    return new Response(JSON.stringify({ error: "name and category are required" }), { status: 400, headers: CORS });
  }

  const row = await env.DB
    .prepare("INSERT INTO resources (name, category, utilization, notes) VALUES (?, ?, ?, ?) RETURNING *")
    .bind(name, category, utilization, notes || null)
    .first();

  return new Response(JSON.stringify(row), { status: 201, headers: CORS });
}
