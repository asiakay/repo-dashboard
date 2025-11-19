export async function onRequest(context) {
  const repos = await fetch(
    "https://raw.githubusercontent.com/asiakay/repo-dashboard/main/public/data/repos.json"
  ).then(r => r.json());

  return new Response(JSON.stringify({
    count: repos.length,
    repos
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
