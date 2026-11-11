// Shared logic for the projects index (handoff cards).
// Used by /api/projects, /api/projects/[id] and the MCP list_projects / upsert_project tools.

export const PROJECT_STATUSES = ["draft", "live", "paused", "archived"];

// Text fields a caller may set, in column order. slug/name/status are handled separately.
export const PROJECT_TEXT_FIELDS = [
  "hook", "summary", "front_end_url", "front_end_host", "back_end_type", "back_end_url",
  "edit_front_end", "edit_back_end", "repo_name", "handoff_notes", "value_note", "tags",
];

const MAX_LEN = 4000;

export function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function clean(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, MAX_LEN) : null;
}

// Validates and normalizes input. Returns { error } or { fields }.
// `partial` = true for updates: only the keys present are returned.
export function normalizeProject(input, { partial = false } = {}) {
  if (!input || typeof input !== "object") return { error: "Body must be a JSON object" };
  const out = {};

  if (input.name !== undefined || !partial) {
    const name = clean(input.name);
    if (!name) return { error: "name is required" };
    out.name = name;
  }

  if (input.slug !== undefined || !partial) {
    const slug = slugify(input.slug || out.name);
    if (!slug) return { error: "slug could not be derived; pass a slug or a name with letters or digits" };
    out.slug = slug;
  }

  if (input.status !== undefined) {
    if (!PROJECT_STATUSES.includes(input.status)) {
      return { error: `status must be one of: ${PROJECT_STATUSES.join(", ")}` };
    }
    out.status = input.status;
  } else if (!partial) {
    out.status = "draft";
  }

  for (const key of PROJECT_TEXT_FIELDS) {
    const v = clean(input[key]);
    if (v !== undefined) out[key] = v;
    else if (!partial) out[key] = null;
  }
  return { fields: out };
}

export async function listProjects(db, { status = null } = {}) {
  let sql = "SELECT * FROM projects";
  const binds = [];
  if (status) { sql += " WHERE status = ?"; binds.push(status); }
  sql += ` ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'draft' THEN 1 WHEN 'paused' THEN 2 ELSE 3 END,
           updated_at DESC, name ASC`;
  const { results } = await db.prepare(sql).bind(...binds).all();
  return results || [];
}

export async function insertProject(db, fields) {
  const cols = Object.keys(fields);
  const sql = `INSERT INTO projects (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) RETURNING *`;
  return db.prepare(sql).bind(...cols.map((c) => fields[c])).first();
}

export async function updateProject(db, id, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
  const sql = `UPDATE projects SET ${cols.map((c) => `${c} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? RETURNING *`;
  return db.prepare(sql).bind(...cols.map((c) => fields[c]), id).first();
}

// Create or update. Matches an existing card by id, else by slug.
export async function upsertProject(db, input) {
  const id = input && input.id ? parseInt(input.id, 10) : null;
  let existing = null;
  if (id) {
    existing = await db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first();
    if (!existing) return { error: `Project ${id} not found`, status: 404 };
  } else if (input && (input.slug || input.name)) {
    const slug = slugify(input.slug || input.name);
    if (slug) existing = await db.prepare("SELECT * FROM projects WHERE slug = ?").bind(slug).first();
  }

  if (existing) {
    const { error, fields } = normalizeProject(input, { partial: true });
    if (error) return { error, status: 400 };
    const row = await updateProject(db, existing.id, fields);
    return { row, created: false };
  }

  const { error, fields } = normalizeProject(input);
  if (error) return { error, status: 400 };
  const row = await insertProject(db, fields);
  return { row, created: true };
}
