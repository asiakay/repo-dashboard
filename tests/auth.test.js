import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import {
  verifyAccessJwt,
  getCallerIdentity,
  requireWriteAuth,
  timingSafeEqual,
  _resetAccessCertCache,
} from "../functions/_shared/auth.js";
import { onRequest as mcpHandler } from "../functions/api/mcp.js";
import { onRequest as meHandler } from "../functions/api/me.js";

const TEAM = "team.cloudflareaccess.com";
const AUD = "aud-tag-123";
const ENV = { CF_ACCESS_TEAM_DOMAIN: TEAM, CF_ACCESS_AUD: AUD };
const KID = "kid-1";

let signingKey;   // matches the published cert
let otherKey;     // not published — signatures must fail
let publicJwk;

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

async function sign(payload, { key = signingKey, kid = KID, alg = "RS256" } = {}) {
  const head = enc({ alg, kid, typ: "JWT" });
  const body = enc(payload);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`)
  );
  return `${head}.${body}.${b64url(new Uint8Array(sig))}`;
}

function claims(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: [AUD], iss: `https://${TEAM}`, email: "asia@example.com",
    iat: now, nbf: now, exp: now + 300, ...overrides,
  };
}

function reqWith(headers = {}, method = "POST", body = null) {
  return new Request("http://localhost/api/x", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeAll(async () => {
  const gen = () => crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]
  );
  const pair = await gen();
  signingKey = pair.privateKey;
  otherKey = (await gen()).privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: KID };
});

