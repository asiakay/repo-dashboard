import { describe, it, expect } from "vitest";
import { requireWriteAuth } from "../functions/_shared/auth.js";
import { onRequest as priorityHandler } from "../functions/api/priority.js";
import { onRequest as workItemsHandler } from "../functions/api/work-items.js";
import { onRequest as workItemByIdHandler } from "../functions/api/work-items/[id].js";
import { onRequest as closeIssueHandler } from "../functions/api/work-items/close-issue.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function req(method, { headers = {}, body = null } = {}) {
  return new Request("http://localhost/", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
  });
}

// Returns a due-date string N days from today.
function inDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Minimal D1 mock — routes by SQL content so Promise.all queries stay distinct.
function makeDB({ items = [], signals = [], allItems = [] } = {}) {
  const defaultItem = {
    id: 1, repo_name: "test-repo", task_description: "Fix bug",
    status: "not_started", assigned_to: "agent", notes: null,
    depends_on_repo: null, started_at: null, completed_at: null,
    source_type: "manual", source_url: null, github_issue_number: null,
    manual_consequence_override: null,
  };
  return {
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        all() {
          if (sql.includes("deadline_signals")) return Promise.resolve({ results: signals });
          if (sql.includes("repo_name, status FROM")) return Promise.resolve({ results: allItems });
          return Promise.resolve({ results: items });
        },
        first() { return Promise.resolve({ ...defaultItem, ...items[0] }); },
        run() { return Promise.resolve({ meta: { changes: 1 } }); },
      };
      return stmt;
    },
  };
}

function ctx(method, { headers = {}, body = null, env = {}, params = {} } = {}) {
  return { request: req(method, { headers, body }), env: { DB: makeDB(), ...env }, params };
}

// ─── requireWriteAuth ───────────────────────────────────────────────────────

describe("requireWriteAuth", () => {
  it("returns null when WRITE_TOKEN is not configured", () => {
    const result = requireWriteAuth(req("POST"), {});
    expect(result).toBeNull();
  });

  it("returns null when the correct token is provided", () => {
    const env = { WRITE_TOKEN: "secret" };
    const result = requireWriteAuth(req("POST", { headers: { Authorization: "Bearer secret" } }), env);
    expect(result).toBeNull();
  });

  it("returns 401 when the token is wrong", async () => {
    const env = { WRITE_TOKEN: "secret" };
    const result = requireWriteAuth(req("POST", { headers: { Authorization: "Bearer wrong" } }), env);
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(401);
    const body = await result.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header is missing", () => {
    const env = { WRITE_TOKEN: "secret" };
    const result = requireWriteAuth(req("POST"), env);
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(401);
  });

  it("returns 401 when the Bearer prefix is absent", () => {
    const env = { WRITE_TOKEN: "secret" };
    const result = requireWriteAuth(req("POST", { headers: { Authorization: "secret" } }), env);
    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(401);
  });
});

// ─── Priority handler ───────────────────────────────────────────────────────

