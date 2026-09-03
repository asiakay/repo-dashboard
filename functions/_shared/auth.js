function unauthorized() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "WWW-Authenticate": "Bearer",
    },
  });
}

// Returns the Cloudflare Access authenticated email, or null if not present.
export function getCallerIdentity(request) {
  return request.headers.get("Cf-Access-Authenticated-User-Email") || null;
}

// Returns a 401 Response if the request fails auth, or null if it passes.
// Auth priority:
//   1. Cloudflare Access header (production — CF Access already authenticated the user at the edge)
//   2. WRITE_TOKEN bearer token (local dev fallback)
// When neither is configured, all requests are allowed (opt-in).
export function requireWriteAuth(request, env) {
  const cfEmail = getCallerIdentity(request);
  if (cfEmail) return null;

  if (!env.WRITE_TOKEN) return null;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  return token === env.WRITE_TOKEN ? null : unauthorized();
}
