export async function onRequest(context) {
  const data = await fetch(
    "https://raw.githubusercontent.com/asiakay/repo-dashboard/main/public/data/repos.json"
  ).then(r => r.json());

  const repos = Array.isArray(data) ? data : (data.repos || []);

  return new Response(JSON.stringify({
    count: repos.length,
    repos,
    generated_at: data.generated_at || null,
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
