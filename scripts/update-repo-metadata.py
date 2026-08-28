#!/usr/bin/env python3
"""
Bulk repo metadata updater — asiakay GitHub account
Updates descriptions and topic tags for 40 repositories.
Run with: GITHUB_TOKEN=your_token python3 scripts/update-repo-metadata.py
"""

import json, os, sys, time, urllib.request, urllib.error

OWNER = "asiakay"
TOKEN = os.environ.get("GITHUB_TOKEN", "")
BASE  = "https://api.github.com"

# (repo_name, new_description_or_None, topics_list)
# description=None means keep the existing description, only update topics
UPDATES = [
    # ── Both description + topics ─────────────────────────────────────────────
    ("asiagrady",
     "Personal profile and redirect page for Asia Grady — artist-developer and civic tech builder",
     ["portfolio", "profile", "personal-site", "cloudflare-pages"]),

    ("commonground",
     "Community platform for shared knowledge-building, collective coordination, and mutual accountability",
     ["civic-tech", "community-organizing", "collaboration", "cloudflare-pages", "javascript"]),

    ("honey-dripper",
     "Honey Dripper — a project at the intersection of music, culture, and community memory",
     ["community", "music", "creative-coding", "javascript"]),

    ("bridge-marketplace",
     "Marketplace layer for the B.R.I.D.G.E. ecosystem — connecting community resources and local services",
     ["civic-tech", "marketplace", "community-organizing", "bridge-action-network", "cloudflare-pages"]),

    ("cc-agent-worker",
     "Cloudflare Worker powering Claude Code agent automation and task orchestration",
     ["cloudflare-workers", "ai-agent", "claude-ai", "automation", "edge-computing"]),

    ("climasphere-global-climate-event-tracker",
     "Global climate event tracker visualizing environmental data and trends across regions",
     ["climate", "data-visualization", "environmental-data", "civic-tech", "global"]),

    ("hemp-pilot-ops-dashboard",
     "Operations dashboard for managing hemp pilot program data, compliance, and reporting",
     ["dashboard", "hemp", "agriculture", "cloudflare-workers", "data-visualization"]),

    ("receipt-logger",
     "Lightweight receipt logging and expense tracking tool for small businesses and co-ops",
     ["expense-tracking", "logging", "cloudflare-workers", "pwa", "javascript"]),

    ("deeds-app",
     "Community good-deeds tracking and recognition platform rooted in solidarity economics",
     ["civic-tech", "community", "good-deeds", "social-impact", "liberation-tech"]),

    ("fairfoods-schedule",
     "Scheduling tool for fair food programs and community food distribution events",
     ["food-justice", "scheduling", "community", "civic-tech", "javascript"]),

    ("webrtc-room",
     "Browser-based real-time video and audio room using WebRTC — no server required",
     ["webrtc", "real-time", "video-chat", "peer-to-peer", "javascript"]),

    ("front-porch-economics",
     "Front Porch Economics — cooperative economic infrastructure and platform for community builders",
     ["cooperative-economics", "civic-tech", "community-organizing", "cloudflare-pages", "liberation-tech"]),

    ("synth-nest",
     "Synth Nest — browser-based synthesizer and generative sound design environment",
     ["synthesizer", "web-audio-api", "music", "creative-coding", "javascript"]),

    ("student-deals-hub",
     "Hub connecting students to local deals, discounts, and community resources",
     ["student-resources", "community", "civic-tech", "javascript"]),

    ("operaflowhq",
     "OperaFlow HQ — AI-powered operations hub for service-based businesses",
     ["ai-tools", "operations", "service-business", "cloudflare-workers", "saas"]),

    ("email-api-worker",
     "Cloudflare Worker API for transactional email delivery via third-party email providers",
     ["cloudflare-workers", "email-api", "serverless", "javascript", "edge-computing"]),

    ("no-one-heard-her",
     "Interactive narrative project centering silenced voices and unrecorded histories",
     ["narrative", "social-justice", "liberation-tech", "digital-humanities", "interactive"]),

    ("community-power-directory",
     "Directory of community power organizations, mutual aid networks, and solidarity groups",
     ["directory", "community-organizing", "mutual-aid", "civic-tech", "grassroots"]),

    ("Food_Security_MA",
     "Massachusetts food security data tools, resource mapping, and community access guides",
     ["food-security", "massachusetts", "civic-tech", "data-visualization", "community"]),

    ("funding-pipline",
     "Grant and funding pipeline tracker for nonprofit and community-serving organizations",
     ["grants", "nonprofit-tools", "funding", "civic-tech", "cloudflare-workers"]),

    ("legal-scraper-api",
     "API for scraping and parsing public legal documents, court records, and policy filings",
     ["legal-tech", "web-scraping", "api", "civic-tech", "public-data"]),

    ("solar-roots-agents",
     "AI agent layer for Solar Roots Co-op — automating community solar operations and reporting",
     ["solar-roots", "ai-agent", "clean-energy", "cloudflare-workers", "anthropic-api"]),

    ("grants-worker",
     "Cloudflare Worker for automated grant discovery, filtering, and notification pipelines",
     ["cloudflare-workers", "grants", "nonprofit-tools", "automation", "serverless"]),

    ("virtueverse-community-good-deeds-tracker",
     "VirtueVerse — community platform for tracking and celebrating acts of mutual care and solidarity",
     ["community", "good-deeds", "civic-tech", "solidarity-economy", "javascript"]),

    ("legacy-and-code-roxbury",
     "Oral history and coding project preserving Roxbury's community legacy through technology",
     ["roxbury", "oral-history", "civic-tech", "community", "liberation-tech"]),

    ("build-with-asia",
     "Build With Asia — live coding sessions, workshops, and collaborative project resources",
     ["workshops", "education", "civic-tech", "community", "javascript"]),

    ("agents-course",
     "Course materials and experiments for building AI agents with modern LLM frameworks",
     ["ai-agents", "learning", "llm", "anthropic-api", "javascript"]),

    ("climasphere",
     "ClimaSphere — climate data exploration and community event calendar platform",
     ["climate", "data-visualization", "community", "civic-tech", "javascript"]),

    ("electric-grid-visualization",
     "Interactive visualization of electric grid infrastructure, energy flow, and topology data",
     ["data-visualization", "electric-grid", "energy", "d3js", "civic-tech"]),

    ("aetherium-praxis-a-framework-for-liberation-technology",
     "Aetherium Praxis — conceptual and technical framework for liberation-centered technology",
     ["liberation-tech", "framework", "civic-tech", "community-organizing", "afrofuturism"]),

    ("art-tech-event-signup",
     "Event sign-up platform for art and technology community gatherings and workshops",
     ["events", "art-tech", "community", "javascript", "civic-tech"]),

    ("aurafolio",
     "Aurafolio — minimalist digital portfolio with an ethereal, ambient visual identity",
     ["portfolio", "personal-site", "minimalist", "javascript", "cloudflare-pages"]),

    ("python-flask-blog",
     "Lightweight blog application built with Python Flask — markdown rendering and content tagging",
     ["python", "flask", "blog", "web-app", "backend"]),

    ("rox-tech-music",
     "Music and culture platform for Roxbury's tech-creative community",
     ["roxbury", "music", "community", "civic-tech", "javascript"]),

    ("energy-business-metrics-dashboard",
     "Business metrics dashboard for the energy sector — tracking KPIs, revenue, and operational data",
     ["dashboard", "energy", "metrics", "data-visualization", "javascript"]),

    ("level-up-learning-hub",
     "Level Up Learning Hub — structured skill-building platform and educational resource discovery",
     ["education", "learning", "skill-building", "javascript", "civic-tech"]),

    # ── Topics only (descriptions are already good) ───────────────────────────
    ("solarroots-coming-soon",
     None,
     ["solar-roots", "landing-page", "clean-energy", "cooperative", "cloudflare-pages"]),

    ("repair-tracker-pro",
     None,
     ["nextjs", "firebase", "react", "inventory-management", "retail"]),

    ("ai-game-guru",
     None,
     ["openai", "gpt3", "game-recommendations", "react", "ai-tools"]),

    ("Produce-PLU-Code-Search",
     None,
     ["react", "search", "grocery", "produce", "javascript"]),
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
