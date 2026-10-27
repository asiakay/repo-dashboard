/**
 * Live repo health data for asiakay — the single source behind GET /api/repos
 * and the MCP `list_repos` tool. See docs/architecture.md ("Repo health data").
 *
 * Resolution order for getRepos():
 *   1. Fresh D1 cache entry (younger than CACHE_TTL_MS)        → served as-is
 *   2. GitHub API (all pages, or nothing — never a partial list) → cached, served
 *   3. Last good D1 cache entry, however old                   → served with stale: true
 *   4. Committed public/data/repos.json snapshot               → served with stale: true
 *   5. { error: true, message }                                → /api/repos answers 502
 *
 * The cache lives in D1 (table `cache_entries`) rather than the Workers Cache
 * API because the Cache API is unavailable behind Cloudflare Access, which
 * fronts production. After a GitHub failure the stale entry is re-stamped so
 * GitHub is retried at most once per RETRY_AFTER_FAILURE_MS, instead of on
 * every request while it is down or rate-limiting us.
 *
 * Every successful result is joined with the `site_status` table, which the
 * hourly update workflow fills by probing each repo's homepage; that join is
 * what produces `site_error` on the repo cards.
 *
 * All D1 access is best-effort: with no DB binding, or before the tables
 * exist, getRepos() degrades to "GitHub, then snapshot" and never throws.
 */

export const CACHE_KEY = "repos:v1";
export const CACHE_TTL_MS = 5 * 60 * 1000;
export const RETRY_AFTER_FAILURE_MS = 60 * 1000;

export function health(repo) {
  let score = 0;
  const days = (Date.now() - new Date(repo.updated_at)) / 86400000;
  if (days > 30) score++;
  if (days > 180) score += 2;
  if (repo.open_issues_count > 5) score++;
  if (!repo.description) score++;
  return score < 2 ? "green" : score < 4 ? "yellow" : "red";
}

// Returns the full repo list, or null if any page fails — a partial list must
// never be served (or cached) as if it were complete.
async function fetchAllRepos(token) {
  const all = [];
  let page = 1;
  const headers = { "User-Agent": "repo-dashboard/1.0", "Accept": "application/vnd.github+json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  while (true) {
    let res;
    try {
      res = await fetch(
        `https://api.github.com/users/asiakay/repos?per_page=100&page=${page}&sort=updated&direction=desc`,
        { headers }
      );
    } catch {
      return null;
    }
    if (!res.ok) return null;
    const batch = await res.json().catch(() => null);
    if (!Array.isArray(batch)) return null;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all.length ? all : null;
}

function normalize(raw) {
  return raw.map(r => ({
    name: r.name,
    full_name: r.full_name,
    url: r.html_url,
    homepage: r.homepage || null,
    description: r.description,
    created_at: r.created_at,
    updated_at: r.updated_at,
    language: r.language,
    open_issues: r.open_issues_count,
    stars: r.stargazers_count,
    forks: r.forks_count,
    topics: r.topics || [],
    default_branch: r.default_branch,
    health: health(r),
  }));
}

// ── D1 cache ────────────────────────────────────────────────────────────────

async function readCache(db) {
  if (!db) return null;
  try {
    const row = await db
      .prepare("SELECT value, expires_at FROM cache_entries WHERE key = ?")
      .bind(CACHE_KEY)
      .first();
    if (!row) return null;
    return { data: JSON.parse(row.value), fresh: row.expires_at > Date.now() };
  } catch {
    return null;
  }
}

async function writeCache(db, data, ttlMs) {
  if (!db) return;
  try {
    await db
      .prepare(
        `INSERT INTO cache_entries (key, value, expires_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
      )
      .bind(CACHE_KEY, JSON.stringify(data), Date.now() + ttlMs)
      .run();
  } catch {}
}

// ── Live-site status (written by .github/workflows/update.yml) ──────────────

async function attachSiteStatus(db, data) {
  if (!db) return data;
  let rows;
  try {
    ({ results: rows } = await db
      .prepare("SELECT repo_name, homepage, is_error, http_status, checked_at FROM site_status")
      .all());
  } catch {
    return data;
  }
  const byName = new Map((rows || []).map(r => [r.repo_name, r]));
  const repos = data.repos.map(repo => {
    const status = byName.get(repo.name);
    // A probe of an old homepage says nothing about the current one.
    if (!status || !repo.homepage || status.homepage !== repo.homepage) return repo;
    return {
      ...repo,
      site_error: !!status.is_error,
      site_http_status: status.http_status ?? null,
      site_checked_at: status.checked_at,
    };
  });
  return { ...data, repos };
}

// ── Committed snapshot (last resort) ────────────────────────────────────────

async function loadSnapshot(env, requestUrl) {
  try {
    const assetRes = await env.ASSETS.fetch(new Request(new URL("/data/repos.json", requestUrl)));
    if (!assetRes.ok) return null;
    const cached = await assetRes.json();
    const repos = Array.isArray(cached) ? cached : (cached.repos || []);
    if (!repos.length) return null;
    return { count: repos.length, generated_at: cached.generated_at || null, stale: true, repos };
  } catch {
    return null;
  }
}

/**
 * Returns { count, generated_at, repos, stale? } or { error: true, message }.
 * Never throws.
 */
export async function getRepos(env, requestUrl) {
  const db = env.DB || null;
  const cached = await readCache(db);
  if (cached && cached.fresh) return attachSiteStatus(db, cached.data);

  const raw = await fetchAllRepos(env.GITHUB_TOKEN);
  if (raw) {
    const repos = normalize(raw);
    const data = { count: repos.length, generated_at: new Date().toISOString(), repos };
    await writeCache(db, data, CACHE_TTL_MS);
    return attachSiteStatus(db, data);
  }

  // GitHub failed (down, rate-limited, or a page errored).
  if (cached) {
    const stale = { ...cached.data, stale: true };
    await writeCache(db, stale, RETRY_AFTER_FAILURE_MS);
    return attachSiteStatus(db, stale);
  }
  const snapshot = await loadSnapshot(env, requestUrl);
  if (snapshot) return attachSiteStatus(db, snapshot);
  return { error: true, message: "GitHub API returned no repos" };
}
