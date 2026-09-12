/**
 * MCP (Model Context Protocol) endpoint — JSON-RPC 2.0 over HTTP POST /api/mcp
 *
 * Auth: Bearer token matching env.MCP_SECRET_TOKEN (opt-in; open when unset).
 * D1 binding: DB (same as the rest of the API).
 *
 * Supported methods:
 *   tools/list   → enumerate available tools
 *   tools/call   → invoke a tool by name
 *
 * Tools: log_task, get_okr_progress, get_daily_summary, register_okr,
 *         list_agent_tasks, start_task, finish_task
 */

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonRpc(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: CORS });
}

function jsonRpcError(id, code, message, httpStatus = 200) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }),
    { status: httpStatus, headers: CORS }
  );
}

// ── Tool definitions ────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "log_task",
    description: "Log a micro-task linked to an OKR key result.",
    inputSchema: {
      type: "object",
      properties: {
        description: { type: "string", description: "What was accomplished" },
        okr_id: { type: "string", description: "ID of the linked OKR (e.g. KR-1.1)" },
        time_spent: { type: "string", description: "Optional time spent, e.g. '45m' or '1.5h'" },
        status: {
          type: "string",
          enum: ["To Do", "In Progress", "Done"],
          description: "Task status (defaults to 'Done')",
        },
        notes: { type: "string", description: "Optional additional notes" },
      },
      required: ["description", "okr_id"],
    },
  },
  {
    name: "get_okr_progress",
    description: "Returns task counts and completion percentage for each OKR.",
    inputSchema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_daily_summary",
    description: "Retrieves tasks logged on a given date (defaults to UTC today).",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string", description: "ISO date string YYYY-MM-DD; omit for today (UTC)" },
      },
      required: [],
    },
  },
  {
    name: "register_okr",
    description: "Creates or updates a strategic objective / key result.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "OKR ID, e.g. KR-5.1" },
        objective: { type: "string", description: "High-level objective title" },
        key_result: { type: "string", description: "Measurable key result description" },
        target_date: { type: "string", description: "Target date (YYYY-MM-DD) or 'Ongoing'" },
        status: {
          type: "string",
          enum: ["Planned", "In Progress", "In Review", "Completed"],
          description: "OKR status (defaults to 'In Progress')",
        },
      },
      required: ["id", "objective", "key_result"],
    },
  },
  // ── Agent work-item tools ─────────────────────────────────────────────────
  {
    name: "list_agent_tasks",
    description: "Returns work_items assigned to agent. Excludes done tasks by default. Use this to read the agent task queue before starting work.",
    inputSchema: {
      type: "object",
      properties: {
        include_done: {
          type: "boolean",
          description: "Set true to include completed tasks (default false)",
        },
        repo_name: {
          type: "string",
          description: "Optional: filter to a specific repo/project label",
        },
      },
      required: [],
    },
  },
  {
    name: "start_task",
    description: "Claim a work_item: transitions status to in_progress and stamps started_at. Safe to call if already in_progress — returns the current row without changes.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "ID of the work_item to start" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "finish_task",
    description: "Complete a work_item: transitions status to done and stamps completed_at. Optionally appends notes.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "ID of the work_item to complete" },
        notes: { type: "string", description: "Optional notes to record on the completed task" },
      },
      required: ["task_id"],
    },
  },
  // ── OKR micro-task pipeline tools ────────────────────────────────────────
  {
    name: "list_okr_tasks",
    description: "List micro-tasks from the tasks table (linked to OKRs). Excludes Done tasks by default. Filter by OKR or status.",
    inputSchema: {
      type: "object",
      properties: {
        okr_id:      { type: "string",  description: "Optional: filter to a specific OKR (e.g. DAD-8)" },
        status:      { type: "string",  enum: ["To Do", "In Progress", "Done"], description: "Optional: filter by status" },
        include_done:{ type: "boolean", description: "Set true to include Done tasks (default false)" },
      },
      required: [],
    },
  },
  {
    name: "start_okr_task",
    description: "Advance an OKR micro-task to In Progress and stamp started_at. Idempotent if already In Progress.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number", description: "ID of the task to start" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "finish_okr_task",
    description: "Mark an OKR micro-task Done, stamp completed_at, and optionally append notes.",
    inputSchema: {
      type: "object",
      properties: {
        task_id:    { type: "number", description: "ID of the task to complete" },
        notes:      { type: "string", description: "Optional notes to append" },
        time_spent: { type: "string", description: "Optional time spent, e.g. '45m' or '1.5h'" },
      },
      required: ["task_id"],
    },
  },
];

// ── Tool handlers ───────────────────────────────────────────────────────────

