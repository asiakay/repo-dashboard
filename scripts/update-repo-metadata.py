#!/usr/bin/env python3
"""
Bulk repo metadata updater — asiakay GitHub account
Updates descriptions and topic tags for repositories.
Run with: GITHUB_TOKEN=your_token python3 scripts/update-repo-metadata.py
"""

import json, os, sys, time, urllib.request, urllib.error

OWNER = "asiakay"
TOKEN = os.environ.get("GITHUB_TOKEN", "")
BASE  = "https://api.github.com"

# (repo_name, new_description_or_None, topics_list)
# description=None means keep the existing description, only update topics
UPDATES = [
    # ── Batch 4 ───────────────────────────────────────────────────────────────
    ("inflam-ease",
     "InflamEase — culturally tailored anti-inflammatory meal planning for patients in healthcare facilities",
     ["health", "wellness", "inflammation", "javascript", "healthcare"]),

    ("happy-earth-data-analysis",
     "Environmental data analysis and visualization exploring earth health metrics and sustainability",
     ["data-analysis", "environment", "sustainability", "python", "data-visualization"]),

    ("Creative-Connections-Network",
     "Creative Connections Network — platform connecting creatives, collaborators, and makers",
     ["creative-community", "networking", "directory", "community", "civic-tech"]),

    ("inauguration-countdown-2029",
     "Countdown to the 2029 presidential inauguration — civic engagement and hope in code",
     ["countdown", "civic-tech", "javascript", "political", "interactive"]),

    ("_front-porch-economics_",
     "Community platform for mission-driven builders, cooperatives, and civic technologists in Boston",
     ["boston", "civic-tech", "cloudflare-pages", "cloudflare-workers", "community-organizing",
      "cooperative-economics", "community-platform"]),

    ("asialakay-docs",
     "Asia Lakay's personal documentation, technical notes, news, and troubleshooting guides",
     ["documentation", "personal-site", "javascript", "guides", "notes"]),

    ("floral-clerk-manual",
     "Retail floral clerk guide — customer service, inventory, arrangements, and sustainable practices",
     ["floral", "retail", "guide", "manual", "sustainability"]),

    ("ccct",
     "CCCT — community blog and content site built with Astro on Cloudflare Pages",
     ["astro", "civic-tech", "community", "blog", "cloudflare-pages"]),

    ("Legislative-Transcription-App",
     "Python app for transcribing and processing legislative text for civic accessibility and research",
     ["civic-tech", "transcription", "legislative", "python", "accessibility"]),

    ("efab",
     "EFAB — EdTech, forensics, art, and builds tech services for marginalized communities",
     ["edtech", "civic-tech", "community", "javascript", "social-impact"]),

    ("community-487",
     "Community 487 — web platform and digital home for a local community network",
     ["community", "javascript", "vercel", "civic-tech", "local-community"]),

    ("asiaLakay_portfolio_system",
     "Cloudflare-native portfolio system for creators — static-site speed, KV storage, and full content control",
     ["portfolio", "personal-site", "cloudflare-pages", "javascript", "github-pages"]),
]


def gh(method, path, data=None):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": f"Bearer {TOKEN}",
        "Accept":        "application/vnd.github+json",
        "Content-Type":  "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent":    "repo-metadata-updater/1.0",
    })
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main():
    if not TOKEN:
        sys.exit("Error: GITHUB_TOKEN is not set.\n"
                 "Run: export GITHUB_TOKEN=your_pat_here")

    # Verify auth
    s, me = gh("GET", "/user")
    if s != 200:
        sys.exit(f"Auth failed ({s}): {me.get('message', '')}")
    print(f"✓ Authenticated as {me['login']}\n")

    ok, fail = [], []

    for repo, desc, topics in UPDATES:
        errors = []

        # 1. Update description (PATCH /repos/{owner}/{repo})
        if desc is not None:
            s, d = gh("PATCH", f"/repos/{OWNER}/{repo}", {"description": desc})
            if s in (200, 201):
                print(f"  ✓ desc    {repo}")
            else:
                msg = d.get("message", "unknown")
                print(f"  ✗ desc    {repo}: {s} — {msg}")
                errors.append(f"desc:{s}")
            time.sleep(0.2)

        # 2. Update topics (PUT /repos/{owner}/{repo}/topics)
        s, d = gh("PUT", f"/repos/{OWNER}/{repo}/topics", {"names": topics})
        if s in (200, 201):
            print(f"  ✓ topics  {repo}")
        else:
            msg = d.get("message", "unknown")
            print(f"  ✗ topics  {repo}: {s} — {msg}")
            errors.append(f"topics:{s}")
        time.sleep(0.2)

        if errors:
            fail.append((repo, errors))
        else:
            ok.append(repo)

    print(f"\n{'='*55}")
    print(f"  Updated:  {len(ok):>3} repos")
    print(f"  Failed:   {len(fail):>3} repos")
    print(f"{'='*55}")

    if fail:
        print("\nFailed repos:")
        for repo, errs in fail:
            print(f"  {repo}: {', '.join(errs)}")
    else:
        print("\nAll repos updated successfully! 🎉")


if __name__ == "__main__":
    main()
