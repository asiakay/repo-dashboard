import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createD1 } from "./helpers/d1.js";
import { getRepos, CACHE_KEY, CACHE_TTL_MS, RETRY_AFTER_FAILURE_MS } from "../functions/_shared/repos.js";
import { onRequest as reposHandler } from "../functions/api/repos.js";
import { onRequest as mcpHandler } from "../functions/api/mcp.js";

const REQUEST_URL = "https://dash.example/api/repos";
const T0 = new Date("2026-10-27T12:00:00Z").getTime();

function ghRepo(name, extra = {}) {
  return {
    name,
    full_name: `asiakay/${name}`,
    html_url: `https://github.com/asiakay/${name}`,
    homepage: null,
    description: `${name} description`,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: new Date(T0 - 86400000).toISOString(),
    language: "JavaScript",
    open_issues_count: 0,
    stargazers_count: 1,
    forks_count: 0,
    topics: [],
    default_branch: "main",
    ...extra,
  };
}

// Fake GitHub: `pages` is an array of page bodies (or a Response for a failing
// page). Records every call so tests can assert on traffic.
function stubGitHub(pages) {
  const calls = [];
  vi.stubGlobal("fetch", async (url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers || {} });
    const page = Number(new URL(url).searchParams.get("page"));
    const body = pages[page - 1] ?? [];
    if (body instanceof Response) return body;
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return calls;
}

function snapshotAssets(payload) {
  return {
    fetch: async () => payload === undefined
      ? new Response("not found", { status: 404 })
      : new Response(JSON.stringify(payload), { status: 200 }),
  };
}

function cacheRow(db) {
  return db.sqlite.prepare("SELECT value, expires_at FROM cache_entries WHERE key = ?").get(CACHE_KEY);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("getRepos — live GitHub path", () => {
  it("normalizes GitHub repos and computes health", async () => {
    stubGitHub([[ghRepo("alpha", { homepage: "https://alpha.example" })]]);
    const data = await getRepos({ DB: createD1(), ASSETS: snapshotAssets() }, REQUEST_URL);

    expect(data.stale).toBeUndefined();
    expect(data.count).toBe(1);
    expect(data.generated_at).toBe(new Date(T0).toISOString());
    expect(data.repos[0]).toMatchObject({
      name: "alpha",
      full_name: "asiakay/alpha",
      url: "https://github.com/asiakay/alpha",
      homepage: "https://alpha.example",
      open_issues: 0,
      stars: 1,
      health: "green",
    });
  });

  it("follows pagination and concatenates every page", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ghRepo(`r${i}`));
    const calls = stubGitHub([page1, [ghRepo("last")]]);
    const data = await getRepos({ DB: createD1() }, REQUEST_URL);

    expect(calls).toHaveLength(2);
    expect(data.count).toBe(101);
    expect(data.repos.at(-1).name).toBe("last");
  });

  it("sends GITHUB_TOKEN as a bearer token when configured", async () => {
    const calls = stubGitHub([[ghRepo("alpha")]]);
    await getRepos({ DB: createD1(), GITHUB_TOKEN: "ghp_test" }, REQUEST_URL);
    expect(calls[0].headers.Authorization).toBe("Bearer ghp_test");
  });

  it("works with no DB binding at all", async () => {
    stubGitHub([[ghRepo("alpha")]]);
    const data = await getRepos({}, REQUEST_URL);
    expect(data.count).toBe(1);
  });

  it("works when the D1 tables do not exist yet", async () => {
    stubGitHub([[ghRepo("alpha")]]);
    const data = await getRepos({ DB: createD1({ schema: false }) }, REQUEST_URL);
    expect(data.count).toBe(1);
  });
});

describe("getRepos — D1 cache", () => {
  it("stores the result with a five-minute expiry", async () => {
    stubGitHub([[ghRepo("alpha")]]);
    const DB = createD1();
    await getRepos({ DB }, REQUEST_URL);

    const row = cacheRow(DB);
    expect(row.expires_at).toBe(T0 + CACHE_TTL_MS);
    expect(JSON.parse(row.value).repos[0].name).toBe("alpha");
  });

  it("serves a fresh entry without calling GitHub", async () => {
    const DB = createD1();
    stubGitHub([[ghRepo("alpha")]]);
    await getRepos({ DB }, REQUEST_URL);

    const calls = stubGitHub([[ghRepo("beta")]]);
    vi.setSystemTime(T0 + CACHE_TTL_MS - 1);
    const data = await getRepos({ DB }, REQUEST_URL);

    expect(calls).toHaveLength(0);
    expect(data.repos[0].name).toBe("alpha");
  });

  it("refetches once the entry has expired", async () => {
    const DB = createD1();
    stubGitHub([[ghRepo("alpha")]]);
    await getRepos({ DB }, REQUEST_URL);

    const calls = stubGitHub([[ghRepo("beta")]]);
    vi.setSystemTime(T0 + CACHE_TTL_MS + 1);
    const data = await getRepos({ DB }, REQUEST_URL);

    expect(calls).toHaveLength(1);
    expect(data.repos[0].name).toBe("beta");
    expect(data.stale).toBeUndefined();
  });
});

