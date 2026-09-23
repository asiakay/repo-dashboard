// ============================================================
// Write auth — CF Access (production) or WRITE_TOKEN (local dev)
// ============================================================
function writeHeaders() {
  const token = localStorage.getItem("writeToken");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function collegeWriteHeaders() {
  const token = localStorage.getItem("collegeWriteToken");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

function showSessionExpiredBanner() {
  let banner = document.getElementById("auth-expired-banner");
  if (banner) return;
  banner = document.createElement("div");
  banner.id = "auth-expired-banner";
  banner.className = "auth-expired-banner";
  banner.setAttribute("role", "alert");
  banner.innerHTML = `
    <span>Session expired — please <button class="auth-refresh-btn" onclick="location.reload()">refresh</button> to re-authenticate.</span>
    <button class="auth-dismiss-btn" aria-label="Dismiss" onclick="this.closest('#auth-expired-banner').remove()">✕</button>
  `;
  document.body.prepend(banner);
}

async function handleWriteResponse(res, retryFn) {
  if (res.status === 401) {
    // In production, CF Access is the gate — a 401 means the session expired.
    // In local dev, try the stored WRITE_TOKEN; if missing, prompt once and retry.
    const existingToken = localStorage.getItem("writeToken");
    if (!existingToken) {
      const token = prompt(
        "Local dev: enter your WRITE_TOKEN (saved in this browser):"
      );
      if (token) {
        localStorage.setItem("writeToken", token.trim());
        return retryFn();
      }
    } else {
      // Token was sent but rejected — clear it and show the expiry banner.
      localStorage.removeItem("writeToken");
    }
    showSessionExpiredBanner();
    throw new Error("Not authenticated — request cancelled.");
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Load and display the authenticated user identity from /api/me.
async function loadIdentity() {
  try {
    const res = await fetch("/api/me");
    if (!res.ok) return;
    const { email, authenticated } = await res.json();
    if (authenticated && email) {
      const chip = document.getElementById("identity-chip");
      chip.textContent = `● ${email}`;
      chip.hidden = false;
    }
  } catch {
    // Identity display is best-effort; silently skip on error.
  }
}

const COLLEGE_TRACKER_URL = "https://college-tracker.asialakaygrady-6d4.workers.dev";

let allRepos = [];
let filteredRepos = [];
let workItems = [];
let priorityData = { items: [], bottlenecks: [] };
let okrStats = null;
let repoTaskData = [];
let pipelineTasks = [];
let resources = [];
let collegeDeadlines = [];
let collegeDailyTasks = [];
let collegeError = null;
let pipelineError = null;
let pipelineOkrFilter = "";
let okrCategoryFilter = "";
const expandedOkrIds = new Set();
const okrTaskCache = {};
let workItemsError = null;
let priorityError = null;
let reposError = null;
let okrStatsError = null;
let resourcesError = null;
let activeWorkView = "active"; // "active" | "completed"

// DOM refs — repos view
const searchInput = document.getElementById("search");
const languageFilter = document.getElementById("language-filter");
const healthFilter = document.getElementById("health-filter");
const sortBy = document.getElementById("sort-by");
const repoList = document.getElementById("repo-list");
const summaryText = document.getElementById("summary-text");
const dataFreshness = document.getElementById("data-freshness");

// Stats pills
const statTotal = document.getElementById("stat-total");
const statGreen = document.getElementById("stat-green");
const statYellow = document.getElementById("stat-yellow");
const statRed = document.getElementById("stat-red");

// Clickable stat pill filtering
const pillMeta = [
  { pill: document.getElementById("pill-total"), health: "" },
  { pill: document.getElementById("pill-green"), health: "green" },
  { pill: document.getElementById("pill-yellow"), health: "yellow" },
  { pill: document.getElementById("pill-red"), health: "red" },
];

pillMeta.forEach(({ pill, health }) => {
  const activate = () => {
    switchTab("repos");
    const current = healthFilter.value;
    healthFilter.value = current === health ? "" : health;
    updateActivePill();
    applyFilters();
  };
  pill.addEventListener("click", activate);
  pill.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(); } });
});

function updateActivePill() {
  const active = healthFilter.value;
  pillMeta.forEach(({ pill, health }) => {
    pill.classList.toggle("active", health === active);
  });
}

// ============================================================
// Tab switching
// ============================================================
const TABS = ["today", "capacity", "repos", "active-work", "agent-tasks", "priority", "okr-progress", "pipeline", "pull-requests"];

function switchTab(tabId) {
  TABS.forEach(id => {
    const view = document.getElementById(`view-${id}`);
    if (view) view.classList.toggle("hidden", id !== tabId);
  });
  document.querySelectorAll(".tab-btn").forEach(btn => {
    const isActive = btn.dataset.tab === tabId;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  if (tabId === "today") renderToday();
  if (tabId === "capacity") renderCapacity();
  if (tabId === "active-work") renderActiveWork();
  if (tabId === "agent-tasks") renderAgentTasks();
  if (tabId === "priority") renderPriority();
  if (tabId === "okr-progress") renderOkrProgress();
  if (tabId === "pipeline") renderPipeline();
  if (tabId === "pull-requests") renderPullRequests();
}

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

document.querySelectorAll(".work-toggle-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    activeWorkView = btn.dataset.view;
    renderActiveWork();
  });
});

document.querySelector(".tab-nav-inner").addEventListener("keydown", e => {
  const tabs = [...document.querySelectorAll(".tab-btn")];
  const idx = tabs.indexOf(document.activeElement);
  if (idx === -1) return;
  if (e.key === "ArrowRight") { tabs[(idx + 1) % tabs.length].focus(); e.preventDefault(); }
  if (e.key === "ArrowLeft")  { tabs[(idx - 1 + tabs.length) % tabs.length].focus(); e.preventDefault(); }
  if (e.key === "Home") { tabs[0].focus(); e.preventDefault(); }
  if (e.key === "End")  { tabs[tabs.length - 1].focus(); e.preventDefault(); }
});

// ============================================================
// Data loading
// ============================================================
async function loadRepos() {
  try {
    let data;
    try {
      const res = await fetch("/api/repos");
      data = await res.json();
    } catch {
      const res = await fetch("/data/repos.json");
      data = await res.json();
    }

    if (data && data.error) {
      reposError = data.message || "GitHub API error";
      summaryText.textContent = "";
      renderRepos();
      return;
    }

    if (Array.isArray(data)) {
      allRepos = data;
    } else if (data && Array.isArray(data.repos)) {
      allRepos = data.repos;
      if (data.generated_at) showFreshness(data.generated_at);
      if (data.stale) dataFreshness.textContent += " · using cached data";
    } else {
      reposError = "No repo data found";
      summaryText.textContent = "";
      renderRepos();
      return;
    }

    reposError = null;
    filteredRepos = [...allRepos];
    populateLanguageFilter();
    populateRepoDatalist();
    updateStats();
    applySorting();
    renderRepos();
    summaryText.textContent = `Showing ${filteredRepos.length} repositories`;

  } catch (err) {
    console.error("Error loading repos:", err);
    reposError = err.message;
    summaryText.textContent = "";
    renderRepos();
  }
}

async function loadWorkItems() {
  try {
    const res = await fetch("/api/work-items");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    workItems = await res.json();
    workItemsError = null;
  } catch (err) {
    console.warn("Could not load work items:", err);
    workItems = [];
    workItemsError = err.message;
  }
}

async function loadPriorityData() {
  try {
    const res = await fetch("/api/priority");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    priorityData = await res.json();
    priorityError = null;
  } catch (err) {
    console.warn("Could not load priority data:", err);
    priorityData = { items: [], bottlenecks: [] };
    priorityError = err.message;
  }
}

async function retryRepos() {
  reposError = null;
  summaryText.textContent = "Loading…";
  repoList.innerHTML = "";
  await loadRepos();
  renderRepos();
}

async function retryWorkItems() {
  workItemsError = null;
  await loadWorkItems();
  renderActiveWork();
  renderAgentTasks();
  renderRepos();
}

async function retryPriority() {
  priorityError = null;
  await loadPriorityData();
  renderPriority();
}

async function retryCollegeDeadlines() {
  collegeError = null;
  await loadCollegeDeadlines();
  renderPriority();
}

async function loadOkrStats() {
  try {
    const res = await fetch("/api/okr-stats");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    okrStats = await res.json();
    okrStatsError = null;
  } catch (err) {
    console.warn("Could not load OKR stats:", err);
    okrStats = null;
    okrStatsError = err.message;
  }
}

async function retryOkrStats() {
  okrStatsError = null;
  await loadOkrStats();
  renderOkrProgress();
}

async function loadPipelineTasks() {
  try {
    const res = await fetch("/api/tasks?include_done=true");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pipelineTasks = await res.json();
    pipelineError = null;
  } catch (err) {
    console.warn("Could not load pipeline tasks:", err);
    pipelineTasks = [];
    pipelineError = err.message;
  }
}

async function retryPipeline() {
  pipelineError = null;
  await loadPipelineTasks();
  renderPipeline();
  renderFocusStrip();
}