describe("priority handler", () => {
  it("returns empty items and bottlenecks when DB is empty", async () => {
    const res = await priorityHandler(ctx("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.bottlenecks).toEqual([]);
  });

  it("scores a work item with no matching signal as Tier 4 (consequence 3 × lead-time 1 = 3)", async () => {
    const items = [{ id: 1, repo_name: "test-repo", task_description: "Task", status: "not_started", assigned_to: "agent", manual_consequence_override: null }];
    const db = makeDB({ items, signals: [], allItems: items });
    const res = await priorityHandler({ request: req("GET"), env: { DB: db } });
    const { items: rows } = await res.json();
    expect(rows).toHaveLength(1);
    expect(rows[0].impact_score).toBe(3);
    expect(rows[0].tier_num).toBe(4);
    expect(rows[0].has_deadline_pressure).toBe(false);
  });

  it("scores a grant-domain item due in 5 days as Tier 1 (consequence 5 × lead-time 4 = 20)", async () => {
    const items = [{ id: 2, repo_name: "grant-repo", task_description: "Submit grant", status: "in_progress", assigned_to: "asia", manual_consequence_override: null }];
    const signals = [{
      id: 1, title: "Grant deadline", due_date: inDays(5), consequence_severity: 5,
      affects_repos: JSON.stringify(["grant-repo"]), source_repo: "grant-repo",
      domain: "grant", notes: null, last_synced: new Date().toISOString(),
    }];
    const db = makeDB({ items, signals, allItems: items });
    const res = await priorityHandler({ request: req("GET"), env: { DB: db } });
    const { items: rows } = await res.json();
    expect(rows[0].impact_score).toBe(20);
    expect(rows[0].tier_num).toBe(1);
    expect(rows[0].tier_label).toBe("Immediate Focus");
    expect(rows[0].driving_signal.domain).toBe("grant");
  });

  it("reports a bottleneck when a signal is due within 7 days with no in-progress work", async () => {
    const items = [{ id: 1, repo_name: "at-risk", task_description: "Task", status: "not_started", assigned_to: "agent", manual_consequence_override: null }];
    const signals = [{
      id: 1, title: "Urgent deadline", due_date: inDays(3), consequence_severity: 4,
      affects_repos: JSON.stringify(["at-risk"]), source_repo: "at-risk",
      domain: "default", notes: null, last_synced: new Date().toISOString(),
    }];
    const db = makeDB({ items, signals, allItems: items });
    const res = await priorityHandler({ request: req("GET"), env: { DB: db } });
    const { bottlenecks } = await res.json();
    expect(bottlenecks).toHaveLength(1);
    expect(bottlenecks[0].title).toBe("Urgent deadline");
  });

  it("does not report a bottleneck when affected repo has in-progress work", async () => {
    const items = [{ id: 1, repo_name: "on-track", task_description: "Task", status: "in_progress", assigned_to: "agent", manual_consequence_override: null }];
    const allItems = [{ repo_name: "on-track", status: "in_progress" }];
    const signals = [{
      id: 1, title: "Deadline", due_date: inDays(3), consequence_severity: 4,
      affects_repos: JSON.stringify(["on-track"]), source_repo: "on-track",
      domain: "default", notes: null, last_synced: new Date().toISOString(),
    }];
    const db = makeDB({ items, signals, allItems });
    const res = await priorityHandler({ request: req("GET"), env: { DB: db } });
    const { bottlenecks } = await res.json();
    expect(bottlenecks).toHaveLength(0);
  });

  it("respects manual_consequence_override over the signal's severity", async () => {
    const items = [{ id: 1, repo_name: "r", task_description: "T", status: "not_started", assigned_to: "agent", manual_consequence_override: 1 }];
    const signals = [{
      id: 1, title: "Big deadline", due_date: inDays(2), consequence_severity: 5,
      affects_repos: JSON.stringify(["r"]), source_repo: "r",
      domain: "default", notes: null, last_synced: new Date().toISOString(),
    }];
    const db = makeDB({ items, signals, allItems: items });
    const res = await priorityHandler({ request: req("GET"), env: { DB: db } });
    const { items: rows } = await res.json();
    // override=1, lead-time=5 (≤3 days default) → score=5
    expect(rows[0].impact_score).toBe(5);
    expect(rows[0].manual_consequence_override).toBe(1);
  });

  it("returns 405 for non-GET requests", async () => {
    const res = await priorityHandler(ctx("POST"));
    expect(res.status).toBe(405);
  });
});

// ─── work-items handler (POST + GET) ───────────────────────────────────────

describe("work-items handler", () => {
  it("GET returns work items list", async () => {
    const items = [{ id: 1, repo_name: "r", task_description: "T", status: "not_started", assigned_to: "agent" }];
    const db = makeDB({ items });
    const res = await workItemsHandler({ request: req("GET"), env: { DB: db } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
  });

  it("OPTIONS returns 204", async () => {
    const res = await workItemsHandler(ctx("OPTIONS"));
    expect(res.status).toBe(204);
  });

  it("POST with missing required fields returns 400", async () => {
    const res = await workItemsHandler(ctx("POST", { body: { repo_name: "test" } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("POST with invalid JSON returns 400", async () => {
    const context = {
      request: new Request("http://localhost/", { method: "POST", body: "not-json", headers: { "Content-Type": "application/json" } }),
      env: { DB: makeDB() },
    };
    const res = await workItemsHandler(context);
    expect(res.status).toBe(400);
  });

  it("POST succeeds when WRITE_TOKEN is not configured", async () => {
    const body = { repo_name: "r", task_description: "T", status: "not_started", assigned_to: "agent" };
    const res = await workItemsHandler(ctx("POST", { body }));
    expect(res.status).toBe(201);
  });

  it("POST returns 401 when WRITE_TOKEN is set and token is missing", async () => {
    const body = { repo_name: "r", task_description: "T", status: "not_started", assigned_to: "agent" };
    const res = await workItemsHandler(ctx("POST", { body, env: { DB: makeDB(), WRITE_TOKEN: "secret" } }));
    expect(res.status).toBe(401);
  });

  it("POST succeeds when WRITE_TOKEN is set and correct token is provided", async () => {
    const body = { repo_name: "r", task_description: "T", status: "not_started", assigned_to: "agent" };
    const res = await workItemsHandler(ctx("POST", {
      body,
      headers: { Authorization: "Bearer secret" },
      env: { DB: makeDB(), WRITE_TOKEN: "secret" },
    }));
    expect(res.status).toBe(201);
  });
});

// ─── work-items/[id] handler (PUT) ─────────────────────────────────────────

describe("work-items/[id] handler", () => {
  it("PUT with no WRITE_TOKEN is allowed", async () => {
    const res = await workItemByIdHandler({
      request: req("PUT", { body: { status: "in_progress" } }),
      env: { DB: makeDB() },
      params: { id: "1" },
    });
    expect(res.status).toBe(200);
  });

  it("PUT returns 401 when WRITE_TOKEN is set and token is absent", async () => {
    const res = await workItemByIdHandler({
      request: req("PUT", { body: { status: "done" } }),
      env: { DB: makeDB(), WRITE_TOKEN: "secret" },
      params: { id: "1" },
    });
    expect(res.status).toBe(401);
  });

  it("PUT returns 400 when no recognised fields are provided", async () => {
    const res = await workItemByIdHandler({
      request: req("PUT", { body: { unknown_field: "value" } }),
      env: { DB: makeDB() },
      params: { id: "1" },
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no valid fields/i);
  });

  it("PUT with a valid field returns the updated item", async () => {
    const updated = { id: 1, repo_name: "r", status: "done", task_description: "T", assigned_to: "agent" };
    const db = makeDB({ items: [updated] });
    const res = await workItemByIdHandler({
      request: req("PUT", { body: { status: "done" } }),
      env: { DB: db },
      params: { id: "1" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("done");
  });
});

// ─── close-issue handler ────────────────────────────────────────────────────

describe("close-issue handler", () => {
  it("POST returns 401 when WRITE_TOKEN is set and token is absent", async () => {
    const res = await closeIssueHandler({
      request: req("POST", { body: { repo_name: "r", github_issue_number: 1 } }),
      env: { DB: makeDB(), WRITE_TOKEN: "secret" },
    });
    expect(res.status).toBe(401);
  });

  it("POST returns 400 when required fields are missing", async () => {
    const res = await closeIssueHandler({
      request: req("POST", { body: { repo_name: "r" } }),
      env: { DB: makeDB() },
    });
    expect(res.status).toBe(400);
  });

  it("POST marks the issue done and returns ok:true", async () => {
    const res = await closeIssueHandler({
      request: req("POST", { body: { repo_name: "r", github_issue_number: 42 } }),
      env: { DB: makeDB() },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.changes).toBe(1);
  });

  it("GET returns 405", async () => {
    const res = await closeIssueHandler({ request: req("GET"), env: { DB: makeDB() } });
    expect(res.status).toBe(405);
  });
});
