import { describe, it, expect } from "vitest";
import { requireWriteAuth } from "../functions/_shared/auth.js";
import { onRequest as priorityHandler } from "../functions/api/priority.js";
import { onRequest as workItemsHandler } from "../functions/api/work-items.js";
import { onRequest as workItemByIdHandler } from "../functions/api/work-items/[id].js";
import { onRequest as closeIssueHandler } from "../functions/api/work-items/close-issue.js";
import { onRequest as mcpHandler } from "../functions/api/mcp.js";
import { onRequest as okrStatsHandler } from "../functions/api/okr-stats.js";

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

// ─── MCP handler ────────────────────────────────────────────────────────────

function makeMcpDB({ okr = null, task = null, okrProgress = [], dailyTasks = [] } = {}) {
  const defaultTask = {
    id: 1, date: "2026-08-28", description: "Fix auth", okr_id: "KR-1.1",
    time_spent: "30m", status: "Done", notes: null, created_at: "2026-08-28T10:00:00",
  };
  const defaultOkr = {
    id: "KR-5.1", objective: "Test Obj", key_result: "Test KR",
    target_date: null, status: "In Progress",
  };
  return {
    prepare(sql) {
      const stmt = {
        bind() { return stmt; },
        first() {
          if (sql.includes("SELECT id FROM okrs")) return Promise.resolve(okr);
          if (sql.includes("INSERT INTO tasks")) return Promise.resolve(task || defaultTask);
          if (sql.includes("INSERT INTO okrs")) return Promise.resolve(okr || defaultOkr);
          return Promise.resolve(null);
        },
        all() {
          if (sql.includes("LEFT JOIN tasks")) return Promise.resolve({ results: okrProgress });
          if (sql.includes("JOIN okrs o ON o.id")) return Promise.resolve({ results: dailyTasks });
          return Promise.resolve({ results: [] });
        },
        run() { return Promise.resolve({ meta: { changes: 1 } }); },
      };
      return stmt;
    },
  };
}

function mcpCtx(body, { env = {}, token = null } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return {
    request: new Request("http://localhost/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
    env: { DB: makeMcpDB(), ...env },
  };
}

describe("MCP handler", () => {
  it("OPTIONS returns 204", async () => {
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", { method: "OPTIONS" }),
      env: { DB: makeMcpDB() },
    });
    expect(res.status).toBe(204);
  });

  it("GET returns 405", async () => {
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", { method: "GET" }),
      env: { DB: makeMcpDB() },
    });
    expect(res.status).toBe(405);
  });

  it("returns 401 JSON-RPC error when MCP_SECRET_TOKEN is set and token is absent", async () => {
    const res = await mcpHandler(mcpCtx(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { env: { DB: makeMcpDB(), MCP_SECRET_TOKEN: "secret" } }
    ));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe(-32000);
  });

  it("returns 401 when MCP_SECRET_TOKEN is set and token is wrong", async () => {
    const res = await mcpHandler(mcpCtx(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { env: { DB: makeMcpDB(), MCP_SECRET_TOKEN: "secret" }, token: "wrong" }
    ));
    expect(res.status).toBe(401);
  });

  it("tools/list returns all four tools when auth passes", async () => {
    const res = await mcpHandler(mcpCtx(
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { env: { DB: makeMcpDB(), MCP_SECRET_TOKEN: "secret" }, token: "secret" }
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toHaveLength(4);
    const names = body.result.tools.map((t) => t.name);
    expect(names).toContain("log_task");
    expect(names).toContain("get_okr_progress");
    expect(names).toContain("get_daily_summary");
    expect(names).toContain("register_okr");
  });

  it("tools/list works when MCP_SECRET_TOKEN is not configured (open)", async () => {
    const res = await mcpHandler(mcpCtx({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.tools).toHaveLength(4);
  });

  it("unknown method returns -32601", async () => {
    const res = await mcpHandler(mcpCtx({ jsonrpc: "2.0", id: 3, method: "ping" }));
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("tools/call with unknown tool returns -32601", async () => {
    const res = await mcpHandler(mcpCtx({
      jsonrpc: "2.0", id: 4, method: "tools/call",
      params: { name: "nonexistent_tool", arguments: {} },
    }));
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("log_task with missing description returns isError", async () => {
    const res = await mcpHandler(mcpCtx({
      jsonrpc: "2.0", id: 5, method: "tools/call",
      params: { name: "log_task", arguments: { okr_id: "KR-1.1" } },
    }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
  });

  it("log_task with unknown okr_id returns isError", async () => {
    const db = makeMcpDB({ okr: null }); // SELECT id FROM okrs returns null
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 6, method: "tools/call",
          params: { name: "log_task", arguments: { description: "Did a thing", okr_id: "KR-NOPE" } },
        }),
      }),
      env: { DB: db },
    });
    const body = await res.json();
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toMatch(/not found/i);
  });

  it("log_task with valid args and existing okr_id returns created task", async () => {
    const db = makeMcpDB({ okr: { id: "KR-1.1" } }); // OKR exists
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 7, method: "tools/call",
          params: { name: "log_task", arguments: { description: "Wrote grant section", okr_id: "KR-1.1", time_spent: "2h" } },
        }),
      }),
      env: { DB: db },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const task = JSON.parse(body.result.content[0].text);
    expect(task.id).toBeDefined();
  });

  it("get_okr_progress returns aggregated rows", async () => {
    const okrProgress = [
      { id: "KR-1.1", objective: "Anchor Funding", key_result: "Grant App", total_tasks: 5, done_tasks: 3, completion_pct: 60.0 },
    ];
    const db = makeMcpDB({ okrProgress });
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "get_okr_progress", arguments: {} } }),
      }),
      env: { DB: db },
    });
    const body = await res.json();
    const rows = JSON.parse(body.result.content[0].text);
    expect(rows).toHaveLength(1);
    expect(rows[0].completion_pct).toBe(60.0);
  });

  it("get_daily_summary returns tasks for the given date", async () => {
    const dailyTasks = [{ id: 1, description: "Morning standup notes", okr_id: "KR-3.1", date: "2026-08-28" }];
    const db = makeMcpDB({ dailyTasks });
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 9, method: "tools/call",
          params: { name: "get_daily_summary", arguments: { date: "2026-08-28" } },
        }),
      }),
      env: { DB: db },
    });
    const body = await res.json();
    const summary = JSON.parse(body.result.content[0].text);
    expect(summary.date).toBe("2026-08-28");
    expect(summary.tasks).toHaveLength(1);
  });

  it("register_okr with missing fields returns isError", async () => {
    const res = await mcpHandler(mcpCtx({
      jsonrpc: "2.0", id: 10, method: "tools/call",
      params: { name: "register_okr", arguments: { id: "KR-5.1" } },
    }));
    const body = await res.json();
    expect(body.result.isError).toBe(true);
  });

  it("register_okr with valid args creates/updates the OKR", async () => {
    const newOkr = { id: "KR-5.1", objective: "Community Reach", key_result: "50 newsletter subs", target_date: "2026-12-01", status: "Planned" };
    const db = makeMcpDB({ okr: newOkr });
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 11, method: "tools/call",
          params: { name: "register_okr", arguments: { id: "KR-5.1", objective: "Community Reach", key_result: "50 newsletter subs", status: "Planned" } },
        }),
      }),
      env: { DB: db },
    });
    const body = await res.json();
    expect(body.result.isError).toBeUndefined();
    const okr = JSON.parse(body.result.content[0].text);
    expect(okr.id).toBe("KR-5.1");
  });

  it("invalid JSON body returns -32700 parse error", async () => {
    const res = await mcpHandler({
      request: new Request("http://localhost/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not-json",
      }),
      env: { DB: makeMcpDB() },
    });
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });

  it("jsonrpc field other than '2.0' returns -32600", async () => {
    const res = await mcpHandler(mcpCtx({ jsonrpc: "1.0", id: 1, method: "tools/list" }));
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });
});