async function handleToolCall(name, args, db) {
  if (name === "log_task") {
    const { description, okr_id, time_spent = null, status = "Done", notes = null } = args || {};

    if (!description || !okr_id) {
      return {
        isError: true,
        content: [{ type: "text", text: "Missing required fields: description, okr_id" }],
      };
    }

    // Foreign-key validation — reject unknown OKR IDs explicitly
    const okr = await db.prepare("SELECT id FROM okrs WHERE id = ?").bind(okr_id).first();
    if (!okr) {
      return {
        isError: true,
        content: [{ type: "text", text: `OKR '${okr_id}' not found. Use register_okr to create it first.` }],
      };
    }

    const now = new Date().toISOString();
    let taskStartedAt = null;
    let taskCompletedAt = null;
    if (status === "In Progress") {
      taskStartedAt = now;
    } else if (status === "Done") {
      taskStartedAt = now;
      taskCompletedAt = now;
    }

    const task = await db
      .prepare(
        "INSERT INTO tasks (description, okr_id, time_spent, status, notes, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *"
      )
      .bind(description, okr_id, time_spent, status, notes, taskStartedAt, taskCompletedAt)
      .first();

    return { content: [{ type: "text", text: JSON.stringify(task) }] };
  }

  if (name === "get_okr_progress") {
    const { results } = await db
      .prepare(
        `SELECT o.id,
                o.objective,
                o.key_result,
                o.target_date,
                o.status,
                COUNT(t.id) AS total_tasks,
                SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) AS done_tasks,
                ROUND(
                  CASE WHEN COUNT(t.id) = 0 THEN 0
                       ELSE 100.0 * SUM(CASE WHEN t.status = 'Done' THEN 1 ELSE 0 END) / COUNT(t.id)
                  END, 1
                ) AS completion_pct
         FROM okrs o
         LEFT JOIN tasks t ON t.okr_id = o.id
         GROUP BY o.id
         ORDER BY o.id`
      )
      .all();

    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }

  if (name === "get_daily_summary") {
    const date = (args && args.date) || new Date().toISOString().slice(0, 10);

    const { results } = await db
      .prepare(
        `SELECT t.*, o.objective, o.key_result
         FROM tasks t
         JOIN okrs o ON o.id = t.okr_id
         WHERE t.date = ?
         ORDER BY t.created_at`
      )
      .bind(date)
      .all();

    return { content: [{ type: "text", text: JSON.stringify({ date, tasks: results }) }] };
  }

  if (name === "register_okr") {
    const { id, objective, key_result, target_date = null, status = "In Progress" } = args || {};

    if (!id || !objective || !key_result) {
      return {
        isError: true,
        content: [{ type: "text", text: "Missing required fields: id, objective, key_result" }],
      };
    }

    const okr = await db
      .prepare(
        `INSERT INTO okrs (id, objective, key_result, target_date, status)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           objective   = excluded.objective,
           key_result  = excluded.key_result,
           target_date = excluded.target_date,
           status      = excluded.status
         RETURNING *`
      )
      .bind(id, objective, key_result, target_date, status)
      .first();

    return { content: [{ type: "text", text: JSON.stringify(okr) }] };
  }

  if (name === "list_agent_tasks") {
    const includeDone = args && args.include_done === true;
    const repoFilter = args && args.repo_name ? args.repo_name : null;

    let query = "SELECT * FROM work_items WHERE assigned_to = 'agent'";
    const bindings = [];

    if (!includeDone) {
      query += " AND status != 'done'";
    }
    if (repoFilter) {
      query += " AND repo_name = ?";
      bindings.push(repoFilter);
    }

    query += " ORDER BY CASE status WHEN 'in_progress' THEN 0 WHEN 'blocked' THEN 1 WHEN 'not_started' THEN 2 ELSE 3 END, repo_name ASC";

    const { results } = await db.prepare(query).bind(...bindings).all();
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }

  if (name === "start_task") {
    const { task_id } = args || {};
    if (!task_id) {
      return { isError: true, content: [{ type: "text", text: "Missing required field: task_id" }] };
    }

    const existing = await db.prepare("SELECT * FROM work_items WHERE id = ? AND assigned_to = 'agent'").bind(task_id).first();
    if (!existing) {
      return { isError: true, content: [{ type: "text", text: `Task ${task_id} not found or not assigned to agent` }] };
    }

    if (existing.status === "in_progress") {
      return { content: [{ type: "text", text: JSON.stringify(existing) }] };
    }

    const now = new Date().toISOString();
    const updated = await db
      .prepare("UPDATE work_items SET status = 'in_progress', started_at = ? WHERE id = ? RETURNING *")
      .bind(now, task_id)
      .first();

    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  }

  if (name === "finish_task") {
    const { task_id, notes = null } = args || {};
    if (!task_id) {
      return { isError: true, content: [{ type: "text", text: "Missing required field: task_id" }] };
    }

    const existing = await db.prepare("SELECT * FROM work_items WHERE id = ? AND assigned_to = 'agent'").bind(task_id).first();
    if (!existing) {
      return { isError: true, content: [{ type: "text", text: `Task ${task_id} not found or not assigned to agent` }] };
    }

    const now = new Date().toISOString();
    const started = existing.started_at || now;
    const mergedNotes = notes
      ? (existing.notes ? `${existing.notes}\n${notes}` : notes)
      : existing.notes;

    const updated = await db
      .prepare("UPDATE work_items SET status = 'done', started_at = ?, completed_at = ?, notes = ? WHERE id = ? RETURNING *")
      .bind(started, now, mergedNotes, task_id)
      .first();

    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  }

  if (name === "list_okr_tasks") {
    const includeDone = args && args.include_done === true;
    const okrFilter  = args && args.okr_id ? args.okr_id : null;
    const statusFilter = args && args.status ? args.status : null;

    let query = `
      SELECT t.*, o.objective, o.key_result
      FROM tasks t JOIN okrs o ON o.id = t.okr_id
    `;
    const binds = [];
    const conditions = [];
    if (!includeDone && !statusFilter) conditions.push("t.status != 'Done'");
    if (statusFilter) { conditions.push("t.status = ?"); binds.push(statusFilter); }
    if (okrFilter)   { conditions.push("t.okr_id = ?"); binds.push(okrFilter); }
    if (conditions.length) query += " WHERE " + conditions.join(" AND ");
    query += " ORDER BY CASE t.status WHEN 'In Progress' THEN 0 WHEN 'To Do' THEN 1 ELSE 2 END, t.okr_id, t.id";

    const { results } = await db.prepare(query).bind(...binds).all();
    return { content: [{ type: "text", text: JSON.stringify(results) }] };
  }

  if (name === "start_okr_task") {
    const { task_id } = args || {};
    if (!task_id) return { isError: true, content: [{ type: "text", text: "Missing required field: task_id" }] };

    const existing = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(task_id).first();
    if (!existing) return { isError: true, content: [{ type: "text", text: `Task ${task_id} not found` }] };
    if (existing.status === "In Progress") return { content: [{ type: "text", text: JSON.stringify(existing) }] };

    const now = new Date().toISOString();
    const fields = ["status"];
    const values = ["In Progress"];
    if (!existing.started_at) { fields.push("started_at"); values.push(now); }

    const setClauses = fields.map(f => `${f} = ?`).join(", ");
    const updated = await db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ? RETURNING *`)
      .bind(...values, task_id).first();
    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  }

  if (name === "finish_okr_task") {
    const { task_id, notes = null, time_spent = null } = args || {};
    if (!task_id) return { isError: true, content: [{ type: "text", text: "Missing required field: task_id" }] };

    const existing = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(task_id).first();
    if (!existing) return { isError: true, content: [{ type: "text", text: `Task ${task_id} not found` }] };

    const now = new Date().toISOString();
    const mergedNotes = notes
      ? (existing.notes ? `${existing.notes}\n${notes}` : notes)
      : existing.notes;

    const fields = ["status", "completed_at", "notes"];
    const values = ["Done", now, mergedNotes];
    if (!existing.started_at) { fields.push("started_at"); values.push(now); }
    if (time_spent) { fields.push("time_spent"); values.push(time_spent); }

    const setClauses = fields.map(f => `${f} = ?`).join(", ");
    const updated = await db.prepare(`UPDATE tasks SET ${setClauses} WHERE id = ? RETURNING *`)
      .bind(...values, task_id).first();
    return { content: [{ type: "text", text: JSON.stringify(updated) }] };
  }

  return null; // unknown tool
}

// ── Request handler ─────────────────────────────────────────────────────────

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: CORS });
  }

  // Bearer token auth — opt-in: open when MCP_SECRET_TOKEN is not configured
  if (env.MCP_SECRET_TOKEN) {
    const auth = request.headers.get("Authorization") || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (token !== env.MCP_SECRET_TOKEN) {
      return jsonRpcError(null, -32000, "Unauthorized", 401);
    }
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const { jsonrpc, id = null, method, params = {} } = body;

  if (jsonrpc !== "2.0") {
    return jsonRpcError(id, -32600, "Invalid Request: jsonrpc must be '2.0'");
  }

  if (method === "tools/list") {
    return jsonRpc(id, { tools: TOOLS });
  }

  if (method === "tools/call") {
    const { name, arguments: args = {} } = params;
    let result;
    try {
      result = await handleToolCall(name, args, env.DB);
    } catch (err) {
      return jsonRpcError(id, -32603, `Internal error: ${err.message}`);
    }
    if (result === null) {
      return jsonRpcError(id, -32601, `Tool not found: ${name}`);
    }
    return jsonRpc(id, result);
  }

  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}
