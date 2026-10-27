import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createD1 } from "./helpers/d1.js";
import { probeSite, probeAll, isProbeableUrl, sqlQuote, buildSiteStatusSql } from "../scripts/probe-sites.mjs";

const run = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("../scripts/probe-sites.mjs", import.meta.url));

function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init.method });
    return handler(url, init);
  };
  return { impl, calls };
}

describe("probeSite", () => {
  it("reports a 2xx site as up", async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 200 }));
    expect(await probeSite("https://ok.example", { fetchImpl: impl })).toEqual({ is_error: false, http_status: 200 });
  });

  it("reports a 4xx/5xx site as an error with its status", async () => {
    const { impl } = fakeFetch(() => new Response(null, { status: 503 }));
    expect(await probeSite("https://down.example", { fetchImpl: impl })).toEqual({ is_error: true, http_status: 503 });
  });

  it("retries with GET when a host rejects HEAD", async () => {
    const { impl, calls } = fakeFetch((url, init) => new Response(null, { status: init.method === "HEAD" ? 405 : 200 }));
    expect(await probeSite("https://nohead.example", { fetchImpl: impl })).toEqual({ is_error: false, http_status: 200 });
    expect(calls.map(c => c.method)).toEqual(["HEAD", "GET"]);
  });

  it("reports a failed request (DNS, TLS, timeout) as an error with no status", async () => {
    const { impl } = fakeFetch(() => { throw new TypeError("fetch failed"); });
    expect(await probeSite("https://gone.example", { fetchImpl: impl })).toEqual({ is_error: true, http_status: null });
  });
});

describe("isProbeableUrl", () => {
  it.each([
    ["https://a.example", true],
    ["http://a.example/path", true],
    ["", false],
    [null, false],
    ["a.example", false],
    ["ftp://a.example", false],
    ["javascript:alert(1)", false],
  ])("%s → %s", (value, expected) => {
    expect(isProbeableUrl(value)).toBe(expected);
  });
});

describe("sqlQuote", () => {
  it("escapes single quotes and maps null/number correctly", () => {
    expect(sqlQuote("it's")).toBe("'it''s'");
    expect(sqlQuote(null)).toBe("NULL");
    expect(sqlQuote(undefined)).toBe("NULL");
    expect(sqlQuote(404)).toBe("404");
    expect(sqlQuote(NaN)).toBe("NULL");
  });
});

describe("buildSiteStatusSql", () => {
  it("produces SQL that replaces site_status wholesale under the real schema", () => {
    const DB = createD1();
    DB.sqlite.exec(buildSiteStatusSql(
      [{ repo_name: "stale-row", homepage: "https://old.example", is_error: true, http_status: 500 }],
      "2026-10-27T10:00:00Z"
    ));

    DB.sqlite.exec(buildSiteStatusSql([
      { repo_name: "team's-site", homepage: "https://x.example/?q='; DROP TABLE site_status; --", is_error: false, http_status: 200 },
      { repo_name: "down", homepage: "https://down.example", is_error: true, http_status: null },
    ], "2026-10-27T11:00:00Z"));

    const rows = DB.sqlite.prepare("SELECT * FROM site_status ORDER BY repo_name").all();
    expect(rows.map(r => ({ ...r }))).toEqual([
      { repo_name: "down", homepage: "https://down.example", is_error: 1, http_status: null, checked_at: "2026-10-27T11:00:00Z" },
      { repo_name: "team's-site", homepage: "https://x.example/?q='; DROP TABLE site_status; --", is_error: 0, http_status: 200, checked_at: "2026-10-27T11:00:00Z" },
    ]);
  });

  it("still clears the table when no repo has a homepage", () => {
    expect(buildSiteStatusSql([], "2026-10-27T11:00:00Z")).toBe("DELETE FROM site_status;\n");
  });
});

describe("probeAll", () => {
  it("probes only repos with a usable homepage, in bounded batches", async () => {
    let inFlight = 0, maxInFlight = 0;
    const probe = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setTimeout(r, 1));
      inFlight--;
      return { is_error: false, http_status: 200 };
    };
    const repos = [
      ...Array.from({ length: 25 }, (_, i) => ({ name: `r${i}`, homepage: `https://r${i}.example` })),
      { name: "none", homepage: null },
      { name: "bare", homepage: "r.example" },
    ];
    const results = await probeAll(repos, { probe, concurrency: 10 });
    expect(results).toHaveLength(25);
    expect(maxInFlight).toBe(10);
    expect(results[0]).toEqual({ repo_name: "r0", homepage: "https://r0.example", is_error: false, http_status: 200 });
  });
});

describe("scripts/probe-sites.mjs end to end", () => {
  let server, base, dir;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === "/ok") return res.writeHead(200).end("ok");
      if (req.url === "/missing") return res.writeHead(404).end();
      if (req.url === "/redirect") return res.writeHead(301, { Location: "/ok" }).end();
      if (req.url === "/no-head") return res.writeHead(req.method === "HEAD" ? 405 : 200).end();
      res.writeHead(500).end();
    });
    await new Promise(r => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    dir = mkdtempSync(join(tmpdir(), "probe-sites-"));
  });

  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("probes real HTTP endpoints, writes loadable SQL, and updates repos.json", async () => {
    const reposPath = join(dir, "repos.json");
    const sqlPath = join(dir, "site-status.sql");
    writeFileSync(reposPath, JSON.stringify({
      generated_at: "2026-10-27T11:00:00Z",
      repos: [
        { name: "ok", homepage: `${base}/ok` },
        { name: "missing", homepage: `${base}/missing` },
        { name: "redirect", homepage: `${base}/redirect` },
        { name: "no-head", homepage: `${base}/no-head` },
        { name: "unreachable", homepage: "http://127.0.0.1:1/" },
        { name: "no-site", homepage: null },
      ],
    }));

    const { stdout } = await run(process.execPath, [SCRIPT, reposPath, sqlPath]);
    expect(stdout).toMatch(/Probed 5 live sites, 2 with errors/);

    const DB = createD1();
    DB.sqlite.exec(readFileSync(sqlPath, "utf8"));
    const status = Object.fromEntries(
      DB.sqlite.prepare("SELECT repo_name, is_error, http_status FROM site_status").all()
        .map(r => [r.repo_name, [r.is_error, r.http_status]])
    );
    expect(status).toEqual({
      ok: [0, 200],
      missing: [1, 404],
      redirect: [0, 200],
      "no-head": [0, 200],
      unreachable: [1, null],
    });

    const written = JSON.parse(readFileSync(reposPath, "utf8"));
    expect(written.generated_at).toBe("2026-10-27T11:00:00Z");
    expect(Object.fromEntries(written.repos.map(r => [r.name, r.site_error]))).toEqual({
      ok: false, missing: true, redirect: false, "no-head": false, unreachable: true, "no-site": undefined,
    });
  });

  it("exits with usage when arguments are missing", async () => {
    await expect(run(process.execPath, [SCRIPT])).rejects.toMatchObject({ code: 2 });
  });
});
