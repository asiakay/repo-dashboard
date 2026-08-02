const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  const id = params.id;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method === "PUT") {
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