let fetchMock;
beforeEach(() => {
  _resetAccessCertCache();
  fetchMock = vi.fn(async (url) => {
    if (url === `https://${TEAM}/cdn-cgi/access/certs`) {
      return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("timingSafeEqual", () => {
  it("compares strings", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
    expect(timingSafeEqual(undefined, "")).toBe(false);
  });
});

describe("verifyAccessJwt", () => {
  it("accepts a valid token and returns its payload", async () => {
    const token = await sign(claims());
    const payload = await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV);
    expect(payload.email).toBe("asia@example.com");
  });

  it("caches certs across calls", async () => {
    const token = await sign(claims());
    await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV);
    await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a team domain given with https:// and a trailing slash", async () => {
    const token = await sign(claims());
    const env = { ...ENV, CF_ACCESS_TEAM_DOMAIN: `https://${TEAM}/` };
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), env)).not.toBeNull();
  });

  it("returns null when Access is not configured", async () => {
    const token = await sign(claims());
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), {})).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or malformed token", async () => {
    expect(await verifyAccessJwt(reqWith(), ENV)).toBeNull();
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": "not.a.jwt" }), ENV)).toBeNull();
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": "x" }), ENV)).toBeNull();
  });

  it("rejects a token signed by an unpublished key", async () => {
    const token = await sign(claims(), { key: otherKey });
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBeNull();
  });

  it("rejects a token with tampered claims", async () => {
    const token = await sign(claims());
    const [h, , s] = token.split(".");
    const forged = `${h}.${enc(claims({ email: "attacker@example.com" }))}.${s}`;
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": forged }), ENV)).toBeNull();
  });

  it("rejects a non-RS256 alg", async () => {
    const token = await sign(claims(), { alg: "none" });
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBeNull();
  });

  it("rejects wrong audience, wrong issuer, expired, and not-yet-valid tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const bad of [
      claims({ aud: ["other-aud"] }),
      claims({ iss: "https://evil.cloudflareaccess.com" }),
      claims({ exp: now - 3600 }),
      claims({ nbf: now + 3600 }),
      claims({ exp: undefined }),
    ]) {
      const token = await sign(bad);
      expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBeNull();
    }
  });

  it("does not refetch certs for an unknown kid within the cooldown", async () => {
    const token = await sign(claims(), { kid: "unknown" });
    for (let i = 0; i < 5; i++) {
      expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refetches certs on an unknown kid once the cooldown has passed (key rotation)", async () => {
    const valid = await sign(claims());
    expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": valid }), ENV)).not.toBeNull();
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    try {
      const token = await sign(claims(), { kid: "rotated-away" });
      expect(await verifyAccessJwt(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("getCallerIdentity", () => {
  it("returns the service token common_name when there is no email", async () => {
    const token = await sign(claims({ email: undefined, common_name: "client-id.access" }));
    expect(await getCallerIdentity(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBe("client-id.access");
  });

  it("ignores the unsigned email header", async () => {
    const r = reqWith({ "Cf-Access-Authenticated-User-Email": "asia@example.com" });
    expect(await getCallerIdentity(r, ENV)).toBeNull();
  });
});

describe("requireWriteAuth with Access", () => {
  it("passes with a valid JWT", async () => {
    const token = await sign(claims());
    expect(await requireWriteAuth(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV)).toBeNull();
  });

  it("passes with WRITE_TOKEN when Access is also configured", async () => {
    const env = { ...ENV, WRITE_TOKEN: "w" };
    expect(await requireWriteAuth(reqWith({ Authorization: "Bearer w" }), env)).toBeNull();
  });

  it("rejects an invalid JWT", async () => {
    const token = await sign(claims(), { key: otherKey });
    const res = await requireWriteAuth(reqWith({ "Cf-Access-Jwt-Assertion": token }), ENV);
    expect(res.status).toBe(401);
  });
});

describe("/api/me with Access", () => {
  it("reports the verified identity", async () => {
    const token = await sign(claims());
    const res = await meHandler({ request: reqWith({ "Cf-Access-Jwt-Assertion": token }, "GET"), env: ENV });
    expect(await res.json()).toEqual({ email: "asia@example.com", authenticated: true });
  });
});

describe("/api/mcp auth", () => {
  const call = (name) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: {} } });
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };

  it("rejects a forged email header when MCP_SECRET_TOKEN is set", async () => {
    const res = await mcpHandler({
      request: reqWith({ "Cf-Access-Authenticated-User-Email": "attacker@example.com" }, "POST", list),
      env: { MCP_SECRET_TOKEN: "secret" },
    });
    expect(res.status).toBe(401);
  });

  it("fails closed when only Access is configured and no valid JWT is sent", async () => {
    const res = await mcpHandler({
      request: reqWith({ "Cf-Access-Authenticated-User-Email": "attacker@example.com" }, "POST", list),
      env: ENV,
    });
    expect(res.status).toBe(401);
  });

  it("accepts a valid Access JWT", async () => {
    const token = await sign(claims());
    const res = await mcpHandler({
      request: reqWith({ "Cf-Access-Jwt-Assertion": token }, "POST", list),
      env: { ...ENV, MCP_SECRET_TOKEN: "secret" },
    });
    expect(res.status).toBe(200);
  });

  it("refuses service token tools for an unauthenticated caller even when nothing is configured", async () => {
    for (const name of ["list_service_tokens", "create_service_token", "rotate_service_token", "delete_service_token"]) {
      const res = await mcpHandler({
        request: reqWith({ "Cf-Access-Authenticated-User-Email": "attacker@example.com" }, "POST", call(name)),
        env: { CF_API_TOKEN: "cf", CF_ACCOUNT_ID: "acct" },
      });
      const body = await res.json();
      expect(body.result.isError).toBe(true);
      expect(body.result.content[0].text).toMatch(/require authentication/);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows service token tools with the bearer token", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response(JSON.stringify({ success: true, result: [], result_info: { total_pages: 1 } }))
    );
    const res = await mcpHandler({
      request: reqWith({ Authorization: "Bearer secret" }, "POST", call("list_service_tokens")),
      env: { MCP_SECRET_TOKEN: "secret", CF_API_TOKEN: "cf", CF_ACCOUNT_ID: "acct" },
    });
    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    expect(JSON.parse(body.result.content[0].text)).toEqual([]);
  });
});
