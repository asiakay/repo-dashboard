import { requireWriteAuth } from "../../_shared/auth.js";
import { normalizeProject, updateProject } from "../../_shared/projects.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });

// GET    /api/projects/:id  → one card
// PUT    /api/projects/:id  → partial update (only the keys sent change)
// DELETE /api/projects/:id
export async function onRequest({ request, env, params }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const id = parseInt(params.id, 10);
  if (!id) return json({ error: "Invalid id" }, 400);

  if (request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
    return row ? json(row) : json({ error: "Not found" }, 404);
  }

  const authError = await requireWriteAuth(request, env);
  if (authError) return authError;

  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); }
    catch { return json({ error: "Invalid JSON" }, 400); }

    const { error, fields } = normalizeProject(body, { partial: true });
    if (error) return json({ error }, 400);

    try {
      const row = await updateProject(env.DB, id, fields);
      return row ? json(row) : json({ error: "Not found" }, 404);
    } catch (err) {
      if (/UNIQUE/i.test(String(err && err.message))) return json({ error: "Another project already uses that slug" }, 409);
      throw err;
    }
  }

  if (request.method === "DELETE") {
    const existing = await env.DB.prepare("SELECT id FROM projects WHERE id = ?").bind(id).first();
    if (!existing) return json({ error: "Not found" }, 404);
    await env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
    return json({ deleted: id });
  }

  return json({ error: "Method not allowed" }, 405);
}
