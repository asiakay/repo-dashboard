import { describe, it, expect } from "vitest";
import { slugify, normalizeProject, upsertProject } from "../functions/_shared/projects.js";
import { onRequest as projectsHandler } from "../functions/api/projects.js";
import { onRequest as projectByIdHandler } from "../functions/api/projects/[id].js";
import { onRequest as mcpHandler } from "../functions/api/mcp.js";

// Tiny in-memory stand-in for the D1 projects table: understands the few
// statement shapes functions/_shared/projects.js issues.
function makeProjectsDB(seed = []) {
  const rows = seed.map((r, i) => ({ id: i + 1, status: "draft", ...r }));
  let nextId = rows.length + 1;
  const calls = [];
  return {
    rows, calls,
    prepare(sql) {
      let binds = [];
      const stmt = {
        bind(...b) { binds = b; return stmt; },
        async all() {
          calls.push({ sql, binds });
          let out = rows;
          if (/WHERE status = \?/.test(sql)) out = rows.filter((r) => r.status === binds[0]);
          return { results: out };
        },
        async first() {
          calls.push({ sql, binds });
          if (/^SELECT \* FROM projects WHERE id = \?/.test(sql) || /^SELECT id FROM projects WHERE id/.test(sql)) {
            return rows.find((r) => r.id === binds[0]) || null;
          }
          if (/^SELECT \* FROM projects WHERE slug = \?/.test(sql)) {
            return rows.find((r) => r.slug === binds[0]) || null;
          }
          if (/^INSERT INTO projects/.test(sql)) {
            const cols = sql.match(/\(([^)]+)\) VALUES/)[1].split(",").map((c) => c.trim());
            const row = { id: nextId++ };
            cols.forEach((c, i) => { row[c] = binds[i]; });
            if (rows.some((r) => r.slug === row.slug)) throw new Error("UNIQUE constraint failed: projects.slug");
            rows.push(row);
            return row;
          }
          if (/^UPDATE projects SET/.test(sql)) {
            const cols = [...sql.matchAll(/(\w+) = \?/g)].map((m) => m[1]).filter((c) => c !== "id");
            const id = binds[binds.length - 1];
            const row = rows.find((r) => r.id === id);
            if (!row) return null;
            cols.forEach((c, i) => { row[c] = binds[i]; });
            return row;
          }
          return null;
        },
        async run() { calls.push({ sql, binds }); return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
  };
}

function req(method, body, url = "http://localhost/api/projects") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("The Creative Principle!")).toBe("the-creative-principle");
    expect(slugify("  Café — Roots  ")).toBe("cafe-roots");
  });
});

describe("normalizeProject", () => {
  it("requires a name on create", () => {
    expect(normalizeProject({}).error).toMatch(/name/);
  });
  it("defaults status to draft and derives slug", () => {
    const { fields } = normalizeProject({ name: "Solar Roots" });
    expect(fields.status).toBe("draft");
    expect(fields.slug).toBe("solar-roots");
    expect(fields.hook).toBeNull();
  });
  it("rejects an unknown status", () => {
    expect(normalizeProject({ name: "X", status: "shipped" }).error).toMatch(/status/);
  });
  it("partial updates only return the keys sent", () => {
    const { fields } = normalizeProject({ hook: "New hook" }, { partial: true });
    expect(fields).toEqual({ hook: "New hook" });
  });
});

describe("upsertProject", () => {
  it("creates a new card", async () => {
    const db = makeProjectsDB();
    const r = await upsertProject(db, { name: "Leverage List", status: "live" });
    expect(r.created).toBe(true);
    expect(r.row.slug).toBe("leverage-list");
  });
  it("updates the existing card with the same slug instead of duplicating", async () => {
    const db = makeProjectsDB([{ slug: "leverage-list", name: "Leverage List", hook: "old" }]);
    const r = await upsertProject(db, { name: "Leverage List", hook: "new" });
    expect(r.created).toBe(false);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].hook).toBe("new");
  });
  it("returns 404 for an unknown id", async () => {
    const r = await upsertProject(makeProjectsDB(), { id: 9, name: "X" });
    expect(r.status).toBe(404);
  });
});

describe("/api/projects", () => {
  it("GET lists cards", async () => {
    const db = makeProjectsDB([{ slug: "a", name: "A" }]);
    const res = await projectsHandler({ request: req("GET"), env: { DB: db } });
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(1);
  });
  it("GET rejects a bad status filter", async () => {
    const res = await projectsHandler({ request: req("GET", null, "http://localhost/api/projects?status=nope"), env: { DB: makeProjectsDB() } });
    expect(res.status).toBe(400);
  });
  it("POST requires write auth when WRITE_TOKEN is set", async () => {
    const res = await projectsHandler({ request: req("POST", { name: "A" }), env: { DB: makeProjectsDB(), WRITE_TOKEN: "s" } });
    expect(res.status).toBe(401);
  });
  it("POST creates (201) then updates (200)", async () => {
    const db = makeProjectsDB();
    const first = await projectsHandler({ request: req("POST", { name: "A" }), env: { DB: db } });
    expect(first.status).toBe(201);
    const second = await projectsHandler({ request: req("POST", { name: "A", status: "live" }), env: { DB: db } });
    expect(second.status).toBe(200);
    expect((await second.json()).status).toBe("live");
  });
});

describe("/api/projects/:id", () => {
  it("PUT updates only the sent fields", async () => {
    const db = makeProjectsDB([{ slug: "a", name: "A", hook: "keep" }]);
    const res = await projectByIdHandler({ request: req("PUT", { status: "paused" }), env: { DB: db }, params: { id: "1" } });
    expect(res.status).toBe(200);
    const row = await res.json();
    expect(row.status).toBe("paused");
    expect(row.hook).toBe("keep");
  });
  it("PUT returns 404 for a missing card", async () => {
    const res = await projectByIdHandler({ request: req("PUT", { hook: "x" }), env: { DB: makeProjectsDB() }, params: { id: "5" } });
    expect(res.status).toBe(404);
  });
  it("DELETE removes a card", async () => {
    const db = makeProjectsDB([{ slug: "a", name: "A" }]);
    const res = await projectByIdHandler({ request: req("DELETE"), env: { DB: db }, params: { id: "1" } });
    expect(res.status).toBe(200);
  });
});

describe("MCP project tools", () => {
  const call = (db, name, args) => mcpHandler({
    request: req("POST", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, "http://localhost/api/mcp"),
    env: { DB: db },
  });

  it("upsert_project creates a card", async () => {
    const db = makeProjectsDB();
    const res = await call(db, "upsert_project", { name: "The Creative Principle", front_end_url: "https://example.com" });
    const body = await res.json();
    const out = JSON.parse(body.result.content[0].text);
    expect(out.created).toBe(true);
    expect(out.project.slug).toBe("the-creative-principle");
  });

  it("list_projects returns cards", async () => {
    const db = makeProjectsDB([{ slug: "a", name: "A", status: "live" }]);
    const res = await call(db, "list_projects", { status: "live" });
    const body = await res.json();
    expect(JSON.parse(body.result.content[0].text)).toHaveLength(1);
  });

  it("upsert_project reports validation errors", async () => {
    const res = await call(makeProjectsDB(), "upsert_project", { name: "A", status: "bogus" });
    const body = await res.json();
    expect(body.result.isError).toBe(true);
  });
});