describe("getRepos — GitHub failures", () => {
  const rateLimited = () => new Response(JSON.stringify({ message: "API rate limit exceeded" }), { status: 403 });

  it("serves the last good result as stale instead of the old snapshot", async () => {
    const DB = createD1();
    stubGitHub([[ghRepo("alpha")]]);
    await getRepos({ DB }, REQUEST_URL);

    vi.setSystemTime(T0 + 60 * 60 * 1000);
    stubGitHub([rateLimited()]);
    const data = await getRepos({ DB, ASSETS: snapshotAssets([{ name: "ancient" }]) }, REQUEST_URL);

    expect(data.stale).toBe(true);
    expect(data.repos[0].name).toBe("alpha");
    expect(data.generated_at).toBe(new Date(T0).toISOString()); // when it was actually fetched
  });

  it("backs off: retries GitHub at most once per minute while it is failing", async () => {
    const DB = createD1();
    stubGitHub([[ghRepo("alpha")]]);
    await getRepos({ DB }, REQUEST_URL);

    vi.setSystemTime(T0 + CACHE_TTL_MS + 1);
    let calls = stubGitHub([rateLimited()]);
    await getRepos({ DB }, REQUEST_URL);
    expect(calls).toHaveLength(1);

    calls = stubGitHub([rateLimited()]);
    vi.setSystemTime(T0 + CACHE_TTL_MS + RETRY_AFTER_FAILURE_MS - 1);
    const during = await getRepos({ DB }, REQUEST_URL);
    expect(calls).toHaveLength(0);
    expect(during.stale).toBe(true);

    calls = stubGitHub([[ghRepo("recovered")]]);
    vi.setSystemTime(T0 + CACHE_TTL_MS + RETRY_AFTER_FAILURE_MS + 2);
    const after = await getRepos({ DB }, REQUEST_URL);
    expect(calls).toHaveLength(1);
    expect(after.stale).toBeUndefined();
    expect(after.repos[0].name).toBe("recovered");
  });

  it("never serves or caches a partial list when a later page fails", async () => {
    const DB = createD1();
    const page1 = Array.from({ length: 100 }, (_, i) => ghRepo(`r${i}`));
    stubGitHub([page1, new Response("boom", { status: 500 })]);
    const data = await getRepos({ DB, ASSETS: snapshotAssets([{ name: "snap" }]) }, REQUEST_URL);

    expect(data.stale).toBe(true);
    expect(data.repos.map(r => r.name)).toEqual(["snap"]);
    expect(cacheRow(DB)).toBeUndefined();
  });

  it("treats a network error like any other GitHub failure", async () => {
    stubGitHub([new TypeError("fetch failed")]);
    const data = await getRepos({ DB: createD1(), ASSETS: snapshotAssets([{ name: "snap" }]) }, REQUEST_URL);
    expect(data.stale).toBe(true);
  });

  it("treats a malformed (non-array) body as a failure", async () => {
    stubGitHub([new Response(JSON.stringify({ message: "Bad credentials" }), { status: 200 })]);
    const data = await getRepos({ DB: createD1(), ASSETS: snapshotAssets([{ name: "snap" }]) }, REQUEST_URL);
    expect(data.repos[0].name).toBe("snap");
  });

  it("falls back to the snapshot (envelope format) with no cache", async () => {
    stubGitHub([rateLimited()]);
    const envelope = { generated_at: "2025-11-19T01:40:30Z", repos: [{ name: "snap" }] };
    const data = await getRepos({ DB: createD1(), ASSETS: snapshotAssets(envelope) }, REQUEST_URL);
    expect(data).toMatchObject({ stale: true, count: 1, generated_at: "2025-11-19T01:40:30Z" });
  });

  it("returns an error object when nothing is available, and never throws", async () => {
    stubGitHub([rateLimited()]);
    const data = await getRepos({ DB: createD1(), ASSETS: snapshotAssets() }, REQUEST_URL);
    expect(data).toEqual({ error: true, message: "GitHub API returned no repos" });
  });
});

