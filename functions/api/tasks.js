import { requireWriteAuth } from "../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
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

  const { description, okr_id, time_spent, status = "Done", notes } = body;

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

  const task = await env.DB.prepare(
    "INSERT INTO tasks (description,okr_id,time_spent,status,notes) VALUES (?,?,?,?,?) RETURNING *"
  ).bind(description, okr_id, time_spent || null, status, notes || null).first();

  return new Response(JSON.stringify(task), { status: 201, headers: CORS });
}
