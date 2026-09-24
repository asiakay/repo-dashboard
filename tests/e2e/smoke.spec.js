import { test, expect } from "@playwright/test";

// ── Shared API fixtures ──────────────────────────────────────────────────────

const EMPTY_WORK_ITEMS = [];
const EMPTY_TASKS = [];
const EMPTY_PRIORITY = { items: [], bottlenecks: [] };
const EMPTY_OKR_STATS = {
  okrs: [],
  today: { date: new Date().toISOString().slice(0, 10), tasks: [] },
};
const EMPTY_RESOURCES = [];
const EMPTY_REPO_SUMMARY = [];

const SAMPLE_REPOS = {
  count: 2,
  generated_at: new Date().toISOString(),
  repos: [
    {
      name: "repo-dashboard",
      full_name: "asiakay/repo-dashboard",
      url: "https://github.com/asiakay/repo-dashboard",
      description: "Live GitHub repo health dashboard",
      updated_at: new Date().toISOString(),
      language: "JavaScript",
      open_issues: 2,
      stars: 1,
      forks: 0,
      topics: ["cloudflare", "dashboard"],
      health: "green",
    },
    {
      name: "solar-roots",
      full_name: "asiakay/solar-roots",
      url: "https://github.com/asiakay/solar-roots",
      description: "Solar co-op platform",
      updated_at: new Date().toISOString(),
      language: "Python",
      open_issues: 0,
      stars: 0,
      forks: 0,
      topics: [],
      health: "yellow",
    },
  ],
};

const SAMPLE_TASKS = [
  { id: 1, description: "Write grant narrative", okr_id: "KR-1.1", status: "In Progress", started_at: "2026-09-01T10:00:00Z", completed_at: null, time_spent: "2h", objective: "Anchor Funding", key_result: "Submit grant" },
  { id: 2, description: "Set up CI pipeline",   okr_id: "KR-2.1", status: "To Do",        started_at: null,                     completed_at: null, time_spent: null,  objective: "Ship v2",        key_result: "CI green"      },
  { id: 3, description: "Deploy to production",  okr_id: "KR-2.1", status: "Done",         started_at: "2026-09-10T09:00:00Z",   completed_at: "2026-09-10T11:00:00Z", time_spent: "1h", objective: "Ship v2", key_result: "CI green" },
];

// Intercepts all API endpoints and external calls before each test
async function mockAllAPIs(page) {
  await page.route("**/api/me", (route) =>
    route.fulfill({ json: { email: null, authenticated: false } })
  );
  await page.route("**/api/work-items", (route) =>
    route.fulfill({ json: EMPTY_WORK_ITEMS })
  );
  await page.route("**/api/priority", (route) =>
    route.fulfill({ json: EMPTY_PRIORITY })
  );
  await page.route("**/api/okr-stats", (route) =>
    route.fulfill({ json: EMPTY_OKR_STATS })
  );
  await page.route("**/api/resources**", (route) =>
    route.fulfill({ json: EMPTY_RESOURCES })
  );
  await page.route("**/api/repo-task-summary", (route) =>
    route.fulfill({ json: EMPTY_REPO_SUMMARY })
  );
  await page.route("**/api/repos", (route) =>
    route.fulfill({ json: SAMPLE_REPOS })
  );
  await page.route("**/data/repos.json", (route) =>
    route.fulfill({ json: SAMPLE_REPOS })
  );
  await page.route("**/api/tasks**", (route) =>
    route.fulfill({ json: EMPTY_TASKS })
  );
  await page.route("**/data/pull_requests.json", (route) =>
    route.fulfill({ json: [] })
  );
  // Block external college-tracker calls
  await page.route("*college-tracker*", (route) => route.fulfill({ json: [] }));
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe("Page shell", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAPIs(page);
    await page.goto("/");
  });

  test("has correct title", async ({ page }) => {
    await expect(page).toHaveTitle(/Repo Dashboard/);
  });

  test("renders all tab buttons", async ({ page }) => {
    const tabs = ["Today", "Capacity", "OKR Progress", "Repos", "Active Work", "Agent Tasks", "Priority", "Pipeline", "Pull Requests"];
    for (const label of tabs) {
      await expect(page.getByRole("tab", { name: label })).toBeVisible();
    }
  });

  test("Today tab is active by default", async ({ page }) => {
    await expect(page.getByRole("tab", { name: "Today" })).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#view-today")).toBeVisible();
  });

  test("switching tabs shows correct panel and hides others", async ({ page }) => {
    await page.getByRole("tab", { name: "Repos" }).click();
    await expect(page.locator("#view-repos")).toBeVisible();
    await expect(page.locator("#view-today")).not.toBeVisible();
    await expect(page.getByRole("tab", { name: "Repos" })).toHaveAttribute("aria-selected", "true");
  });
});

