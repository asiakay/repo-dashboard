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
    # ── Batch 2 ───────────────────────────────────────────────────────────────
    ("mvp-projects",
     "Collection of minimum viable product experiments and rapid-prototype seeds",
     ["mvp", "prototyping", "experiments", "javascript", "civic-tech"]),

    ("terminal-website",
     "Terminal-style personal website — command-line UI for navigating portfolio and projects",
     ["terminal", "portfolio", "personal-site", "javascript", "creative-coding"]),

    ("community-data-sovereignty-hub",
     "Tools and resources for communities to own, control, and benefit from their own data",
     ["data-sovereignty", "civic-tech", "community-organizing", "privacy", "open-data"]),

    ("baddies-tech-hub",
     "Tech hub for women of color in Boston — resources, mentorship, and community connections",
     ["women-in-tech", "boston", "diversity-in-tech", "community", "civic-tech"]),

    ("ROXBURY-TECH-COLLECTIVE",
     "Collaborative tech collective rooted in Roxbury, MA — building tools and culture for the community",
     ["roxbury", "boston", "civic-tech", "community-organizing", "liberation-tech"]),

    ("boston-black-tech",
     "Resource hub for Boston's Black tech community — events, jobs, and professional connections",
     ["boston", "black-tech", "community", "civic-tech", "diversity-in-tech"]),

    ("mutual-aid",
     "Mutual aid coordination platform for community resource sharing and solidarity support",
     ["mutual-aid", "civic-tech", "community-organizing", "solidarity-economy", "javascript"]),

    ("roxbury-community-art-tech-justice-hub",
     "Central hub for Roxbury's art, tech, and justice community — events, projects, and connections",
     ["roxbury", "civic-tech", "art-tech", "community-organizing", "liberation-tech"]),

    ("solarroots-directory",
     "Directory of Solar Roots Co-op projects, partners, and community solar installations",
     ["solar-roots", "directory", "clean-energy", "cooperative", "cloudflare-pages"]),

    ("asialakay_portfolio",
     "Asia Lakay's personal portfolio — artist-developer building liberation tech and civic tools",
     ["portfolio", "personal-site", "cloudflare-pages", "javascript"]),

    ("ai-agent-starter",
     "Starter template for building AI agents with Cloudflare Workers and Anthropic's API",
     ["ai-agent", "starter", "cloudflare-workers", "anthropic-api", "javascript"]),

    ("vpp-dash",
     "Virtual Power Plant dashboard — monitoring distributed energy resources and grid contributions",
     ["dashboard", "virtual-power-plant", "energy", "clean-energy", "data-visualization"]),

    ("wealth-gap-map",
     "Interactive map visualizing the racial and economic wealth gap across US geographies",
     ["data-visualization", "wealth-gap", "economic-justice", "civic-tech", "d3js"]),

    ("closing-racial-wealth-gap",
     "Data tools and resources for understanding and closing the racial wealth gap",
     ["racial-wealth-gap", "civic-tech", "data-visualization", "economic-justice", "community"]),

    ("period-power-platform",
     "Community platform for menstrual health education, tracking, and mutual support",
     ["menstrual-health", "community", "health-equity", "civic-tech", "javascript"]),

    ("liberate",
     "Liberation technology tools and frameworks for community self-determination and resistance",
     ["liberation-tech", "civic-tech", "community-organizing", "afrofuturism", "javascript"]),

    ("black-quantum-fleet",
     "Black Quantum Fleet — Afrofuturist worldbuilding and speculative fiction platform",
     ["afrofuturism", "speculative-fiction", "liberation-tech", "creative-coding", "community"]),

    ("ritual-design-as-resistance",
     "Designing rituals as acts of resistance — tools for collective healing and cultural memory",
     ["liberation-tech", "design", "ritual", "digital-humanities", "community"]),

    ("boston-tech-pathways",
     "Mapping pathways into tech careers for Boston's underrepresented communities",
     ["boston", "career-pathways", "civic-tech", "diversity-in-tech", "education"]),

    ("cdsh-dao",
     "Community Data Sovereignty Hub DAO — decentralized governance for community-owned data systems",
     ["data-sovereignty", "dao", "blockchain", "community-organizing", "civic-tech"]),

    ("deeds-app-mvp",
     "MVP prototype for the community good-deeds tracking and recognition platform",
     ["mvp", "good-deeds", "civic-tech", "community", "solidarity-economy"]),

    ("ayiti-deeds-mvp",
     "Ayiti Deeds MVP — good-deeds tracking platform rooted in Haitian community solidarity",
     ["ayiti", "haiti", "good-deeds", "civic-tech", "solidarity-economy"]),

    ("restaurant-visibility",
     "Digital visibility toolkit for independent restaurants — SEO, reviews, and local presence",
     ["restaurant", "seo", "local-business", "civic-tech", "javascript"]),

    ("job-filter-worker",
     "Cloudflare Worker for filtering and ranking job listings by equity, pay, and community fit",
     ["cloudflare-workers", "job-board", "filtering", "serverless", "javascript"]),

    ("data-loss-prevention",
     "Data loss prevention tools and policies for community-held sensitive data",
     ["data-loss-prevention", "security", "privacy", "civic-tech", "data-governance"]),

    ("vite-react-template",
     "Opinionated Vite + React starter template built for Asia's civic-tech project ecosystem",
     ["vite", "react", "template", "starter", "javascript"]),

    ("climacal-boston-climate-energy-event-calendar",
     "Full Boston climate and energy event calendar — comprehensive local sustainability event tracker",
     ["climate", "boston", "events", "civic-tech", "calendar"]),

    ("savings-calculator",
     "Interactive savings calculator for personal finance planning and community wealth-building goals",
     ["finance", "calculator", "personal-finance", "javascript", "wealth-building"]),

    ("roxbury-creative-genesis",
     "Creative genesis space for Roxbury's art and technology community builders",
     ["roxbury", "creative-tech", "community", "art-tech", "civic-tech"]),

    ("rcc-bic",
     "Digital tools and resources for Roxbury Community College's Business Innovation Center",
     ["roxbury", "education", "business-innovation", "civic-tech", "community"]),

    ("code-culture",
     "Exploring the intersection of code, culture, and identity in Boston's tech community",
     ["civic-tech", "culture", "community", "digital-humanities", "boston"]),

    ("transmission",
     "Transmission — a communications and broadcasting platform for community storytelling",
     ["community", "storytelling", "broadcasting", "civic-tech", "javascript"]),

    ("asiaLAKAY_project_starter",
     "Asia Lakay's opinionated project starter — Cloudflare Pages, D1, and Workers",
     ["template", "starter", "cloudflare-pages", "cloudflare-workers", "javascript"]),

    ("text-to-image-worker",
     "Cloudflare Worker API for text-to-image generation using AI models",
     ["ai", "api", "text-to-image", "cloudflare-workers", "image-generation"]),

    ("ddc",
     "DDC — digital community hub for Boston's Dudley, Dorchester, and Codman Square corridor",
     ["civic-tech", "community-organizing", "boston", "javascript"]),

    ("climate-events-min",
     "Minimal climate events tracker — lightweight local environmental action and event aggregator",
     ["climate", "events", "minimal", "civic-tech", "javascript"]),

    ("aetherium-praxis",
     "Aetherium Praxis — modular liberation technology framework and community design system",
     ["liberation-tech", "framework", "civic-tech", "afrofuturism", "design-system"]),

    ("asia-lakay-hub",
     "Central hub for Asia Lakay's digital ecosystem — projects, platforms, and community tools",
     ["portfolio", "hub", "civic-tech", "liberation-tech", "community"]),

    ("reelfetch-worker",
     "Cloudflare Worker for fetching and caching social media reels and short-form video content",
     ["cloudflare-workers", "video", "social-media", "api", "edge-computing"]),

    ("presentation",
     "Presentation slides and templates for Asia's community talks, workshops, and speaking engagements",
     ["presentations", "slides", "workshops", "community", "education"]),
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
