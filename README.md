A lightweight GitHub repository dashboard for organizing projects, tracking repository metadata, and managing your development workspace.

## Develop

```bash
npm ci
npm run seed        # create the local D1 database from db/schema.sql
npm run dev         # wrangler pages dev on http://localhost:8788
npm test            # vitest; runs in CI on every pull request
```

Static Cloudflare Pages site (vanilla HTML/CSS/JS in `public/`, Pages Functions in `functions/`, D1 for state). No build step.

## Docs

- [`docs/architecture.md`](docs/architecture.md): how repo health data flows from GitHub through the D1 cache to the dashboard and the MCP `list_repos` tool, plus the hourly live-site probe, failure modes and troubleshooting.
- [`CLAUDE.md`](CLAUDE.md): full project context: data model, MCP endpoint and tools, frontend features.
- [`CONTRIBUTING.md`](CONTRIBUTING.md)