test.describe("Repos tab", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAPIs(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Repos" }).click();
  });

  test("renders repo cards", async ({ page }) => {
    await expect(page.locator(".repo-card")).toHaveCount(2);
  });

  test("first repo card shows correct name and description", async ({ page }) => {
    const first = page.locator(".repo-card").first();
    await expect(first).toContainText("repo-dashboard");
    await expect(first).toContainText("Live GitHub repo health dashboard");
  });

  test("stat pills update with repo counts", async ({ page }) => {
    await expect(page.locator("#stat-total")).toContainText("2");
  });

  test("shows error state when API returns an error", async ({ page }) => {
    // Navigate fresh with a broken repos endpoint
    await page.route("**/api/repos", (route) =>
      route.fulfill({ status: 502, json: { error: true, message: "GitHub API returned no repos" } })
    );
    await page.route("**/data/repos.json", (route) =>
      route.fulfill({ status: 404, body: "Not Found" })
    );
    await page.reload();
    await page.getByRole("tab", { name: "Repos" }).click();
    // summary-text should indicate no repos loaded (0 or error message)
    const summaryText = page.locator("#summary-text");
    await expect(summaryText).not.toContainText("Loading");
  });
});

test.describe("Pipeline tab", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAPIs(page);
    // Override tasks with sample data that has all three statuses
    await page.route("**/api/tasks**", (route) =>
      route.fulfill({ json: SAMPLE_TASKS })
    );
    await page.goto("/");
    await page.getByRole("tab", { name: "Pipeline" }).click();
  });

  test("renders three kanban columns", async ({ page }) => {
    await expect(page.locator(".pipeline-col")).toHaveCount(3);
  });

  test("column headers are In Progress, To Do, Done", async ({ page }) => {
    const labels = page.locator(".pipeline-col-label");
    await expect(labels.nth(0)).toContainText("In Progress");
    await expect(labels.nth(1)).toContainText("To Do");
    await expect(labels.nth(2)).toContainText("Done");
  });

  test("tasks appear in the correct column", async ({ page }) => {
    const inProgressCol = page.locator(".pipeline-col-inprogress");
    await expect(inProgressCol.locator(".pipeline-card")).toHaveCount(1);
    await expect(inProgressCol).toContainText("Write grant narrative");

    const todoCol = page.locator(".pipeline-col-todo");
    await expect(todoCol.locator(".pipeline-card")).toHaveCount(1);
    await expect(todoCol).toContainText("Set up CI pipeline");

    const doneCol = page.locator(".pipeline-col-done");
    await expect(doneCol.locator(".pipeline-card")).toHaveCount(1);
    await expect(doneCol).toContainText("Deploy to production");
  });

  test("empty state message shown when no tasks exist", async ({ page }) => {
    await page.route("**/api/tasks**", (route) =>
      route.fulfill({ json: [] })
    );
    await page.reload();
    await page.getByRole("tab", { name: "Pipeline" }).click();
    const board = page.locator("#pipeline-board");
    await expect(board).toContainText("No tasks found");
  });
});

test.describe("Active Work tab", () => {
  test.beforeEach(async ({ page }) => {
    await mockAllAPIs(page);
    await page.goto("/");
    await page.getByRole("tab", { name: "Active Work" }).click();
  });

  test("shows the Add work item button", async ({ page }) => {
    await expect(page.locator("#btn-add-work-item")).toBeVisible();
  });

  test("shows empty-state message when no work items exist", async ({ page }) => {
    const container = page.locator("#work-items-list, #view-active-work");
    await expect(container).toContainText(/nothing active|all clear/i);
  });
});
