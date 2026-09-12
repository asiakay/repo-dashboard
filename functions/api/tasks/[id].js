import { requireWriteAuth } from "../../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const VALID_STATUSES = ["To Do", "In Progress", "Done"];

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "PUT") {
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

  const { status, notes, time_spent } = body;

  if (status && !VALID_STATUSES.includes(status)) {
    return new Response(JSON.stringify({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }), { status: 400, headers: CORS });
  }

  const current = await env.DB.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first();
  if (!current) {
    return new Response(JSON.stringify({ error: "Task not found" }), { status: 404, headers: CORS });
  }

  const now = new Date().toISOString();
  const fields = [];
  const values = [];

  if (status && status !== current.status) {
    fields.push("status"); values.push(status);
    if (status === "In Progress" && !current.started_at) {
      fields.push("started_at"); values.push(now);
    }
    if (status === "Done") {
      if (!current.started_at) { fields.push("started_at"); values.push(now); }
      fields.push("completed_at"); values.push(now);
    }
    if (status === "To Do") {
      fields.push("started_at");   values.push(null);
      fields.push("completed_at"); values.push(null);
    }
  }

  if (notes !== undefined) {
    const merged = notes
      ? (current.notes ? `${current.notes}\n${notes}` : notes)
      : current.notes;
    fields.push("notes"); values.push(merged);
  }

  if (time_spent !== undefined) { fields.push("time_spent"); values.push(time_spent); }

  if (!fields.length) {
    return new Response(JSON.stringify(current), { headers: CORS });
  }

  const setClauses = fields.map(f => `${f} = ?`).join(", ");
  await env.DB.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ?`).bind(...values, id).run();

  const updated = await env.DB.prepare(
    "SELECT t.*, o.objective, o.key_result FROM tasks t JOIN okrs o ON o.id = t.okr_id WHERE t.id = ?"
  ).bind(id).first();

  return new Response(JSON.stringify(updated), { headers: CORS });
}
