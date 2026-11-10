/**
 * Live repo health data for asiakay, shared by /api/repos and the MCP list_repos tool.
 *
 * Fetches public repos from the GitHub API, caches the result at the edge for
 * CACHE_TTL seconds where the Cache API is available, and falls back to the
 * committed public/data/repos.json snapshot (marked stale) if GitHub fails.
 * Behind Cloudflare Access there is no cache, so set GITHUB_TOKEN in production
 * (5,000 GitHub requests/hour instead of 60).
 */

const CACHE_TTL = 300;
const CACHE_KEY = "https://repo-dashboard.internal/cache/repos-v1";

function health(repo) {
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
  const headers = { "User-Agent": "repo-dashboard/1.0" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  while (true) {
    const res = await fetch(
      `https://api.github.com/users/asiakay/repos?per_page=100&page=${page}&sort=updated&direction=desc`,
      { headers }
    );
    if (!res.ok) return null;
    const batch = await res.json().catch(() => null);
    if (!Array.isArray(batch)) return null;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all.length ? all : null;
}

// The Cache API is unavailable for Workers fronted by Cloudflare Access (which
// production uses), so every cache operation is best-effort and never throws.
async function cacheGet() {
  try {
    if (typeof caches === "undefined") return null;
    const hit = await caches.default.match(CACHE_KEY);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

async function cachePut(data) {
  try {
    if (typeof caches === "undefined") return;
    await caches.default.put(CACHE_KEY, new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL}` },
    }));
  } catch {}
}

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
 */
export async function getRepos(env, requestUrl) {
  const hit = await cacheGet();
  if (hit) return hit;

  const raw = await fetchAllRepos(env.GITHUB_TOKEN);
  if (!raw) {
    // GitHub rate-limited or unreachable — serve the committed static snapshot
    return (await loadSnapshot(env, requestUrl)) ||
      { error: true, message: "GitHub API returned no repos" };
  }

  const repos = raw.map(r => ({
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

  const data = { count: repos.length, generated_at: new Date().toISOString(), repos };
  await cachePut(data);
  return data;
}
