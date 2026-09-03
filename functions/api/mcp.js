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
 * Tools: log_task, get_okr_progress, get_daily_summary, register_okr
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
