import { requireWriteAuth } from "../../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest({ request, env, params }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const authError = requireWriteAuth(request, env);
  if (authError) return authError;

  const id = parseInt(params.id, 10);
  if (!id) {
    return new Response(JSON.stringify({ error: "Invalid id" }), { status: 400, headers: CORS });
  }

  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); }
    catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

    const { name, category, utilization, notes } = body;
    if (!name || !category || !utilization) {
      return new Response(JSON.stringify({ error: "name, category, and utilization are required" }), { status: 400, headers: CORS });
    }

    const row = await env.DB
      .prepare(
        `UPDATE resources SET name=?, category=?, utilization=?, notes=?, updated_at=CURRENT_TIMESTAMP
         WHERE id=? RETURNING *`
      )
      .bind(name, category, utilization, notes || null, id)
      .first();

    if (!row) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
    return new Response(JSON.stringify(row), { headers: CORS });
  }

  if (request.method === "DELETE") {
    const existing = await env.DB.prepare("SELECT id FROM resources WHERE id=?").bind(id).first();
    if (!existing) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
    await env.DB.prepare("DELETE FROM resources WHERE id=?").bind(id).run();
    return new Response(JSON.stringify({ deleted: id }), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
}
