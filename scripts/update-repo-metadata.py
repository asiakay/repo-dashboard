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
    # ── Batch 3 ───────────────────────────────────────────────────────────────
    ("grant-manager-tool-demo",
     "Demo of a community grant management and tracking tool for nonprofit organizations",
     ["grants", "nonprofit-tools", "demo", "javascript", "civic-tech"]),

    ("signup-app",
     "Community event and program sign-up app with waitlist and notification features",
     ["signup", "events", "forms", "javascript", "community"]),

    ("cleantech-index",
     "Index of clean technology companies, projects, and community energy resources",
     ["clean-tech", "index", "civic-tech", "sustainability", "data"]),

    ("next-app",
     "Next.js application starter with opinionated configuration for rapid project setup",
     ["nextjs", "react", "starter", "javascript", "template"]),

    ("floralflow",
     "FloralFlow — scheduling and workflow platform for floral arrangement businesses",
     ["scheduling", "local-business", "floral", "javascript", "cloudflare-pages"]),

    ("we-are-the-infrastructure",
     "Digital toolkit rooted in the idea that communities ARE the infrastructure — civic self-determination",
     ["civic-tech", "community-organizing", "liberation-tech", "infrastructure", "grassroots"]),

    ("SQL_Scripts",
     "SQL scripts and queries for data analysis, reporting, and community database management",
     ["sql", "database", "data-analysis", "scripts", "utilities"]),

    ("racism-mutation-map",
     "Interactive map tracking patterns and mutations of structural racism across geographies",
     ["data-visualization", "antiracism", "civic-tech", "social-justice", "digital-humanities"]),

    ("Metrics_tracker",
     "Community and project metrics tracker for measuring social impact and progress over time",
     ["metrics", "tracking", "data-visualization", "civic-tech", "javascript"]),

    ("data-vis-1",
     "Data visualization experiments using D3.js and web charting libraries",
     ["data-visualization", "d3js", "charts", "javascript", "learning"]),

    ("college-tracker",
     "College application and enrollment tracker supporting first-generation students",
     ["education", "tracking", "first-gen", "civic-tech", "javascript"]),

    ("crypto-dashboard",
     "Cryptocurrency portfolio and market data dashboard with real-time price tracking",
     ["crypto", "dashboard", "data-visualization", "javascript", "finance"]),

    ("gatsby-netlify-okta-example",
     "Example app: Gatsby.js with Netlify deployment and Okta authentication integration",
     ["gatsby", "netlify", "okta", "authentication", "javascript"]),

    ("EcoStyleEcoChic",
     "EcoStyleEcoChic — sustainable fashion platform promoting ethical and eco-conscious clothing",
     ["sustainability", "fashion", "eco-friendly", "javascript", "community"]),

    ("data-scan",
     "Data scanning and parsing utilities for community data collection and processing workflows",
     ["data-processing", "utilities", "civic-tech", "python", "data-tools"]),

    ("onehouroffers.work",
     "One Hour Offers — rapid marketplace connecting community members for quick-turnaround services",
     ["marketplace", "gig-economy", "community", "civic-tech", "javascript"]),

    ("the-memory-shard",
     "The Memory Shard — digital archive for preserving community stories and cultural memory",
     ["oral-history", "digital-humanities", "community", "liberation-tech", "javascript"]),

    ("arabic-study-guide",
     "Interactive Arabic language study guide with vocabulary, grammar, and cultural context",
     ["arabic", "language-learning", "education", "javascript", "interactive"]),

    ("history-fact-app",
     "Daily history fact app surfacing overlooked events and voices in Black and liberation history",
     ["history", "education", "liberation-tech", "civic-tech", "javascript"]),

    ("notesapp",
     "Lightweight notes application with markdown support and local storage",
     ["notes", "markdown", "pwa", "javascript", "productivity"]),

    ("bottle-drive-fundraiser",
     "Digital coordination tool for community bottle drive fundraisers and recycling campaigns",
     ["fundraising", "community", "civic-tech", "javascript", "recycling"]),

    ("spectral-resonance-analysis",
     "Spectral resonance analysis tools for audio frequency data exploration and visualization",
     ["audio-analysis", "signal-processing", "data-visualization", "javascript", "creative-tech"]),

    ("creative-tech",
     "Creative technology experiments at the intersection of art, code, and community expression",
     ["creative-coding", "art-tech", "community", "javascript", "experiments"]),

    ("react-redux-contact-manager",
     "Contact manager built with React and Redux demonstrating state management patterns",
     ["react", "redux", "contact-manager", "javascript", "learning"]),

    ("react-python-calculator",
     "Full-stack calculator with React frontend and Python Flask backend API",
     ["react", "python", "flask", "calculator", "fullstack"]),

    ("pixelpulse",
     "PixelPulse — digital art and creative media platform for visual storytelling and expression",
     ["creative-coding", "digital-art", "javascript", "community", "media"]),

    ("sheconnect",
     "SheConnect — networking and mentorship platform for women and gender-expansive folks in tech",
     ["women-in-tech", "mentorship", "networking", "civic-tech", "community"]),

    ("liftup-collective",
     "Lift Up Collective — mutual support and professional development platform for community advancement",
     ["community", "professional-development", "collective", "civic-tech", "solidarity-economy"]),

    ("climacal-boston",
     "ClimaCal Boston — compact climate and sustainability event calendar for the Boston area",
     ["climate", "boston", "calendar", "civic-tech", "javascript"]),

    ("custom-furniture-upholstery",
     "Website for a custom furniture and upholstery business — portfolio, services, and contact",
     ["local-business", "furniture", "landing-page", "javascript", "cloudflare-pages"]),

    ("self-published-poet-website",
     "Website template for self-published poets — showcase works, events, and books for sale",
     ["poetry", "personal-site", "artist", "creative", "javascript"]),

    ("pipeline-game",
     "Browser-based pipeline puzzle game — logic and strategy built with vanilla JavaScript",
     ["game", "puzzle", "browser-game", "javascript", "creative-coding"]),

    ("decorators-workroom-website",
     "Business website for an interior decorators workroom and design studio",
     ["local-business", "interior-design", "landing-page", "javascript", "cloudflare-pages"]),

    ("generative-art-nft",
     "Generative art engine for creating unique NFT collections using algorithmic design",
     ["generative-art", "nft", "blockchain", "creative-coding", "javascript"]),

    ("room-GPT",
     "AI-powered room redesign tool — upload a photo and get a GPT-styled interior design",
     ["ai-tools", "gpt", "interior-design", "javascript", "creative-coding"]),

    ("wave-portal-app",
     "Wave Portal — web3 social messaging app built on Ethereum with Solidity smart contracts",
     ["web3", "ethereum", "blockchain", "solidity", "javascript"]),

    ("blockchain-xp",
     "Blockchain development experiments and learning projects in Solidity and web3.js",
     ["blockchain", "web3", "ethereum", "solidity", "learning"]),

    ("password-generator",
     "Secure password generator with customizable length, character sets, and copy-to-clipboard",
     ["security", "password", "utility", "javascript", "tool"]),

    ("root-studio",
     "Root Studio — creative and digital production space for community-centered storytelling",
     ["creative-studio", "community", "storytelling", "javascript", "civic-tech"]),

    ("blog",
     "Personal blog — writing on tech, community, liberation, and building a more just world",
     ["blog", "personal-site", "writing", "javascript", "cloudflare-pages"]),
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
