import { requireWriteAuth } from "../../_shared/auth.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Called by the GitHub Actions sync when a labeled issue is closed.
// Marks the corresponding work_item done without overwriting manual completions.
export async function onRequest(context) {
  const { request, env } = context;

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

  const { repo_name, github_issue_number } = body;
  if (!repo_name || github_issue_number == null) {
    return new Response(JSON.stringify({ error: "repo_name and github_issue_number are required" }), { status: 400, headers: CORS });
  }

  const result = await env.DB.prepare(
    `UPDATE work_items
     SET status = 'done', completed_at = datetime('now')
     WHERE repo_name = ? AND github_issue_number = ? AND status != 'done'`
  ).bind(repo_name, github_issue_number).run();

  return new Response(JSON.stringify({ ok: true, changes: result.meta?.changes ?? 0 }), { headers: CORS });
}