describe("getRepos — live-site status join", () => {
  function seedStatus(DB, rows) {
    const insert = DB.sqlite.prepare(
      "INSERT INTO site_status (repo_name, homepage, is_error, http_status, checked_at) VALUES (?, ?, ?, ?, ?)"
    );
    for (const r of rows) insert.run(r.repo_name, r.homepage, r.is_error, r.http_status, r.checked_at);
  }

  it("attaches site_error when the probed homepage matches", async () => {
    const DB = createD1();
    seedStatus(DB, [
      { repo_name: "up", homepage: "https://up.example", is_error: 0, http_status: 200, checked_at: "2026-10-27T11:00:00Z" },
      { repo_name: "down", homepage: "https://down.example", is_error: 1, http_status: null, checked_at: "2026-10-27T11:00:00Z" },
    ]);
    stubGitHub([[
      ghRepo("up", { homepage: "https://up.example" }),
      ghRepo("down", { homepage: "https://down.example" }),
      ghRepo("no-site"),
    ]]);
    const { repos } = await getRepos({ DB }, REQUEST_URL);
    const byName = Object.fromEntries(repos.map(r => [r.name, r]));

    expect(byName.up).toMatchObject({ site_error: false, site_http_status: 200, site_checked_at: "2026-10-27T11:00:00Z" });
    expect(byName.down).toMatchObject({ site_error: true, site_http_status: null });
    expect(byName["no-site"].site_error).toBeUndefined();
  });

  it("ignores a probe of a homepage the repo no longer uses", async () => {
    const DB = createD1();
    seedStatus(DB, [{ repo_name: "moved", homepage: "https://old.example", is_error: 1, http_status: 404, checked_at: "2026-10-27T11:00:00Z" }]);
    stubGitHub([[ghRepo("moved", { homepage: "https://new.example" })]]);
    const { repos } = await getRepos({ DB }, REQUEST_URL);
    expect(repos[0].site_error).toBeUndefined();
  });

  it("applies the latest probe results to a cached repo list", async () => {
    const DB = createD1();
    stubGitHub([[ghRepo("up", { homepage: "https://up.example" })]]);
    await getRepos({ DB }, REQUEST_URL);

    seedStatus(DB, [{ repo_name: "up", homepage: "https://up.example", is_error: 1, http_status: 503, checked_at: "2026-10-27T12:01:00Z" }]);
    const { repos } = await getRepos({ DB }, REQUEST_URL);
    expect(repos[0]).toMatchObject({ site_error: true, site_http_status: 503 });
  });
});

describe("GET /api/repos", () => {
  it("returns live data with a 5-minute browser cache", async () => {
    stubGitHub([[ghRepo("alpha")]]);
    const res = await reposHandler({ request: new Request(REQUEST_URL), env: { DB: createD1() } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect((await res.json()).repos[0].name).toBe("alpha");
  });

  it("shortens the browser cache when serving stale data", async () => {
    stubGitHub([new Response("", { status: 500 })]);
    const res = await reposHandler({
      request: new Request(REQUEST_URL),
      env: { DB: createD1(), ASSETS: snapshotAssets([{ name: "snap" }]) },
    });
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  });

  it("answers 502 when no data is available", async () => {
    stubGitHub([new Response("", { status: 500 })]);
    const res = await reposHandler({ request: new Request(REQUEST_URL), env: { DB: createD1(), ASSETS: snapshotAssets() } });
    expect(res.status).toBe(502);
  });
});

describe("MCP list_repos", () => {
  async function callListRepos(env) {
    const res = await mcpHandler({
      request: new Request("https://dash.example/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_repos", arguments: {} } }),
      }),
      env,
    });
    return res.json();
  }

  it("returns exact repo_name values plus health and live-site fields", async () => {
    const DB = createD1();
    DB.sqlite.prepare(
      "INSERT INTO site_status (repo_name, homepage, is_error, http_status, checked_at) VALUES (?, ?, ?, ?, ?)"
    ).run("Alpha-Repo", "https://alpha.example", 0, 200, "2026-10-27T11:00:00Z");
    stubGitHub([[ghRepo("Alpha-Repo", { homepage: "https://alpha.example" })]]);

    const body = await callListRepos({ DB });
    const payload = JSON.parse(body.result.content[0].text);

    expect(payload).toMatchObject({ stale: false, count: 1, generated_at: new Date(T0).toISOString() });
    expect(payload.repos[0]).toEqual({
      repo_name: "Alpha-Repo",
      full_name: "asiakay/Alpha-Repo",
      description: "Alpha-Repo description",
      url: "https://github.com/asiakay/Alpha-Repo",
      homepage: "https://alpha.example",
      health: "green",
      site_error: false,
      site_checked_at: "2026-10-27T11:00:00Z",
      open_issues: 0,
      updated_at: new Date(T0 - 86400000).toISOString(),
      language: "JavaScript",
    });
  });

  it("reports stale: true when serving fallback data", async () => {
    stubGitHub([new Response("", { status: 500 })]);
    const body = await callListRepos({ DB: createD1(), ASSETS: snapshotAssets([{ name: "snap" }]) });
    expect(JSON.parse(body.result.content[0].text).stale).toBe(true);
  });

  it("returns an MCP tool error (not a crash) when no data is available", async () => {
    stubGitHub([new Response("", { status: 500 })]);
    const body = await callListRepos({ DB: createD1(), ASSETS: snapshotAssets() });
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/Could not load repos/);
  });
});