async function loadCollegeDeadlines() {
  try {
    const res = await fetch(`${COLLEGE_TRACKER_URL}/api/deadlines?days=14`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    collegeDeadlines = data.deadlines || [];
    collegeError = null;
  } catch (err) {
    console.warn("Could not load college deadlines:", err);
    collegeDeadlines = [];
    collegeError = err.message;
  }
}

async function loadCollegeDailyTasks() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await fetch(`${COLLEGE_TRACKER_URL}/api/tasks?date=${today}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    collegeDailyTasks = data.tasks || [];
  } catch (err) {
    console.warn("Could not load college daily tasks:", err);
    collegeDailyTasks = [];
  }
}

async function loadResources() {
  try {
    const res = await fetch("/api/resources");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    resources = await res.json();
    resourcesError = null;
  } catch (err) {
    console.warn("Could not load resources:", err);
    resources = [];
    resourcesError = err.message;
  }
}

async function loadRepoTaskData() {
  try {
    const res = await fetch("/api/repo-task-summary");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    repoTaskData = await res.json();
  } catch {
    repoTaskData = [];
  }
}

function showFreshness(isoString) {
  const mins = Math.round((Date.now() - new Date(isoString)) / 60000);
  const label = mins < 2
    ? "Refreshed just now"
    : mins < 60
    ? `Refreshed ${mins}m ago`
    : `Refreshed ${Math.round(mins / 60)}h ago`;
  dataFreshness.textContent = " · " + label;
}

function timeAgo(dateStr) {
  if (!dateStr) return null;
  const diff = Date.now() - new Date(dateStr);
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// ============================================================
// Today view
// ============================================================
function renderToday() {
  const container = document.getElementById("today-list");

  const myActive = workItems.filter(w => w.status === "in_progress" && w.assigned_to === "asia");
  const agentBlocked = workItems.filter(w => w.assigned_to === "agent" && w.status === "blocked");
  const bottlenecks = priorityData.bottlenecks || [];
  const myActiveRepos = new Set(myActive.map(w => w.repo_name));
  const topPriority = (priorityData.items || []).filter(i => i.tier_num <= 2 && !myActiveRepos.has(i.repo_name));
  const okrActive = pipelineTasks.filter(t => t.status === "In Progress");
  const todayLogged = (okrStats && okrStats.today && okrStats.today.tasks) ? okrStats.today.tasks : [];
  const upcomingAssignments = collegeDeadlines.slice().sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

  const totalSignals = myActive.length + agentBlocked.length + bottlenecks.length + topPriority.length + upcomingAssignments.filter(a => {
    const days = a.due_date ? Math.ceil((new Date(a.due_date) - new Date()) / 86400000) : 999;
    return days <= 7;
  }).length;

  let html = `<div class="today-header">
    <h2 class="today-headline">${totalSignals === 0 ? "Nothing urgent right now." : `${totalSignals} item${totalSignals !== 1 ? "s" : ""} need${totalSignals === 1 ? "s" : ""} your attention`}</h2>
    <span class="today-subline">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</span>
  </div>`;

  if (myActive.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label">My work in flight <span class="work-group-count">${myActive.length}</span></h3>`;
    myActive.forEach(item => {
      const startedAgo = timeAgo(item.started_at);
      html += `<div class="today-row today-row-mine">
        <div class="today-row-main">
          <span class="badge badge-work badge-work-in_progress">In Progress</span>
          <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
          <span class="work-task">${escapeText(item.task_description)}</span>
        </div>
        <div class="today-row-meta">
          ${startedAgo ? `<span class="work-time">Started ${startedAgo}</span>` : ""}
          <button class="btn-ghost btn-sm" onclick="switchTab('active-work')">Edit →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (agentBlocked.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label today-section-urgent">Agent blocked — needs you <span class="work-group-count">${agentBlocked.length}</span></h3>`;
    agentBlocked.forEach(item => {
      html += `<div class="today-row today-row-blocked">
        <div class="today-row-main">
          <span class="badge badge-work badge-work-blocked">Blocked</span>
          <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
          <span class="work-task">${escapeText(item.task_description)}</span>
        </div>
        ${item.notes ? `<div class="today-row-notes">${escapeText(item.notes)}</div>` : ""}
        <div class="today-row-meta">
          <button class="btn-ghost btn-sm" onclick="switchTab('active-work');setTimeout(()=>openEditForm(${item.id}),0)">Unblock →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (bottlenecks.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label today-section-urgent">Deadline pressure — no work in flight <span class="work-group-count">${bottlenecks.length}</span></h3>`;
    bottlenecks.forEach(b => {
      const isOverdue = b.days_remaining <= 0;
      const daysLabel = isOverdue ? "OVERDUE" : `${b.days_remaining}d remaining`;
      html += `<div class="today-row today-row-deadline">
        <div class="today-row-main">
          <span class="badge badge-domain badge-domain-${escapeText(b.domain)}">${escapeText(b.domain)}</span>
          <span class="work-task">${escapeText(b.title)}</span>
        </div>
        <div class="today-row-meta">
          <span class="${isOverdue || b.days_remaining <= 3 ? "text-urgent" : "work-time"}">${daysLabel}</span>
          <span class="work-time">due ${escapeText(b.due_date)}</span>
          <button class="btn-ghost btn-sm" onclick="switchTab('priority')">Priority →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (upcomingAssignments.length > 0) {
    const urgentCount = upcomingAssignments.filter(a => {
      const days = a.due_date ? Math.ceil((new Date(a.due_date) - new Date()) / 86400000) : 999;
      return days <= 7;
    }).length;
    const labelClass = urgentCount > 0 ? "today-section-urgent" : "";
    html += `<div class="today-section">
      <h3 class="today-section-label ${labelClass}">Assignments due soon <span class="work-group-count">${upcomingAssignments.length}</span></h3>`;
    upcomingAssignments.forEach(a => {
      const days = a.due_date ? Math.ceil((new Date(a.due_date) - new Date()) / 86400000) : null;
      const isOverdue = days !== null && days <= 0;
      const daysLabel = days === null ? "" : isOverdue ? "OVERDUE" : days === 0 ? "due today" : `${days}d`;
      const urgentClass = isOverdue || days <= 3 ? "text-urgent" : days <= 7 ? "work-time" : "work-time";
      html += `<div class="today-row today-row-deadline">
        <div class="today-row-main">
          <span class="badge badge-college-type badge-college-${escapeText((a.deliverable_type || "Project").toLowerCase())}">${escapeText(a.deliverable_type || "Project")}</span>
          <span class="work-task">${escapeText(a.title)}</span>
        </div>
        <div class="today-row-meta">
          <span class="work-time">${escapeText(a.course_name || a.course_id)}</span>
          ${daysLabel ? `<span class="${urgentClass}">${daysLabel}</span>` : ""}
          ${a.due_date ? `<span class="work-time">due ${escapeText(a.due_date)}</span>` : ""}
          ${a.weight_pct ? `<span class="pipeline-chip">${a.weight_pct}%</span>` : ""}
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (topPriority.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label">High priority — start next <span class="work-group-count">${topPriority.length}</span></h3>`;
    topPriority.forEach(item => {
      html += `<div class="today-row">
        <div class="today-row-main">
          <span class="badge badge-tier badge-tier-${item.tier_num}">${item.tier_num}</span>
          <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
          <span class="work-task">${escapeText(item.task_description)}</span>
        </div>
        <div class="today-row-meta">
          <span class="impact-score">${item.impact_score}</span><span class="impact-max">/25</span>
          <span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span>
          <button class="btn-ghost btn-sm" onclick="switchTab('priority')">Details →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (okrActive.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label">OKR tasks in progress <span class="work-group-count">${okrActive.length}</span></h3>`;
    okrActive.forEach(t => {
      html += `<div class="today-row">
        <div class="today-row-main">
          <span class="badge badge-work badge-work-in_progress">In Progress</span>
          <span class="okr-id">${escapeText(t.okr_id)}</span>
          <span class="work-task">${escapeText(t.description)}</span>
        </div>
        <div class="today-row-meta">
          ${t.time_spent ? `<span class="pipeline-chip">${escapeText(t.time_spent)}</span>` : ""}
          <button class="btn-ghost btn-sm" onclick="switchTab('pipeline')">Pipeline →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (totalSignals === 0 && okrActive.length === 0) {
    html += `<p class="empty-state">All clear — nothing requires your attention right now. <button class="btn-link" onclick="switchTab('capacity')">Check Capacity →</button></p>`;
  }

  if (todayLogged.length > 0) {
    html += `<div class="today-section today-log-section">
      <h3 class="today-section-label today-section-dim">Logged today <span class="work-group-count">${todayLogged.length}</span></h3>`;
    todayLogged.forEach(t => {
      html += `<div class="today-row today-row-done">
        <div class="today-row-main">
          <span class="okr-id">${escapeText(t.okr_id)}</span>
          <span class="work-task">${escapeText(t.description)}</span>
        </div>
        ${t.time_spent ? `<div class="today-row-meta"><span class="pipeline-chip">${escapeText(t.time_spent)}</span></div>` : ""}
      </div>`;
    });
    html += `</div>`;
  }

  if (collegeDailyTasks.length > 0) {
    html += `<div class="today-section today-log-section">
      <h3 class="today-section-label today-section-dim">Academic work logged today <span class="work-group-count">${collegeDailyTasks.length}</span></h3>`;
    collegeDailyTasks.forEach(t => {
      html += `<div class="today-row today-row-done">
        <div class="today-row-main">
          <span class="okr-id">${escapeText(t.okr_id)}</span>
          <span class="work-task">${escapeText(t.description)}</span>
        </div>
        <div class="today-row-meta">
          ${t.time_spent ? `<span class="pipeline-chip">${escapeText(t.time_spent)}</span>` : ""}
          ${t.assignment_id ? `<span class="work-time">${escapeText(t.assignment_id)}</span>` : ""}
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  container.innerHTML = html;
}

// ============================================================
// Capacity view
// ============================================================
function computeExpectedPct(okr) {
  if (!okr.target_date || okr.target_date === "Ongoing") return null;
  if (!okr.created_at) return null;
  const target = new Date(okr.target_date);
  const start = new Date(okr.created_at);
  const totalMs = target - start;
  if (totalMs <= 0) return 100;
  const elapsedMs = Date.now() - start;
  return Math.min(100, Math.round((elapsedMs / totalMs) * 100));
}

function renderAllResourcesList() {
  if (!resources.length) return "";
  return `<div class="resource-grid">` +
    resources.map(r => `<div class="resource-card resource-util-${escapeText(r.utilization)}">
      <div class="resource-card-header">
        <span class="resource-name">${escapeText(r.name)}</span>
        <span class="badge resource-badge resource-badge-${escapeText(r.utilization)}">${escapeText(r.utilization)}</span>
      </div>
      <span class="resource-category">${escapeText(r.category.replace("_", " "))}</span>
      ${r.notes ? `<div class="resource-notes">${escapeText(r.notes)}</div>` : ""}
      <div class="resource-card-actions">
        <button class="btn-ghost btn-sm" onclick="openEditResource(${r.id})">Edit</button>
        <button class="btn-ghost btn-sm btn-danger-sm" onclick="deleteResource(${r.id})">Delete</button>
      </div>
    </div>`).join("") + `</div>`;
}

async function deleteResource(id) {
  if (!confirm("Delete this resource?")) return;
  const doDelete = async () => {
    const res = await fetch(`/api/resources/${id}`, {
      method: "DELETE",
      headers: writeHeaders(),
    });
    return handleWriteResponse(res, doDelete);
  };
  try {
    await doDelete();
    resources = resources.filter(r => r.id !== id);
    renderCapacity();
  } catch (err) {
    alert("Failed to delete: " + err.message);
  }
}

function renderAddResourceForm(containerId) {
  const form = document.getElementById(containerId);
  form.innerHTML = `
    <div class="work-form-grid">
      <div class="control">
        <label>Name</label>
        <input id="rf-name" type="text" placeholder="e.g. Grantmatch pipeline, Python/data skills" />
      </div>
      <div class="control">
        <label>Category</label>
        <select id="rf-category">
          <option value="tool_repo">Tool / Repo</option>
          <option value="skill">Skill</option>
          <option value="network">Network / Collaborators</option>
          <option value="financial">Financial</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="control">
        <label>Utilization</label>
        <select id="rf-utilization">
          <option value="abundant">Abundant</option>
          <option value="underused">Underused</option>
          <option value="active">Active</option>
          <option value="depleted">Depleted</option>
          <option value="unknown">Unknown</option>
        </select>
      </div>
      <div class="control">
        <label>Notes (optional)</label>
        <input id="rf-notes" type="text" placeholder="Context about this resource" />
      </div>
    </div>
    <div class="work-form-actions">
      <button class="btn-primary" onclick="saveNewResource()">Save</button>
      <button class="btn-ghost" onclick="document.getElementById('${containerId}').classList.add('hidden')">Cancel</button>
    </div>`;
}

async function saveNewResource() {
  const name = document.getElementById("rf-name").value.trim();
  const category = document.getElementById("rf-category").value;
  const utilization = document.getElementById("rf-utilization").value;
  const notes = document.getElementById("rf-notes").value.trim() || null;

  if (!name) { alert("Name is required."); return; }

  const doSave = async () => {
    const res = await fetch("/api/resources", {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify({ name, category, utilization, notes }),
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    const created = await doSave();
    resources.push(created);
    renderCapacity();
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

function openEditResource(id) {
  const resource = resources.find(r => r.id === id);
  if (!resource) return;

  const form = document.getElementById("resource-edit-form");
  if (!form) return;
  form.classList.remove("hidden");
  form.innerHTML = `
    <div class="work-form-grid">
      <div class="control">
        <label>Name</label>
        <input id="re-name" type="text" value="${escapeText(resource.name)}" />
      </div>
      <div class="control">
        <label>Category</label>
        <select id="re-category">
          <option value="tool_repo" ${resource.category === "tool_repo" ? "selected" : ""}>Tool / Repo</option>
          <option value="skill" ${resource.category === "skill" ? "selected" : ""}>Skill</option>
          <option value="network" ${resource.category === "network" ? "selected" : ""}>Network / Collaborators</option>
          <option value="financial" ${resource.category === "financial" ? "selected" : ""}>Financial</option>
          <option value="other" ${resource.category === "other" ? "selected" : ""}>Other</option>
        </select>
      </div>
      <div class="control">
        <label>Utilization</label>
        <select id="re-utilization">
          <option value="abundant" ${resource.utilization === "abundant" ? "selected" : ""}>Abundant</option>
          <option value="underused" ${resource.utilization === "underused" ? "selected" : ""}>Underused</option>
          <option value="active" ${resource.utilization === "active" ? "selected" : ""}>Active</option>
          <option value="depleted" ${resource.utilization === "depleted" ? "selected" : ""}>Depleted</option>
          <option value="unknown" ${resource.utilization === "unknown" ? "selected" : ""}>Unknown</option>
        </select>
      </div>
      <div class="control">
        <label>Notes</label>
        <input id="re-notes" type="text" value="${escapeText(resource.notes || "")}" />
      </div>
    </div>
    <div class="work-form-actions">
      <button class="btn-primary" onclick="saveEditResource(${id})">Save</button>
      <button class="btn-ghost" onclick="document.getElementById('resource-edit-form').classList.add('hidden')">Cancel</button>
    </div>`;
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveEditResource(id) {
  const name = document.getElementById("re-name").value.trim();
  const category = document.getElementById("re-category").value;
  const utilization = document.getElementById("re-utilization").value;
  const notes = document.getElementById("re-notes").value.trim() || null;

  if (!name) { alert("Name is required."); return; }

  const doSave = async () => {
    const res = await fetch(`/api/resources/${id}`, {
      method: "PUT",
      headers: writeHeaders(),
      body: JSON.stringify({ name, category, utilization, notes }),
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    const updated = await doSave();
    const idx = resources.findIndex(r => r.id === id);
    if (idx !== -1) resources[idx] = updated;
    document.getElementById("resource-edit-form").classList.add("hidden");
    renderCapacity();
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

function renderCapacity() {
  const container = document.getElementById("capacity-list");

  const okrList = (okrStats && okrStats.okrs) ? okrStats.okrs : [];

  const behindPace = okrList
    .filter(o => o.status !== "Completed")
    .map(o => ({ ...o, expected_pct: computeExpectedPct(o) }))
    .filter(o => o.expected_pct !== null && (o.completion_pct || 0) < o.expected_pct - 10);

  const plannedOkrs = okrList.filter(o => o.status === "Planned");

  const asiaNotStarted = workItems.filter(w => w.assigned_to === "asia" && w.status === "not_started");

  const activeRepoNames = new Set(workItems.filter(w => w.status !== "done").map(w => w.repo_name));
  const idleRepos = allRepos
    .filter(r => !activeRepoNames.has(r.name))
    .sort((a, b) => new Date(a.updated_at) - new Date(b.updated_at))
    .slice(0, 10);

  const availableResources = resources.filter(r => ["abundant", "underused"].includes(r.utilization));
  const totalSlack = behindPace.length + plannedOkrs.length + asiaNotStarted.length;

  let html = `<div class="today-header">
    <h2 class="today-headline">Capacity</h2>
    <span class="today-subline">${totalSlack} area${totalSlack !== 1 ? "s" : ""} with room to move</span>
  </div>`;

  if (availableResources.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label today-section-resource">Available resources <span class="work-group-count">${availableResources.length}</span></h3>
      <div class="resource-grid">`;
    availableResources.forEach(r => {
      html += `<div class="resource-card resource-util-${escapeText(r.utilization)}">
        <div class="resource-card-header">
          <span class="resource-name">${escapeText(r.name)}</span>
          <span class="badge resource-badge resource-badge-${escapeText(r.utilization)}">${escapeText(r.utilization)}</span>
        </div>
        <span class="resource-category">${escapeText(r.category.replace("_", " "))}</span>
        ${r.notes ? `<div class="resource-notes">${escapeText(r.notes)}</div>` : ""}
        <div class="resource-card-actions">
          <button class="btn-ghost btn-sm" onclick="openEditResource(${r.id})">Edit</button>
        </div>
      </div>`;
    });
    html += `</div></div>`;
  }

  if (behindPace.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label today-section-warn">OKRs behind pace <span class="work-group-count">${behindPace.length}</span></h3>`;
    behindPace.forEach(okr => {
      const gap = okr.expected_pct - Math.round(okr.completion_pct || 0);
      html += `<div class="today-row today-row-behind">
        <div class="today-row-main">
          <span class="okr-id">${escapeText(okr.id)}</span>
          <span class="work-task">${escapeText(okr.key_result)}</span>
        </div>
        <div class="today-row-meta">
          <span class="capacity-pace-gap">−${gap}% behind</span>
          <span class="work-time">${Math.round(okr.completion_pct || 0)}% done, expected ${okr.expected_pct}%</span>
          <button class="btn-ghost btn-sm" onclick="switchTab('okr-progress')">OKRs →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (plannedOkrs.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label">Planned OKRs — not started <span class="work-group-count">${plannedOkrs.length}</span></h3>`;
    plannedOkrs.forEach(okr => {
      html += `<div class="today-row">
        <div class="today-row-main">
          <span class="badge badge-work badge-work-not_started">Planned</span>
          <span class="okr-id">${escapeText(okr.id)}</span>
          <span class="work-task">${escapeText(okr.key_result)}</span>
        </div>
        ${okr.target_date ? `<div class="today-row-meta"><span class="work-time">Target: ${escapeText(okr.target_date)}</span></div>` : ""}
      </div>`;
    });
    html += `</div>`;
  }

  if (asiaNotStarted.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label">My queue — not started <span class="work-group-count">${asiaNotStarted.length}</span></h3>`;
    asiaNotStarted.forEach(item => {
      html += `<div class="today-row">
        <div class="today-row-main">
          <span class="badge badge-work badge-work-not_started">Not started</span>
          <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
          <span class="work-task">${escapeText(item.task_description)}</span>
        </div>
        <div class="today-row-meta">
          ${item.depends_on_repo ? `<span class="work-dep">→ needs ${escapeText(item.depends_on_repo)}</span>` : ""}
          <button class="btn-ghost btn-sm" onclick="switchTab('active-work')">Start →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (idleRepos.length > 0) {
    html += `<div class="today-section">
      <h3 class="today-section-label today-section-dim">Repos with no active work <span class="work-group-count">${idleRepos.length}${allRepos.filter(r => !activeRepoNames.has(r.name)).length > 10 ? "+" : ""}</span></h3>
      <p class="today-section-sub">Oldest activity first — candidates to invest in or archive.</p>`;
    idleRepos.forEach(repo => {
      const daysStale = Math.floor((Date.now() - new Date(repo.updated_at)) / 86400000);
      html += `<div class="today-row">
        <div class="today-row-main">
          <span class="badge badge-health-${repo.health}"><span class="badge-dot" aria-hidden="true"></span>${repo.health.toUpperCase()}</span>
          <a href="${escapeText(repo.url)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(repo.name)}</a>
          <span class="work-task" style="color:var(--text-muted)">${escapeText(repo.description || "No description")}</span>
        </div>
        <div class="today-row-meta">
          <span class="work-time">${daysStale}d idle</span>
          <button class="btn-ghost btn-sm" onclick="switchTab('repos')">Repos →</button>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (totalSlack === 0 && availableResources.length === 0 && idleRepos.length === 0) {
    html += `<p class="empty-state">All projects have active work and no idle resources. Nothing obvious to invest in right now.</p>`;
  }

  html += `<div class="today-section resource-manage-section">
    <h3 class="today-section-label today-section-dim" style="display:flex;align-items:center">
      All resources
      <button class="btn-primary btn-sm" id="btn-add-resource" style="margin-left:auto">+ Add resource</button>
    </h3>
    <div id="add-resource-form" class="work-form hidden" style="margin-bottom:12px"></div>
    <div id="resource-edit-form" class="work-form hidden" style="margin-bottom:12px"></div>
    ${resources.length === 0 ? `<p class="empty-state">No resources tracked yet. Add tools, skills, or financial resources you want to leverage.</p>` : renderAllResourcesList()}
  </div>`;

  container.innerHTML = html;

  document.getElementById("btn-add-resource").addEventListener("click", () => {
    const form = document.getElementById("add-resource-form");
    form.classList.toggle("hidden");
    if (!form.classList.contains("hidden")) renderAddResourceForm("add-resource-form");
  });
}

// ============================================================
// Repos view
// ============================================================
function populateLanguageFilter() {
  const languages = [...new Set(allRepos.map(r => r.language).filter(Boolean))];
  languages.sort();
  languages.forEach(lang => {
    const opt = document.createElement("option");
    opt.value = lang;
    opt.textContent = lang;
    languageFilter.appendChild(opt);
  });
}

function populateRepoDatalist() {
  const opts = allRepos.map(r => `<option value="${escapeText(r.name)}"></option>`).join('');
  ['wf-repo-list', 'wf-depends-list'].forEach(id => {
    const dl = document.getElementById(id);
    if (dl) dl.innerHTML = opts;
  });
}

function updateStats() {
  statTotal.textContent = allRepos.length;
  statGreen.textContent = allRepos.filter(r => r.health === "green").length;
  statYellow.textContent = allRepos.filter(r => r.health === "yellow").length;
  statRed.textContent = allRepos.filter(r => r.health === "red").length;
}

function applyFilters() {
  const q = searchInput.value.toLowerCase();
  const lang = languageFilter.value;
  const health = healthFilter.value;

  filteredRepos = allRepos.filter(repo => {
    const matchesSearch =
      repo.name.toLowerCase().includes(q) ||
      (repo.description || "").toLowerCase().includes(q) ||
      (repo.topics || []).some(t => t.toLowerCase().includes(q));
    const matchesLanguage = lang ? repo.language === lang : true;
    const matchesHealth = health ? repo.health === health : true;
    return matchesSearch && matchesLanguage && matchesHealth;
  });

  applySorting();
  summaryText.textContent = `Showing ${filteredRepos.length} repositories`;
  renderRepos();
}

function applySorting() {
  const val = sortBy.value;
  filteredRepos.sort((a, b) => {
    switch (val) {
      case "updated_desc": return new Date(b.updated_at) - new Date(a.updated_at);
      case "updated_asc":  return new Date(a.updated_at) - new Date(b.updated_at);
      case "name_asc":     return a.name.localeCompare(b.name);
      case "name_desc":    return b.name.localeCompare(a.name);
      case "issues_desc":  return (b.open_issues || 0) - (a.open_issues || 0);
      case "stars_desc":   return (b.stars || 0) - (a.stars || 0);
      default: return 0;
    }
  });
}

function escapeText(str) {
  const d = document.createElement("div");
  d.appendChild(document.createTextNode(str || ""));
  return d.innerHTML;
}

const WORK_STATUS_LABELS = {
  not_started: "Not started",
  in_progress:  "In progress",
  blocked:      "Blocked",
  done:         "Done",
};

function errorBanner(message, retryFn) {
  return `<div class="load-error" role="alert">
    <span class="load-error-msg">⚠ ${escapeText(message)}</span>
    <button class="btn-ghost btn-sm" onclick="${escapeText(retryFn)}()">Retry</button>
  </div>`;
}

function renderRepos() {
  repoList.innerHTML = "";

  if (reposError) {
    repoList.insertAdjacentHTML("beforeend", errorBanner(`Failed to load repositories — ${reposError}`, "retryRepos"));
    return;
  }

  if (!filteredRepos.length) {
    const p = document.createElement("p");
    p.style.cssText = "color:var(--text-muted);padding:10px;";
    p.textContent = "No repositories found.";
    repoList.appendChild(p);
    return;
  }

  filteredRepos.forEach(repo => {
    const updated = new Date(repo.updated_at).toLocaleDateString();
    const issues = repo.open_issues || 0;
    const stars = repo.stars || 0;
    const forks = repo.forks || 0;
    const topics = (repo.topics || []).slice(0, 5);

    const issuesBadge = `<a href="${escapeText(repo.url)}/issues" target="_blank" rel="noopener noreferrer" class="badge badge-issues${issues === 0 ? " badge-issues-zero" : ""}">${issues} issue${issues !== 1 ? "s" : ""}</a>`;

    const langBadge = repo.language
      ? `<span class="badge badge-language">${escapeText(repo.language)}</span>`
      : "";

    const homepageBadge = repo.homepage
      ? `<a href="${escapeText(repo.homepage)}" target="_blank" rel="noopener noreferrer"
            class="badge ${repo.site_error ? 'badge-site-error' : 'badge-homepage'}"
            title="${repo.site_error ? 'Live site returned an error' : 'View live site'}"
            aria-label="${repo.site_error ? 'Site error for ' : 'Visit live site for '}${escapeText(repo.name)}">
           ${repo.site_error ? '⚠ site error' : '↗ site'}
         </a>`
      : "";

    const topicsHtml = topics.length
      ? `<div class="repo-topics">${topics.map(t => `<span class="badge badge-topic">${escapeText(t)}</span>`).join("")}</div>`
      : "";

    const starsForks = (stars > 0 || forks > 0)
      ? `<span class="meta-stars" aria-label="${stars} stars">★ ${stars}</span><span class="meta-forks" aria-label="${forks} forks">⑂ ${forks}</span>`
      : "";

    // Work status badge — find the most relevant open work item for this repo
    const wi = workItems.find(w => w.repo_name === repo.name && w.status !== "done");
    const workBadge = wi
      ? `<span class="badge badge-work badge-work-${wi.status}" title="${escapeText(wi.task_description)}">${escapeText(WORK_STATUS_LABELS[wi.status] || wi.status)}</span>`
      : "";

    // Task activity from OKR tracker
    const rt = repoTaskData.find(r => r.repo_name === repo.name);
    const taskBadge = rt && rt.total_tasks > 0
      ? `<span class="badge badge-tasks" title="${rt.done_tasks}/${rt.total_tasks} tasks done">${rt.total_tasks} task${rt.total_tasks !== 1 ? "s" : ""}</span>`
      : "";
    const taskMeta = rt && rt.total_tasks > 0
      ? `<span class="repo-task-activity">
           <span class="repo-task-bar-track" role="progressbar" aria-valuenow="${Math.round(rt.done_tasks * 100 / rt.total_tasks)}" aria-valuemin="0" aria-valuemax="100">
             <span class="repo-task-bar-fill" style="width:${Math.round(rt.done_tasks * 100 / rt.total_tasks)}%"></span>
           </span>
           <span class="repo-task-label">${rt.done_tasks}/${rt.total_tasks} tasks done${rt.linked_okrs ? " · " + escapeText(rt.linked_okrs) : ""}</span>
         </span>`
      : "";

    const card = `
      <div class="repo-card">
        <div class="repo-header">
          <div class="repo-name">
            <a href="${escapeText(repo.url)}" target="_blank" rel="noopener noreferrer">${escapeText(repo.name)}</a>
          </div>
          <div class="repo-badges">
            <span class="badge badge-health-${repo.health}">
              <span class="badge-dot" aria-hidden="true"></span>${repo.health.toUpperCase()}
            </span>
            ${workBadge}
            ${taskBadge}
            ${homepageBadge}
            ${langBadge}
            ${issuesBadge}
          </div>
        </div>

        <p class="repo-description">${escapeText(repo.description || "No description.")}</p>

        ${topicsHtml}
        ${taskMeta}

        <div class="repo-meta">
          <span>Updated: ${updated}</span>
          <span>Branch: ${escapeText(repo.default_branch || "main")}</span>
          ${starsForks}
        </div>
      </div>
    `;

    repoList.insertAdjacentHTML("beforeend", card);
  });
}

// ============================================================
// Active Work view
// ============================================================
const STATUS_ORDER = ["in_progress", "blocked", "not_started"];
const STATUS_SECTION_LABELS = {
  in_progress: "In Progress",
  blocked:     "Blocked",
  not_started: "Not Started",
};

function depHasOpenWork(dependsOnRepo) {
  return workItems.some(w => w.repo_name === dependsOnRepo && w.status !== "done");
}

function durationLabel(startStr, endStr) {
  if (!startStr || !endStr) return null;
  const ms = new Date(endStr) - new Date(startStr);
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

function syncWorkToggle() {
  document.querySelectorAll(".work-toggle-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === activeWorkView);
    btn.setAttribute("aria-pressed", btn.dataset.view === activeWorkView ? "true" : "false");
  });
}

function renderActiveWork() {
  const container = document.getElementById("active-work-list");
  syncWorkToggle();

  if (workItemsError) {
    container.innerHTML = errorBanner(`Failed to load work items — ${workItemsError}`, "retryWorkItems");
    return;
  }

  if (activeWorkView === "completed") {
    renderCompletedWork(container);
  } else {
    renderActiveWorkItems(container);
  }
}

function renderActiveWorkItems(container) {
  const items = workItems.filter(w => w.status !== "done");

  let html = "";

  if (collegeDeadlines.length > 0) {
    const sorted = collegeDeadlines.slice().sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    html += `<div class="work-group">
      <h3 class="work-group-label">Upcoming Assignments <span class="work-group-count">${sorted.length}</span></h3>`;
    sorted.forEach(a => {
      const days = a.due_date ? Math.ceil((new Date(a.due_date) - new Date()) / 86400000) : null;
      const isOverdue = days !== null && days <= 0;
      const daysLabel = days === null ? "" : isOverdue ? "OVERDUE" : days === 0 ? "today" : `${days}d`;
      html += `<div class="work-row">
        <div class="work-card-top">
          <span class="badge badge-college-type badge-college-${escapeText((a.deliverable_type || "Project").toLowerCase())}">${escapeText(a.deliverable_type || "Project")}</span>
          <span class="work-repo">${escapeText(a.course_name || a.course_id)}</span>
          <span class="work-task">${escapeText(a.title)}</span>
        </div>
        <div class="work-card-meta">
          ${a.due_date ? `<span class="${isOverdue || days <= 3 ? "text-urgent" : "work-time"}">${daysLabel} · due ${escapeText(a.due_date)}</span>` : ""}
          ${a.weight_pct ? `<span class="pipeline-chip">${a.weight_pct}%</span>` : ""}
          <span class="badge badge-work badge-work-not_started">${escapeText(a.status || "Not Started")}</span>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  if (!items.length) {
    html += `<p class="empty-state">Nothing active right now. All clear! <button class="btn-ghost btn-sm" onclick="activeWorkView='completed';renderActiveWork()">See completed →</button></p>`;
    container.innerHTML = html;
    return;
  }

  STATUS_ORDER.forEach(status => {
    const group = items.filter(w => w.status === status);
    if (!group.length) return;

    const sectionLabel = STATUS_SECTION_LABELS[status];
    html += `<div class="work-group">
      <h3 class="work-group-label">${sectionLabel} <span class="work-group-count">${group.length}</span></h3>`;

    group.forEach(item => {
      const depWarning = item.depends_on_repo && depHasOpenWork(item.depends_on_repo)
        ? `<div class="dep-warning">⚠ <strong>${escapeText(item.repo_name)}</strong> depends on <strong>${escapeText(item.depends_on_repo)}</strong>, which has unfinished work.</div>`
        : "";

      const startedAgo = timeAgo(item.started_at);
      const timeSpan = startedAgo
        ? `<span class="work-time" title="${escapeText(item.started_at)}">Started ${startedAgo}</span>`
        : "";

      const depSpan = item.depends_on_repo
        ? `<span class="work-dep">→ needs ${escapeText(item.depends_on_repo)}</span>`
        : "";

      const notesDiv = item.notes
        ? `<div class="work-notes-inline">${escapeText(item.notes)}</div>`
        : "";

      html += `
        <div class="work-row" data-id="${item.id}">
          ${depWarning}
          <div class="work-card-top">
            <span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span>
            <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
            <span class="work-task">${escapeText(item.task_description)}</span>
          </div>
          <div class="work-card-meta">
            <span class="work-assigned badge-assigned-${item.assigned_to}">${escapeText(item.assigned_to)}</span>
            ${depSpan}
            ${timeSpan}
            <button class="btn-ghost btn-sm" onclick="openEditForm(${item.id})">Edit</button>
          </div>
          ${notesDiv}
          <div id="edit-form-${item.id}" class="work-form work-inline-form hidden"></div>
        </div>`;
    });

    html += `</div>`;
  });

  container.innerHTML = html;
}

function renderCompletedWork(container) {
  const doneItems = workItems
    .filter(w => w.status === "done")
    .sort((a, b) => {
      const aTime = a.completed_at ? new Date(a.completed_at) : new Date(0);
      const bTime = b.completed_at ? new Date(b.completed_at) : new Date(0);
      return bTime - aTime;
    });

  if (!doneItems.length) {
    container.innerHTML = `<p class="empty-state">No completed work items yet.</p>`;
    return;
  }

  let html = `<div class="work-group">
    <h3 class="work-group-label">Completed <span class="work-group-count">${doneItems.length}</span></h3>`;

  doneItems.forEach(item => {
    const completedAgo = timeAgo(item.completed_at);
    const completedFull = item.completed_at
      ? new Date(item.completed_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
      : null;
    const dur = durationLabel(item.started_at, item.completed_at);

    const completedSpan = completedFull
      ? `<span class="work-time work-completed-at" title="${escapeText(item.completed_at)}">Completed ${completedAgo}${completedFull ? ` (${completedFull})` : ""}</span>`
      : "";
    const durSpan = dur
      ? `<span class="work-duration">· took ${dur}</span>`
      : "";

    const notesDiv = item.notes
      ? `<div class="work-notes-inline">${escapeText(item.notes)}</div>`
      : "";

    html += `
      <div class="work-row work-row-done" data-id="${item.id}">
        <div class="work-card-top">
          <span class="badge badge-work badge-work-done">Done</span>
          <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
          <span class="work-task">${escapeText(item.task_description)}</span>
        </div>
        <div class="work-card-meta">
          <span class="work-assigned badge-assigned-${item.assigned_to}">${escapeText(item.assigned_to)}</span>
          ${completedSpan}
          ${durSpan}
          <button class="btn-ghost btn-sm" onclick="openEditForm(${item.id})">Edit</button>
        </div>
        ${notesDiv}
        <div class="work-okr-nudge">
          <span class="okr-nudge-icon" aria-hidden="true">✓</span>
          This work is done — <button class="btn-link" onclick="switchTab('okr-progress')">log it against an OKR →</button>
        </div>
        <div id="edit-form-${item.id}" class="work-form work-inline-form hidden"></div>
      </div>`;
  });

  html += `</div>`;
  container.innerHTML = html;
}

function openEditForm(id) {
  const item = workItems.find(w => w.id === id);
  if (!item) return;

  // Close any other open forms
  document.querySelectorAll(".work-inline-form").forEach(f => {
    if (f.id !== `edit-form-${id}`) f.classList.add("hidden");
  });

  const formEl = document.getElementById(`edit-form-${id}`);
  if (!formEl.classList.contains("hidden")) {
    formEl.classList.add("hidden");
    return;
  }

  formEl.innerHTML = `
    <div class="work-form-grid">
      <div class="control">
        <label>Status</label>
        <select id="ef-status-${id}">
          <option value="not_started" ${item.status === "not_started" ? "selected" : ""}>Not started</option>
          <option value="in_progress" ${item.status === "in_progress" ? "selected" : ""}>In progress</option>
          <option value="blocked" ${item.status === "blocked" ? "selected" : ""}>Blocked</option>
          <option value="done" ${item.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </div>
      <div class="control">
        <label>Assigned to</label>
        <select id="ef-assigned-${id}">
          <option value="agent" ${item.assigned_to === "agent" ? "selected" : ""}>Agent</option>
          <option value="asia" ${item.assigned_to === "asia" ? "selected" : ""}>Asia</option>
        </select>
      </div>
      <div class="control">
        <label>Notes</label>
        <input id="ef-notes-${id}" type="text" value="${escapeText(item.notes || "")}" placeholder="One-line summary..." />
      </div>
      <div class="control">
        <label>Blocker</label>
        <input id="ef-blocker-${id}" type="text" value="${escapeText(item.blocker || "")}" placeholder="What's blocking this? (clear when resolved)" />
      </div>
    </div>
    <div class="work-form-actions">
      <button class="btn-primary" onclick="saveEdit(${id})">Save</button>
      <button class="btn-ghost" onclick="document.getElementById('edit-form-${id}').classList.add('hidden')">Cancel</button>
    </div>`;

  formEl.classList.remove("hidden");
}

async function saveEdit(id) {
  const status = document.getElementById(`ef-status-${id}`).value;
  const assigned_to = document.getElementById(`ef-assigned-${id}`).value;
  const notes = document.getElementById(`ef-notes-${id}`).value;
  const blocker = document.getElementById(`ef-blocker-${id}`)?.value || null;

  const started_at = status === "in_progress" && !workItems.find(w => w.id === id)?.started_at
    ? new Date().toISOString()
    : undefined;
  const completed_at = status === "done"
    ? new Date().toISOString()
    : undefined;

  const body = { status, assigned_to, notes, blocker };
  if (started_at !== undefined) body.started_at = started_at;
  if (completed_at !== undefined) body.completed_at = completed_at;

  const doSave = async () => {
    const res = await fetch(`/api/work-items/${id}`, {
      method: "PUT",
      headers: writeHeaders(),
      body: JSON.stringify(body),
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    const updated = await doSave();
    const idx = workItems.findIndex(w => w.id === id);
    if (idx !== -1) workItems[idx] = updated;
    renderActiveWork();
    renderRepos();
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

// ============================================================
// Priority tab inline edit for repo work items

function openPriorityEdit(id) {
  // Close any other open priority form rows
  document.querySelectorAll(".priority-form-row").forEach(r => {
    if (r.id !== `priority-form-row-${id}`) r.classList.add("hidden");
  });
  document.querySelectorAll("[id^='priority-card-form-']").forEach(f => {
    if (f.id !== `priority-card-form-${id}`) f.classList.add("hidden");
  });

  // Desktop: toggle the <tr> below the item row (only when the table is actually visible)
  const rowEl = document.getElementById(`priority-form-row-${id}`);
  const tableVisible = rowEl && rowEl.offsetParent !== null;
  if (tableVisible) {
    rowEl.classList.toggle("hidden");
    return;
  }

  // Mobile: render into the card form div
  const cardFormEl = document.getElementById(`priority-card-form-${id}`);
  if (!cardFormEl) return;
  if (!cardFormEl.classList.contains("hidden")) {
    cardFormEl.classList.add("hidden");
    return;
  }
  const item = workItems.find(w => w.id === id);
  if (!item) return;
  cardFormEl.innerHTML = `
    <div class="work-form-grid">
      <div class="control">
        <label>Status</label>
        <select id="pef-status-mobile-${id}">
          <option value="not_started" ${item.status === "not_started" ? "selected" : ""}>Not started</option>
          <option value="in_progress" ${item.status === "in_progress" ? "selected" : ""}>In progress</option>
          <option value="blocked" ${item.status === "blocked" ? "selected" : ""}>Blocked</option>
          <option value="done" ${item.status === "done" ? "selected" : ""}>Done</option>
        </select>
      </div>
      <div class="control">
        <label>Notes</label>
        <input id="pef-notes-mobile-${id}" type="text" value="${escapeText(item.notes || "")}" placeholder="One-line summary..." />
      </div>
      <div class="control">
        <label>Blocker</label>
        <input id="pef-blocker-mobile-${id}" type="text" value="${escapeText(item.blocker || "")}" placeholder="What's blocking this? (clear when resolved)" />
      </div>
    </div>
    <div class="work-form-actions">
      <button class="btn-primary" onclick="savePriorityEdit(${id})">Save</button>
      <button class="btn-ghost" onclick="document.getElementById('priority-card-form-${id}').classList.add('hidden')">Cancel</button>
    </div>`;
  cardFormEl.classList.remove("hidden");
}

async function savePriorityEdit(id) {
  const status   = document.getElementById(`pef-status-${id}`)?.value
                ?? document.getElementById(`pef-status-mobile-${id}`)?.value;
  const notes    = document.getElementById(`pef-notes-${id}`)?.value
                ?? document.getElementById(`pef-notes-mobile-${id}`)?.value ?? null;
  const blocker  = document.getElementById(`pef-blocker-${id}`)?.value
                ?? document.getElementById(`pef-blocker-mobile-${id}`)?.value ?? null;

  const item = workItems.find(w => w.id === id);
  const started_at = status === "in_progress" && !item?.started_at ? new Date().toISOString() : undefined;
  const completed_at = status === "done" ? new Date().toISOString() : undefined;

  const body = { status, notes, blocker: blocker || null };
  if (started_at !== undefined) body.started_at = started_at;
  if (completed_at !== undefined) body.completed_at = completed_at;

  const doSave = async () => {
    const res = await fetch(`/api/work-items/${id}`, {
      method: "PUT",
      headers: writeHeaders(),
      body: JSON.stringify(body),
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    const updated = await doSave();
    const idx = workItems.findIndex(w => w.id === id);
    if (idx !== -1) workItems[idx] = updated;
    document.getElementById(`priority-form-row-${id}`)?.classList.add("hidden");
    document.getElementById(`priority-card-form-${id}`)?.classList.add("hidden");
    renderPriority();
    renderActiveWork();
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

// ============================================================
// Academic deadline inline edit
// ============================================================
function openEditAssignment(id) {
  const a = collegeDeadlines.find(x => x.id === id);
  if (!a) return;

  document.querySelectorAll("[id^='asn-form-']").forEach(f => {
    if (f.id !== `asn-form-${id}`) f.classList.add("hidden");
  });

  const formEl = document.getElementById(`asn-form-${id}`);
  if (!formEl) return;
  if (!formEl.classList.contains("hidden")) {
    formEl.classList.add("hidden");
    return;
  }

  const statusOptions = ["Not Started", "In Progress", "Submitted", "Graded"]
    .map(s => `<option value="${s}"${s === (a.status || "Not Started") ? " selected" : ""}>${s}</option>`)
    .join("");

  formEl.innerHTML = `
    <div class="work-form-grid">
      <div class="control">
        <label>Status</label>
        <select id="asn-status-${id}">${statusOptions}</select>
      </div>
      <div class="control">
        <label>Due Date</label>
        <input id="asn-due-${id}" type="date" value="${escapeText(a.due_date || "")}" />
      </div>
      <div class="control">
        <label>Notes</label>
        <input id="asn-notes-${id}" type="text" value="${escapeText(a.notes || "")}" placeholder="Optional notes" />
      </div>
      <div class="control">
        <label>Blocker</label>
        <input id="asn-blocker-${id}" type="text" value="${escapeText(a.blocker || "")}" placeholder="What's blocking this? (clear when resolved)" />
      </div>
    </div>
    <div class="work-form-actions">
      <button class="btn-primary" onclick="saveAssignmentEdit('${escapeText(id)}')">Save</button>
      <button class="btn-ghost" onclick="document.getElementById('asn-form-${id}').classList.add('hidden')">Cancel</button>
    </div>`;

  formEl.classList.remove("hidden");
}

async function saveAssignmentEdit(id) {
  const a = collegeDeadlines.find(x => x.id === id);
  if (!a) return;

  const status   = document.getElementById(`asn-status-${id}`)?.value;
  const due_date = document.getElementById(`asn-due-${id}`)?.value || null;
  const notes    = document.getElementById(`asn-notes-${id}`)?.value || null;
  const blocker  = document.getElementById(`asn-blocker-${id}`)?.value || null;

  const body = {};
  if (status   !== undefined) body.status   = status;
  if (due_date !== undefined) body.due_date  = due_date;
  if (notes    !== undefined) body.notes     = notes;
  body.blocker = blocker;

  const doSave = async () => {
    const res = await fetch(`${COLLEGE_TRACKER_URL}/api/assignments/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: collegeWriteHeaders(),
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const token = prompt("Enter college-tracker write token (MCP_SECRET_TOKEN):");
      if (token) {
        localStorage.setItem("collegeWriteToken", token.trim());
        return doSave();
      }
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    Object.assign(a, body);
    if (["Submitted", "Graded"].includes(status)) {
      collegeDeadlines = collegeDeadlines.filter(x => x.id !== id);
    }
    renderPriority();
  };

  try {
    await doSave();
  } catch (err) {
    alert("Failed to save: " + err.message);
  }
}

// ============================================================
// Agent Tasks view
// ============================================================
function renderAgentTasks() {
  const container = document.getElementById("agent-tasks-list");

  if (workItemsError) {
    container.innerHTML = errorBanner(`Failed to load agent tasks — ${workItemsError}`, "retryWorkItems");
    return;
  }

  const agentItems = workItems
    .filter(w => w.assigned_to === "agent")
    .sort((a, b) => {
      if (a.started_at && b.started_at) return new Date(b.started_at) - new Date(a.started_at);
      if (a.started_at) return -1;
      if (b.started_at) return 1;
      return 0;
    });

  if (!agentItems.length) {
    container.innerHTML = `<p class="empty-state">No agent tasks found.</p>`;
    return;
  }

  // Table (desktop)
  const rows = agentItems.map(item => {
    const startedAgo = timeAgo(item.started_at);
    const completedAgo = timeAgo(item.completed_at);
    const startedFull = item.started_at ? new Date(item.started_at).toLocaleDateString() : null;
    const completedFull = item.completed_at ? new Date(item.completed_at).toLocaleDateString() : null;
    const sourceBadge = item.source_type === "github_issue"
      ? `<span class="badge badge-source-auto">auto</span>`
      : `<span class="badge badge-source-manual">manual</span>`;
    const issueLink = item.source_url
      ? `<a href="${escapeText(item.source_url)}" target="_blank" rel="noopener noreferrer" class="badge badge-issue-link" title="View GitHub issue">↗ issue</a>`
      : "";
    return `
    <tr>
      <td><a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer">${escapeText(item.repo_name)}</a></td>
      <td>${escapeText(item.task_description)}</td>
      <td><span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span></td>
      <td>${sourceBadge}${issueLink}</td>
      <td ${startedFull ? `title="${escapeText(startedFull)}"` : ""}>${startedAgo || "—"}</td>
      <td ${completedFull ? `title="${escapeText(completedFull)}"` : ""}>${completedAgo || "—"}</td>
      <td class="notes-cell">${escapeText(item.notes || "")}</td>
    </tr>`;
  }).join("");

  // Cards (mobile)
  const cards = agentItems.map(item => {
    const startedAgo = timeAgo(item.started_at);
    const completedAgo = timeAgo(item.completed_at);
    const notesHtml = item.notes
      ? `<p class="agent-card-notes">${escapeText(item.notes)}</p>`
      : "";
    const metaParts = [
      startedAgo ? `Started ${startedAgo}` : null,
      completedAgo ? `Done ${completedAgo}` : null,
    ].filter(Boolean);
    const sourceBadge = item.source_type === "github_issue"
      ? `<span class="badge badge-source-auto">auto</span>`
      : `<span class="badge badge-source-manual">manual</span>`;
    const issueLink = item.source_url
      ? `<a href="${escapeText(item.source_url)}" target="_blank" rel="noopener noreferrer" class="badge badge-issue-link">↗ issue</a>`
      : "";
    return `
    <div class="agent-card">
      <div class="agent-card-header">
        <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer">${escapeText(item.repo_name)}</a>
        <div class="agent-card-badges">
          <span class="badge badge-work badge-work-${item.status}">${escapeText(WORK_STATUS_LABELS[item.status] || item.status)}</span>
          ${sourceBadge}${issueLink}
        </div>
      </div>
      <p class="agent-card-task">${escapeText(item.task_description)}</p>
      ${metaParts.length ? `<div class="agent-card-meta">${metaParts.map(p => `<span>${p}</span>`).join("")}</div>` : ""}
      ${notesHtml}
    </div>`;
  }).join("");

  container.innerHTML = `
    <div class="agent-table-wrap">
      <div class="table-scroll">
        <table class="work-table">
          <thead>
            <tr>
              <th>Repo</th>
              <th>Task</th>
              <th>Status</th>
              <th>Source</th>
              <th>Started</th>
              <th>Completed</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="agent-cards">${cards}</div>`;
}

// ============================================================
// Priority view
// ============================================================
function renderPriority() {
  const container = document.getElementById("priority-list");

  if (priorityError) {
    container.innerHTML = errorBanner(`Failed to load priority data — ${priorityError}`, "retryPriority");
    return;
  }

  const { items, bottlenecks } = priorityData;

  let html = "";

  // Bottlenecks panel — signals due within 7 days with no in-progress work in affected repos
  if (bottlenecks && bottlenecks.length > 0) {
    html += `<div class="bottleneck-panel" role="alert" aria-label="Priority bottlenecks">
      <div class="bottleneck-header">
        <span aria-hidden="true">⚠</span>
        <strong>Bottlenecks — Urgent deadlines with no in-progress work</strong>
        <span class="bottleneck-count">${bottlenecks.length}</span>
      </div>
      <ul class="bottleneck-list">`;

    for (const b of bottlenecks) {
      const daysLabel = b.days_remaining <= 0
        ? `<strong class="text-urgent">OVERDUE</strong>`
        : `<strong class="${b.days_remaining <= 3 ? "text-urgent" : ""}">${b.days_remaining}d remaining</strong>`;
      html += `<li class="bottleneck-item">
        <span class="bottleneck-title">${escapeText(b.title)}</span>
        <span class="bottleneck-meta">
          · due ${escapeText(b.due_date)} · ${daysLabel}
          · from <a href="https://github.com/asiakay/${escapeText(b.source_repo)}" target="_blank" rel="noopener noreferrer">${escapeText(b.source_repo)}</a>
        </span>
        <span class="bottleneck-repos">affects: ${b.affects_repos.map(r => escapeText(r)).join(", ")}</span>
      </li>`;
    }
    html += `</ul></div>`;
  }

  // Academic deadlines panel — always shown (error / empty / data)
  {
    const urgent = collegeDeadlines.filter(a => {
      const days = a.due_date ? Math.ceil((new Date(a.due_date) - new Date()) / 86400000) : 999;
      return days <= 7;
    });
    const panelClass = collegeError
      ? "bottleneck-panel bottleneck-panel-college bottleneck-panel-calm"
      : urgent.length > 0
        ? "bottleneck-panel bottleneck-panel-college"
        : "bottleneck-panel bottleneck-panel-college bottleneck-panel-calm";
    const sorted = collegeDeadlines.slice().sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    html += `<div class="${panelClass}" role="region" aria-label="Academic deadlines">
      <div class="bottleneck-header">
        <span aria-hidden="true">🎓</span>
        <strong>Academic Deadlines — next 14 days</strong>
        <span class="bottleneck-count">${sorted.length}</span>
      </div>
      <ul class="bottleneck-list">`;
    if (collegeError) {
      html += `<li class="bottleneck-item">
        <span class="bottleneck-meta text-urgent">Could not load college deadlines — ${escapeText(collegeError)}</span>
        <span class="bottleneck-repos"><button class="btn-link" onclick="retryCollegeDeadlines()">Retry</button></span>
      </li>`;
    } else if (sorted.length === 0) {
      html += `<li class="bottleneck-item">
        <span class="bottleneck-meta">No upcoming assignments in the next 14 days.</span>
      </li>`;
    } else {
      for (const a of sorted) {
        const days = a.due_date ? Math.ceil((new Date(a.due_date) - new Date()) / 86400000) : null;
        const isOverdue = days !== null && days <= 0;
        const daysLabel = days === null ? "" : isOverdue
          ? `<strong class="text-urgent">OVERDUE</strong>`
          : `<strong class="${days <= 3 ? "text-urgent" : ""}">${days}d remaining</strong>`;
        html += `<li class="bottleneck-item" id="asn-item-${escapeText(a.id)}">
          <span class="bottleneck-title">${escapeText(a.title)}</span>
          <span class="bottleneck-meta">
            · ${escapeText(a.course_name || a.course_id)}
            ${a.due_date ? ` · due ${escapeText(a.due_date)}` : ""}
            ${daysLabel ? ` · ${daysLabel}` : ""}
            ${a.weight_pct ? ` · <span class="pipeline-chip">${a.weight_pct}%</span>` : ""}
          </span>
          <span class="bottleneck-repos">
            <span class="badge badge-college-type badge-college-${escapeText((a.deliverable_type || "Project").toLowerCase())}">${escapeText(a.deliverable_type || "Project")}</span>
            ${escapeText(a.objective || a.okr_id || "")}
            <button class="btn-link" onclick="openEditAssignment('${escapeText(a.id)}')">Edit</button>
          </span>
          ${a.blocker ? `<span class="blocker-line"><span class="badge badge-work-blocked">Blocked</span>${escapeText(a.blocker)}</span>` : ""}
          <div id="asn-form-${escapeText(a.id)}" class="work-inline-form hidden"></div>
        </li>`;
      }
    }
    html += `</ul></div>`;
  }

  if (!items || !items.length) {
    html += `<p class="empty-state">No active work items. All done!</p>`;
    container.innerHTML = html;
    return;
  }

  // Table (desktop)
  const rows = items.map(item => {
    const tierClass = `badge-tier-${item.tier_num}`;
    let drivingHtml;
    if (item.driving_signal) {
      const d = item.driving_signal;
      const daysLabel = d.days_remaining <= 0
        ? `<span class="text-urgent">OVERDUE</span>`
        : `${d.days_remaining}d`;
      drivingHtml = `<div class="signal-title">${escapeText(d.title)}</div>
        <div class="signal-meta">
          ${escapeText(d.due_date)} · ${daysLabel} ·
          <a href="https://github.com/asiakay/${escapeText(d.source_repo)}" target="_blank" rel="noopener noreferrer">${escapeText(d.source_repo)}</a>
          <span class="badge-domain badge-domain-${escapeText(d.domain)}">${escapeText(d.domain)}</span>
        </div>`;
    } else {
      drivingHtml = `<span class="no-signal-note">No external deadline pressure — manual priority only</span>`;
    }

    const overrideVal = item.manual_consequence_override != null ? String(item.manual_consequence_override) : "";
    return `<tr data-id="${item.id}">
      <td><span class="badge badge-tier ${tierClass}" title="${escapeText(item.tier_label)}">${item.tier_num}</span></td>
      <td><a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer">${escapeText(item.repo_name)}</a></td>
      <td>
        ${escapeText(item.task_description)}
        ${item.blocker ? `<span class="blocker-line"><span class="badge badge-work-blocked">Blocked</span>${escapeText(item.blocker)}</span>` : ""}
        <button class="btn-link" onclick="openPriorityEdit(${item.id})">Edit</button>
      </td>
      <td class="score-cell"><span class="impact-score">${item.impact_score}</span><span class="impact-max">/25</span></td>
      <td>${drivingHtml}</td>
      <td>
        <input type="number" class="override-input" min="1" max="5" value="${escapeText(overrideVal)}"
          placeholder="1–5" title="Override consequence severity (1–5). Clears when a deadline signal is linked."
          data-id="${item.id}" />
      </td>
    </tr>
    <tr id="priority-form-row-${item.id}" class="priority-form-row hidden">
      <td colspan="6">
        <div class="work-form-grid">
          <div class="control">
            <label>Status</label>
            <select id="pef-status-${item.id}">
              <option value="not_started" ${item.status === "not_started" ? "selected" : ""}>Not started</option>
              <option value="in_progress" ${item.status === "in_progress" ? "selected" : ""}>In progress</option>
              <option value="blocked" ${item.status === "blocked" ? "selected" : ""}>Blocked</option>
              <option value="done" ${item.status === "done" ? "selected" : ""}>Done</option>
            </select>
          </div>
          <div class="control">
            <label>Notes</label>
            <input id="pef-notes-${item.id}" type="text" value="${escapeText(item.notes || "")}" placeholder="One-line summary..." />
          </div>
          <div class="control">
            <label>Blocker</label>
            <input id="pef-blocker-${item.id}" type="text" value="${escapeText(item.blocker || "")}" placeholder="What's blocking this? (clear when resolved)" />
          </div>
        </div>
        <div class="work-form-actions">
          <button class="btn-primary" onclick="savePriorityEdit(${item.id})">Save</button>
          <button class="btn-ghost" onclick="document.getElementById('priority-form-row-${item.id}').classList.add('hidden')">Cancel</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  // Mobile cards
  const cards = items.map(item => {
    let drivingHtml;
    if (item.driving_signal) {
      const d = item.driving_signal;
      const daysLabel = d.days_remaining <= 0 ? "OVERDUE" : `${d.days_remaining}d`;
      drivingHtml = `<div class="signal-title">${escapeText(d.title)}</div>
        <div class="signal-meta">${escapeText(d.due_date)} · ${daysLabel}</div>`;
    } else {
      drivingHtml = `<span class="no-signal-note">No deadline pressure</span>`;
    }
    return `<div class="work-row">
      <div class="work-card-top">
        <span class="badge badge-tier badge-tier-${item.tier_num}" title="${escapeText(item.tier_label)}">${item.tier_num}</span>
        <a href="https://github.com/asiakay/${escapeText(item.repo_name)}" target="_blank" rel="noopener noreferrer" class="work-repo">${escapeText(item.repo_name)}</a>
        <span class="work-task">${escapeText(item.task_description)}</span>
        <button class="btn-link" onclick="openPriorityEdit(${item.id})">Edit</button>
      </div>
      ${item.blocker ? `<span class="blocker-line"><span class="badge badge-work-blocked">Blocked</span>${escapeText(item.blocker)}</span>` : ""}
      <div id="priority-card-form-${item.id}" class="work-inline-form hidden"></div>
      <div class="priority-card-meta">
        <span>Score: <strong>${item.impact_score}</strong>/25</span>
        ${drivingHtml}
      </div>
    </div>`;
  }).join("");

  html += `
    <div class="priority-table-wrap">
      <div class="table-scroll">
        <table class="work-table priority-table">
          <thead>
            <tr>
              <th>Tier</th>
              <th>Repo</th>
              <th>Task</th>
              <th>Score</th>
              <th>Driving Deadline</th>
              <th title="Override consequence severity (1–5) when auto-detected value needs adjustment">Override</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
    <div class="priority-cards">${cards}</div>`;

  container.innerHTML = html;

  // Wire up override inputs after DOM is written
  container.querySelectorAll(".override-input").forEach(input => {
    input.addEventListener("change", () => {
      saveOverride(parseInt(input.dataset.id, 10), input.value);
    });
  });
}

async function saveOverride(id, value) {
  const parsed = parseInt(value, 10);
  const override = (parsed >= 1 && parsed <= 5) ? parsed : null;
  const body = JSON.stringify({ manual_consequence_override: override });

  const doSave = async () => {
    const res = await fetch(`/api/work-items/${id}`, {
      method: "PUT",
      headers: writeHeaders(),
      body,
    });
    return handleWriteResponse(res, doSave);
  };

  try {
    await doSave();
    await loadPriorityData();
    renderPriority();
  } catch (err) {
    console.error("Failed to save override:", err);
  }
}

// ============================================================
// Add work item form
// ============================================================
document.getElementById("btn-add-work-item").addEventListener("click", () => {
  document.getElementById("add-work-item-form").classList.toggle("hidden");
});

document.getElementById("btn-cancel-work-item").addEventListener("click", () => {
  document.getElementById("add-work-item-form").classList.add("hidden");
});

document.getElementById("btn-save-work-item").addEventListener("click", async () => {
  const repo_name = document.getElementById("wf-repo").value.trim();
  const task_description = document.getElementById("wf-task").value.trim();
  const status = document.getElementById("wf-status").value;
  const assigned_to = document.getElementById("wf-assigned").value;
  const depends_on_repo = document.getElementById("wf-depends").value.trim() || null;
  const notes = document.getElementById("wf-notes").value.trim() || null;

  if (!repo_name || !task_description) {
    alert("Repo name and task description are required.");
    return;
  }

  const body = { repo_name, task_description, status, assigned_to, depends_on_repo, notes };
  if (status === "in_progress") body.started_at = new Date().toISOString();
  const serialized = JSON.stringify(body);

  const doAdd = async () => {
    const res = await fetch("/api/work-items", {
      method: "POST",
      headers: writeHeaders(),
      body: serialized,
    });
    return handleWriteResponse(res, doAdd);
  };

  try {
    const newItem = await doAdd();
    workItems.push(newItem);

    // Reset form
    ["wf-repo", "wf-task", "wf-depends", "wf-notes"].forEach(id => { document.getElementById(id).value = ""; });
    document.getElementById("add-work-item-form").classList.add("hidden");

    renderActiveWork();
    renderRepos();
  } catch (err) {
    alert("Failed to add work item: " + err.message);
  }
});

// ============================================================
// Event listeners — repos view
// ============================================================
searchInput.addEventListener("input", applyFilters);
languageFilter.addEventListener("change", applyFilters);
healthFilter.addEventListener("change", () => {
  updateActivePill();
  applyFilters();
});
sortBy.addEventListener("change", () => {
  applySorting();
  renderRepos();
});

// ============================================================
// OKR Progress view
// ============================================================
const OKR_STATUS_BADGE = {
  "In Progress": "badge-work-in_progress",
  "Planned": "badge-work-not_started",
  "In Review": "badge-work-blocked",
  "Completed": "badge-work-done",
};

function renderOkrProgress() {
  const container = document.getElementById("okr-progress-list");

  if (okrStatsError) {
    container.innerHTML = errorBanner(`Failed to load OKR data — ${okrStatsError}`, "retryOkrStats");
    return;
  }

  if (!okrStats) {
    container.innerHTML = `<p class="empty-state">Loading OKR data…</p>`;
    return;
  }

  if (okrStats.migration_pending) {
    container.innerHTML = `
      <div class="load-error" role="alert">
        <span class="load-error-msg">OKR tables not found in the database.</span>
        <span class="load-error-msg" style="margin-top:6px">
          Go to <strong>GitHub → Actions → "Initialize OKR &amp; Task Tracker schema"</strong>
          and click <strong>Run workflow</strong>, then refresh this page.
        </span>
      </div>`;
    return;
  }

  const { okrs, today } = okrStats;

  if (!okrs || !okrs.length) {
    container.innerHTML = `<p class="empty-state">No OKRs found. Register OKRs using the MCP tools.</p>`;
    return;
  }

  const CATEGORY_LABELS = {
    project:    "Projects",
    education:  "Education",
    life_admin: "Life Admin",
    health:     "Health",
    financial:  "Financial",
    other:      "Other",
  };

  // Build category filter dropdown (persists across re-renders)
  const categories = [...new Set(okrs.map(o => o.category || "project"))].sort();
  const filterEl = container.querySelector(".okr-category-filter");
  const savedFilter = filterEl ? filterEl.value : okrCategoryFilter;
  okrCategoryFilter = savedFilter;

  const filteredOkrs = okrCategoryFilter
    ? okrs.filter(o => (o.category || "project") === okrCategoryFilter)
    : okrs;

  function renderOkrCard(okr) {
    const pct = okr.completion_pct || 0;
    const barColor = pct >= 80 ? "var(--success)" : pct >= 40 ? "var(--accent)" : "var(--danger)";
    const badgeClass = OKR_STATUS_BADGE[okr.status] || "badge-work-not_started";
    const targetDate = okr.target_date
      ? `<span class="okr-target-date">${escapeText(okr.target_date)}</span>`
      : "";
    const taskChips = okr.has_assignments
      ? (okr.total_assignments > 0
        ? `<span class="okr-task-chip">${okr.completed_assignments}/${okr.total_assignments} assignments submitted</span>`
        : `<span class="okr-task-chip okr-task-chip-empty">No assignments yet</span>`)
      : (okr.total_tasks > 0
        ? `<span class="okr-task-chip">${okr.done_tasks}/${okr.total_tasks} tasks done</span>`
        : `<span class="okr-task-chip okr-task-chip-empty">No tasks yet</span>`);

    const nextDueChip = okr.next_due_date
      ? `<span class="okr-next-due">Next due: ${escapeText(okr.next_due_date)}</span>`
      : "";

    const isExpanded = expandedOkrIds.has(okr.id);

    // OKR-level dependency badges
    const depBadges = (okr.deps || []).map(d =>
      `<span class="okr-dep-badge" title="${escapeText(d.dep_objective || "")}">Needs: ${escapeText(d.depends_on_okr_id)}</span>`
    ).join("");

    // Expanded task list
    let taskListHtml = "";
    if (isExpanded) {
      const cached = okrTaskCache[okr.id];
      if (!cached || cached === "loading") {
        taskListHtml = `<div class="okr-task-list"><p class="okr-task-list-empty">Loading…</p></div>`;
      } else if (cached === "error") {
        taskListHtml = `<div class="okr-task-list"><p class="okr-task-list-empty">Failed to load tasks.</p></div>`;
      } else if (!cached.length) {
        taskListHtml = `<div class="okr-task-list"><p class="okr-task-list-empty">No tasks yet — use <code>log_task</code> via MCP.</p></div>`;
      } else {
        const asnBadgeClass = s => s === "Graded" ? "badge-work-done"
          : s === "Submitted" ? "badge-work-in_progress"
          : s === "Late" ? "badge-work-blocked"
          : "badge-work-not_started";
        const taskRows = cached.map(t => {
          if (t.is_assignment) {
            const isDone = t.status === "Submitted" || t.status === "Graded";
            const dueInfo = t.due_date ? `<span class="okr-task-date">Due: ${escapeText(t.due_date)}</span>` : "";
            const courseChip = t.course_name ? `<span class="okr-task-time">${escapeText(t.course_name)}</span>` : "";
            return `
              <div class="okr-task-row${isDone ? " okr-task-row-done" : ""}">
                <div class="okr-task-row-main">
                  <span class="badge badge-work ${asnBadgeClass(t.status)}">${escapeText(t.status || "Not Submitted")}</span>
                  <span class="okr-task-desc">${escapeText(t.description)}</span>
                  ${dueInfo}
                  ${courseChip}
                </div>
                ${t.notes ? `<div class="okr-task-notes">${escapeText(t.notes)}</div>` : ""}
              </div>`;
          }
          const tBadgeClass = t.status === "Done" ? "badge-work-done"
            : t.status === "In Progress" ? "badge-work-in_progress"
            : "badge-work-not_started";
          const timeSpent = t.time_spent ? `<span class="okr-task-time">${escapeText(t.time_spent)}</span>` : "";
          const taskDate = t.date ? `<span class="okr-task-date">${escapeText(t.date)}</span>` : "";
          const blockedBy = t.blocked_by_desc
            ? `<div class="okr-blocked-by">⛔ Blocked by: ${escapeText(t.blocked_by_desc)} <span class="badge badge-work ${t.blocked_by_status === "Done" ? "badge-work-done" : "badge-work-in_progress"}">${escapeText(t.blocked_by_status || "")}</span></div>`
            : "";
          return `
            <div class="okr-task-row${t.status === "Done" ? " okr-task-row-done" : ""}">
              <div class="okr-task-row-main">
                <span class="badge badge-work ${tBadgeClass}">${escapeText(t.status || "To Do")}</span>
                <span class="okr-task-desc">${escapeText(t.description)}</span>
                ${timeSpent}
                ${taskDate}
              </div>
              ${blockedBy}
              ${t.notes ? `<div class="okr-task-notes">${escapeText(t.notes)}</div>` : ""}
            </div>`;
        }).join("");
        taskListHtml = `<div class="okr-task-list">${taskRows}</div>`;
      }
    }

    return `
      <div class="okr-card" data-okr-id="${escapeText(okr.id)}">
        <div class="okr-card-header">
          <div class="okr-card-title">
            <span class="okr-id">${escapeText(okr.id)}</span>
            <span class="badge badge-work ${badgeClass}">${escapeText(okr.status || "Planned")}</span>
            ${depBadges}
          </div>
          <div class="okr-card-meta">
            ${taskChips}
            ${nextDueChip}
            ${targetDate}
            <button class="okr-expand-btn" data-expand-okr="${escapeText(okr.id)}" aria-label="${isExpanded ? "Collapse tasks" : "Expand tasks"}" aria-expanded="${isExpanded}">${isExpanded ? "▲" : "▼"}</button>
          </div>
        </div>
        <div class="okr-objective">${escapeText(okr.objective)}</div>
        <div class="okr-key-result">${escapeText(okr.key_result)}</div>
        <div class="okr-bar-wrap">
          <div class="okr-bar-track" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${pct}% complete">
            <div class="okr-bar-fill" style="width:${pct}%;background:${barColor}"></div>
          </div>
          <span class="okr-bar-label">${pct}%</span>
        </div>
        ${taskListHtml}
      </div>`;
  }

  // Group by category; render a section header before each group when multiple categories exist
  const groupedHtml = (() => {
    const showHeaders = categories.length > 1 && !okrCategoryFilter;
    if (!showHeaders) {
      return `<div class="okr-grid">${filteredOkrs.map(renderOkrCard).join("")}</div>`;
    }
    const byCategory = {};
    filteredOkrs.forEach(o => {
      const cat = o.category || "project";
      (byCategory[cat] = byCategory[cat] || []).push(o);
    });
    return Object.entries(byCategory).map(([cat, items]) => `
      <div class="okr-category-group">
        <h3 class="okr-category-heading">${escapeText(CATEGORY_LABELS[cat] || cat)}</h3>
        <div class="okr-grid">${items.map(renderOkrCard).join("")}</div>
      </div>`).join("");
  })();

  const taskStatusClass = s => s === "Done" ? "done" : s === "In Progress" ? "in_progress" : "not_started";

  const todayTasks = today && today.tasks && today.tasks.length
    ? today.tasks.map(t => {
        const statusBadge = t.status
          ? `<span class="badge badge-work badge-work-${taskStatusClass(t.status)}">${escapeText(t.status)}</span>`
          : "";
        const timeSpent = t.time_spent
          ? `<span class="okr-task-time">${escapeText(t.time_spent)}</span>`
          : "";
        return `
          <div class="okr-today-row">
            <div class="okr-today-meta">
              <span class="okr-today-okr-id">${escapeText(t.okr_id)}</span>
              ${statusBadge}
              ${timeSpent}
            </div>
            <div class="okr-today-desc">${escapeText(t.description)}</div>
            ${t.notes ? `<div class="okr-today-notes">${escapeText(t.notes)}</div>` : ""}
          </div>`;
      }).join("")
    : `<p class="empty-state">No tasks logged today. Use <code>log_task</code> via MCP to add one.</p>`;

  const taskCount = (today && today.tasks) ? today.tasks.length : 0;

  const okrOptions = filteredOkrs.map(o =>
    `<option value="${escapeText(o.id)}">${escapeText(o.id)} — ${escapeText(o.key_result)}</option>`
  ).join("");

  const categoryFilterOptions = `<option value="">All categories</option>` +
    categories.map(cat =>
      `<option value="${escapeText(cat)}"${cat === okrCategoryFilter ? " selected" : ""}>${escapeText(CATEGORY_LABELS[cat] || cat)}</option>`
    ).join("");

  container.innerHTML = `
    <div class="okr-progress-toolbar">
      <label for="okr-category-filter" class="sr-only">Filter by category</label>
      <select id="okr-category-filter" class="okr-category-filter">${categoryFilterOptions}</select>
    </div>
    ${groupedHtml}
    <section class="okr-today-section">
      <h3 class="okr-today-title">
        Today's Log <span class="work-group-count">${taskCount}</span>
        <button class="btn-primary btn-sm" id="btn-log-task" style="margin-left:auto">+ Log task</button>
      </h3>
      <div id="log-task-form" class="work-form hidden" style="margin-bottom:12px">
        <div class="work-form-grid">
          <div class="control">
            <label for="tf-okr">OKR</label>
            <select id="tf-okr">${okrOptions}</select>
          </div>
          <div class="control">
            <label for="tf-desc">Description</label>
            <input id="tf-desc" type="text" placeholder="What did you work on?" />
          </div>
          <div class="control">
            <label for="tf-status">Status</label>
            <select id="tf-status">
              <option value="Done" selected>Done</option>
              <option value="In Progress">In Progress</option>
              <option value="To Do">To Do</option>
            </select>
          </div>
          <div class="control">
            <label for="tf-time">Time spent</label>
            <input id="tf-time" type="text" placeholder="e.g. 1.5h, 45m" />
          </div>
          <div class="control">
            <label for="tf-repo">Repo (optional)</label>
            <input id="tf-repo" type="text" list="tf-repo-list" placeholder="e.g. repo-dashboard" />
            <datalist id="tf-repo-list">${allRepos.map(r => `<option value="${escapeText(r.name)}"></option>`).join("")}</datalist>
          </div>
          <div class="control">
            <label for="tf-notes">Notes (optional)</label>
            <input id="tf-notes" type="text" placeholder="Any context…" />
          </div>
        </div>
        <div class="work-form-actions">
          <button class="btn-primary" id="btn-save-task">Save</button>
          <button class="btn-ghost" id="btn-cancel-task">Cancel</button>
        </div>
      </div>
      <div class="okr-today-list">${todayTasks}</div>
    </section>`;

  document.getElementById("btn-log-task").addEventListener("click", () => {
    document.getElementById("log-task-form").classList.toggle("hidden");
  });
  document.getElementById("btn-cancel-task").addEventListener("click", () => {
    document.getElementById("log-task-form").classList.add("hidden");
  });
  document.getElementById("btn-save-task").addEventListener("click", saveNewTask);
}

async function saveNewTask() {
  const okr_id = document.getElementById("tf-okr").value;
  const description = document.getElementById("tf-desc").value.trim();
  const status = document.getElementById("tf-status").value;
  const time_spent = document.getElementById("tf-time").value.trim() || null;
  const repo_name = document.getElementById("tf-repo").value.trim() || null;
  const notes = document.getElementById("tf-notes").value.trim() || null;

  if (!okr_id || !description) {
    alert("OKR and description are required.");
    return;
  }

  const body = JSON.stringify({ okr_id, description, status, time_spent, repo_name, notes });
  const doSave = async () => {
    const res = await fetch("/api/tasks", { method: "POST", headers: writeHeaders(), body });
    return handleWriteResponse(res, doSave);
  };

  try {
    await doSave();
    document.getElementById("log-task-form").classList.add("hidden");
    document.getElementById("tf-desc").value = "";
    document.getElementById("tf-time").value = "";
    document.getElementById("tf-repo").value = "";
    document.getElementById("tf-notes").value = "";
    await Promise.all([loadOkrStats(), loadRepoTaskData()]);
    renderOkrProgress();
    renderRepos();
  } catch (err) {
    alert("Failed to save task: " + err.message);
  }
}

// ============================================================
// Pipeline (Kanban) view
// ============================================================
const PIPELINE_COLS = [
  { status: "In Progress", label: "In Progress", cls: "pipeline-col-inprogress" },
  { status: "To Do",       label: "To Do",       cls: "pipeline-col-todo" },
  { status: "Done",        label: "Done",         cls: "pipeline-col-done" },
];

const NEXT_STATUS = { "To Do": "In Progress", "In Progress": "Done", "Done": null };

function renderPipeline() {
  const board = document.getElementById("pipeline-board");
  const filterEl = document.getElementById("pipeline-okr-filter");

  if (pipelineError) {
    board.innerHTML = errorBanner(`Failed to load pipeline — ${pipelineError}`, "retryPipeline");
    return;
  }

  // Populate OKR filter dropdown from loaded tasks
  const okrIds = [...new Set(pipelineTasks.map(t => t.okr_id))].sort();
  const currentFilter = filterEl.value;
  filterEl.innerHTML = `<option value="">All OKRs</option>` +
    okrIds.map(id => `<option value="${escapeText(id)}"${id === currentFilter ? " selected" : ""}>${escapeText(id)}</option>`).join("");
  pipelineOkrFilter = filterEl.value;

  const tasks = pipelineOkrFilter
    ? pipelineTasks.filter(t => t.okr_id === pipelineOkrFilter)
    : pipelineTasks;

  if (!tasks.length) {
    board.innerHTML = `<p class="empty-state">No tasks found. Use the MCP <code>log_task</code> tool or the OKR Progress tab to add tasks.</p>`;
    return;
  }

  const colsHtml = PIPELINE_COLS.map(col => {
    const colTasks = tasks.filter(t => t.status === col.status);
    const next = NEXT_STATUS[col.status];

    const cards = colTasks.map(t => {
      const advanceBtn = next
        ? `<button class="pipeline-advance-btn" data-task-id="${t.id}" data-next="${escapeText(next)}" aria-label="Advance to ${next}">→ ${escapeText(next)}</button>`
        : "";
      const timeChip = t.time_spent ? `<span class="pipeline-chip">${escapeText(t.time_spent)}</span>` : "";
      const started = t.started_at ? `<span class="pipeline-chip pipeline-chip-muted">Started ${t.started_at.slice(0, 10)}</span>` : "";
      const completed = t.completed_at ? `<span class="pipeline-chip pipeline-chip-muted">Done ${t.completed_at.slice(0, 10)}</span>` : "";
      return `
        <div class="pipeline-card${col.status === "Done" ? " pipeline-card-done" : ""}">
          <div class="pipeline-card-okr">${escapeText(t.okr_id)}</div>
          <div class="pipeline-card-desc">${escapeText(t.description)}</div>
          <div class="pipeline-card-meta">${timeChip}${started}${completed}</div>
          ${t.notes ? `<div class="pipeline-card-notes">${escapeText(t.notes)}</div>` : ""}
          <div class="pipeline-card-actions">${advanceBtn}</div>
        </div>`;
    }).join("");

    return `
      <div class="pipeline-col ${col.cls}">
        <div class="pipeline-col-header">
          <span class="pipeline-col-label">${col.label}</span>
          <span class="pipeline-col-count">${colTasks.length}</span>
        </div>
        <div class="pipeline-col-cards">${cards || `<p class="pipeline-empty">Nothing here</p>`}</div>
      </div>`;
  }).join("");

  board.innerHTML = colsHtml;

  // Advance-button handlers
  board.querySelectorAll(".pipeline-advance-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const taskId = btn.dataset.taskId;
      const nextStatus = btn.dataset.next;
      btn.disabled = true;
      btn.textContent = "Saving…";
      const doSave = async () => {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: "PUT",
          headers: writeHeaders(),
          body: JSON.stringify({ status: nextStatus }),
        });
        return handleWriteResponse(res, doSave);
      };
      try {
        await doSave();
        await loadPipelineTasks();
        renderPipeline();
        renderFocusStrip();
      } catch (err) {
        alert("Failed to update task: " + err.message);
        btn.disabled = false;
        btn.textContent = `→ ${nextStatus}`;
      }
    });
  });
}

// OKR filter change
document.getElementById("pipeline-okr-filter").addEventListener("change", e => {
  pipelineOkrFilter = e.target.value;
  renderPipeline();
});

// OKR category filter (rendered dynamically inside #okr-progress-list, use delegation)
document.getElementById("okr-progress-list").addEventListener("change", e => {
  if (e.target.id === "okr-category-filter") {
    okrCategoryFilter = e.target.value;
    renderOkrProgress();
  }
});

// OKR card expand/collapse
document.getElementById("okr-progress-list").addEventListener("click", async e => {
  const btn = e.target.closest("[data-expand-okr]");
  if (!btn) return;
  const okrId = btn.dataset.expandOkr;
  if (expandedOkrIds.has(okrId)) {
    expandedOkrIds.delete(okrId);
    renderOkrProgress();
    return;
  }
  expandedOkrIds.add(okrId);
  if (!okrTaskCache[okrId]) {
    okrTaskCache[okrId] = "loading";
    renderOkrProgress();
    try {
      const res = await fetch(`/api/tasks?okr_id=${encodeURIComponent(okrId)}`);
      okrTaskCache[okrId] = res.ok ? await res.json() : "error";
    } catch {
      okrTaskCache[okrId] = "error";
    }
  }
  renderOkrProgress();
});

// ============================================================
// Pull Requests — donut chart + history list
// ============================================================
let prData = null;
let prDataError = null;
let prHistoryRepo = "all";
let prHistoryState = "all";
let prHistorySearch = "";

async function loadPullRequests() {
  try {
    const res = await fetch("/data/pull_requests.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    prData = await res.json();
  } catch (err) {
    prDataError = err.message;
  }
}

function renderPullRequests() {
  const el = document.getElementById("pr-chart-container");
  if (!el) return;

  if (prData === null && !prDataError) {
    el.innerHTML = `<p class="view-loading">Loading PR data…</p>`;
    return;
  }
  if (prDataError) {
    el.innerHTML = `<p class="view-error">Failed to load PR data: ${prDataError}</p>`;
    return;
  }

  const repos = prData.repos || [];
  const totalPRs = prData.total_prs || 0;

  if (!repos.length || !totalPRs) {
    el.innerHTML = `<p class="view-empty">No PR data yet — the hourly <strong>Initialize &amp; Update Repo Dashboard</strong> workflow will populate this view.</p>`;
    return;
  }

  // Top 9 repos + "Other" for the rest
  const TOP = 9;
  const sorted = [...repos].sort((a, b) => b.total - a.total);
  const top = sorted.slice(0, TOP);
  const rest = sorted.slice(TOP);
  if (rest.length) {
    top.push({
      name: "Other",
      open: rest.reduce((s, r) => s + r.open, 0),
      merged: rest.reduce((s, r) => s + r.merged, 0),
      closed: rest.reduce((s, r) => s + r.closed, 0),
      total: rest.reduce((s, r) => s + r.total, 0),
    });
  }

  const COLORS = [
    "#4fd1c5", "#63b3ed", "#f6ad55", "#fc8181", "#b794f4",
    "#76e4f7", "#68d391", "#f6e05e", "#ed64a6", "#a0aec0"
  ];

  // SVG donut geometry
  const CX = 120, CY = 120, OR = 100, IR = 58;

  function pt(angleDeg, r) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
  }

  function arcPath(startDeg, endDeg, color, idx) {
    // Clamp near-full circles to avoid SVG arc edge case
    const sweep = Math.min(endDeg - startDeg, 359.99);
    const large = sweep > 180 ? 1 : 0;
    const endClamped = startDeg + sweep;
    const s1 = pt(startDeg, OR), s2 = pt(endClamped, OR);
    const s3 = pt(endClamped, IR), s4 = pt(startDeg, IR);
    const gap = 0.6; // degrees of gap between slices
    const gs = pt(startDeg + gap / 2, OR), ge = pt(endClamped - gap / 2, OR);
    const gi = pt(endClamped - gap / 2, IR), gis = pt(startDeg + gap / 2, IR);
    return `<path d="M ${gs.x} ${gs.y} A ${OR} ${OR} 0 ${large} 1 ${ge.x} ${ge.y} L ${gi.x} ${gi.y} A ${IR} ${IR} 0 ${large} 0 ${gis.x} ${gis.y} Z"
      fill="${color}" class="pr-slice" data-idx="${idx}" />`;
  }

  let angle = 0;
  const segments = top.map((repo, i) => {
    const pct = totalPRs > 0 ? repo.total / totalPRs : 0;
    const sweep = pct * 360;
    const path = arcPath(angle, angle + sweep, COLORS[i % COLORS.length], i);
    const seg = { repo, pct, sweep, color: COLORS[i % COLORS.length], path };
    angle += sweep;
    return seg;
  });

  let dateRangeLabel = "";
  const allPrHistory = prData.history || [];
  if (allPrHistory.length) {
    const dates = allPrHistory.map(p => new Date(p.created_at)).filter(d => !isNaN(d));
    if (dates.length) {
      const earliest = new Date(Math.min(...dates));
      const latest = new Date(Math.max(...dates));
      const fmt = d => d.toLocaleDateString(undefined, { year: "numeric", month: "short" });
      dateRangeLabel = ` · ${fmt(earliest)} – ${fmt(latest)}`;
    }
  }

  const freshness = prData.generated_at
    ? `<span class="pr-freshness">Updated ${new Date(prData.generated_at).toLocaleString()}</span>`
    : "";

  const svgSlices = segments.map(s => s.path).join("\n");

  const legendRows = segments.map(({ repo, pct, color }) => `
    <div class="pr-legend-row">
      <span class="pr-legend-swatch" style="background:${color}"></span>
      <span class="pr-legend-name" title="${repo.name}">${repo.name}</span>
      <span class="pr-legend-pct">${Math.round(pct * 100)}%</span>
      <span class="pr-legend-counts">
        <span class="pr-badge pr-open" title="Open">${repo.open}</span>
        <span class="pr-badge pr-merged" title="Merged">${repo.merged}</span>
        <span class="pr-badge pr-closed" title="Closed">${repo.closed}</span>
      </span>
    </div>`).join("");

  // History list
  const history = prData.history || [];
  const repoNames = [...new Set(history.map(p => p.repo))].sort();

  const filtered = history.filter(p => {
    if (prHistoryRepo !== "all" && p.repo !== prHistoryRepo) return false;
    if (prHistoryState !== "all" && p.state !== prHistoryState) return false;
    if (prHistorySearch) {
      const q = prHistorySearch.toLowerCase();
      if (!p.title.toLowerCase().includes(q) && !p.repo.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const PAGE = 100;
  const shown = filtered.slice(0, PAGE);
  const moreCount = Math.max(0, filtered.length - PAGE);

  const historyRows = shown.map(p => {
    const date = p.merged_at || p.closed_at || p.created_at;
    const dateStr = date ? new Date(date).toLocaleDateString() : "";
    const stateClass = p.state === "open" ? "pr-open" : p.state === "merged" ? "pr-merged" : "pr-closed";
    return `
    <div class="pr-history-row">
      <span class="pr-badge ${stateClass} pr-history-state">${p.state}</span>
      <div class="pr-history-main">
        <a href="${p.url}" target="_blank" rel="noopener" class="pr-history-title">${escapeText(p.title)}</a>
        <div class="pr-history-meta">
          <span>${escapeText(p.repo)}</span>
          <span>#${p.number}</span>
          ${p.author ? `<span>${escapeText(p.author)}</span>` : ""}
          <span>${dateStr}</span>
        </div>
      </div>
    </div>`;
  }).join("");

  const repoOptions = repoNames.map(n =>
    `<option value="${n}" ${prHistoryRepo === n ? "selected" : ""}>${n}</option>`
  ).join("");

  el.innerHTML = `
    <div class="pr-meta-row">${freshness} <span class="pr-total-label">${totalPRs} total PRs across ${repos.length} repos${dateRangeLabel}</span></div>
    <div class="pr-chart-wrap">
      <svg viewBox="0 0 240 240" class="pr-donut-svg" role="img" aria-label="Donut chart showing PR share by repository">
        ${svgSlices}
        <text x="${CX}" y="${CY - 8}" class="pr-center-count" text-anchor="middle">${totalPRs}</text>
        <text x="${CX}" y="${CY + 14}" class="pr-center-label" text-anchor="middle">Total PRs</text>
      </svg>
      <div class="pr-legend">
        <div class="pr-legend-header">
          <span></span><span></span><span></span>
          <span class="pr-badge pr-open" title="Open">●</span>
          <span class="pr-badge pr-merged" title="Merged">●</span>
          <span class="pr-badge pr-closed" title="Closed">●</span>
        </div>
        <div class="pr-legend-hint-row">
          <span></span><span></span><span></span>
          <span class="pr-badge-label">open</span>
          <span class="pr-badge-label">merged</span>
          <span class="pr-badge-label">closed</span>
        </div>
        ${legendRows}
      </div>
    </div>
    <div class="pr-history-section">
      <div class="pr-history-filters">
        <select onchange="prHistoryRepo=this.value;renderPullRequests()">
          <option value="all" ${prHistoryRepo === "all" ? "selected" : ""}>All repos</option>
          ${repoOptions}
        </select>
        <select onchange="prHistoryState=this.value;renderPullRequests()">
          <option value="all"    ${prHistoryState === "all"    ? "selected" : ""}>All states</option>
          <option value="open"   ${prHistoryState === "open"   ? "selected" : ""}>Open</option>
          <option value="merged" ${prHistoryState === "merged" ? "selected" : ""}>Merged</option>
          <option value="closed" ${prHistoryState === "closed" ? "selected" : ""}>Closed</option>
        </select>
        <input type="search" placeholder="Search title or repo…"
          value="${prHistorySearch.replace(/"/g, '&quot;')}"
          oninput="prHistorySearch=this.value;renderPullRequests()" />
        <span class="pr-history-count">${filtered.length} PR${filtered.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="pr-history-list">
        ${historyRows || '<p class="empty-state">No PRs match this filter.</p>'}
        ${moreCount ? `<p class="pr-history-more">+ ${moreCount} more — narrow the filter to see all</p>` : ""}
      </div>
    </div>`;
}

// ============================================================
// Focus strip — current priority micro-task in the header (#106)
// ============================================================
// Source: OKR micro-tasks (pipelineTasks). "Current" = In Progress tasks, oldest
// start first; if none are in progress, falls back to the next unblocked To Do.
//
// Two designs under test, switchable via ?header=simple|interactive or the
// toggle button in the strip (remembered per browser):
//   simple      — read-only line; click jumps to the Pipeline tab.
//   interactive — adds ‹ › cycling, an inline Advance button, and art that
//                 responds to attention: a glow that follows the pointer, a
//                 tunnel canvas that quickens as the pointer nears the header,
//                 and a slow "breathing" pulse after idle or on returning to
//                 the tab, to draw focus back to the task.
const FOCUS_MODES = ["simple", "interactive"];
const FOCUS_IDLE_MS = 90 * 1000;
const FOCUS_AWAY_MS = 60 * 1000;
let focusMode = initialFocusMode();
let focusIndex = 0;
let focusLastActivity = Date.now();
let focusHiddenAt = null;

// Shared with tunnel.js: level 0..1 = how much attention is on the header.
window.headerAttention = { level: 0, pulseAt: 0 };

function initialFocusMode() {
  const param = new URLSearchParams(location.search).get("header");
  if (FOCUS_MODES.includes(param)) return param;
  try {
    const saved = localStorage.getItem("focusStripMode");
    if (FOCUS_MODES.includes(saved)) return saved;
  } catch { /* storage unavailable — use default */ }
  return "simple";
}

function setFocusMode(mode) {
  focusMode = mode;
  try { localStorage.setItem("focusStripMode", mode); } catch { /* ignore */ }
  renderFocusStrip();
}

function focusCandidates() {
  const inProgress = pipelineTasks
    .filter(t => t.status === "In Progress" && !t.is_assignment)
    .sort((a, b) => (a.started_at || "~").localeCompare(b.started_at || "~"));
  if (inProgress.length) return { tasks: inProgress, fallback: false };
  const next = pipelineTasks.find(t =>
    t.status === "To Do" && !t.is_assignment &&
    (!t.blocked_by_status || t.blocked_by_status === "Done"));
  return { tasks: next ? [next] : [], fallback: true };
}

function focusElapsed(startedAt) {
  if (!startedAt) return "";
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(startedAt) ? startedAt : startedAt.replace(" ", "T") + "Z";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just started";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

function renderFocusStrip() {
  const strip = document.getElementById("focus-strip");
  if (!strip) return;
  const { tasks, fallback } = focusCandidates();
  if (pipelineError || !tasks.length) {
    strip.hidden = true;
    return;
  }
  focusIndex = ((focusIndex % tasks.length) + tasks.length) % tasks.length;
  const t = tasks[focusIndex];
  const interactive = focusMode === "interactive";
  const label = fallback ? "Up next" : "Now";
  const elapsed = fallback ? "" : focusElapsed(t.started_at);
  const next = NEXT_STATUS[t.status];

  const cycle = interactive && tasks.length > 1 ? `
    <div class="focus-cycle">
      <button class="focus-btn" data-focus-action="prev" aria-label="Previous in-progress task">‹</button>
      <span class="focus-count">${focusIndex + 1}/${tasks.length}</span>
      <button class="focus-btn" data-focus-action="next" aria-label="Next in-progress task">›</button>
    </div>` : "";
  const advance = interactive && next ? `
    <button class="focus-btn focus-advance" data-focus-action="advance" data-task-id="${t.id}" data-next="${escapeText(next)}">
      ${next === "Done" ? "✓ Done" : "▶ Start"}
    </button>` : "";
  const toggleTo = interactive ? "simple" : "interactive";

  strip.hidden = false;
  strip.className = `focus-strip focus-strip--${focusMode}`;
  strip.innerHTML = `
    <div class="focus-inner">
      <button class="focus-main" data-focus-action="open" title="Open in Pipeline">
        <span class="focus-label${fallback ? " focus-label--next" : ""}">${label}</span>
        <span class="focus-okr">${escapeText(t.okr_id)}</span>
        <span class="focus-desc">${escapeText(t.description)}</span>
        ${elapsed ? `<span class="focus-elapsed" data-started="${escapeText(t.started_at)}">${elapsed}</span>` : ""}
      </button>
      ${cycle}
      ${advance}
      <button class="focus-btn focus-mode-toggle" data-focus-action="mode" data-mode="${toggleTo}"
        title="Switch header design to ${toggleTo}" aria-label="Switch header design to ${toggleTo}">
        ${interactive ? "◐" : "◑"}
      </button>
    </div>`;
  if (!interactive) window.headerAttention.level = 0;
}

document.getElementById("focus-strip").addEventListener("click", async e => {
  const btn = e.target.closest("[data-focus-action]");
  if (!btn) return;
  const action = btn.dataset.focusAction;
  if (action === "open") {
    switchTab("pipeline");
  } else if (action === "mode") {
    setFocusMode(btn.dataset.mode);
  } else if (action === "prev" || action === "next") {
    focusIndex += action === "next" ? 1 : -1;
    renderFocusStrip();
  } else if (action === "advance") {
    const nextStatus = btn.dataset.next;
    btn.disabled = true;
    btn.textContent = "Saving…";
    const doSave = async () => {
      const res = await fetch(`/api/tasks/${btn.dataset.taskId}`, {
        method: "PUT",
        headers: writeHeaders(),
        body: JSON.stringify({ status: nextStatus }),
      });
      return handleWriteResponse(res, doSave);
    };
    try {
      await doSave();
      await loadPipelineTasks();
      renderFocusStrip();
      if (!document.getElementById("view-pipeline").classList.contains("hidden")) renderPipeline();
      if (!document.getElementById("view-today").classList.contains("hidden")) renderToday();
      window.headerAttention.pulseAt = performance.now();
    } catch (err) {
      alert("Failed to update task: " + err.message);
      renderFocusStrip();
    }
  }
});

// Attention tracking — only drives visuals in interactive mode.
(function trackFocusAttention() {
  const header = document.querySelector(".topbar");
  const strip = document.getElementById("focus-strip");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function markActive() {
    focusLastActivity = Date.now();
    strip.classList.remove("focus-strip--drifting");
  }

  document.addEventListener("pointermove", e => {
    markActive();
    if (focusMode !== "interactive") return;
    const rect = header.getBoundingClientRect();
    // Attention fades from 1 inside the header to 0 at ~240px below it.
    const dist = Math.max(0, e.clientY - rect.bottom);
    window.headerAttention.level = Math.max(0, 1 - dist / 240);
    strip.style.setProperty("--focus-x", `${((e.clientX - rect.left) / rect.width) * 100}%`);
    strip.style.setProperty("--focus-level", window.headerAttention.level.toFixed(2));
  }, { passive: true });
  ["keydown", "scroll", "pointerdown"].forEach(ev =>
    document.addEventListener(ev, markActive, { passive: true }));

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      focusHiddenAt = Date.now();
      return;
    }
    const away = focusHiddenAt && Date.now() - focusHiddenAt > FOCUS_AWAY_MS;
    focusHiddenAt = null;
    renderFocusStrip();
    if (away && focusMode === "interactive" && !reduceMotion.matches) {
      strip.classList.remove("focus-strip--welcome");
      void strip.offsetWidth; // restart the animation
      strip.classList.add("focus-strip--welcome");
      window.headerAttention.pulseAt = performance.now();
    }
  });

  // Tick: refresh elapsed times; enter the idle "drift" state.
  setInterval(() => {
    strip.querySelectorAll(".focus-elapsed[data-started]").forEach(el => {
      el.textContent = focusElapsed(el.dataset.started);
    });
    const idle = Date.now() - focusLastActivity > FOCUS_IDLE_MS;
    strip.classList.toggle("focus-strip--drifting",
      idle && focusMode === "interactive" && !reduceMotion.matches);
  }, 15 * 1000);
})();

// ============================================================
// Init
// ============================================================
async function init() {
  await Promise.all([loadRepos(), loadWorkItems(), loadPriorityData(), loadOkrStats(), loadRepoTaskData(), loadPipelineTasks(), loadResources(), loadIdentity(), loadCollegeDeadlines(), loadCollegeDailyTasks(), loadPullRequests()]);
  renderToday();   // Today is the landing view
  renderRepos();   // pre-render repos with work items overlaid
  renderFocusStrip();
}

init();
