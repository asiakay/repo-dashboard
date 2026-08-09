# User Stories

## Repository Overview

1. As a developer, I want a single page showing all my GitHub repos with health badges so I can prioritize maintenance at a glance.
2. As a developer, I want to filter repos by keyword, language, and health status so I can find specific repos quickly.
3. As a developer, I want to sort repos by last updated, name, open issues, or stars so I can surface the most relevant repos for my current focus.
4. As a developer, I want clickable summary pills (Total / Healthy / Needs Attention / Stale) so I can jump directly to a filtered set without typing.
5. As a developer, I want to see a live-site link on repos that have a homepage so I can visit deployed products without going to GitHub.
6. As a developer, I want to see open issue counts linked directly to the repo's issues tab so I can jump into triage in one click.
7. As a developer, I want repo cards to show a work-status badge when active work exists so I don't have to switch tabs to know what's in flight.

## Active Work Tracking

8. As a project owner, I want to track work items tied to specific repos with statuses (not started / in progress / blocked / done) so I know what needs attention.
9. As a project owner, I want work items grouped by status (In Progress first, then Blocked, then Not Started) so the most urgent work is always at the top.
10. As a project owner, I want to add a new work item inline without leaving the dashboard so I can capture tasks immediately.
11. As a project owner, I want to edit a work item's status, assignee, and notes inline so I can keep the tracker current without a separate admin tool.
12. As a project owner, I want a dependency warning when a work item's prerequisite repo still has open work so I don't start blocked tasks prematurely.
13. As a project owner, I want a toggle to show completed items so I can review what's been done without cluttering the default view.

## Agent Task Tracking

14. As an AI workflow manager, I want a dedicated Agent Tasks tab filtered to AI-assigned items so I can review all handoffs in one place.
15. As an AI workflow manager, I want agent tasks sorted by most-recently-started so the most active handoffs are visible first.
16. As an AI workflow manager, I want a notes field on each task so I can record what came back from the agent alongside the original request.

## Data Pipeline

17. As a developer, I want repo data to refresh automatically every hour via CI so the health signals stay accurate without manual effort.
18. As a developer, I want a static `repos.json` fallback committed by CI so the dashboard works even when the live API is unavailable.
19. As a developer, I want a "Refreshed X minutes ago" label in the footer so I always know how fresh the data is.
