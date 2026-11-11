import { requireWriteAuth } from "../_shared/auth.js";
import { listProjects, upsertProject, PROJECT_STATUSES } from "../_shared/projects.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: CORS });

// GET  /api/projects[?status=live]  → all project cards
// POST /api/projects                → create, or update the card with the same slug
export async function onRequest({ request, env }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (request.method === "GET") {
    const status = new URL(request.url).searchParams.get("status");
    if (status && !PROJECT_STATUSES.includes(status)) {
      return json({ error: `status must be one of: ${PROJECT_STATUSES.join(", ")}` }, 400);
    }
    return json(await listProjects(env.DB, { status }));
  }

  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authError = await requireWriteAuth(request, env);
  if (authError) return authError;

  let body;
  try { body = await request.json(); }
  catch { return json({ error: "Invalid JSON" }, 400); }

  try {
    const result = await upsertProject(env.DB, body);
    if (result.error) return json({ error: result.error }, result.status);
    return json(result.row, result.created ? 201 : 200);
  } catch (err) {
    if (/UNIQUE/i.test(String(err && err.message))) return json({ error: "Another project already uses that slug" }, 409);
    throw err;
  }
}
