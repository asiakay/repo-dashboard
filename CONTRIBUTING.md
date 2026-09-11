# Contributing

## Data handling — public repo, sensitive ecosystem data

`asiakay/repo-dashboard` and its connected app `asiakay/masshealth-crm` are **public repositories**.

**The following must never be committed to seed data, fixtures, config, or any file that enters git history:**

- Real patient or ward names (even first name only)
- Real docket, case, or court file numbers
- Real court or county names linked to an active case
- Real street addresses or unit numbers for a ward or care facility contact
- Personal contact details for family members or legal representatives
- Facility contact details beyond what the facility publicly lists itself (website, NPI registry, CMS data)

**Real case data lives only in the live D1 database and private records — never in git.**

**Fixtures and seed data must use:**

- Fictitious names in the format: first name + last initial only (e.g. "Arthur V.", "Eleanor V."), or fully synthetic surname pairs where a shared family identity is needed (as with existing "Vance" fixtures)
- A clearly synthetic docket number with a `SAMPLE-` prefix (e.g. `SAMPLE-0000-GD`)
- No real court, county, or jurisdiction names tied to an active case
- A prominent `// SAMPLE DATA` or `/* SAMPLE */` comment adjacent to any fixture block

**OKR and task descriptions** committed in migration files (e.g. `db/migrations/0004_dad_okrs.sql`) may describe legal stages and regulatory citations — that is public process information, not case data — but must not name any real person, court, or specific filing date.

If you are unsure whether a detail is safe to commit, leave it out and add it directly in the live database instead.
