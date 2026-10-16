/**
 * Live repo health data for asiakay, shared by /api/repos and the MCP list_repos tool.
 *
 * Fetches public repos from the GitHub API (GITHUB_TOKEN raises the rate limit),
 * caches the result at the edge for CACHE_TTL seconds, and falls back to the
 * committed public/data/repos.json snapshot (marked stale) if GitHub fails.
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
    if (!res.ok) break;
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return all;
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
  const cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) {
    const hit = await cache.match(CACHE_KEY);
    if (hit) return hit.json();
  }

  const raw = await fetchAllRepos(env.GITHUB_TOKEN);
  if (!raw.length) {
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
  if (cache) {
    await cache.put(CACHE_KEY, new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${CACHE_TTL}` },
    }));
  }
  return data;
}
