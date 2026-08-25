const UNAUTHORIZED = new Response(JSON.stringify({ error: "Unauthorized" }), {
  status: 401,
  headers: {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "WWW-Authenticate": "Bearer",
  },
});

// Returns a 401 Response if the request fails auth, or null if it passes.
// When WRITE_TOKEN is not configured, all requests are allowed (opt-in).
export function requireWriteAuth(request, env) {
  if (!env.WRITE_TOKEN) return null;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return token === env.WRITE_TOKEN ? null : UNAUTHORIZED;
}
