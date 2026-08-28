function health(repo) {
  let score = 0;
  const days = (Date.now() - new Date(repo.updated_at)) / 86400000;
  if (days > 30) score++;
  if (days > 180) score += 2;
  if (repo.open_issues_count > 5) score++;
  if (!repo.description) score++;
  return score < 2 ? "green" : score < 4 ? "yellow" : "red";
}

async function fetchAllRepos() {
  const all = [];
  let page = 1;
  while (true) {
    const res = await fetch(
      `https://api.github.com/users/asiakay/repos?per_page=100&page=${page}&sort=updated&direction=desc`,
      { headers: { "User-Agent": "repo-dashboard/1.0" } }
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

export async function onRequest(context) {
  const raw = await fetchAllRepos();

  if (!raw.length) {
    // GitHub rate-limited or unreachable — serve the committed static snapshot
    try {
      const assetReq = new Request(new URL("/data/repos.json", context.request.url));
      const assetRes = await context.env.ASSETS.fetch(assetReq);
      if (assetRes.ok) {
        const cached = await assetRes.json();
        const repos = Array.isArray(cached) ? cached : (cached.repos || []);
        if (repos.length) {
          return new Response(JSON.stringify({
            count: repos.length,
            generated_at: cached.generated_at || null,
            stale: true,
            repos,
          }), {
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=60",
            },
          });
        }
      }
    } catch {}

    return new Response(JSON.stringify({ error: true, message: "GitHub API returned no repos" }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
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

  return new Response(JSON.stringify({
    count: repos.length,
    generated_at: new Date().toISOString(),
    repos,
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
  });
}
