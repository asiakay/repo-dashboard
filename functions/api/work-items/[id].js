import { requireWriteAuth } from "../../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === "PUT") {
    const authError = requireWriteAuth(request, env);
    if (authError) return authError;

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS });
    }

    const allowed = ["status", "notes", "started_at", "completed_at", "task_description", "assigned_to", "depends_on_repo", "manual_consequence_override"];
    const fields = Object.keys(body).filter(k => allowed.includes(k));

    if (!fields.length) {
      return new Response(JSON.stringify({ error: "No valid fields to update" }), { status: 400, headers: CORS });
    }

    // Server-side auto-stamp: inject timestamps based on status transition
    // unless the client explicitly sent a value for that field.
    if (body.status && !fields.includes("started_at") && !fields.includes("completed_at")) {
      if (body.status === "in_progress") {
        // Preserve existing started_at; only stamp on first in_progress transition.
        // Resolved via COALESCE in the SET clause (needs a sub-select to read current value).
        // Simpler: fetch current row first, then stamp only if null.
        const current = await env.DB.prepare("SELECT started_at FROM work_items WHERE id = ?").bind(id).first();
        if (current && !current.started_at) {
          fields.push("started_at");
          body.started_at = new Date().toISOString();
        }
      } else if (body.status === "done") {
        fields.push("completed_at");
        body.completed_at = new Date().toISOString();
      } else if (body.status === "not_started" || body.status === "blocked") {
        fields.push("completed_at");
        body.completed_at = null;
      }
    }

    const setClauses = fields.map(f => `${f} = ?`).join(", ");
    const values = fields.map(f => body[f] ?? null);

    await env.DB.prepare(`UPDATE work_items SET ${setClauses} WHERE id = ?`)
      .bind(...values, id)
      .run();

    const updated = await env.DB.prepare("SELECT * FROM work_items WHERE id = ?").bind(id).first();

    if (!updated) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
    }

    return new Response(JSON.stringify(updated), { headers: CORS });
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
}
