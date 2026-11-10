import { getRepos } from "../_shared/repos.js";

export async function onRequest(context) {
  const data = await getRepos(context.env, context.request.url);

  if (data.error) {
    return new Response(JSON.stringify(data), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": data.stale ? "public, max-age=60" : "public, max-age=300",
    },
  });
}
