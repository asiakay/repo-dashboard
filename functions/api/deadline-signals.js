const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  let signals = [];
  try {
    const result = await env.DB.prepare("SELECT * FROM deadline_signals ORDER BY due_date ASC").all();
    signals = (result.results ?? []).map(sig => ({
      ...sig,
      affects_repos: JSON.parse(sig.affects_repos || "[]"),
    }));
  } catch {
    // Table doesn't exist yet — return empty until schema migration runs
  }

  return new Response(JSON.stringify(signals), { headers: CORS });
}
