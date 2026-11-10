// Shared authentication helpers for Pages Functions.
//
// Identity comes from Cloudflare Access, but only after verifying the signed
// Cf-Access-Jwt-Assertion JWT. The plain Cf-Access-Authenticated-User-Email
// header is never trusted on its own: any request that reaches a function
// without passing through Access (e.g. the *.pages.dev hostname or a bypass
// rule) can set it freely.
//
// Env vars:
//   CF_ACCESS_TEAM_DOMAIN – e.g. "myteam.cloudflareaccess.com"
//   CF_ACCESS_AUD         – the Access application's Audience (AUD) tag
//   WRITE_TOKEN           – bearer token for write endpoints (local dev / scripts)

const CERT_TTL_MS = 60 * 60 * 1000;
const FORCED_REFRESH_COOLDOWN_MS = 60 * 1000; // caps unknown-kid refetches (forged tokens)
const CLOCK_SKEW_S = 60;
const certCache = new Map(); // teamDomain → { keys: Map<kid, CryptoKey>, expires, fetchedAt }

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

function teamDomain(env) {
  return (env.CF_ACCESS_TEAM_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

// True when Cloudflare Access JWT verification is configured.
export function accessConfigured(env) {
  return !!(teamDomain(env) && env.CF_ACCESS_AUD);
}

// Constant-time string comparison (length difference still short-circuits the result,
// but not the loop).
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const len = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// True when the request carries `Authorization: Bearer <secret>` and secret is non-empty.
export function bearerMatches(request, secret) {
  if (!secret) return false;
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  return timingSafeEqual(auth.slice(7), secret);
}

function b64urlDecode(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(s)));
}

async function loadCerts(team, force = false) {
  const cached = certCache.get(team);
  if (cached && cached.expires > Date.now()) {
    if (!force || Date.now() - cached.fetchedAt < FORCED_REFRESH_COOLDOWN_MS) return cached.keys;
  }

  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access certs fetch failed: ${res.status}`);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    if (!jwk.kid || jwk.kty !== "RSA") continue;
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    map.set(jwk.kid, key);
  }
  certCache.set(team, { keys: map, expires: Date.now() + CERT_TTL_MS, fetchedAt: Date.now() });
  return map;
}

// Test hook: clears the module-level cert cache.
export function _resetAccessCertCache() {
  certCache.clear();
}

// Verifies the Cf-Access-Jwt-Assertion header. Returns the JWT payload when valid,
// otherwise null. Always null when Access verification is not configured.
export async function verifyAccessJwt(request, env) {
  if (!accessConfigured(env)) return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = decodeJson(parts[0]);
    const payload = decodeJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return null;

    const team = teamDomain(env);
    let keys = await loadCerts(team);
    if (!keys.has(header.kid)) keys = await loadCerts(team, true); // key rotation
    const key = keys.get(header.kid);
    if (!key) return null;

    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlDecode(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`)
    );
    if (!ok) return null;

    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.includes(env.CF_ACCESS_AUD)) return null;
    if (payload.iss !== `https://${team}`) return null;
    if (typeof payload.exp !== "number" || payload.exp < now - CLOCK_SKEW_S) return null;
    if (typeof payload.nbf === "number" && payload.nbf > now + CLOCK_SKEW_S) return null;

    return payload;
  } catch {
    return null;
  }
}

// Returns the verified Cloudflare Access identity (user email, or the service
// token's common_name), or null.
export async function getCallerIdentity(request, env) {
  const payload = await verifyAccessJwt(request, env || {});
  if (!payload) return null;
  return payload.email || payload.common_name || null;
}

// Returns a 401 Response if the request fails auth, or null if it passes.
// Auth priority:
//   1. Verified Cloudflare Access JWT (production)
//   2. WRITE_TOKEN bearer token (local dev / scripts)
// Open only when neither Access verification nor WRITE_TOKEN is configured (local dev).
export async function requireWriteAuth(request, env) {
  if (await getCallerIdentity(request, env)) return null;
  if (bearerMatches(request, env.WRITE_TOKEN)) return null;
  if (!env.WRITE_TOKEN && !accessConfigured(env)) return null;
  return unauthorized();
}
