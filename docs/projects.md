# Projects index — handoff cards

The **Projects** tab holds one card per project page or app (artifacts, Cloudflare
sites, GitHub Pages, anything). A card exists so that someone else — a collaborator,
a client, a future you, or an agent — can understand a project and pick it up
without a walkthrough.

## What every card should answer

| Field | Question it answers |
|---|---|
| **Name** | What is it called? |
| **Hook** | Why does it matter, in one line? |
| **One sentence** (`summary`) | What is it, and who is it for? |
| **Status** | `live`, `draft`, `paused` or `archived` |
| **Front end** (`front_end_url`, `front_end_host`) | Where can I see it, and where is it hosted? |
| **Back end** (`back_end_type`, `back_end_url`) | Where does its data go (a Tally form, D1, nothing)? |
| **Edit page** (`edit_front_end`) | How do I change the page? A link, or plain instructions. |
| **Edit back end** (`edit_back_end`) | How do I change the form, database or service? |
| **Repo** (`repo_name`) | Which GitHub repo, if any? Must match a name on the Repos tab. |
| **Handoff notes** | What must I know before building on it — placeholders, limits, paid plans, secrets I'll need to ask for? |
| **Value** (`value_note`) | Portfolio piece, sellable template, or community asset? Put a price here if there is one. |
| **Tags** | Comma-separated, for grouping. |

A card shows **"Ready to hand off"** once it has a summary, a front-end link, edit
instructions and handoff notes. Until then it lists what's missing.

Never put passwords, API keys or tokens on a card — the read endpoint is open.
Write "ask Asia for the Tally login" instead.

## Three ways to add or update a card

1. **In the dashboard** — Projects tab → **+ New card**, or **Edit** on a card.
2. **From any Claude connected to the MCP endpoint** — the `upsert_project` tool.
   It matches an existing card by `id`, else by `slug` (derived from the name), so
   saying "update the Creative Principle card: status paused" changes that card
   instead of creating a duplicate. Only the fields passed change.
3. **Over HTTP** — `POST /api/projects` (create, or update by slug) and
   `PUT /api/projects/:id` (partial update). Both need write auth, like every
   other write endpoint (Cloudflare Access session or `WRITE_TOKEN`).

## API

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/projects` | open | Optional `?status=live`. Live first, then by last update. |
| POST | `/api/projects` | write | Creates (201) or updates the card with the same slug (200). |
| GET | `/api/projects/:id` | open | One card. |
| PUT | `/api/projects/:id` | write | Partial update; empty strings clear a field. 409 if the new slug is taken. |
| DELETE | `/api/projects/:id` | write | |

## Storage

`projects` table in the `repo-dashboard-work-items` D1 database. Defined in
`db/schema.sql` (re-applied on every push to `main`, so it exists as soon as this
merges) and recorded in `db/migrations/0011_projects_index.sql`. Shared logic for
the API and MCP tools is in `functions/_shared/projects.js`; the UI is
`public/js/projects.js`.
