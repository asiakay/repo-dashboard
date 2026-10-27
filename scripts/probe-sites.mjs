#!/usr/bin/env node
/**
 * Probe every repo homepage in a repos.json file and emit SQL that replaces the
 * D1 `site_status` table with the results. Run hourly by
 * .github/workflows/update.yml; functions/_shared/repos.js joins the table onto
 * the live repo list to produce `site_error` on the dashboard and in the MCP
 * `list_repos` tool.
 *
 *   node scripts/probe-sites.mjs <repos.json> <out.sql>
 *
 * Also writes site_error back into <repos.json> so later workflow steps that
 * read the file see the same result.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const PROBE_TIMEOUT_MS = 8000;
export const PROBE_CONCURRENCY = 10;

// Some hosts reject HEAD outright; for these a GET decides.
const RETRY_WITH_GET = new Set([403, 405, 501]);

/**
 * Returns { is_error, http_status }. http_status is null when the request
 * itself failed (DNS, TLS, timeout). Redirects are followed.
 */
export async function probeSite(url, { fetchImpl = fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const attempt = method => fetchImpl(url, {
    method,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "repo-dashboard-site-probe/1.0" },
  });
  try {
    let res = await attempt("HEAD");
    if (RETRY_WITH_GET.has(res.status)) res = await attempt("GET");
    return { is_error: res.status >= 400, http_status: res.status };
  } catch {
    return { is_error: true, http_status: null };
  }
}

export function isProbeableUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

export function sqlQuote(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** results: [{ repo_name, homepage, is_error, http_status }] */
export function buildSiteStatusSql(results, checkedAt) {
  const lines = ["DELETE FROM site_status;"];
  for (const r of results) {
    lines.push(
      "INSERT INTO site_status (repo_name, homepage, is_error, http_status, checked_at) VALUES (" +
      [sqlQuote(r.repo_name), sqlQuote(r.homepage), r.is_error ? 1 : 0, sqlQuote(r.http_status), sqlQuote(checkedAt)].join(", ") +
      ");"
    );
  }
  return lines.join("\n") + "\n";
}

export async function probeAll(repos, { probe = probeSite, concurrency = PROBE_CONCURRENCY } = {}) {
  const targets = repos.filter(r => isProbeableUrl(r.homepage));
  const results = [];
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    const outcomes = await Promise.all(batch.map(r => probe(r.homepage)));
    outcomes.forEach((o, j) => results.push({ repo_name: batch[j].name, homepage: batch[j].homepage, ...o }));
  }
  return results;
}

async function main([reposPath, sqlPath]) {
  if (!reposPath || !sqlPath) {
    console.error("usage: node scripts/probe-sites.mjs <repos.json> <out.sql>");
    process.exit(2);
  }
  const raw = JSON.parse(readFileSync(reposPath, "utf8"));
  const repos = Array.isArray(raw) ? raw : (raw.repos || []);

  const results = await probeAll(repos);
  const byName = new Map(results.map(r => [r.repo_name, r]));
  for (const repo of repos) {
    const r = byName.get(repo.name);
    if (r) repo.site_error = r.is_error;
  }
  writeFileSync(reposPath, JSON.stringify(raw, null, 2));
  writeFileSync(sqlPath, buildSiteStatusSql(results, new Date().toISOString()));

  const errors = results.filter(r => r.is_error);
  for (const r of errors) console.log(`  ⚠ site error: ${r.repo_name} (${r.homepage}) → ${r.http_status ?? "no response"}`);
  console.log(`Probed ${results.length} live sites, ${errors.length} with errors. SQL written to ${sqlPath}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main(process.argv.slice(2)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