// ─── okr-stats ─────────────────────────────────────────────────────────────

describe("okr-stats", () => {
  function makeOkrStatsDB({ okrs = [], todayTasks = [] } = {}) {
    return {
      prepare(sql) {
        const stmt = {
          bind() { return stmt; },
          all() {
            if (sql.includes("GROUP BY")) return Promise.resolve({ results: okrs });
            return Promise.resolve({ results: todayTasks });
          },
        };
        return stmt;
      },
    };
  }

  it("GET returns 200 with okrs array and today object", async () => {
    const okrs = [
      { id: "KR-1.1", objective: "Anchor Funding", key_result: "Secure one grant",
        target_date: "2026-10-15", status: "In Progress",
        total_tasks: 5, done_tasks: 3, completion_pct: 60.0 },
    ];
    const res = await okrStatsHandler({ request: req("GET"), env: { DB: makeOkrStatsDB({ okrs }) } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.okrs)).toBe(true);
    expect(body.okrs).toHaveLength(1);
    expect(body.okrs[0].completion_pct).toBe(60.0);
    expect(body.today).toBeDefined();
    expect(body.today.date).toBeDefined();
    expect(Array.isArray(body.today.tasks)).toBe(true);
  });

  it("returns today tasks when present", async () => {
    const todayTasks = [
      { id: 1, description: "Drafted grant section", okr_id: "KR-1.1",
        time_spent: "1.5h", status: "Done", notes: null },
    ];
    const res = await okrStatsHandler({ request: req("GET"), env: { DB: makeOkrStatsDB({ todayTasks }) } });
    const body = await res.json();
    expect(body.today.tasks).toHaveLength(1);
    expect(body.today.tasks[0].status).toBe("Done");
  });

  it("OPTIONS returns 204", async () => {
    const res = await okrStatsHandler({ request: req("OPTIONS"), env: { DB: makeOkrStatsDB() } });
    expect(res.status).toBe(204);
  });

  it("POST returns 405", async () => {
    const res = await okrStatsHandler({ request: req("POST"), env: { DB: makeOkrStatsDB() } });
    expect(res.status).toBe(405);
  });

  it("returns migration_pending:true when DB throws (tables missing)", async () => {
    const db = {
      prepare() {
        return { bind() { return this; }, all() { return Promise.reject(new Error("no such table: okrs")); } };
      },
    };
    const res = await okrStatsHandler({ request: req("GET"), env: { DB: db } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.migration_pending).toBe(true);
    expect(Array.isArray(body.okrs)).toBe(true);
    expect(body.okrs).toHaveLength(0);
  });
});
